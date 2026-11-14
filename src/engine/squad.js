// 小隊隊長與五大流派引擎（Phase 4-E-1、4-E-2）。純規則，不碰畫面；數字在 CONFIG.squad，流派資料在 src/data/squadStyles.js。
//
// 重點規則（露葵 2026-11-14 規格）：
//   - 首通第 1 章尾王（空間等級 >= 2）後啟用。第一次指派免費；當天結束還沒指派就自動冊封戰力最高者（讓掛機與 sim 不中斷）。
//   - 小隊流派 state.squad.style 不由玩家切換，依現任隊長的性格詞條決定（deriveSquadStyle）：選人不選流派。
//   - 隊長陣亡／被回收：和平順延（依原流派標準提拔）；若戰力前兩名差距 < 15% 且（雙方互相討厭或流派不同）就爆發「隊長印記爭奪戰」改朝換代。
//   - 主神強行撤換令：花公庫積分 500 × 空間等級 ＋ 1 顆因果結晶；空降隊長太弱會引發老鳥不服。
//   - 流派機制（分潤在 engine/wallet.js 的 distributeLoot、逛街在 engine/shopping.js、副本內機制在 engine/dungeon.js）都向這個檔案查詢。
// 亂數：獨立亂數流 state.squadRngState（政變、擋刀、狗血事件、子嗣、叛逃共用），不動主亂數、不動既有亂數流。
// 「好感」一律用淨好感 affinity = love - hate（relations.js），因為 love／hate 各自是 0~100 不會是負的。

import { CONFIG } from "../data/config.js";
import { SQUAD_STYLES, DEFAULT_STYLE, TIE_ORDER, TAG_STYLE } from "../data/squadStyles.js";
import { getShopItem } from "../data/shopItems.js";
import { rand } from "./rng.js";
import { emit, currentDay, getSamsarite, setInjury, spend, canAfford } from "./core.js";
import { effectivePower } from "./tags.js";
import { affinity, shiftAffinity } from "./relations.js";
import { addChronicle } from "./lineage.js";
import { logText } from "./templates.js";

const S = () => CONFIG.squad;

// ───────── 狀態與亂數流 ─────────

export function newSquadState() {
  return { captainId: null, style: null, communalFund: 0, captainSeq: 0, appointedDay: null, contraband: [], counters: {} };
}

/** 把 state.squadRngState 包成 rand() 吃得下的亂數物件（讀寫都落回 state） */
export function squadRng(state) {
  return {
    get rngState() {
      return state.squadRngState;
    },
    set rngState(v) {
      state.squadRngState = v;
    },
  };
}

export const squadOf = (state) => (state.squad ??= newSquadState());
/** 累計次數（政變 coup／叛逃 defect／討伐 slain／子嗣 birth／遺物 heirloom／人際事件 drama／空降不服 snub）：sim 與 UI 統計用，編年史只留 100 條不夠數 */
export function bump(state, key, n = 1) {
  const c = (squadOf(state).counters ??= {});
  c[key] = (c[key] ?? 0) + n;
}
export const squadUnlocked = (state) => (state.spaceLevel ?? 1) >= S().unlockSpaceLevel;
/** 名冊（不含催熟艙嬰兒） */
export const squadMembers = (state) => state.samsarites.filter((s) => s.location !== "pod");

/** 現任隊長（人還活著、不在催熟艙）；沒有就 null。隊長暴斃後到當日結算前，這裡回傳 null（隊長光環與流派加成都暫停） */
export function captainOf(state) {
  const sq = squadOf(state);
  if (sq.captainId == null) return null;
  const c = getSamsarite(state, sq.captainId);
  return c && c.location !== "pod" ? c : null;
}

/** 有效的流派 id（沒解鎖或沒隊長 = null） */
export function styleOf(state) {
  if (!squadUnlocked(state)) return null;
  const cap = captainOf(state);
  if (!cap) return null;
  return squadOf(state).style ?? deriveSquadStyle(cap);
}
export const styleInfo = (id) => (id ? SQUAD_STYLES[id] : null);

