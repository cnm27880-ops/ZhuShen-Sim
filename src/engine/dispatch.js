// 自動派遣：把「可用的人」排列組合，挑出最划算的（副本 + 隊伍）。
// 規則：在預估通關率達標的組合裡，優先打獎勵最高的副本；同一個副本的隊伍怎麼挑見 isBetterPlan。

import { CONFIG } from "../data/config.js";
import { DUNGEONS } from "../data/dungeons.js";
import { emit, advanceTick, checkGameOver, currentDay } from "./core.js";
import { logText } from "./templates.js";
import { areEnemies as pairEnemies } from "./relations.js";
import { activeMission } from "./godEvents.js";
import { MANDATORY_ID, pendingMandatory } from "./mandatory.js";
import { effectivePower } from "./tags.js";
import { clearChance, partyPower, startRun, stepDueRooms, settleRuns, unlockedDungeons, isUnlocked } from "./dungeon.js";

// 兩人是否為仇恨／死敵（關係系統在 engine/relations.js）
export function areEnemies(state, a, b) {
  return pairEnemies(state, a, b);
}

/** 強制任務待派時，要替它保留的人：名冊前 topN 強（不論在哪）。沒有待派任務就是空集合 */
function reservedForMandatory(state) {
  if (!pendingMandatory(state) || !CONFIG.auto.holdForMandatory) return new Set();
  const top = state.samsarites.filter((s) => s.location !== "pod").sort((a, b) => effectivePower(b) - effectivePower(a)).slice(0, CONFIG.forcedMission.topN);
  return new Set(top.map((s) => s.id));
}

/** 可以被自動派遣的人：在家、沒鎖定、（保護開關開著時）沒受傷；強制任務待派時前 4 強留給任務 */
export function autoCandidates(state) {
  const reserved = reservedForMandatory(state);
  return state.samsarites
    .filter((s) => !reserved.has(s.id))
    .filter((s) => s.location === "space" && !s.locked && !(s.vacationDays > 0))
    .filter((s) => !(state.settings.protect.noInjured && s.injury > 0))
    .sort((a, b) => effectivePower(b) - effectivePower(a))
    .slice(0, CONFIG.auto.maxCandidates);
}

function* subsets(items, maxSize, start = 0, current = []) {
  if (current.length > 0) yield current;
  if (current.length === maxSize) return;
  for (let i = start; i < items.length; i++) {
    yield* subsets(items, maxSize, i + 1, [...current, items[i]]);
  }
}

function hasEnemyPair(state, party) {
  for (let i = 0; i < party.length; i++) {
    for (let j = i + 1; j < party.length; j++) {
      if (areEnemies(state, party[i], party[j])) return true;
    }
  }
  return false;
}

// 比較兩個方案：獎勵高的副本優先；同副本時「夠穩」（達到目標通關率）的優先；
// 都夠穩就挑總戰力低的（不浪費戰力），都不夠穩就挑通關率高的（不讓人白白送死）。
function isBetterPlan(a, b) {
  if (a.dungeon.reward !== b.dungeon.reward) return a.dungeon.reward > b.dungeon.reward;
  if (a.comfy !== b.comfy) return a.comfy;
  return a.comfy ? a.power < b.power : a.chance > b.chance;
}

/** 在 candidates 的所有隊伍組合 × dungeons 裡挑最划算的；mustInclude 有值時，隊伍必須包含他 */
function bestPlan(state, candidates, dungeons, mustInclude = null) {
  let best = null;
  for (const party of subsets(candidates, CONFIG.partyMax)) {
    if (mustInclude && !party.includes(mustInclude)) continue;
    if (state.settings.protect.noEnemies && hasEnemyPair(state, party)) continue;
    const power = partyPower(party);
    for (const dungeon of dungeons) {
      const chance = clearChance(state, party, dungeon);
      if (chance < CONFIG.auto.minClearChance) continue;
      const comfy = chance >= CONFIG.auto.targetClearChance;
      const better = !best || isBetterPlan({ dungeon, chance, power, comfy }, best);
      if (better) best = { dungeon, party, chance, power, comfy };
    }
  }
  return best;
}

