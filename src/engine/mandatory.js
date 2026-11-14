// 主神強制血腥任務引擎（Phase 4-C-4）。純規則，不碰畫面。數字：CONFIG.forcedMission；文字：src/data/mandatory.js、logs.js（mandatory*）。
//
// state.mandatory：
//   rngState  獨立亂數流（只用在「逾時抹殺」抽人，不動主亂數）
//   lastDay   上次觸發的天數（起算點，初始 = startDay，所以第一次觸發在 startDay + intervalDays）
//   pending   等玩家派隊的任務 { id, createdDay, deadlineDay } 或 null（同時最多 1 個）
//   nextId    任務編號
// 任務本體是「動態副本」：開場時用 buildMandatoryDungeon 依當下名冊算 R，整份快照存在 run.dungeonDef（所以存檔可還原）。
// 出發由 dungeon.js 的 startRun（dungeonId = MANDATORY_ID）處理，結算在 finishRun 的 mandatory 分支。

import { CONFIG } from "../data/config.js";
import { MANDATORY_ID, MANDATORY_DUNGEON } from "../data/mandatory.js";
import { rand, randInt } from "./rng.js";
import { emit, currentDay, killSamsarite, setInjury } from "./core.js";
import { effectivePower } from "./tags.js";
import { afterDeath } from "./relations.js";
import { logText } from "./templates.js";

export { MANDATORY_ID };
const M = () => CONFIG.forcedMission;

export function newMandatoryState(seed = 0) {
  return { rngState: (seed ^ 0x4d41) | 0, lastDay: M().startDay, pending: null, nextId: 1 };
}
const mand = (state) => (state.mandatory ??= newMandatoryState(state.rngState));
export const pendingMandatory = (state) => state.mandatory?.pending ?? null;

const roster = (state) => state.samsarites.filter((s) => s.location !== "pod");

/** 人口軟上限（不含催熟艙嬰兒） */
export function popLimit(state) {
  return M().popBase + (state.spaceLevel ?? 1) * M().popPerLevel;
}
export const isOverPop = (state) => roster(state).length > popLimit(state);

/** 目前的觸發間隔：人口超標就縮短 */
export function mandatoryInterval(state) {
  return isOverPop(state) ? M().overPopIntervalDays : M().intervalDays;
}
/** 下一次觸發的天數（人口超標時每天重算，所以超標會立刻縮短倒數） */
export function nextMandatoryDay(state) {
  return mand(state).lastDay + mandatoryInterval(state);
}

/** 名冊（不含催熟艙）前 N 強的有效戰力總和，不論人在哪 */
export function topPowerSum(state, n = M().topN, onlyHome = false) {
  return roster(state)
    .filter((s) => !onlyHome || s.location === "space") // onlyHome：只算此刻在家可派的人（#11）
    .map(effectivePower)
    .sort((a, b) => b - a)
    .slice(0, n)
    .reduce((sum, p) => sum + p, 0);
}

/** 推薦戰力 R = max(空間等級基準, 名冊前 4 強有效戰力總和 × 0.55) */
export function mandatoryR(state) {
  const snap = state.mandatory?.pending?.R; // #11：任務發布時就把 R 快照進 pending，發布、預覽、出發用同一個數字
  if (snap != null) return snap;
  const base = M().baseR[(state.spaceLevel ?? 1) - 1];
  // 取「全員前 4 強」與「此刻可派的前 4 強」兩者較低者，主力都在副本裡時不會用他們的戰力把 R 墊高
  const top = Math.min(topPowerSum(state), topPowerSum(state, M().topN, true));
  return Math.max(base, Math.round(top * M().powerMult));
}

/** 動態副本快照（依當下名冊與空間等級）；格式和 dungeons.js 的副本一樣，多了 mandatory／toClear／passCap／failInjuryExtra */
export function buildMandatoryDungeon(state) {
  const lv = state.spaceLevel ?? 1;
  return {
    ...MANDATORY_DUNGEON,
    chapter: lv,
    boss: false,
    mandatory: true,
    recommendedPower: mandatoryR(state),
    reward: M().reward[lv - 1],
    toClear: M().toClear,
    passCap: M().passCap,
    failInjuryExtra: M().failInjuryExtra,
  };
}

/**
 * 每日結算掛鉤（在主神搞事之後）：
 *  有待派任務 → 逾時就抹殺；沒有 → 到了觸發日（而且有人在主神空間可派）就發布新任務。
 */
export function dailyMandatory(state) {
  if (state.gameOver) return;
  const m = mand(state);
  const day = currentDay(state);
  if (m.pending) {
    if (day >= m.pending.deadlineDay) purge(state);
    else if (day >= m.pending.deadlineDay - 1 && !m.pending.warned) {
      // 倒數剩最後 1 天且還沒派遣：再提醒一次（事件類型 mandatory，「自動暫停」開著就會暫停，4-E-8）
      m.pending.warned = true;
      emit(state, "mandatory", logText(state, "mandatoryLast", {}));
    }
    return;
  }
  if (day < nextMandatoryDay(state)) return;
  if (!state.samsarites.some((s) => s.location === "space")) return; // 沒人能派，等有人回家再說
  m.pending = { id: m.nextId++, createdDay: day, deadlineDay: day + M().deadlineDays };
  m.pending.R = mandatoryR(state); // 快照（pending 剛建好時還沒有 R，所以這裡算的是即時值）
  m.lastDay = day;
  emit(state, "mandatory", logText(state, "mandatoryAsk", { days: M().deadlineDays, R: mandatoryR(state), reward: M().reward[(state.spaceLevel ?? 1) - 1] }));
}

/** 逾時未派：主神隨機抹殺 1～2 名在主神空間的人，全體存活者理智 -25。空間裡最後一個人不死，改打成致命傷 */
function purge(state) {
  const m = mand(state);
  m.pending = null;
  const cfg = M();
  const home = state.samsarites.filter((s) => s.location === "space");
  let kills = randInt(m, cfg.purgeMin, cfg.purgeMax);
  const allowed = Math.max(0, home.length - 1); // 至少留一人在空間
  const spared = kills > allowed;
  kills = Math.min(kills, allowed);
  const pool = [...home];
  const victims = [];
  for (let i = 0; i < kills; i++) victims.push(pool.splice(Math.floor(rand(m) * pool.length), 1)[0]);
  emit(state, "mandatory", logText(state, "mandatoryMiss", {}));
  for (const v of victims) {
    killSamsarite(state, v, "被主神抹殺（強制任務逾期未派隊）", null, "purge");
    afterDeath(state, v, null);
  }
  if (spared && pool.length > 0) {
    const last = pool[0]; // 空間裡最後一人：不死，直接致命傷
    setInjury(last, 3);
    emit(state, "mandatory", logText(state, "mandatorySpared", { A: last }));
  }
  for (const s of state.samsarites) s.stats.sanity = Math.max(0, s.stats.sanity - cfg.purgeSanityLoss);
}