// ───────── 流派映射：選人不選流派 ─────────

/** 依隊長的詞條算流派：各詞條分數加總取最高；平手依 TIE_ORDER；沒有任何對應詞條 = 共生羈絆流（中性預設） */
export function deriveSquadStyle(s) {
  const score = {};
  for (const t of s.tags ?? []) for (const [style, v] of Object.entries(TAG_STYLE[t] ?? {})) score[style] = (score[style] ?? 0) + v;
  let best = null;
  for (const id of TIE_ORDER) if ((score[id] ?? 0) > (score[best] ?? 0)) best = id;
  return best ?? DEFAULT_STYLE;
}

/** 這個人身價 = 身上裝備價格 + 攜帶耗材價格（契約傭兵流的分帳權重、繼任排序用） */
export function worthOf(s) {
  const gear = Object.values(s.gear ?? {}).reduce((n, id) => n + (getShopItem(id)?.price ?? 0), 0);
  const stuff = (s.consumables ?? []).reduce((n, id) => n + (getShopItem(id)?.price ?? 0), 0);
  return gear + stuff;
}

// ───────── 隊長光環 ─────────

/** 把「隊長 +8% 個人戰力」寫到每個人身上（effectivePower 沒有 state 參數，跟英靈碑同樣做法） */
export function refreshCaptainBonus(state) {
  const cap = squadUnlocked(state) ? captainOf(state) : null;
  for (const s of state.samsarites) s.captainBonus = cap && s.id === cap.id ? S().captainPowerPct : 0;
}

function setCaptain(state, s, how) {
  const sq = squadOf(state);
  sq.captainId = s.id;
  sq.style = CONFIG.squad.forceStyle ?? deriveSquadStyle(s);
  sq.captainSeq = (sq.captainSeq ?? 0) + 1;
  s.captainNo = sq.captainSeq; // 第幾任隊長（遺物履歷用）
  sq.appointedDay = currentDay(state);
  refreshCaptainBonus(state);
  const style = SQUAD_STYLES[sq.style];
  if (how === "coup") bump(state, "coup");
  const key = { first: "squadAppoint", auto: "squadAuto", peace: "squadPeace", coup: "squadCoup", force: "squadForce" }[how];
  const text = logText(state, key, { A: s, style: style.name, icon: style.icon });
  emit(state, "squad", text, { samsariteId: s.id });
  addChronicle(state, how === "coup" ? "coup" : "captain", text);
  return s;
}

/** 奪權上位（噬主夜襲成功用）：不經過順延，直接由 s 接任並改朝換代 */
export function seizeCaptain(state, s) {
  return setCaptain(state, s, "coup");
}

/** 候選人明牌：任命此人將開啟哪個流派（UI 與測試用） */
export function candidateStyle(s) {
  const id = deriveSquadStyle(s);
  return { id, ...SQUAD_STYLES[id] };
}

/** 首次（或隊長缺位時）免費任命。已有隊長要換人請用 replaceCaptain（主神撤換令） */
export function appointCaptain(state, id) {
  if (!squadUnlocked(state)) return { ok: false, reason: `要先首通第 1 章尾王（空間 Lv.${S().unlockSpaceLevel}）才能冊封隊長` };
  if (captainOf(state)) return { ok: false, reason: "已經有隊長了，要換人請用主神撤換令" };
  const s = getSamsarite(state, id);
  if (!s || s.location === "pod") return { ok: false, reason: "找不到這個人" };
  setCaptain(state, s, "first");
  return { ok: true, captain: s };
}

// ───────── 主神強行撤換令 ─────────

export const replaceCostOf = (state) => S().replaceBaseCost * (state.spaceLevel ?? 1);