/**
 * 回傳 { dungeon, party, chance } 或 null（沒有任何組合達標）。
 * 主神突襲任務（Phase 3-E）：目標還能被自動派遣時，先找「含他、打任務副本、通關率達標」的方案；
 * 找不到（他太弱、被鎖定…）才走一般邏輯，所以不會為了任務硬送人去死。
 */
export function planAutoDispatch(state) {
  let candidates = autoCandidates(state);
  const mission = CONFIG.auto.missionFirst ? activeMission(state) : null;
  const target = mission ? state.samsarites.find((s) => s.id === mission.samsariteId) : null;
  const found = mission ? DUNGEONS.find((d) => d.id === mission.dungeonId) : null;
  const missionDungeon = found && isUnlocked(state, found) ? found : null;
  const usable = target && missionDungeon && target.location === "space" && !target.locked && !(target.vacationDays > 0) && !(state.settings.protect.noInjured && target.injury > 0);
  if (usable) {
    if (!candidates.includes(target)) candidates = [...candidates.slice(0, CONFIG.auto.maxCandidates - 1), target]; // 戰力太低被截掉也要算進來
    const plan = bestPlan(state, candidates, [missionDungeon], target);
    if (plan) return plan;
  }
  return bestPlan(state, candidates, unlockedDungeons(state));
}

/**
 * 主神強制任務（Phase 4-C-4）：自動派遣開著時優先處理。不設通關率門檻（不派就是被抹殺），
 * 派名冊在家、沒鎖定、沒放假的人裡「沒受傷優先、其次戰力高」的最多 4 人。回傳派出幾隊（0 或 1）。
 * 4-C-6：R 是看名冊前 4 強算的，所以前 4 強還在副本時先等（同時 autoCandidates 不會再把他們派出去），
 * 等到他們都回家；但期限前最後一個自動派遣時段（再等就逾時）一定派，有多少人派多少。
 */
export function autoMandatory(state) {
  const pending = pendingMandatory(state);
  if (!pending) return 0;
  const topAway = [...reservedForMandatory(state)].some((id) => state.samsarites.find((s) => s.id === id)?.location !== "space");
  const lastChance = currentDay(state) >= pending.deadlineDay - 1;
  if (CONFIG.auto.holdForMandatory && topAway && !lastChance) return 0;
  const pool = state.samsarites.filter((s) => s.location === "space" && !s.locked && !(s.vacationDays > 0));
  const party = [...pool].sort((a, b) => (a.injury > 0) - (b.injury > 0) || effectivePower(b) - effectivePower(a)).slice(0, CONFIG.partyMax);
  if (party.length === 0) return 0;
  return startRun(state, MANDATORY_ID, party.map((s) => s.id)).ok ? 1 : 0;
}

/** 一次排出多隊：每輪挑最划算的一隊，剩下的人再組下一隊，直到沒有達標的組合（人手用完）。回傳派出幾隊 */
export function tryAutoDispatch(state) {
  let sent = autoMandatory(state);
  for (;;) {
    const plan = planAutoDispatch(state);
    if (!plan) break;
    const result = startRun(state, plan.dungeon.id, plan.party.map((s) => s.id));
    if (!result.ok) break;
    sent += 1;
  }
  if (sent === 0) emit(state, "autoIdle", logText(state, "autoIdle"));
  return sent;
}

/** 遊戲主迴圈的「一步」= 主神空間與所有副本同步前進一個時段：先走各副本該走的房間，再推進時間，再結算結束的副本 */
export function step(state) {
  if (state.gameOver) return;
  stepDueRooms(state);
  advanceTick(state);
  settleRuns(state);
  const isDispatchTick = state.tick % CONFIG.ticksPerDay === CONFIG.auto.dispatchAtTick;
  if (state.settings.autoDispatch && isDispatchTick) tryAutoDispatch(state);
  checkGameOver(state);
}
