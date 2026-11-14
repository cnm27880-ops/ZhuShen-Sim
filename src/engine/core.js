// 核心：遊戲狀態、輪迴者、經濟（維持費／高利貸／回收爐）、抽卡、時間推進。
// 這裡完全不碰畫面（DOM），所以可以直接用 Node 跑測試。

import { CONFIG, RANKS, INJURIES, PAUSE_EVENTS } from "../data/config.js";
import { SURNAMES, GIVEN_NAMES } from "../data/names.js";
import { rand, randInt, pick, weighted } from "./rng.js";
import { rollTags, hpRestBonus } from "./tags.js";
import { findSpecialRewardByName, getSpecialReward } from "../data/dungeons.js";
import { migrateWorldId } from "../data/worlds.js";
import { logText } from "./templates.js";
import { dailyWishes, cancelWishesOf } from "./wishes.js"; // 同上，循環引用只要載入時不呼叫就沒問題
import { dailyGod, cancelGodOf, newGodState } from "./godEvents.js"; // 同上（Phase 3-E 主神搞事）
import { dailyNursery, newNurseryState, podCost } from "./children.js"; // 同上（Phase 3-F 生小孩）
import { enshrine, refreshSteleBonus, steleBonusOf } from "./memorial.js"; // 同上（Phase 4-C-5 英靈碑）
import { dailyMandatory, newMandatoryState } from "./mandatory.js"; // 同上（Phase 4-C-4 主神強制任務）
import { dailySanity, newSanityState } from "./sanity.js"; // 同上（Phase 4-C-2 理智暴走）
import { newGrowthState } from "./growth.js"; // 同上（Phase 4-B 基因鎖／強化／頓悟；growth.js 也會 import 這個檔案）
import { taxSanityDaily, forfeitWallet } from "./wallet.js"; // 同上（Phase 4-D-1 雙錢包）
import { dailyShopping } from "./shopping.js"; // 同上（Phase 4-D-3 輪迴者自主逛街）
import { newMarketState, refreshMarket, dailyMarket, refreshStaleSlots } from "./market.js";
import { gearDaily } from "./gearFx.js"; // 裝備被動日結（4-E-8） // 同上（Phase 4-D-2 黑市）
import { newBoardState, fillBoard, dailyBoard } from "./board.js"; // 同上（Phase 4-D-4 動態任務榜）
import { relicBonusOf, refreshRelicBonus } from "./relics.js"; // 同上（Phase 4-D-4 奇物圖鑑）
import { leaveHeirloom, dailyLineage } from "./lineage.js"; // 同上（Phase 4-E-4 遺物、子嗣、叛逃）
import { dailyDrama } from "./drama.js"; // 同上（Phase 4-E-3 5:2:1 狗血事件）
import { newSquadState, dailySquad, refreshCaptainBonus, squadUpkeepMult, communalInherit } from "./squad.js"; // 同上（Phase 4-E 小隊隊長與流派）
import { dailyRelations } from "./relations.js"; // 注意：relations.js 也會 import 這個檔案，只要不在載入時就呼叫，循環引用沒問題

// ───────── 事件與日誌 ─────────

/** 寫一條日誌，同時丟進 state.events 讓畫面層決定要不要自動暫停 */
export function emit(state, type, text, data = {}) {
  const entry = { day: currentDay(state), type, text };
  state.log.push(entry);
  if (state.log.length > CONFIG.logMax) state.log.splice(0, state.log.length - CONFIG.logMax);
  state.events.push({ type, text, ...data });
}

export function currentDay(state) {
  return Math.floor(state.tick / CONFIG.ticksPerDay) + 1;
}

// ───────── 建立新遊戲 ─────────