/** 撤換預覽：花多少、哪些老鳥會不服（事前警告）、會變成什麼流派 */
export function replacePreview(state, id) {
  const s = getSamsarite(state, id);
  if (!s) return null;
  const others = squadMembers(state).filter((o) => o.id !== s.id);
  const mine = effectivePower(s);
  const strongest = others.reduce((m, o) => Math.max(m, effectivePower(o)), 0);
  const snub = strongest > 0 && mine < strongest * S().snubPowerRatio ? others.filter((o) => effectivePower(o) > mine) : [];
  return { cost: replaceCostOf(state), crystal: S().replaceCrystal, style: candidateStyle(s), snub, mine, strongest };
}

export function checkReplace(state, id) {
  if (!squadUnlocked(state)) return { ok: false, reason: "隊長系統還沒啟用" };
  const s = getSamsarite(state, id);
  if (!s || s.location === "pod") return { ok: false, reason: "找不到這個人" };
  const cap = captainOf(state);
  if (!cap) return { ok: true, free: true, cost: 0, crystal: 0 }; // 缺位：免費任命
  if (cap.id === s.id) return { ok: false, reason: "他已經是隊長了" };
  const cost = replaceCostOf(state);
  if ((state.karmaCrystals ?? 0) < S().replaceCrystal) return { ok: false, reason: `需要 ${S().replaceCrystal} 顆因果結晶`, cost, crystal: S().replaceCrystal };
  if (!canAfford(state, cost)) return { ok: false, reason: "積分不夠（已達高利貸上限）", cost, crystal: S().replaceCrystal };
  return { ok: true, cost, crystal: S().replaceCrystal };
}

/** 主神強行撤換：花公庫與結晶換隊長；空降隊長戰力低於隊內最強老鳥的 70%，戰力比他高的老鳥理智 -15、對他好感 -20 */
export function replaceCaptain(state, id) {
  const check = checkReplace(state, id);
  if (!check.ok) return check;
  const s = getSamsarite(state, id);
  if (check.free) return appointCaptain(state, id);
  const preview = replacePreview(state, id);
  spend(state, check.cost);
  state.karmaCrystals -= check.crystal;
  setCaptain(state, s, "force");
  for (const o of preview.snub) {
    o.stats.sanity = Math.max(0, o.stats.sanity - S().snubSanity);
    shiftAffinity(state, o, s, -S().snubAffinity);
  }
  if (preview.snub.length > 0) {
    bump(state, "snub");
    const text = logText(state, "squadSnub", { A: s, B: preview.snub[0], n: preview.snub.length, san: S().snubSanity });
    emit(state, "squad", text);
    addChronicle(state, "snub", text);
  }
  return { ok: true, captain: s, snub: preview.snub };
}

// ───────── 每日結算：自動冊封、三軌繼承、養殖流的怨氣 ─────────

/** 繼任分數：共產／羈絆看資歷 + 隊內平均好感；養殖／菁英看戰力；傭兵看私房錢 + 裝備身價 */
function successorScore(state, s, style, pool) {
  if (style === "farming" || style === "elite") return effectivePower(s);
  if (style === "mercenary") return (s.wallet ?? 0) + worthOf(s);
  const others = pool.filter((o) => o.id !== s.id);
  const avg = others.length ? others.reduce((n, o) => n + affinity(state, o, s), 0) / others.length : 0;
  return currentDay(state) - (s.joinedDay ?? 1) + avg * S().seniorityLoveWeight;
}

