// 主神搞事引擎（Phase 3-E）：主神偶爾無聊，對「留在主神空間的人」丟隨機事件。純規則，不碰畫面。
// 種類資料：src/data/godEvents.js；數字：CONFIG.godEvent；日誌：src/data/logs.js（godAsk_*、godDone_* …）。
//
// state.god：
//   rngState         獨立亂數流（不動主亂數，所以加這個系統不會改變既有的種子結果）
//   cooldownUntilDay 這天之前不會再發生新事件
//   pending          等玩家回覆的事件 { id, kind, mode, targetId, createdDay, deadlineDay, params, text } 或 null（同時最多 1 個）
//   mission          進行中的突襲任務 { samsariteId, dungeonId, deadlineDay, reward, penalty } 或 null（同時最多 1 個）
//   nextId           事件編號

import { CONFIG, INJURIES } from "../data/config.js";
import { GOD_EVENTS, getGodEvent } from "../data/godEvents.js";
import { DUNGEONS, getDungeon } from "../data/dungeons.js";
import { randInt, pick, rand, weighted } from "./rng.js";
import { emit, currentDay, spend, canAfford, getSamsarite, setInjury, announceDebtIfNew, debtLimitOf } from "./core.js";
import { setMood, isOnVacation } from "./wishes.js";
import { logText } from "./templates.js";

const G = () => CONFIG.godEvent;

/** 全新的主神狀態（新遊戲、舊存檔補欄位時用）。seed 是遊戲主種子，只用來讓獨立亂數流可重現 */
export function newGodState(seed = 0) {
  return { rngState: (seed ^ 0x600d) | 0, cooldownUntilDay: 0, pending: null, mission: null, nextId: 1 };
}

const god = (state) => (state.god ??= newGodState(state.rngState));
export const pendingGodEvent = (state) => state.god?.pending ?? null;
export const activeMission = (state) => state.god?.mission ?? null;
const atHome = (state) => state.samsarites.filter((s) => s.location === "space");

/** 文字模板用的變數（也給畫面彈窗填 acceptDesc／payDesc／ignoreDesc） */
export function godVars(state, ev) {
  const k = G().kinds[ev.kind];
  const s = ev.targetId != null ? getSamsarite(state, ev.targetId) : null;
  return {
    A: s,
    loss: ev.params.loss,
    san: k.sanityLoss,
    cost: k.resolveCost,
    days: k.days,
    dungeon: getDungeon(ev.params.dungeonId)?.name,
    reward: ev.params.reward,
    penalty: k.penaltyPoints,
    extra: k.resolveSanityAll,
  };
}

// ───────── 事件的產生 ─────────

/** 現在能發生哪些事件：回傳 [{ def, weight }]（不消耗亂數） */
function possibleEvents(state) {
  const home = atHome(state);
  if (home.length === 0) return [];
  const out = [];
  for (const def of GOD_EVENTS) {
    const k = G().kinds[def.id];
    if (!k || k.weight <= 0) continue;
    if (def.mode === "raid") {
      const ready = home.some((s) => !isOnVacation(s) && s.injury === 0);
      const dungeons = DUNGEONS.some((d) => d.recommendedPower <= k.dungeonPowerCap);
      if (!ready || !dungeons || state.god.mission) continue; // 沒人能出任務、沒副本可指定、或已有任務在身
    }
    out.push({ def, weight: k.weight });
  }
  return out;
}

/**
 * 每天結算時呼叫（在許願結算之後、關係事件之前）：
 * 任務逾期 → 沒回覆的事件過期 → 骰新事件。
 */