export function createNewGame(seed = (Date.now() ^ 0x5eed) | 0) {
  const pauseOn = {};
  for (const [key, def] of Object.entries(PAUSE_EVENTS)) pauseOn[key] = def.default;

  const state = {
    version: 1,
    rngState: seed | 0,
    tick: 0,
    points: CONFIG.startingPoints,
    totalSpent: 0, // 累積花費（商店階級解鎖用；公庫與輪迴者私房錢在商店／黑市／強化的消費一律累加，4-D-1）
    taxRate: CONFIG.tax.default, // 公庫稅率：副本結算總積分先抽這個比例入公庫，其餘由存活隊員平分（4-D-1）
    spaceLevel: 1, // 空間等級 Lv.1~5（Phase 4-A）：每首通一章尾王 +1，決定維持費、破產線、解鎖到第幾章
    chapterClearDay: {}, // { 章節: 首通尾王是第幾天 }（npm run sim 統計用）
    chapterClears: {}, // { 章節: 該章前 3 關合計成功結算幾次 }，尾王守門用（CONFIG.bossGate，見 engine/dungeon.js）
    karmaCrystals: 0, // 因果結晶（神級卡池每抽消耗 1 顆；副本掉落，見 engine/dungeon.js）
    gacha: newGachaState(), // 四卡池：本週抽數（漲價計數）與保底計數
    growth: newGrowthState(seed), // 頓悟：獨立亂數流（見 engine/growth.js）
    nextId: 1,
    samsarites: [],
    graveyard: [],
    memorialStele: [], // 英靈碑名單（見 engine/memorial.js）
    relations: {}, // 關係矩陣（見 engine/relations.js）
    wishes: [], // 進行中的許願（見 engine/wishes.js）
    nextWishId: 1,
    nursery: newNurseryState(seed), // 生小孩：獨立亂數流（見 engine/children.js）
    mandatory: newMandatoryState(seed), // 主神強制血腥任務：計時與待派任務（見 engine/mandatory.js）
    airdrop: newAirdropState(seed), // 絕境空投：連續天數與獨立亂數流（見下方 dailyAirdrop）
    sanity: newSanityState(seed), // 理智暴走：獨立亂數流（見 engine/sanity.js）
    god: newGodState(seed), // 主神搞事：冷卻、待回覆事件、突襲任務（見 engine/godEvents.js）
    market: newMarketState(seed), // 8 格分槽黑市（含獨立亂數流 market.rngState；見 engine/market.js）
    aiShopRngState: (seed ^ 0x5b0b) | 0, // 輪迴者自主逛街的獨立亂數流（見 engine/shopping.js）
    autoStrategy: CONFIG.auto.defaultStrategy, // 自動派遣風險策略 safe／balanced／aggressive（4-E-8，見 engine/dispatch.js）
    autoRiskLogDay: null, // 上次提示「任務風險過高」是第幾天（避免洗版）
    squad: newSquadState(), // 小隊隊長、流派、共產互助金（Phase 4-E，見 engine/squad.js）
    squadRngState: (seed ^ 0x5ad0) | 0, // 小隊獨立亂數流：政變、擋刀、狗血事件、子嗣、叛逃（4-E 全域設計原則）
    chronicles: [], // 《空間編年史》：[{ day, kind, text }]，最多 100 條（見 engine/lineage.js）
    armoryHeirlooms: [], // 先人遺物庫：最多 8 件（見 engine/lineage.js）
    rogueBosses: [], // 叛逃的野生魔王：最多 5 名（見 engine/lineage.js）
    board: newBoardState(), // 動態任務榜：3 個常規任務槽，每槽附帶 1 個突變詞綴（見 engine/board.js）
    relicCodex: [], // 奇物永久圖鑑（奇物 id；見 engine/relics.js，全隊戰力加成封頂 +25%）
    cooldowns: {}, // 事件冷卻：{ 事件:配對 → 第幾天後才能再發生 }
    dungeonStats: {}, // { 副本id: { attempts, clears } }；clears > 0 代表已有該副本情報
    collection: [], // 副本特殊獎勵 id（定義在 data/dungeons.js），永久生效，效果見 engine/shop.js collectionEffects
    runs: [], // 進行中的副本（可同時多場）：{ id, startTick, dungeonId, envId, partyIds, roomIndex, results… }，見 engine/dungeon.js
    nextRunId: 1,
    runReports: [], // 還沒給玩家看的副本結算摘要（結算視窗排隊用）
    lastRun: null, // 最近一場副本的結算摘要
    gameOver: false,
    settings: {
      speed: 1,
      paused: false,
      autoDispatch: false,
      autoPause: true, // 總開關：派遣／抽卡／許願／主神事件／指揮部彈窗開著時自動暫停計時（關掉就不強制暫停）
      guideSeen: false, // 新任主神上崗手冊讀過了沒（4-D-7，讀過就不再自動彈出）
      followId: null, // 視角鎖定的輪迴者 id（只給畫面用，引擎不讀）；null = 沒鎖定
      protect: { noInjured: true, noEnemies: true },
      pauseOn,
    },
    log: [],
    events: [], // 暫存、不進存檔
  };

  for (let i = 0; i < CONFIG.startingSamsarites; i++) {
    state.samsarites.push(createSamsarite(state, CONFIG.startingRank));
  }
  refreshMarket(state, { silent: true }); // 開局先上一批貨（不寫日誌）
  fillBoard(state); // 開局先貼好 3 張任務榜
  emit(state, "system", logText(state, "start", { n: CONFIG.startingSamsarites }));
  return state;
}

// ───────── 輪迴者 ─────────