/** 隊長缺位：先看有沒有雙強奪權，沒有就和平順延 */
function succeed(state, pool) {
  const sq = squadOf(state);
  const oldStyle = sq.style ?? DEFAULT_STYLE;
  const ranked = [...pool].sort((a, b) => effectivePower(b) - effectivePower(a) || a.id - b.id);
  if (ranked.length >= 2) {
    const [a, b] = ranked;
    const pa = effectivePower(a);
    const pb = effectivePower(b);
    const gap = (pa - pb) / pa;
    const feud = affinity(state, a, b) < S().coupAffinity && affinity(state, b, a) < S().coupAffinity;
    if (gap < S().coupGapPct && (feud || deriveSquadStyle(a) !== deriveSquadStyle(b))) {
      // 隊長印記爭奪戰：依戰力比例擲骰，勝者上位，敗者受傷掉理智
      const win = rand(squadRng(state)) < pa / (pa + pb);
      const [w, l] = win ? [a, b] : [b, a];
      setInjury(l, Math.min(3, l.injury + S().coupLoserInjury));
      l.stats.sanity = Math.max(0, l.stats.sanity - S().coupLoserSanity);
      const text = logText(state, "squadCoupFight", { A: w, B: l, san: S().coupLoserSanity });
      emit(state, "squad", text); // 編年史由 setCaptain 的「改朝換代」那一條記錄
      setCaptain(state, w, "coup");
      return w;
    }
  }
  let best = null;
  let bestScore = -Infinity;
  for (const s of ranked) {
    const v = successorScore(state, s, oldStyle, pool);
    if (v > bestScore) [best, bestScore] = [s, v];
  }
  return setCaptain(state, best, "peace");
}

/** 每日結算掛鉤（advanceTick，關係事件之後）：自動冊封、隊長缺位時繼任、養殖流的每日怨氣 */
export function dailySquad(state) {
  if (state.gameOver || !squadUnlocked(state)) return;
  const sq = squadOf(state);
  if (!captainOf(state)) {
    const pool = squadMembers(state);
    if (pool.length > 0) {
      if (sq.captainId == null) {
        const top = [...pool].sort((a, b) => effectivePower(b) - effectivePower(a) || a.id - b.id)[0];
        setCaptain(state, top, "auto"); // 當天結束仍未指派：自動冊封戰力最高者為初代隊長
      } else succeed(state, pool);
    }
  }
  refreshCaptainBonus(state);
  const cap = captainOf(state);
  if (cap && styleOf(state) === "farming") {
    const F = S().farming;
    for (const m of squadMembers(state)) {
      if (m.id === cap.id) continue;
      shiftAffinity(state, m, cap, F.dailyAffinity);
      m.stats.sanity = Math.max(0, m.stats.sanity + F.dailySanity);
    }
  }
}

// ───────── 流派機制查詢（給 dungeon／wallet／shopping／market／core 掛鉤用）─────────

/** 共產流：全隊防禦減傷額外 +8%（呼叫端自己套總上限） */
export const squadDefenseBonus = (state) => (styleOf(state) === "communal" ? S().communal.defenseBonus : 0);
/** 傭兵流：低理智內鬥／背刺機率倍率（-80%） */
export const squadClashMult = (state) => (styleOf(state) === "mercenary" ? S().mercenary.clashMult : 1);
/** 傭兵流：同行情誼好感倍率（減半） */
export const squadBondMult = (state) => (styleOf(state) === "mercenary" ? S().mercenary.bondLoveMult : 1);
/** 菁英流：打尾王（與叛逃 Boss）時全隊戰力 ×1.15 */
export const squadBossPowerMult = (state, isBoss) => (isBoss && styleOf(state) === "elite" ? S().elite.bossPowerMult : 1);
/** 傭兵流：黑市 95 折 */
export const squadMarketMult = (state) => (styleOf(state) === "mercenary" ? S().mercenary.marketDiscount : 1);
/**
 * 共產流遺產：成員戰死時私房錢 100% 匯入小隊互助金（0% 消散）。回傳 true = 已由共產流處理（呼叫端不用再走充公）。
 * 注意：這裡看的是「當下流派」，隊長若剛好和他同時死亡，流派視為不存在（captainOf 為 null）。
 */
export function communalInherit(state, s) {
  if (styleOf(state) !== "communal") return false;
  const w = s.wallet ?? 0;
  s.wallet = 0;
  if (w > 0) {
    squadOf(state).communalFund += w;
    emit(state, "wallet", logText(state, "communalInherit", { A: s, wallet: w }));
  }
  return true;
}