export function dailyGod(state) {
  if (state.gameOver) return;
  const g = god(state);
  const day = currentDay(state);

  // 突襲任務逾期（被點名的人還在副本裡就先不算，等那場結算完）
  const m = g.mission;
  if (m) {
    const target = getSamsarite(state, m.samsariteId);
    if (!target) g.mission = null;
    else if (day >= m.deadlineDay && target.location !== "dungeon") raidPenalty(state, target, m.dungeonId, "godRaidFail");
  }

  // 沒回覆的事件：視同照辦（突襲任務視同抗命）
  if (g.pending && day >= g.pending.deadlineDay) {
    emit(state, "god", logText(state, "godTimeoutNote"));
    applyEvent(state, g.pending, true);
    g.pending = null;
  }

  if (g.pending || day < g.cooldownUntilDay) return;
  if (state.mandatory?.pending) return; // 強制任務待派時，主神搞事不擲新事件（避免同時兩個任務，4-C-4）
  if (rand(g) >= G().chance) return;
  const choices = possibleEvents(state);
  if (choices.length === 0) return; // 沒人在家（全在副本）、或沒有可發生的種類：這天不擲
  const def = weighted(g, choices).def;
  const params = {};
  let targetId = null;
  if (def.mode === "tax") params.loss = randInt(g, ...G().kinds.tax.loss);
  else if (def.mode === "raid") {
    const k = G().kinds.raid;
    const ready = atHome(state).filter((s) => !isOnVacation(s) && s.injury === 0);
    targetId = pick(g, ready).id;
    params.dungeonId = pick(g, DUNGEONS.filter((d) => d.recommendedPower <= k.dungeonPowerCap)).id;
    params.reward = randInt(g, ...k.rewardPoints);
  } else targetId = pick(g, atHome(state)).id;

  const ev = {
    id: g.nextId++,
    kind: def.id,
    mode: def.mode,
    targetId,
    createdDay: day,
    deadlineDay: day + G().answerDays,
    params,
    text: "",
  };
  ev.text = logText(state, `godAsk_${def.id}`, godVars(state, ev));
  g.pending = ev;
  g.cooldownUntilDay = day + G().cooldownDays;
  emit(state, "godEvent", ev.text, { godEventId: ev.id, samsariteId: targetId });
}

// ───────── 玩家回覆 ─────────

/** 花積分化解得起嗎？ */
export function checkResolve(state) {
  const ev = state.god?.pending;
  if (!ev) return { ok: false, reason: "這個事件已經處理過了" };
  if (!canAfford(state, G().kinds[ev.kind].resolveCost)) return { ok: false, reason: "積分不夠（連主神高利貸都借不到）" };
  return { ok: true };
}

/** 照辦：直接承受（突襲任務＝接下任務） */
export function acceptGodEvent(state) {
  const ev = state.god?.pending;
  if (!ev) return { ok: false, reason: "這個事件已經處理過了" };
  state.god.pending = null;
  applyEvent(state, ev, false);
  return { ok: true };
}

/** 花積分化解：事件取消（突襲任務＝推掉，不罰） */
export function resolveGodEvent(state) {
  const check = checkResolve(state);
  if (!check.ok) return check;
  const ev = state.god.pending;
  const k = G().kinds[ev.kind];
  spend(state, k.resolveCost, false); // 事件化解費不計入商店階級（#16）
  if (k.resolveSanityAll) for (const s of atHome(state)) s.stats.sanity = Math.max(0, s.stats.sanity - k.resolveSanityAll); // 異質代價：全體留守者理智下降（4-E-7）
  state.god.pending = null;
  emit(state, "god", logText(state, `godResolve_${ev.kind}`, godVars(state, ev)));
  return { ok: true };
}

// ───────── 事件的效果 ─────────