/** rng：抽數值／名字／標籤用的亂數來源，預設是主亂數；生小孩傳入獨立亂數流，才不會動到既有種子結果 */
export function createSamsarite(state, rank, rng = state) {
  const r = RANKS[rank];
  const roll = ([min, max]) => randInt(rng, min, max);
  return {
    id: state.nextId++,
    name: pick(rng, SURNAMES) + pick(rng, GIVEN_NAMES),
    rank,
    stats: {
      hp: roll(r.hp),
      power: roll(r.power),
      defense: roll(r.defense),
      speed: roll(r.speed),
      sanity: 100,
      luck: roll(r.luck),
    },
    injury: 0, // 0 無傷 / 1 輕傷 / 2 重傷 / 3 致命傷
    restDaysLeft: 0,
    locked: false, // 🔒 鎖定後不參與自動派遣
    location: "space", // "space" 主神空間 / "dungeon" 副本中 / "pod" 催熟艙（嬰兒，不能派遣、不參與日常事件）
    podDaysLeft: 0, // 催熟艙剩幾天（location "pod" 才有意義）
    parents: null, // 小孩才有：[家長id, 家長id]
    tags: rollTags(rng), // 標籤 id 陣列，資料在 src/data/tags.js
    geneLock: 0, // 基因鎖階數 0~4（上限依階級，見 RANKS.maxGene；engine/growth.js）
    enhanceCount: 0, // 個人強化累計次數（上限跟基因鎖階數走）
    insightCount: 0, // 通關頓悟累計次數（上限 = (基因鎖階數 + 1) × 4）
    relicBonus: relicBonusOf(state), // 奇物圖鑑的全隊戰力加成（4-D-4；圖鑑變動時由 refreshRelicBonus 更新）
    steleBonus: steleBonusOf(state), // 英靈碑的全隊戰力加成（4-C-5；碑變動時由 refreshSteleBonus 更新）
    inheritPower: 0, // 子嗣繼承值（4-E 才會用，先預留；算進本體值、會吃基因鎖乘區）
    gear: {}, // 商店裝備：{ weapon: 商品id, armor: 商品id }
    joinedDay: currentDay(state),
    runs: 0,
    mood: null, // 心情狀態 { kind: "happy"|"upset", daysLeft }（見 engine/wishes.js）
    vacationDays: 0, // 許願放假：剩幾天不能派遣
    sabotaged: false, // 裝備被人動了手腳（借刀殺人），下次出征會倒楣
    wallet: 0, // 私房錢（4-D-1）：副本分潤進來，輪迴者自己逛街、強化用（見 engine/shopping.js）；戰死 50% 充公，回收 100% 歸公庫
    consumables: [], // 出征耗材緩衝區：商品 id 陣列，下次出發時全部套用成單場 runBuff（4-D-2）
    runBuff: null, // 單場 buff { injuryShield, defense, speed }，出征時由 consumables 轉成、回家清空
    lastDramaDay: null, // 上次偷買黑貨是第幾天（4-D-7：10 天冷卻）
    customProfile: null, // 預留（未來自訂姓名／頭像與分享卡片，目前不實裝邏輯）
    shopLog: [], // 最近的自主購買紀錄 [{ day, text }]（4-D-3，UI 查閱用）
    lockedInPodBy: null, // 被誰鎖進私人休眠艙（0 = 主管）；podLockDays 倒數，期間不能派遣、不能逛街（4-D-2 狗血黑貨）
    podLockDays: 0,
    soulbound: {}, // 公庫賞賜的裝備綁定 { weapon: true, … }：輪迴者自己逛街時不會覆蓋（4-D-1）
    generation: 1, // 世代（4-E-4）：初代 1，子嗣 = max(父, 母) + 1
    bondPartnerId: null, // 生死搭檔（4-E-3）：互為搭檔的人同隊出征，雙方有效戰力小幅加成
    heirloomSlots: {}, // 哪個欄位穿的是先人遺物 { weapon: true }（裝備白值 +10%，4-E-4）
    captainBonus: 0, // 現任隊長的個人戰力加成（由 refreshCaptainBonus 寫入，effectivePower 讀）
    tempPowerPct: 0, // 單場臨時戰力加成（養殖流：肉豬陣亡的隊長；副本結算清掉）
    captainNo: null, // 他是第幾任隊長（遺物履歷用）
    maxBossChapter: 0, // 他參與討伐過的最高章節尾王（遺物履歷用）
    cozyUntilDay: 0, // 社交助興狀態持續到第幾天（合道仙露，4-E-8 收尾：孕育檢定加成）
    elixirUses: 0, // 九轉金丹永久強化已用幾次（單人上限 3，4-E-8）
    deathWardFull: false, // 這張護符是否「全狀態恢復」型（高階）
    deathWard: 0, // 替死護符層數（上限 1；致死判定時消耗，4-E-8）
    geneBuff: null, // 基因鎖助推 Buff { target, costDiscount }（突破該階後消耗，4-E-8）
    talentPct: 0, // 子嗣天賦白值占基礎戰力的比例（4-E-4，總封頂 +25%；inheritPower = round(stats.power × talentPct)）
  };
}

export function getSamsarite(state, id) {
  return state.samsarites.find((s) => s.id === id);
}

