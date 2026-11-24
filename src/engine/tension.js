// 離心力：人際張力與怨氣（A-3 掛機壓力設計 階段 2）。純規則，不碰畫面。
// 數字：CONFIG.tension；事件種類：data/tensionEvents.js；日誌句：data/logs.js 的 tension_* 與 grudge*。
//
// 設計重點（露葵 2026-11 拍板）：
//   - 每天對「都在主神空間的每一對人」擲張力機率（pairProfile），所以期望事件量隨在家人數平方成長，沒有任何人數上限。
//     關係（仇恨、死敵、搶同一個人）、個性差異（野心對野心、利他對利己、不服隊長）、理智、怨氣會放大機率；
//     戀人、好友、拆開（apart）會降低機率。
//   - 事件進 state.tension.pending，期限用遊戲日（currentDay）計，暫停不消耗。玩家可「調停／補償／拆開／無視」。
//     壓力不綁點擊次數：調停有失敗率、補償要選邊（另一方會記恨）、拆開要放一個人假、無視在低等級是合理的分流。
//   - 無視或逾期 → 雙方怨氣 s.grudge 上升、互相仇恨上升、事件升級。怨氣是唯一出口：過門檻每天擲後果
//     （叛逃／互殺／政變夜襲／抗命），後果發生後怨氣回落，所以不會每天重複爆。
//   - 隊長自動調停等級 1 的事件（機率有限）：把隊長人選變成預防手段。
//   - 不受隊長系統（空間 Lv.2）限制：Lv.1 就運作；小隊（n 小）自然很少出事。
// 亂數：獨立亂數流 state.tension.rngState，不動主亂數。例外：互殺的主神懲罰若抽到「洗掉標籤」會用 relations.punish 內的主亂數（只在動手殺人時）。
// 叛逃不看 isDefectImmune（那個函式不動）：怨氣叛逃只豁免隊長與 customProfile，綁定裝備（soulbound）不豁免。

import { CONFIG } from "../data/config.js";
import { getTensionKind, CLIMATE_LEVELS } from "../data/tensionEvents.js";
import { DRAMA_EVENTS } from "../data/dramaEvents.js";
import { rand, weighted } from "./rng.js";
import { emit, currentDay, getSamsarite, killSamsarite, setInjury, upkeepOf, spend, canAfford, checkGameOver } from "./core.js";
import { effectivePower } from "./tags.js";
import { getRel, affinity, pairStatus, addHate, addLove, softenHate, afterDeath, punish } from "./relations.js";
import { captainOf } from "./squad.js";
import { defect } from "./lineage.js";
import { applyEvent } from "./drama.js";
import { setMood, startDefy } from "./wishes.js";
import { logText } from "./templates.js";
import { autoMediate } from "./automation.js";

const T =() => CONFIG.tension;
const clampG = (v) => Math.max(0, Math.min(100, Math.round(v)));

// ───────── 狀態與亂數流 ─────────

export function newTensionState(seed = 0) {
  return {
    rngState: (seed ^ 0x7e45) | 0,
    nextId: 1,
    pending: [], // [{ id, kind, level, aId, bId, createdDay, deadlineDay, tried }]
    pairCool: {}, // { "小id:大id": 第幾天後才能再有事 }
    apart: {}, // { "小id:大id": 拆開效果持續到第幾天 }
    comp: {}, // { 輪迴者id: [補償日...] }（補償價格遞增用）
    climate: "calm",
    stats: { created: 0, expired: 0, booms: 0, mediateOk: 0, mediateFail: 0, compensate: 0, separate: 0, auto: 0, outcomes: { defect: 0, kill: 0, coup: 0, defy: 0 } },
  };
}

/** 取（必要時補）張力狀態，舊存檔沒有就補預設 */
export function tensionOf(state) {
  const t = (state.tension ??= newTensionState(state.rngState));
  const d = newTensionState(0);
  t.rngState ??= d.rngState;
  t.nextId ??= 1;
  t.pending ??= [];
  t.pairCool ??= {};
  t.apart ??= {};
  t.comp ??= {};
  t.climate ??= "calm";
  t.stats = { ...d.stats, ...(t.stats ?? {}), outcomes: { ...d.stats.outcomes, ...(t.stats?.outcomes ?? {}) } };
  return t;
}

