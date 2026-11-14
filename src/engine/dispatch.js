// 自動派遣：把「可用的人」排列組合，挑出最划算的（副本 + 隊伍）。
// 規則：在預估通關率達標的組合裡，優先打獎勵最高的副本；同一個副本的隊伍怎麼挑見 isBetterPlan。

import { CONFIG } from "../data/config.js";
import { DUNGEONS } from "../data/dungeons.js";
import { emit, advanceTick, checkGameOver, currentDay } from "./core.js";
import { logText } from "./templates.js";
import { areEnemies as pairEnemies } from "./relations.js";
import { checkAlerts } from "./alerts.js";
import { activeMission } from "./godEvents.js";
import { MANDATORY_ID, pendingMandatory } from "./mandatory.js";
import { effectivePower } from "./tags.js";
import { clearChance, deathRisk, partyPower, startRun, stepDueRooms, settleRuns, unlockedDungeons, isUnlocked, hasIntel } from "./dungeon.js";
import { boardTargets } from "./board.js";
import { intelFull } from "./market.js";
import { erosionUnlocked, applyErosion, erosionRewardMult } from "./erosion.js";

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

/**
 * 目前策略的整套派遣規則（問題 2）：通關率門檻、每輪最多派幾隊、傷勢上限、死亡風險上限、留守人數。
 * "off"（sim 基準曲線）維持舊行為：門檻用 CONFIG.auto.minClearChance、不限隊數、不留人。
 */
export function autoRules(state) {
  const key = state.autoStrategy ?? CONFIG.auto.defaultStrategy;
  if (key === "off") return { minClear: CONFIG.auto.minClearChance, maxTeams: Infinity, maxInjury: 3, maxDeathRisk: 1, reserve: 0 };
  return CONFIG.auto.rules[key] ?? CONFIG.auto.rules.balanced;
}

/** 這支隊伍符不符合策略（傷勢上限、留守人數、死亡風險）。死亡風險最貴，所以放最後並只在有設限時才算 */
function partyAllowed(state, party, dungeon, rules, homeCount) {
  if (party.some((s) => s.injury > rules.maxInjury)) return false;
  if (homeCount - party.length < rules.reserve) return false;
  if (rules.maxDeathRisk < 1 && deathRisk(state, party, dungeon) > rules.maxDeathRisk) return false;
  return true;
}