/** 維持費的兩個基準部分：個人基因鎖基準費 + 空間環境底費（Phase 4-C-3；沒傳 state 當 Lv.1） */
export function upkeepPartsOf(s, state = null) {
  return {
    gene: CONFIG.space.upkeepGene[s.geneLock ?? 0] ?? 0,
    space: CONFIG.space.upkeepSpace[(state?.spaceLevel ?? 1) - 1] ?? 0,
  };
}

/** 每日維持費 = （個人基因鎖基準費 + 空間環境底費）×（1 + 階級附加% + 傷勢醫藥費%），四捨五入 */
export function upkeepOf(s, state = null) {
  if (s.location === "pod") return CONFIG.child.podUpkeep; // 催熟艙的嬰兒只吃固定的小額
  const { gene, space } = upkeepPartsOf(s, state);
  return Math.round((gene + space) * (1 + RANKS[s.rank].upkeepPct + INJURIES[s.injury].upkeepPct) * (state ? squadUpkeepMult(state, s) : 1) * (state && (state.spaceLevel ?? 1) === 1 ? CONFIG.space.newbieUpkeepMult : 1)); // 養殖流零階新人 -50%（4-E-2）；新手期空間 Lv.1 -50%（4-E-7）
}

export function setInjury(s, level) {
  s.injury = level;
  s.restDaysLeft = INJURIES[level].restDays;
}

/** killer：被同伴害死時的兇手（怪物殺的就不傳）。連鎖反應在 relations.js 的 afterDeath，由呼叫端接著呼叫 */
export function killSamsarite(state, s, cause, killer = null, stele = null) {
  if (stele === "dungeon") leaveHeirloom(state, s); // 副本戰死：老鳥／隊長的最高階裝備不消失，存進遺物庫（要在移出名冊前，4-E-4）
  state.samsarites = state.samsarites.filter((x) => x.id !== s.id);
  cancelWishesOf(state, s.id);
  cancelGodOf(state, s.id);
  state.graveyard.push({ name: s.name, rank: s.rank, day: currentDay(state), cause, killer: killer?.name ?? null });
  if (!communalInherit(state, s)) forfeitWallet(state, s, CONFIG.wallet.deathForfeitPct); // 私房錢 50% 充公、50% 消散（4-D-1）；共產流全進互助金（4-E-2）
  if (stele) enshrine(state, s, stele); // 副本戰死／主神抹殺才入碑（4-C-5）
  emit(state, "death", logText(state, "death", { A: s, rank: s.rank, cause }), { samsariteId: s.id, killerId: killer?.id ?? null });
}

/** 把某人從關係矩陣裡清掉（死亡或被回收之後） */
export function forgetRelations(state, id) {
  for (const key of Object.keys(state.relations ?? {})) {
    const [a, b] = key.split(">").map(Number);
    if (a === id || b === id) delete state.relations[key];
  }
}

function loseSanity(s, amount) {
  s.stats.sanity = Math.max(0, s.stats.sanity - amount);
}

// ───────── 經濟 ─────────

/** 主神高利貸上限（破產線），跟空間等級走 */
export function debtLimitOf(state) {
  return CONFIG.space.debtLimit[(state.spaceLevel ?? 1) - 1];
}

/** 積分可以花到負的（主神高利貸），但不能低於上限 */
export function canAfford(state, cost) {
  return state.points - cost >= debtLimitOf(state);
}

/** 商店目前開到第幾階（1~4），依累積花費 totalSpent 和 CONFIG.shopTierUnlock 決定 */
export function shopTier(state) {
  let tier = 1;
  CONFIG.shopTierUnlock.forEach((need, i) => {
    if (state.totalSpent >= need) tier = i + 1;
  });
  return tier;
}

/** 累加累積花費（公庫與私房錢的消費都走這裡），跨過商店階層門檻就宣布解鎖 */
export function addSpent(state, cost) {
  const tierBefore = shopTier(state);
  state.totalSpent += cost;
  const tierAfter = shopTier(state);
  if (tierAfter > tierBefore) {
    emit(state, "shopTier", logText(state, "shopTier", { tier: tierAfter, spent: state.totalSpent }), { tier: tierAfter });
  }
}

export function spend(state, cost) {
  if (!canAfford(state, cost)) return false;
  const wasInDebt = state.points < 0;
  state.points -= cost;
  announceDebtIfNew(state, wasInDebt);
  addSpent(state, cost);
  return true;
}

/** 輪迴者用私房錢付帳：不能欠債，花費同樣累加進 totalSpent */
export function spendWallet(state, s, cost) {
  if ((s.wallet ?? 0) < cost) return false;
  s.wallet -= cost;
  addSpent(state, cost);
  return true;
}

export function announceDebtIfNew(state, wasInDebt) {
  if (!wasInDebt && state.points < 0) {
    emit(state, "debt", logText(state, "debt", { limit: debtLimitOf(state) }));
  }
}