/** 把 state.tension.rngState 包成 rand() 吃得下的亂數物件 */
export function tensionRng(state) {
  return {
    get rngState() {
      return tensionOf(state).rngState;
    },
    set rngState(v) {
      tensionOf(state).rngState = v;
    },
  };
}

const pairKey = (a, b) => (a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`);
const eligible = (s) => s.location === "space" && !((s.podLockDays ?? 0) > 0);
const addGrudge = (s, d) => {
  s.grudge = clampG((s.grudge ?? 0) + d);
};

// ───────── 產生率 ─────────

/**
 * 一對人今天出張力事件的機率與種類（純函式，不吃亂數；測試與 sim 也用它）。
 * 回傳 { p, kind, wronged }：wronged 是「吃虧不平」裡被占便宜的那位（事件的 A）。
 */
export function pairProfile(state, a, b) {
  const c = T();
  const R = CONFIG.relations;
  const t = tensionOf(state);
  const day = currentDay(state);
  let m = 1;
  const flags = {};
  const hate = Math.max(getRel(state, a, b).hate, getRel(state, b, a).hate);
  const status = pairStatus(state, a, b);
  if (status === "nemesis" || hate >= R.nemesisAt) m *= c.hateMult.nemesis;
  else if (hate >= R.hateAt) m *= c.hateMult.hate;
  else if (hate >= R.dislikeAt) m *= c.hateMult.dislike;
  if (affinity(state, a, b) < 0 && affinity(state, b, a) < 0) m *= c.negAffinityMult;

  const ta = a.traits ?? {};
  const tb = b.traits ?? {};
  const min = c.personalityMin;
  let wronged = null;
  if ((ta.ambition ?? 0) >= min && (tb.ambition ?? 0) >= min) {
    m *= c.ambitionMult;
    flags.rivalry = true;
  }
  if ((ta.altruism ?? 0) >= min && (tb.altruism ?? 0) <= -min) wronged = a;
  else if ((tb.altruism ?? 0) >= min && (ta.altruism ?? 0) <= -min) wronged = b;
  if (wronged) {
    m *= c.altruismMult;
    flags.exploit = true;
  }
  const cap = captainOf(state);
  if (cap && (cap.id === a.id || cap.id === b.id)) {
    const o = cap.id === a.id ? b : a;
    if ((o.traits?.obedience ?? 0) <= -min && affinity(state, o, cap) <= c.captainAffinity) {
      m *= c.captainMult;
      flags.captain = true;
    }
  }
  for (const x of state.samsarites) {
    if (x.id === a.id || x.id === b.id || x.location === "pod") continue;
    if (affinity(state, a, x) >= c.fanAffinity && affinity(state, b, x) >= c.fanAffinity) {
      const lover = [a, b].some((y) => ["lover", "soulmate"].includes(pairStatus(state, y, x)));
      m *= lover ? c.triangleLoverMult : c.triangleMult;
      flags.jealousy = true;
      break;
    }
  }
  const lo = Math.min(a.stats.sanity, b.stats.sanity);
  const lowRule = c.lowSanity.find((r) => lo < r.below);
  if (lowRule) m *= lowRule.mult;
  m *= 1 + ((a.grudge ?? 0) + (b.grudge ?? 0)) / c.grudgeDiv;

  // 預防
  if (status === "lover" || status === "soulmate") m *= c.loverMult;
  if (affinity(state, a, b) >= c.friendAffinity && affinity(state, b, a) >= c.friendAffinity) m *= c.friendMult;
  if ((t.apart[pairKey(a, b)] ?? 0) > day) m *= c.apartMult;

  const kind = flags.jealousy ? "jealousy" : flags.captain ? "captain" : flags.exploit ? "exploit" : flags.rivalry ? "rivalry" : "quarrel";
  return { p: Math.min(c.maxChance, c.baseChance * m), kind, wronged };
}

// ───────── 事件：開立、逾期、升級 ─────────

function openEvent(state, a, b, kind, level, { announce = true } = {}) {
  const t = tensionOf(state);
  const day = currentDay(state);
  const ev = { id: t.nextId++, kind, level, aId: a.id, bId: b.id, createdDay: day, deadlineDay: day + T().deadlineDays[level - 1], tried: false };
  t.pending.push(ev);
  if (announce) {
    t.stats.created += 1;
    emit(state, "tension", logText(state, `tension_${getTensionKind(kind).id}`, { A: a, B: b }));
  }
  return ev;
}

const removeEvent = (state, ev) => {
  const t = tensionOf(state);
  t.pending = t.pending.filter((x) => x.id !== ev.id);
};

/** 逾期（無視）：雙方怨氣與仇恨上升；等級 1～2 升一級重發，等級 3 爆發結束 */
function expireEvent(state, ev) {
  const c = T();
  const t = tensionOf(state);
  const a = getSamsarite(state, ev.aId);
  const b = getSamsarite(state, ev.bId);
  removeEvent(state, ev);
  if (!a || !b) return;
  t.stats.expired += 1;
  const g = c.ignoreGrudge[Math.min(ev.level, c.ignoreGrudge.length) - 1];
  addGrudge(a, g);
  addGrudge(b, g);
  addHate(state, a, b, c.ignoreHate);
  addHate(state, b, a, c.ignoreHate);
  if (ev.level < c.deadlineDays.length) {
    emit(state, "tension", logText(state, "tensionEscalate", { A: a, B: b, lv: ev.level + 1 }));
    openEvent(state, a, b, ev.kind, ev.level + 1, { announce: false });
  } else {
    t.stats.booms += 1;
    t.pairCool[pairKey(a, b)] = currentDay(state) + c.pairCooldown;
    emit(state, "tension", logText(state, "tensionBoom", { A: a, B: b }));
  }
}

// ───────── 玩家回應 ─────────

export const pendingTension = (state) => [...tensionOf(state).pending].sort((x, y) => x.deadlineDay - y.deadlineDay || x.id - y.id);
export const tensionParties = (state, ev) => ({ a: getSamsarite(state, ev.aId), b: getSamsarite(state, ev.bId) });

/** 調停成功率：基礎 + 雙方順從度 + 隊長信任 + 雙方理智；夾在 min~max */
export function mediateChance(state, ev) {
  const M = T().mediate;
  const { a, b } = tensionParties(state, ev);
  if (!a || !b) return 0;
  const obey = ((a.traits?.obedience ?? 0) + (b.traits?.obedience ?? 0)) / 2;
  const cap = captainOf(state);
  const capOk = cap && cap.id !== a.id && cap.id !== b.id && affinity(state, cap, a) >= 0 && affinity(state, cap, b) >= 0;
  const san = (a.stats.sanity + b.stats.sanity) / 2;
  const v = M.base + (M.obedience * obey) / 100 + (capOk ? M.captain : 0) + (M.sanity * (san - 50)) / 100;
  return Math.max(M.min, Math.min(M.max, v));
}

/** 補償價格（公庫）：兩人日維持費 × 天數 × 等級倍率 × 近期補償遞增 */
export function compensateCost(state, ev, payeeId = ev.aId) {
  const C = T().compensate;
  const { a, b } = tensionParties(state, ev);
  if (!a || !b) return 0;
  const day = currentDay(state);
  const recent = (tensionOf(state).comp[payeeId] ?? []).filter((d) => day - d <= C.repeatWindow).length;
  return Math.max(1, Math.round(C.costDays * (upkeepOf(a, state) + upkeepOf(b, state)) * C.levelMult[Math.min(ev.level, C.levelMult.length) - 1] * C.repeatMult ** recent));
}

/** 給 UI／sim 看的選項明細 */
export function tensionOptions(state, ev) {
  const { a, b } = tensionParties(state, ev);
  const cost = compensateCost(state, ev);
  return {
    mediate: { ok: !ev.tried && !!a && !!b, chance: mediateChance(state, ev), tried: ev.tried },
    compensate: { ok: !!a && !!b && canAfford(state, cost), cost },
    separate: { ok: !!a && !!b && (eligible(a) || eligible(b)), days: T().apart.vacationDays },
  };
}

function finish(state, ev, a, b) {
  removeEvent(state, ev);
  tensionOf(state).pairCool[pairKey(a, b)] = currentDay(state) + T().pairCooldown;
}

/** 玩家（或 sim 機器人）回應一件張力事件。action：mediate／compensate（opts.payeeId）／separate（opts.restId） */
export function resolveTension(state, id, action, opts = {}) {
  const c = T();
  const t = tensionOf(state);
  const ev = t.pending.find((x) => x.id === id);
  if (!ev) return { ok: false, reason: "這件麻煩已經不存在" };
  const { a, b } = tensionParties(state, ev);
  if (!a || !b) return { ok: false, reason: "當事人不在了" };

  if (action === "mediate") {
    if (opts.auto ? ev.autoTried : ev.tried) return { ok: false, reason: "已經調停過了，這次談不攏" };
    const chance = mediateChance(state, ev) * (opts.chanceMult ?? 1); // 自動化中樞的自動調停成功率打折（A-3 階段 3）
    if (rand(tensionRng(state)) < chance) {
      for (const x of [a, b]) addGrudge(x, c.mediate.okGrudge);
      softenHate(state, a, b, { reduce: -c.mediate.okHate });
      softenHate(state, b, a, { reduce: -c.mediate.okHate });
      t.stats.mediateOk += 1;
      emit(state, "tension", logText(state, "tensionMediateOk", { A: a, B: b }));
      finish(state, ev, a, b);
      return { ok: true, success: true, chance };
    }
    for (const x of [a, b]) addGrudge(x, c.mediate.failGrudge);
    addHate(state, a, b, c.mediate.failHate);
    addHate(state, b, a, c.mediate.failHate);
    if (opts.auto) ev.autoTried = true; // 自動調停失敗只用掉自動化的那一次，玩家仍可親手再試（A-3 階段 3：避免自動化搶走玩家的調停機會）
    else ev.tried = true;
    t.stats.mediateFail += 1;
    emit(state, "tension", logText(state, "tensionMediateFail", { A: a, B: b }));
    return { ok: true, success: false, chance };
  }

  if (action === "compensate") {
    const payee = opts.payeeId === ev.bId ? b : a;
    const other = payee === a ? b : a;
    const cost = compensateCost(state, ev, payee.id);
    if (!canAfford(state, cost)) return { ok: false, reason: "公庫積分不夠（已達高利貸上限）" };
    spend(state, cost, false);
    (t.comp[payee.id] ??= []).push(currentDay(state));
    const C = c.compensate;
    addGrudge(payee, C.payeeGrudge);
    addLove(state, payee, other, C.payeeAffinity);
    addGrudge(other, C.otherGrudge);
    addHate(state, other, payee, C.otherHate);
    t.stats.compensate += 1;
    emit(state, "tension", logText(state, "tensionCompensate", { A: payee, B: other, cost }));
    finish(state, ev, a, b);
    return { ok: true, cost, payeeId: payee.id };
  }

  if (action === "separate") {
    const rest = opts.restId === ev.bId ? b : a;
    if (!eligible(rest)) return { ok: false, reason: `${rest.name} 現在不在主神空間，沒辦法放假` };
    rest.vacationDays = Math.max(rest.vacationDays ?? 0, c.apart.vacationDays);
    t.apart[pairKey(a, b)] = currentDay(state) + c.apart.days;
    t.stats.separate += 1;
    emit(state, "tension", logText(state, "tensionSeparate", { A: rest, B: rest === a ? b : a, days: c.apart.vacationDays }));
    finish(state, ev, a, b);
    return { ok: true, restId: rest.id };
  }
  return { ok: false, reason: "不認識的處理方式" };
}

// ───────── 隊長自動調停（只處理等級 1）─────────

function captainAutoMediate(state) {
  const C = T().captainAuto;
  const cap = captainOf(state);
  if (!cap || !eligible(cap) || cap.stats.sanity < C.captainSanity) return;
  const t = tensionOf(state);
  for (const ev of [...t.pending]) {
    if (ev.level !== 1 || ev.aId === cap.id || ev.bId === cap.id) continue;
    const { a, b } = tensionParties(state, ev);
    if (!a || !b || affinity(state, cap, a) < 0 || affinity(state, cap, b) < 0) continue;
    if (rand(tensionRng(state)) >= C.chance) continue;
    for (const x of [a, b]) addGrudge(x, C.grudge);
    softenHate(state, a, b, { reduce: -C.hate });
    softenHate(state, b, a, { reduce: -C.hate });
    t.stats.auto += 1;
    emit(state, "tension", logText(state, "tensionCaptainAuto", { A: a, B: b, C: cap }));
    finish(state, ev, a, b);
  }
}

// ───────── 怨氣後果 ─────────

function tensionKill(state, a, b) {
  const rng = tensionRng(state);
  const R = CONFIG.relations;
  emit(state, "relation", logText(state, "attack", { A: a, B: b }));
  const pa = effectivePower(a);
  const pb = effectivePower(b);
  if (rand(rng) < pa / (pa + pb)) {
    killSamsarite(state, b, `在主神空間被 ${a.name} 當場殺害`, a);
    afterDeath(state, b, a);
  } else {
    setInjury(b, Math.min(3, b.injury + R.directInjury));
    addHate(state, b, a, R.attackHate);
    emit(state, "relation", logText(state, "attackSurvive", { A: a, B: b }));
  }
  punish(state, a, weighted(rng, R.punish.weights).type); // 主神照樣懲罰動手的人
}

function runOutcome(state, s) {
  const c = T();
  const rng = tensionRng(state);
  const cap = captainOf(state);
  const home = state.samsarites.filter((x) => x.id !== s.id && x.location === "space");
  const tr = s.traits ?? {};
  const edge = 1 + (c.courageWeight * (Math.max(0, tr.courage ?? 0) + Math.max(0, -(tr.obedience ?? 0)))) / 100; // 膽大、不順從的人更敢動手
  const opts = [];

  if (cap?.id !== s.id && !s.customProfile && (state.rogueBosses?.length ?? 0) < CONFIG.lineage.rogueMax) opts.push({ kind: "defect", weight: c.outcomes.defect * edge });
  const target = home.filter((o) => getRel(state, s, o).hate >= c.killMinHate).sort((x, y) => getRel(state, s, y).hate - getRel(state, s, x).hate || x.id - y.id)[0];
  if (target) opts.push({ kind: "kill", weight: c.outcomes.kill * edge, target });
  if (cap && cap.id !== s.id && eligible(cap)) {
    const crew = [...home.filter((x) => x.id !== cap.id), s].filter((x, i, arr) => arr.indexOf(x) === i && x.id !== cap.id && (x.grudge ?? 0) >= c.coupMinGrudge && affinity(state, x, cap) <= 0);
    if (crew.length >= c.minConspirators && crew.includes(s)) opts.push({ kind: "coup", weight: c.outcomes.coup, crew, cap });
  }
  opts.push({ kind: "defy", weight: c.outcomes.defy });

  const pick = weighted(rng, opts);
  const t = tensionOf(state);
  t.stats.outcomes[pick.kind] += 1;
  if (pick.kind === "defect") defect(state, s);
  else if (pick.kind === "kill") tensionKill(state, s, pick.target);
  else if (pick.kind === "coup") {
    const crew = [...pick.crew].sort((x, y) => effectivePower(y) - effectivePower(x) || x.id - y.id);
    const ev = DRAMA_EVENTS.find((e) => e.id === "coup_night");
    applyEvent(state, ev, { A: crew[0], B: pick.cap, list: crew }, state.samsarites.filter((x) => x.location === "space"));
    for (const x of crew) if (state.samsarites.includes(x)) x.grudge = Math.min(x.grudge ?? 0, c.afterOutcome);
  } else {
    emit(state, "grudge", logText(state, "grudgeDefy", { A: s }));
    emit(state, "grudge", setMood(state, s, "upset"), { samsariteId: s.id });
    startDefy(state, s, CONFIG.personality.v3?.defyDays ?? 0); // 個性 v3：真的拒絕出征幾天（強制任務與洲際碰撞照樣徵召）
  }
  if (state.samsarites.includes(s)) s.grudge = Math.min(s.grudge ?? 0, c.afterOutcome);
  return pick.kind;
}

/** 空間氣氛等級（依最高怨氣）：0 平靜／1 暗流／2 一觸即發 */
export function climateIndex(state) {
  const top = Math.max(0, ...state.samsarites.filter((s) => s.location !== "pod").map((s) => s.grudge ?? 0));
  const [lo, hi] = T().climate;
  return top >= hi ? 2 : top >= lo ? 1 : 0;
}

// ───────── 每日掛鉤 ─────────

/** 每日結算（advanceTick，dailyRelations 之後）：隊長自動調停 → 逾期處理 → 產生新事件 → 怨氣消退與後果 → 空間氣氛 */
export function dailyTension(state) {
  if (state.gameOver || !T().enabled) return;
  const c = T();
  const t = tensionOf(state);
  const day = currentDay(state);
  const rng = tensionRng(state);

  t.pending = t.pending.filter((ev) => getSamsarite(state, ev.aId) && getSamsarite(state, ev.bId)); // 當事人不在了（死亡、叛逃、回收）
  captainAutoMediate(state);
  autoMediate(state); // 自動化中樞：調解中樞（A-3 階段 3；沒投資或故障、停擺時什麼都不做）
  for (const ev of [...t.pending]) if (day >= ev.deadlineDay) expireEvent(state, ev);

  // 產生新事件：每一對在家的人各擲一次（有待辦或冷卻中的不擲）
  const home = state.samsarites.filter(eligible).sort((x, y) => x.id - y.id);
  const busy = new Set(t.pending.map((ev) => pairKey({ id: ev.aId }, { id: ev.bId })));
  for (let i = 0; i < home.length; i++) {
    for (let j = i + 1; j < home.length; j++) {
      const [a, b] = [home[i], home[j]];
      const key = pairKey(a, b);
      if (busy.has(key) || (t.pairCool[key] ?? 0) > day) continue;
      const prof = pairProfile(state, a, b);
      if (rand(rng) >= prof.p) continue;
      const [x, y] = prof.wronged && prof.wronged.id === b.id ? [b, a] : [a, b];
      openEvent(state, x, y, prof.kind, 1);
      busy.add(key);
    }
  }
  for (const [k, until] of Object.entries(t.pairCool)) if (until <= day) delete t.pairCool[k];
  for (const [k, until] of Object.entries(t.apart)) if (until <= day) delete t.apart[k];

  // 怨氣自然消退；過門檻的人每天擲後果
  for (const s of state.samsarites) if ((s.grudge ?? 0) > 0) addGrudge(s, -c.grudgeDecay);
  for (const s of [...state.samsarites].sort((x, y) => x.id - y.id)) {
    if (!state.samsarites.includes(s) || s.location !== "space" || (s.grudge ?? 0) < c.crisisAt) continue;
    if (rand(rng) < c.crisisChance) runOutcome(state, s);
  }

  // 空間氣氛：等級改變才寫一行日誌
  const lv = CLIMATE_LEVELS[climateIndex(state)];
  if (lv.id !== t.climate) {
    t.climate = lv.id;
    emit(state, "tension", logText(state, `tensionClimate_${lv.id}`, {}));
  }
  checkGameOver(state);
}
