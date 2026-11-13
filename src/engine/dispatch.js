// 自動派遣：把「可用的人」排列組合，挑出最划算的（副本 + 隊伍）。
// 規則：在預估通關率達標的組合裡，優先打獎勵最高的副本；同一個副本的隊伍怎麼挑見 isBetterPlan。

import { CONFIG } from "../data/config.js";
import { DUNGEONS } from "../data/dungeons.js";
import { emit, advanceTick, checkGameOver } from "./core.js";
import { clearChance, partyPower, startRun, stepRun } from "./dungeon.js";

// Phase 2 掛鉤：關係系統上線後，這裡回傳「兩人是否為仇恨／死敵」
export function areEnemies(_state, _a, _b) {
  return false;
}

/** 可以被自動派遣的人：在家、沒鎖定、（保護開關開著時）沒受傷 */
export function autoCandidates(state) {
  return state.samsarites
    .filter((s) => s.location === "space" && !s.locked)
    .filter((s) => !(state.settings.protect.noInjured && s.injury > 0))
    .sort((a, b) => b.stats.power - a.stats.power)
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

/** 回傳 { dungeon, party, chance } 或 null（沒有任何組合達標） */
export function planAutoDispatch(state) {
  const candidates = autoCandidates(state);
  let best = null;
  for (const party of subsets(candidates, CONFIG.partyMax)) {
    if (state.settings.protect.noEnemies && hasEnemyPair(state, party)) continue;
    const power = partyPower(party);
    for (const dungeon of DUNGEONS) {
      const chance = clearChance(state, party, dungeon);
      if (chance < CONFIG.auto.minClearChance) continue;
      const comfy = chance >= CONFIG.auto.targetClearChance;
      const better = !best || isBetterPlan({ dungeon, chance, power, comfy }, best);
      if (better) best = { dungeon, party, chance, power, comfy };
    }
  }
  return best;
}

export function tryAutoDispatch(state) {
  const plan = planAutoDispatch(state);
  if (!plan) {
    emit(state, "autoIdle", "🤖 自動派遣：目前沒有任何隊伍的預估通關率達標，今天不出門。");
    return false;
  }
  return startRun(
    state,
    plan.dungeon.id,
    plan.party.map((s) => s.id)
  ).ok;
}

/** 遊戲主迴圈的「一步」：副本中就走一個房間，否則主神空間過一個時段 */
export function step(state) {
  if (state.gameOver) return;
  if (state.run) {
    stepRun(state);
  } else {
    advanceTick(state);
    const isDispatchTick = state.tick % CONFIG.ticksPerDay === CONFIG.auto.dispatchAtTick;
    if (state.settings.autoDispatch && isDispatchTick) tryAutoDispatch(state);
  }
  checkGameOver(state);
}