/** 一天結束：留守人員扣維持費、休息養傷；負債就電擊 */
export function endOfDay(state) {
  const day = state.tick / CONFIG.ticksPerDay; // 剛結束的那一天
  const atHome = state.samsarites.filter((s) => s.location === "space");

  let cost = 0;
  for (const s of atHome) {
    cost += upkeepOf(s, state); // 先用「今天的傷勢」算錢，再結算休息
    s.stats.sanity = Math.min(100, s.stats.sanity + CONFIG.sanity.restRecover); // 人在空間（含帶傷休養）每日自然恢復理智（4-C-2）
    taxSanityDaily(state, s); // 稅率高壓／低稅的每日理智影響（4-D-1）
    gearDaily(state, s); // 黑貨裝備被動：每日理智、入魔傾向（4-E-8）
    if (s.podLockDays > 0 && --s.podLockDays <= 0) s.lockedInPodBy = null; // 私人休眠艙倒數（4-D-2）
    if (s.injury > 0) {
      s.restDaysLeft -= 1;
      if (s.restDaysLeft <= 0) {
        setInjury(s, 0);
        emit(state, "healed", logText(state, "healed", { A: s }), { samsariteId: s.id });
      }
    }
    // 體魄（Phase 4-C-1）：總 hp 超過 100 的部分每滿 40 點，+25% 機率額外多恢復 1 級（降 1 級，休養天數重算；沒有額外加成時不消耗亂數）
    if (s.injury > 0) {
      const { sure, chance } = hpRestBonus(s);
      const extra = sure + (chance > 0 && rand(state) < chance ? 1 : 0);
      if (extra > 0) {
        setInjury(s, Math.max(0, s.injury - extra));
        if (s.injury === 0) emit(state, "healed", logText(state, "healed", { A: s }), { samsariteId: s.id });
      }
    }
  }

  cost += podCost(state); // 催熟艙裡的嬰兒也要吃飯
  const wasInDebt = state.points < 0;
  state.points -= cost;
  const hitLimit = state.points < debtLimitOf(state);
  if (hitLimit) state.points = debtLimitOf(state);

  emit(state, "dayEnd", logText(state, "dayEnd", { day, home: atHome.length, cost }));
  announceDebtIfNew(state, wasInDebt);
  dailyShopping(state); // 輪迴者用私房錢自主逛街、強化（維持費與休養之後，4-D-3）
  dailyAirdrop(state);

  if (state.points < 0 && state.samsarites.length > 0) {
    if (hitLimit) {
      // 債務頂到上限還付不出來：主神暴怒，全員電擊（計畫未定的暫定處理）
      for (const s of state.samsarites) loseSanity(s, CONFIG.debtShockSanity);
      emit(state, "shock", logText(state, "shockAll", { san: CONFIG.debtShockSanity }));
    } else {
      const victim = pick(state, state.samsarites);
      loseSanity(victim, CONFIG.debtShockSanity);
      emit(state, "shock", logText(state, "shockOne", { A: victim, san: CONFIG.debtShockSanity }));
    }
  }
}

// ───────── 絕境空投（Phase 4-C-3）─────────

export function newAirdropState(seed = 0) {
  return { rngState: (seed ^ 0xa1d0) | 0, days: 0 };
}

/** 每日結算尾端：名冊（不含催熟艙）< 2 人且積分 < 120 連續滿 3 天，主神免費空投 1 名 C 級新人，防止死檔。條件中斷就歸零 */
export function dailyAirdrop(state) {
  const ad = (state.airdrop ??= newAirdropState(state.rngState));
  const cfg = CONFIG.airdrop;
  const alive = state.samsarites.filter((s) => s.location !== "pod").length;
  if (state.gameOver || alive >= cfg.minAlive || state.points >= cfg.pointsBelow) {
    ad.days = 0;
    return null;
  }
  ad.days += 1;
  if (ad.days < cfg.everyDays) return null;
  ad.days = 0;
  const s = createSamsarite(state, cfg.rank, ad); // 用獨立亂數流，不動主亂數
  state.samsarites.push(s);
  emit(state, "airdrop", logText(state, "airdrop", { A: s, rank: s.rank }), { samsariteId: s.id });
  return s;
}

/** 主神回收爐：把人做成營養液，換一點積分，其他人理智下降 */
export function recycle(state, id) {
  const s = getSamsarite(state, id);
  if (!s || s.location !== "space") return false;
  state.samsarites = state.samsarites.filter((x) => x.id !== id);
  state.graveyard.push({ name: s.name, rank: s.rank, day: currentDay(state), cause: "被主管推進回收爐" });
  forgetRelations(state, id);
  cancelWishesOf(state, id);
  cancelGodOf(state, id);
  const refund = RANKS[s.rank].recycleRefund; // 依階級返還（C 30／B 80／A 250／S 800）
  forfeitWallet(state, s, 1); // 主動回收：私房錢 100% 歸公庫（4-D-1）
  state.points += refund;
  for (const other of state.samsarites) loseSanity(other, CONFIG.recycle.sanityLoss);
  emit(
    state,
    "recycle",
    logText(state, "recycle", { A: s, points: refund, san: CONFIG.recycle.sanityLoss })
  );
  checkGameOver(state);
  return true;
}

