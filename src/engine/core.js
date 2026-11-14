// 核心：遊戲狀態、輪迴者、經濟（維持費／高利貸／回收爐）、抽卡、時間推進。
// 這裡完全不碰畫面（DOM），所以可以直接用 Node 跑測試。

import { CONFIG, RANKS, INJURIES, PAUSE_EVENTS } from "../data/config.js";
import { SURNAMES, GIVEN_NAMES } from "../data/names.js";
import { rand, randInt, pick, weighted } from "./rng.js";
import { rollTags, hpRestBonus } from "./tags.js";
import { findSpecialRewardByName, getSpecialReward } from "../data/dungeons.js";
import { logText } from "./templates.js";
import { dailyWishes, cancelWishesOf } from "./wishes.js"; // 同上，循環引用只要載入時不呼叫就沒問題
import { dailyGod, cancelGodOf, newGodState } from "./godEvents.js"; // 同上（Phase 3-E 主神搞事）
import { dailyNursery, newNurseryState, podCost } from "./children.js"; // 同上（Phase 3-F 生小孩）
import { dailySanity, newSanityState } from "./sanity.js"; // 同上（Phase 4-C-2 理智暴走）
import { newGrowthState } from "./growth.js"; // 同上（Phase 4-B 基因鎖／強化／頓悟；growth.js 也會 import 這個檔案）
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
    totalSpent: 0, // 累積花費（Phase 3 商店階級解鎖會用到）
    spaceLevel: 1, // 空間等級 Lv.1~5（Phase 4-A）：每首通一章尾王 +1，決定維持費、破產線、解鎖到第幾章
    chapterClearDay: {}, // { 章節: 首通尾王是第幾天 }（npm run sim 統計用）
    chapterClears: {}, // { 章節: 該章前 3 關合計成功結算幾次 }，尾王守門用（CONFIG.bossGate，見 engine/dungeon.js）
    karmaCrystals: 0, // 因果結晶（神級卡池每抽消耗 1 顆；副本掉落，見 engine/dungeon.js）
    gacha: newGachaState(), // 四卡池：本週抽數（漲價計數）與保底計數
    growth: newGrowthState(seed), // 頓悟：獨立亂數流（見 engine/growth.js）
    nextId: 1,
    samsarites: [],
    graveyard: [],
    relations: {}, // 關係矩陣（見 engine/relations.js）
    wishes: [], // 進行中的許願（見 engine/wishes.js）
    nextWishId: 1,
    nursery: newNurseryState(seed), // 生小孩：獨立亂數流（見 engine/children.js）
    sanity: newSanityState(seed), // 理智暴走：獨立亂數流（見 engine/sanity.js）
    god: newGodState(seed), // 主神搞事：冷卻、待回覆事件、突襲任務（見 engine/godEvents.js）
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
    inheritPower: 0, // 子嗣繼承值（4-E 才會用，先預留；算進本體值、會吃基因鎖乘區）
    gear: {}, // 商店裝備：{ weapon: 商品id, armor: 商品id }
    joinedDay: currentDay(state),
    runs: 0,
    mood: null, // 心情狀態 { kind: "happy"|"upset", daysLeft }（見 engine/wishes.js）
    vacationDays: 0, // 許願放假：剩幾天不能派遣
    sabotaged: false, // 裝備被人動了手腳（借刀殺人），下次出征會倒楣
  };
}

export function getSamsarite(state, id) {
  return state.samsarites.find((s) => s.id === id);
}

/** 目前空間等級的基礎日維持費 */
export function upkeepBaseOf(state) {
  return CONFIG.space.upkeepBase[(state?.spaceLevel ?? 1) - 1];
}

/** 每日維持費 = 基礎 ×（1 + 階級附加% + 傷勢醫藥費%），四捨五入。基礎費跟空間等級走（沒傳 state 當 Lv.1） */
export function upkeepOf(s, state = null) {
  if (s.location === "pod") return CONFIG.child.podUpkeep; // 催熟艙的嬰兒只吃固定的小額
  return Math.round(upkeepBaseOf(state) * (1 + RANKS[s.rank].upkeepPct + INJURIES[s.injury].upkeepPct));
}

export function setInjury(s, level) {
  s.injury = level;
  s.restDaysLeft = INJURIES[level].restDays;
}

/** killer：被同伴害死時的兇手（怪物殺的就不傳）。連鎖反應在 relations.js 的 afterDeath，由呼叫端接著呼叫 */
export function killSamsarite(state, s, cause, killer = null) {
  state.samsarites = state.samsarites.filter((x) => x.id !== s.id);
  cancelWishesOf(state, s.id);
  cancelGodOf(state, s.id);
  state.graveyard.push({ name: s.name, rank: s.rank, day: currentDay(state), cause, killer: killer?.name ?? null });
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

export function spend(state, cost) {
  if (!canAfford(state, cost)) return false;
  const wasInDebt = state.points < 0;
  const tierBefore = shopTier(state);
  state.points -= cost;
  state.totalSpent += cost;
  announceDebtIfNew(state, wasInDebt);
  const tierAfter = shopTier(state);
  if (tierAfter > tierBefore) {
    emit(state, "shopTier", logText(state, "shopTier", { tier: tierAfter, spent: state.totalSpent }), { tier: tierAfter });
  }
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

/** 主神回收爐：把人做成營養液，換一點積分，其他人理智下降 */
export function recycle(state, id) {
  const s = getSamsarite(state, id);
  if (!s || s.location !== "space") return false;
  state.samsarites = state.samsarites.filter((x) => x.id !== id);
  state.graveyard.push({ name: s.name, rank: s.rank, day: currentDay(state), cause: "被主管推進回收爐" });
  forgetRelations(state, id);
  cancelWishesOf(state, id);
  cancelGodOf(state, id);
  state.points += CONFIG.recycle.points;
  for (const other of state.samsarites) loseSanity(other, CONFIG.recycle.sanityLoss);
  emit(
    state,
    "recycle",
    logText(state, "recycle", { A: s, points: CONFIG.recycle.points, san: CONFIG.recycle.sanityLoss })
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
    dailyGod(state); // 主神搞事：任務逾期、事件過期、骰新事件（Phase 3-E，用獨立亂數流）
    dailyRelations(state); // 留守的人互動、搞事（Phase 2-B）
    dailyNursery(state); // 催熟倒數、戀人懷孕（Phase 3-F；放在關係事件之後，剛升級的靈魂伴侶今天就有機會）
  }
}

/** 沒人可用、又抽不起最便宜的卡池 = 遊戲結束 */
export function checkGameOver(state) {
  if (state.gameOver) return true;
  // 用「基礎價」判斷（不含本週漲價）：沒人時沒有維持費，等到下週重置價格就回來了，不算卡死
  const cheapest = Math.min(
    ...CONFIG.gacha.pools
      .filter((p) => p.spaceLevel <= (state.spaceLevel ?? 1) && p.crystal <= (state.karmaCrystals ?? 0))
      .map((p) => p.base)
  );
  if (state.samsarites.length === 0 && !canAfford(state, cheapest)) {
    state.gameOver = true;
    emit(state, "gameOver", logText(state, "gameOver"));
  }
  return state.gameOver;
}

// ───────── 存檔 ─────────

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
  state.settings.followId ??= null; // 舊存檔沒有視角鎖定欄位，當沒鎖定
  // 之後新增的暫停事件種類，舊存檔沒有就補上預設值
  for (const [key, def] of Object.entries(PAUSE_EVENTS)) {
    if (!(key in state.settings.pauseOn)) state.settings.pauseOn[key] = def.default;
  }
  return state;
}

export { rand };