/** 養殖流：零階新人維持費減半 */
export const squadUpkeepMult = (state, s) => (styleOf(state) === "farming" && (s.geneLock ?? 0) === 0 ? S().farming.rookieUpkeepMult : 1);

/**
 * 副本單房失敗的理智損耗：菁英流 ×2；隊長在隊時 -1（最少扣 1）。base 已含突變詞綴的加成
 */
export function failSanityLoss(state, party, base) {
  let loss = base;
  if (styleOf(state) === "elite") loss *= S().elite.failSanityMult;
  const cap = captainOf(state);
  if (cap && party.some((p) => p.id === cap.id)) loss -= S().captainFailSanityCut;
  return Math.max(1, loss);
}

/** 副本結算存活後的流派獎勵：羈絆流存活通關全隊理智 +4 */
export function squadAfterClear(state, survivors) {
  if (styleOf(state) !== "bond") return;
  for (const s of survivors) s.stats.sanity = Math.min(100, s.stats.sanity + S().bond.clearSanity);
}

/**
 * 羈絆流「託付後背」：成員遭遇致死判定時，同隊好感 >= 45 且未重傷（injury <= 1）的夥伴有 50% 機率替他擋刀（每場限 1 次）。
 * 擋刀成功：雙方 injury = min(3, injury + 1)、互相好感 +10，致死改判。回傳擋刀的人或 null。沒有符合條件的夥伴時不消耗亂數。
 */
export function bondGuard(state, run, party, victim) {
  if (styleOf(state) !== "bond" || run.bondGuardUsed) return null;
  const B = S().bond;
  const guard = party.find((o) => o.id !== victim.id && o.injury <= 1 && affinity(state, o, victim) >= B.guardAffinity);
  if (!guard || rand(squadRng(state)) >= B.guardChance) return null;
  run.bondGuardUsed = true;
  setInjury(victim, Math.min(3, victim.injury + 1));
  setInjury(guard, Math.min(3, guard.injury + 1));
  shiftAffinity(state, guard, victim, B.guardLove);
  shiftAffinity(state, victim, guard, B.guardLove);
  const text = logText(state, "squadGuard", { A: guard, B: victim });
  emit(state, "social", text);
  return guard;
}

/**
 * 養殖流「肉豬陣亡」：副本內有 geneLock <= 1 的隊員陣亡，在隊的隊長當場臨時戰力 +12%，結算積分 +20%（最多疊 2 層）。
 */
export function farmingPigDied(state, run, dead) {
  if (styleOf(state) !== "farming" || (dead.geneLock ?? 0) > 1) return;
  const cap = captainOf(state);
  if (!cap || !run.partyIds.includes(cap.id) || dead.id === cap.id) return;
  run.pigDeaths = Math.min(S().farming.pigStacks, (run.pigDeaths ?? 0) + 1);
  cap.tempPowerPct = S().farming.pigPowerPct;
  emit(state, "social", logText(state, "squadPig", { A: cap, B: dead }));
}
export const farmingRewardMult = (state, run) => (styleOf(state) === "farming" ? 1 + (run.pigDeaths ?? 0) * S().farming.pigDeathReward : 1);

/** 英靈碑加成倍率：羈絆流 ×1.5 */
export const squadSteleMult = (state) => (styleOf(state) === "bond" ? S().bond.steleMult : 1);

/** 黑貨使用紀錄（4-E-3 的「黑貨事發對質」會翻這份）：由 engine/shop.js 的 applyContraband 呼叫 */
export function noteContraband(state, user, victim, item) {
  const sq = squadOf(state);
  (sq.contraband ??= []).push({ day: currentDay(state), userId: user.id, victimId: victim?.id ?? null, itemId: item.id, exposed: false });
  if (sq.contraband.length > CONFIG.drama.contrabandKeep) sq.contraband.splice(0, sq.contraband.length - CONFIG.drama.contrabandKeep);
}