// ───────── 抽卡（Phase 4-B：四階卡池）─────────
// 每個卡池有「本週已抽次數」（每 resetDays 天重置，用來漲價）與「保底計數」（跨週保留，抽中保底階級才歸零）。
// 週數是從目前天數算出來的（第 1~7 天 = 第 0 週，第 8~14 天 = 第 1 週…），所以讀檔後也不會錯。

const RANK_ORDER = ["C", "B", "A", "S"];

export function newGachaState() {
  const pools = {};
  for (const p of CONFIG.gacha.pools) pools[p.id] = { pulls: 0, pity: 0 };
  return { week: 0, pools };
}

/** 確保 state.gacha 存在、跨週就把「本週已抽次數」歸零（保底計數不動），回傳某池的狀態 */
function gachaPoolState(state, poolId) {
  state.gacha ??= newGachaState();
  const week = Math.floor((currentDay(state) - 1) / CONFIG.gacha.resetDays);
  if (state.gacha.week !== week) {
    state.gacha.week = week;
    for (const p of Object.values(state.gacha.pools)) p.pulls = 0;
  }
  return (state.gacha.pools[poolId] ??= { pulls: 0, pity: 0 });
}

export const gachaPoolOf = (poolId) => CONFIG.gacha.pools.find((p) => p.id === poolId);

/** 現在抽某個池的狀況：{ ok, reason, pool, cost, crystal, pulls, pity }。reason 是給畫面看的繁體中文 */
export function checkGacha(state, poolId) {
  const pool = gachaPoolOf(poolId);
  if (!pool) return { ok: false, reason: "沒有這個卡池" };
  const ps = gachaPoolState(state, poolId);
  const cost = pool.base + pool.step * ps.pulls;
  const info = { pool, cost, crystal: pool.crystal, pulls: ps.pulls, pity: ps.pity };
  if ((state.spaceLevel ?? 1) < pool.spaceLevel) return { ...info, ok: false, reason: `需要空間等級 Lv.${pool.spaceLevel}` };
  if ((state.karmaCrystals ?? 0) < pool.crystal) return { ...info, ok: false, reason: `需要 ${pool.crystal} 顆因果結晶` };
  if (!canAfford(state, cost)) return { ...info, ok: false, reason: "積分不夠（已達高利貸上限）" };
  return { ...info, ok: true };
}

/** 全部卡池的狀況（畫面用） */
export function gachaInfo(state) {
  return CONFIG.gacha.pools.map((p) => checkGacha(state, p.id));
}

export function pullGacha(state, poolId) {
  const check = checkGacha(state, poolId);
  if (!check.ok) return null;
  const { pool, cost } = check;
  const ps = state.gacha.pools[pool.id];

  // 保底：第 every 抽（本池保底計數 + 1 達標）保證出 minRank 以上
  const minIdx = pool.pity ? RANK_ORDER.indexOf(pool.pity.minRank) : 0;
  const forced = !!pool.pity && ps.pity + 1 >= pool.pity.every;
  let items = RANK_ORDER.map((rank) => ({ rank, weight: pool.odds[rank] ?? 0 })).filter((it) => it.weight > 0);
  if (forced) {
    items = items.filter((it) => RANK_ORDER.indexOf(it.rank) >= minIdx);
    if (items.length === 0) items = [{ rank: pool.pity.minRank, weight: 1 }]; // 設定漏寫時的保險
  }

  spend(state, cost);
  state.karmaCrystals = (state.karmaCrystals ?? 0) - pool.crystal;
  const rank = weighted(state, items).rank;
  const pityN = ps.pity + 1;
  ps.pulls += 1;
  if (pool.pity) ps.pity = RANK_ORDER.indexOf(rank) >= minIdx ? 0 : ps.pity + 1;

  const s = createSamsarite(state, rank);
  state.samsarites.push(s);
  if (forced) emit(state, "gachaPity", logText(state, "gachaPity", { pool: pool.name, n: pityN, need: pool.pity.minRank }));
  emit(state, "gacha", logText(state, "gacha", { pool: pool.name, cost, rank, A: s, power: s.stats.power }), {
    samsariteId: s.id,
  });
  return s;
}

// ───────── 時間 ─────────