/** timedOut = true 表示玩家沒回覆（突襲任務改成抗命受罰；其他事件跟照辦一樣） */
function applyEvent(state, ev, timedOut) {
  const k = G().kinds[ev.kind];
  const vars = godVars(state, ev);
  const target = ev.targetId != null ? getSamsarite(state, ev.targetId) : null;
  if (ev.targetId != null && !target) return; // 人已經不在了（死亡／回收會順手取消事件，這裡只是保險）

  if (ev.mode === "tax") {
    const wasInDebt = state.points < 0;
    state.points = Math.max(debtLimitOf(state), state.points - ev.params.loss);
    announceDebtIfNew(state, wasInDebt);
    emit(state, "god", logText(state, "godDone_tax", vars));
  } else if (ev.mode === "shock") {
    target.stats.sanity = Math.max(0, target.stats.sanity - k.sanityLoss);
    emit(state, "god", logText(state, "godDone_shock", vars));
  } else if (ev.mode === "checkup") {
    const outcome = weighted(god(state), k.outcomes).type;
    if (outcome === "injury") {
      setInjury(target, Math.min(INJURIES.length - 1, target.injury + k.injuryLevels));
      vars.injury = INJURIES[target.injury].name;
    } else if (outcome === "points") {
      vars.reward = randInt(god(state), ...k.rewardPoints);
      state.points += vars.reward;
    } else {
      target.stats.sanity = Math.min(100, target.stats.sanity + k.rewardSanity);
      vars.san = k.rewardSanity;
    }
    emit(state, "god", logText(state, `godDone_checkup_${outcome}`, vars));
  } else if (ev.mode === "raid") {
    if (timedOut) return raidPenalty(state, target, ev.params.dungeonId, "godRaidIgnore");
    state.god.mission = {
      samsariteId: target.id,
      dungeonId: ev.params.dungeonId,
      deadlineDay: currentDay(state) + k.days,
      reward: ev.params.reward,
    };
    emit(state, "god", logText(state, "godRaidStart", vars));
  }
}

/** 抗命或任務逾期：扣積分（可扣到負債，不低於上限）、被點名的人不爽、任務結束 */
function raidPenalty(state, target, dungeonId, logKey) {
  const k = G().kinds.raid;
  const wasInDebt = state.points < 0;
  state.points = Math.max(debtLimitOf(state), state.points - k.penaltyPoints);
  announceDebtIfNew(state, wasInDebt);
  state.god.mission = null;
  const text = logText(state, logKey, { A: target, dungeon: getDungeon(dungeonId)?.name, penalty: k.penaltyPoints });
  emit(state, "god", text + "\n" + setMood(state, target, "upset"));
}

// ───────── 掛鉤：副本結算、死亡／回收 ─────────

/** 副本結算時呼叫（跟 wishesAfterRun 一樣的參數）：任務目標活著帶隊通關指定副本 → 領獎 */
export function godAfterRun(state, dungeonId, success, partyIds, survivorIds) {
  const m = state.god?.mission;
  if (!m || m.dungeonId !== dungeonId || !success) return;
  if (!partyIds.includes(m.samsariteId) || !survivorIds.includes(m.samsariteId)) return;
  const s = getSamsarite(state, m.samsariteId);
  state.god.mission = null;
  if (!s) return;
  state.points += m.reward;
  const text = logText(state, "godRaidDone", { A: s, dungeon: getDungeon(dungeonId)?.name, reward: m.reward });
  emit(state, "god", text + "\n" + setMood(state, s, "happy"));
}

/** 人死了或被回收：跟他有關的待回覆事件和任務直接取消，不罰分 */
export function cancelGodOf(state, id) {
  const g = state.god;
  if (!g) return;
  if (g.pending?.targetId === id) g.pending = null;
  if (g.mission?.samsariteId === id) g.mission = null;
}

export { getGodEvent };

/**
 * 事件經濟檢查（4-E-7 防同幣別套利，測試掃描用）：
 *   直接後果是否「純扣積分」、最高扣多少；化解的積分價與是否另有非積分代價。
 * 規則：純扣積分的事件，化解必須帶非積分代價，或積分價 >= 直接最高扣分；
 *       直接後果含扣理智／受傷／減員／不爽等非積分損失時，才允許花小額積分破財消災。
 */
export function godEventEconomics(id) {
  const k = G().kinds[id];
  const def = GOD_EVENTS.find((e) => e.id === id);
  const directPointsMax = def.mode === "tax" ? k.loss[1] : def.mode === "raid" ? k.penaltyPoints : 0;
  return { directPointsMax, directNonPoint: def.mode !== "tax", resolvePoints: k.resolveCost, resolveNonPoint: !!k.resolveSanityAll };
}