/** 可以被自動派遣的人：在家、沒鎖定、（保護開關開著時）沒受傷；強制任務待派時前 4 強留給任務 */
export function autoCandidates(state) {
  const reserved = reservedForMandatory(state);
  const rules = autoRules(state);
  return state.samsarites
    .filter((s) => !reserved.has(s.id))
      .filter((s) => s.location === "space" && !s.locked && !(s.vacationDays > 0) && !(s.podLockDays > 0))
    .filter((s) => !(state.settings.protect.noInjured && s.injury > 0))
    .filter((s) => s.injury <= rules.maxInjury)
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

/**
 * 自動派遣可以選的目標（4-D-4）：任務榜上還沒人出發的槽（含突變詞綴的 R 倍率與獎勵加成）＋已解鎖的各章尾王（常駐）。
 * 每個目標 = { dungeon（已套詞綴的 R）, slotId（尾王為 null）, mutation, reward（含詞綴的結算積分加成，只用來比較） }
 */
export function autoTargets(state) {
  const out = boardTargets(state)
    .filter((t) => !t.slot.running && isUnlocked(state, t.dungeon))
    .map((t) => ({ dungeon: t.dungeon, slotId: t.slot.id, mutation: t.mutation, reward: t.dungeon.reward * (1 + (t.mutation?.rewardPct ?? 0)) }));
  for (const d of unlockedDungeons(state)) if (d.boss) out.push({ dungeon: d, slotId: null, mutation: null, reward: d.reward });
  return out;
}

// 比較兩個方案：獎勵高的副本優先；同副本時「夠穩」（達到目標通關率）的優先；
// 都夠穩就挑總戰力低的（不浪費戰力），都不夠穩就挑通關率高的（不讓人白白送死）。
function isBetterPlan(a, b) {
  if (a.reward !== b.reward) return a.reward > b.reward;
  if (a.comfy !== b.comfy) return a.comfy;
  return a.comfy ? a.power < b.power : a.chance > b.chance;
}

/**
 * 自動派遣的「看戰力下菜」門檻（4-E-8）：隊伍總戰力 >= 關卡實際有效推薦戰力 × 倍率才出擊。
 * state.autoStrategy：safe 1.20／balanced 1.00（空間 Lv.1 新手期放寬為 0.85）／aggressive 0.80／off 不檢查（sim 基準曲線用）。
 */
export function autoRatioGate(state) {
  const A = CONFIG.auto.strategies;
  const key = state.autoStrategy ?? CONFIG.auto.defaultStrategy;
  if (key === "off") return 0;
  if (key === "balanced" && (state.spaceLevel ?? 1) === 1) return A.balancedNewbie;
  return A[key] ?? A.balanced;
}
let ratioBlocked = false; // 這一輪規劃：有沒有組合「通關率夠、但戰力比值不夠」被擋下（待機提示用）

/** 在 candidates 的所有隊伍組合 × targets（autoTargets 的項目）裡挑最划算的；mustInclude 有值時，隊伍必須包含他 */
function bestPlan(state, candidates, targets, mustInclude = null) {
  let best = null;
  const gate = autoRatioGate(state);
  const rules = autoRules(state);
  const homeCount = state.samsarites.filter((s) => s.location === "space").length;
  for (const party of subsets(candidates, CONFIG.partyMax)) {
    if (mustInclude && !party.includes(mustInclude)) continue;
    if (state.settings.protect.noEnemies && hasEnemyPair(state, party)) continue;
    const power = partyPower(party);
    for (const target of targets) {
      const { dungeon } = target;
      const chance = clearChance(state, party, dungeon);
      if (chance < rules.minClear) continue;
      if (gate > 0 && power < dungeon.recommendedPower * gate) { // 戰力不夠就不挑這個槽（不開放鎖定單一關卡，但會看戰力下菜）
        ratioBlocked = true;
        continue;
      }
      if (!partyAllowed(state, party, dungeon, rules, homeCount)) continue; // 傷勢上限／留守人數／死亡風險（問題 2、4）
      const comfy = chance >= CONFIG.auto.targetClearChance;
      const plan = { dungeon, party, chance, power, comfy, reward: target.reward, slotId: target.slotId, mutation: target.mutation };
      if (!best || isBetterPlan(plan, best)) best = plan;
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
  ratioBlocked = false;
  let candidates = autoCandidates(state);
  const mission = CONFIG.auto.missionFirst ? activeMission(state) : null;
  const target = mission ? state.samsarites.find((s) => s.id === mission.samsariteId) : null;
  const found = mission ? DUNGEONS.find((d) => d.id === mission.dungeonId) : null;
  const missionDungeon = found && isUnlocked(state, found) ? found : null;
  const usable = target && missionDungeon && target.location === "space" && !target.locked && !(target.vacationDays > 0) && !(target.podLockDays > 0) && !(state.settings.protect.noInjured && target.injury > 0);
  if (usable) {
    if (!candidates.includes(target)) candidates = [...candidates.slice(0, CONFIG.auto.maxCandidates - 1), target]; // 戰力太低被截掉也要算進來
    const plan = bestPlan(state, candidates, [{ dungeon: missionDungeon, slotId: null, mutation: null, reward: missionDungeon.reward }], target);
    if (plan) return plan;
  }
  const normal = bestPlan(state, candidates, autoTargets(state));
  // 位面侵蝕（4-F-3）：自動挑戰侵蝕開著時，只在「主線卡關」（打得過的任務都低於最前線章節）或「全通後」才改打已首通世界的侵蝕星級，
  // 賺結晶與高倍率積分；最前線章節還有打得過的任務時，主線優先（侵蝕獎勵 ×1.32^k 很大，不能搶走推進主線的人手）
  const frontier = (state.spaceLevel ?? 1) >= CONFIG.space.maxLevel && !!state.chapterClearDay?.[CONFIG.space.maxLevel] ? false : true;
  const blocked = !frontier || !normal || normal.dungeon.chapter < (state.spaceLevel ?? 1);
  if (state.autoErosion && erosionUnlocked(state) && blocked) {
    const eros = bestErosionPlan(state, candidates);
    if (eros && (!normal || eros.reward > normal.reward)) return eros;
  }
  return normal;
}

/**
 * 侵蝕方案：從已首通、已解鎖的世界裡挑獎勵最高的前 CONFIG.erosion.autoWorlds 個，
 * 對每個隊伍組合找「可安全吃下」（通關率達 minClearChance、戰力達 autoStrategy 門檻）的最高星級。
 */
function bestErosionPlan(state, candidates) {
  const worlds = DUNGEONS.filter((d) => hasIntel(state, d) && isUnlocked(state, d))
    .sort((a, b) => b.reward - a.reward)
    .slice(0, CONFIG.erosion.autoWorlds);
  if (worlds.length === 0) return null;
  const gate = autoRatioGate(state);
  const rules = autoRules(state);
  const homeCount = state.samsarites.filter((s) => s.location === "space").length;
  let best = null;
  for (const party of subsets(candidates, CONFIG.partyMax)) {
    if (state.settings.protect.noEnemies && hasEnemyPair(state, party)) continue;
    const power = partyPower(party);
    for (const world of worlds) {
      for (let k = CONFIG.erosion.maxStar; k >= 1; k--) {
        const dungeon = applyErosion(world, k);
        if (gate > 0 && power < dungeon.recommendedPower * gate) continue;
        const chance = clearChance(state, party, dungeon);
        if (chance < rules.minClear) continue;
        if (!partyAllowed(state, party, dungeon, rules, homeCount)) continue;
        const plan = { dungeon: world, party, chance, power, comfy: chance >= CONFIG.auto.targetClearChance, reward: world.reward * erosionRewardMult(k), slotId: null, mutation: null, erosion: k };
        if (!best || isBetterPlan(plan, best)) best = plan;
        break; // 這個隊伍 × 世界已找到最高可行星級
      }
    }
  }
  return best;
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
  // 問題 3：平常尊重保護設定（🔒 鎖定的人不派、noInjured 開著時傷員不派），先排除他們再取前 4 名；
  // 池子空了就等，只有真的到了最後期限（再不派就抹殺）才放寬、硬派並跳提示。
  const home = state.samsarites.filter((s) => s.location === "space" && !(s.vacationDays > 0) && !(s.podLockDays > 0));
  const order = (a, b) => (a.injury > 0) - (b.injury > 0) || effectivePower(b) - effectivePower(a); // 健康優先、戰力由高到低
  let pool = home.filter((s) => !s.locked && !(state.settings.protect.noInjured && s.injury > 0));
  let relaxed = false;
  if (pool.length === 0 && lastChance) {
    pool = home;
    relaxed = true;
  }
  const party = [...pool].sort(order).slice(0, CONFIG.partyMax);
  if (party.length === 0) return 0;
  const ok = startRun(state, MANDATORY_ID, party.map((s) => s.id), { ignoreLock: relaxed }).ok;
  if (ok && relaxed) emit(state, "mandatory", logText(state, "mandatoryForced", { A: party[0], n: party.length }));
  return ok ? 1 : 0;
}

/** 一次排出多隊：每輪挑最划算的一隊，剩下的人再組下一隊，直到沒有達標的組合（人手用完）。回傳派出幾隊 */
export function tryAutoDispatch(state) {
  let sent = autoMandatory(state);
  const rules = autoRules(state);
  let normal = 0; // 問題 1：每輪（= 每天）一般派遣最多幾隊，依策略（強制任務那一隊不算）
  while (normal < rules.maxTeams) {
    const plan = planAutoDispatch(state);
    if (!plan) break;
    // 貪婪探索（4-D-4）：預估通關率夠高而且該副本情報滿格就帶上
    const greedy = plan.chance >= CONFIG.relic.autoGreedyAt && intelFull(state, plan.dungeon.id);
    const result = startRun(state, plan.dungeon.id, plan.party.map((s) => s.id), { slotId: plan.slotId, greedy, erosion: plan.erosion ?? 0 });
    if (!result.ok) break;
    sent += 1;
    normal += 1;
  }
  if (sent === 0) {
    if (ratioBlocked) {
      // 所有任務槽對手上的人都超出戰力門檻：當日待機休整，提示最多每 3 天一次（不洗版）
      if (currentDay(state) - (state.autoRiskLogDay ?? -99) >= CONFIG.auto.riskLogEveryDays) {
        state.autoRiskLogDay = currentDay(state);
        emit(state, "autoRisk", logText(state, "autoRisk"));
      }
    } else emit(state, "autoIdle", logText(state, "autoIdle"));
  }
  return sent;
}

/** 遊戲主迴圈的「一步」= 主神空間與所有副本同步前進一個時段：先走各副本該走的房間，再推進時間，再結算結束的副本 */
export function step(state) {
  if (state.gameOver) return;
  stepDueRooms(state);
  advanceTick(state, () => {
    // #10：強制任務若在這個日界線逾時抹殺，先讓剛好此刻結束的副本結算回家，再給一次補派機會（自動派遣開著才補派）
    const pending = pendingMandatory(state);
    if (!pending || currentDay(state) < pending.deadlineDay) return;
    settleRuns(state);
    if (state.settings.autoDispatch) autoMandatory(state);
  });
  settleRuns(state);
  const isDispatchTick = state.tick % CONFIG.ticksPerDay === CONFIG.auto.dispatchAtTick;
  if (state.settings.autoDispatch && isDispatchTick) tryAutoDispatch(state);
  checkAlerts(state);
  checkGameOver(state);
}