/** 時間前進一個時段；跨日就做每日結算 */
export function advanceTick(state) {
  state.tick += 1;
  if (state.tick % CONFIG.ticksPerDay === 0) {
    dailySanity(state); // 理智歸零的人暴走（要在 endOfDay 補理智之前，Phase 4-C-2）
    endOfDay(state);
    dailyWishes(state); // 心情／休假倒數、許願超時（Phase 3-B）
    dailyMarket(state); // 黑市到期換貨（4-D-2，獨立亂數流）
    dailyBoard(state); // 任務榜輪換／補槽（4-D-4，獨立亂數流）
    dailyMandatory(state); // 主神強制血腥任務：發布／逾時抹殺（Phase 4-C-4，獨立亂數流）
    dailyGod(state); // 主神搞事：任務逾期、事件過期、骰新事件（Phase 3-E，用獨立亂數流）
    dailyRelations(state); // 留守的人互動、搞事（Phase 2-B）
    dailyNursery(state); // 催熟倒數、戀人懷孕（Phase 3-F；放在關係事件之後，剛升級的靈魂伴侶今天就有機會）
    dailyDrama(state); // 5:2:1 人際事件：熱血羈絆／派系摩擦／八點檔修羅場（Phase 4-E-3，獨立亂數流）
    dailySquad(state); // 自動冊封／隊長缺位繼任／養殖流怨氣（Phase 4-E-1，獨立亂數流）
    dailyLineage(state); // 叛逃判定、子嗣孕育（Phase 4-E-4，獨立亂數流）
  }
}

/** 沒人可用、又抽不起最便宜的卡池 = 遊戲結束（4-C-6 起空投開著時由空投救援，不會結束，見 CONFIG.airdrop.rescue） */
export function checkGameOver(state) {
  if (state.gameOver) return true;
  // 用「基礎價」判斷（不含本週漲價）：沒人時沒有維持費，等到下週重置價格就回來了，不算卡死
  const cheapest = Math.min(
    ...CONFIG.gacha.pools
      .filter((p) => p.spaceLevel <= (state.spaceLevel ?? 1) && p.crystal <= (state.karmaCrystals ?? 0))
      .map((p) => p.base)
  );
  if (state.samsarites.length === 0 && !canAfford(state, cheapest) && !CONFIG.airdrop.rescue) {
    state.gameOver = true;
    emit(state, "gameOver", logText(state, "gameOver"));
  }
  return state.gameOver;
}

// ───────── 存檔 ─────────

/** 舊存檔的副本 id（chN_1～chN_4）→ 新 id（見 data/worlds.js）：統計、進行中的副本、結算摘要、許願與主神突襲任務都要改 */
function migrateDungeonIds(state) {
  const fix = (o, key = "dungeonId") => {
    if (o && o[key]) o[key] = migrateWorldId(o[key]);
  };
  for (const [oldId, st] of Object.entries(state.dungeonStats ?? {})) {
    const id = migrateWorldId(oldId);
    if (id !== oldId) {
      state.dungeonStats[id] = st;
      delete state.dungeonStats[oldId];
    }
  }
  (state.runs ?? []).forEach((r) => fix(r));
  (state.runReports ?? []).forEach((r) => fix(r));
  fix(state.lastRun);
  (state.wishes ?? []).forEach((w) => fix(w.params));
  fix(state.god?.mission);
  fix(state.god?.pending?.params);
}

export function serialize(state) {
  return JSON.stringify({ ...state, events: [] });
}

export function deserialize(json) {
  const state = JSON.parse(json);
  if (state.version !== 1) throw new Error("存檔版本不符");
  state.events = [];
  state.collection ??= []; // 舊存檔沒有這個欄位
  // Phase 3-A 之前收藏存的是名字，現在存 id；對不上的丟掉
  state.collection = state.collection
    .map((x) => (getSpecialReward(x) ? x : findSpecialRewardByName(x)?.id))
    .filter(Boolean);
  for (const s of state.samsarites) {
    delete s.upgrades; // Phase 4-B：舊商店強化已移除，舊存檔的強化加成歸零、不退費
    delete s.bought;
    s.gear ??= {};
    s.mood ??= null;
    s.vacationDays ??= 0;
  }
  // 舊存檔只有單一 state.run：遷移成 state.runs 陣列
  state.runs ??= [];
  state.nextRunId ??= 1;
  state.runReports ??= [];
  if (state.run) {
    const old = state.run;
    state.runs.push({ id: state.nextRunId++, startTick: state.tick - old.roomIndex * CONFIG.roomTicks, ...old });
  }
  delete state.run;
  for (const r of state.runs) r.id ??= state.nextRunId++;
  state.nextRunId = Math.max(state.nextRunId, 1 + Math.max(0, ...state.runs.map((r) => r.id)));
  state.memorialStele ??= []; // 舊存檔沒有英靈碑（Phase 4-C-5）
  refreshSteleBonus(state);
  state.mandatory ??= newMandatoryState(state.rngState); // 舊存檔沒有強制任務欄位（Phase 4-C-4）
  state.airdrop ??= newAirdropState(state.rngState); // 舊存檔沒有絕境空投欄位（Phase 4-C-3）
  state.sanity ??= newSanityState(state.rngState); // 舊存檔沒有理智暴走欄位（Phase 4-C-2）
  state.god ??= newGodState(state.rngState); // 舊存檔沒有主神搞事欄位（Phase 3-E）
  state.god.pending ??= null;
  state.god.mission ??= null;
  state.nursery ??= newNurseryState(state.rngState); // 舊存檔沒有生小孩欄位（Phase 3-F）
  for (const s of state.samsarites) {
    s.podDaysLeft ??= 0;
    s.parents ??= null;
  }
  state.spaceLevel ??= 1; // Phase 4-A 之前的存檔沒有空間等級
  state.chapterClearDay ??= {};
  // Phase 4-B 之前的存檔：補基因鎖／強化／頓悟／卡池／結晶欄位（不退費、舊卡池狀態不保留，見 CLAUDE.md）
  state.chapterClears ??= {};
  state.karmaCrystals ??= 0;
  state.gacha ??= newGachaState();
  for (const p of CONFIG.gacha.pools) state.gacha.pools[p.id] ??= { pulls: 0, pity: 0 };
  state.growth ??= newGrowthState(state.rngState);
  for (const s of state.samsarites) {
    s.geneLock ??= 0;
    s.enhanceCount ??= 0;
    s.insightCount ??= 0;
    s.inheritPower ??= 0;
  }
  state.wishes ??= [];
  state.nextWishId ??= 1 + Math.max(0, ...state.wishes.map((w) => w.id));
  state.relations ??= {};
  state.cooldowns ??= {};
  migrateDungeonIds(state); // Phase 4-D-4：舊的 chN_1～chN_4 副本 id 改成 30 世界新 id
  state.market ??= newMarketState(state.rngState); // Phase 4-D-2 之前的存檔沒有黑市／逛街亂數流
  state.market.slots ??= [];
  state.aiShopRngState ??= (state.rngState ^ 0x5b0b) | 0;
  if (state.market.slots.length === 0) refreshMarket(state, { silent: true });
  // Phase 4-E：舊存檔補齊小隊擴充欄位、編年史、遺物庫、叛逃 Boss 與獨立亂數流
  state.squad ??= newSquadState();
  state.squad.counters ??= {};
  Object.assign(state.squad, { communalFund: state.squad.communalFund ?? 0, captainSeq: state.squad.captainSeq ?? 0, appointedDay: state.squad.appointedDay ?? null, contraband: state.squad.contraband ?? [] });
  state.squad.captainId ??= null;
  state.squad.style ??= null;
  state.squadRngState ??= (state.rngState ^ 0x5ad0) | 0;
  state.autoStrategy ??= CONFIG.auto.defaultStrategy;
  state.autoRiskLogDay ??= null;
  state.settings.autoPause ??= true; // 設定頁「自動暫停」總開關：開窗自動暫停（4-E-8）
  state.chronicles ??= [];
  state.armoryHeirlooms ??= [];
  state.rogueBosses ??= [];
  for (const s of state.samsarites) {
    s.generation ??= 1;
    s.bondPartnerId ??= null;
    s.heirloomSlots ??= {};
    s.captainBonus ??= 0;
    s.tempPowerPct ??= 0;
    s.captainNo ??= null;
    s.maxBossChapter ??= 0;
    s.talentPct ??= 0;
    s.elixirUses ??= 0;
    s.cozyUntilDay ??= 0;
    s.deathWard ??= 0;
    s.deathWardFull ??= false;
    s.geneBuff ??= null;
  }
  refreshStaleSlots(state); // 4-E-8：黑市貨架含舊版失效商品的格子自動重抽
  refreshCaptainBonus(state);
  state.board ??= newBoardState(); // Phase 4-D-4 之前的存檔沒有任務榜與奇物圖鑑
  state.board.slots ??= [];
  for (const slot of state.board.slots) slot.running = state.runs.some((r) => r.slotId === slot.id);
  fillBoard(state);
  state.relicCodex ??= [];
  for (const r of state.runs) {
    r.mutationId ??= null;
    r.slotId ??= null;
    r.greedy ??= false;
  }
  refreshRelicBonus(state);
  state.taxRate ??= CONFIG.tax.default; // Phase 4-D-1 之前的存檔沒有稅率與私房錢
  for (const s of state.samsarites) {
    s.wallet ??= 0;
    s.soulbound ??= {};
    s.consumables ??= [];
    s.shopLog ??= [];
    s.customProfile ??= null;
    s.lastDramaDay ??= null;
    s.runBuff ??= null;
    s.lockedInPodBy ??= null;
    s.podLockDays ??= 0;
  }
  state.settings.guideSeen ??= false; // 4-D-7 上崗手冊：舊存檔當作還沒看過
  state.settings.followId ??= null; // 舊存檔沒有視角鎖定欄位，當沒鎖定
  // 之後新增的暫停事件種類，舊存檔沒有就補上預設值
  for (const [key, def] of Object.entries(PAUSE_EVENTS)) {
    if (!(key in state.settings.pauseOn)) state.settings.pauseOn[key] = def.default;
  }
  return state;
}

export { rand };
