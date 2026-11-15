// 「天數對應章節」共用表（第四批 7、8 節）：許願「想去副本」、主神突襲任務挑副本、主神搞事的積分倍率都讀這一張。
// 門檻是 sim 尾王首通中位數 32／73／175／322／382 取整（CONFIG.dayChapter.days），之後可再校正。純規則，不碰畫面。

import { CONFIG } from "../data/config.js";
import { DUNGEONS } from "../data/dungeons.js";
import { currentDay } from "./core.js";
import { effectivePower } from "./tags.js";
import { isUnlocked } from "./dungeon.js";

const D = () => CONFIG.dayChapter;

/** 第幾天對應第幾章（1~5）：Day < 30 → 1；30~69 → 2；70~174 → 3；175~319 → 4；320 以上 → 5 */
export function dayChapterOf(day) {
  let ch = 1;
  for (const d of D().days) if (day >= d) ch += 1;
  return ch;
}
export const dayChapter = (state) => dayChapterOf(currentDay(state));

/** 玩家已經通關過的最高章節（看各副本通關次數；沒通關過回 0） */
export function highestClearedChapter(state) {
  let best = 0;
  for (const d of DUNGEONS) if ((state.dungeonStats?.[d.id]?.clears ?? 0) > 0) best = Math.max(best, d.chapter);
  return best;
}

/** 主神搞事的積分倍率（化解費、損失、補償、通關獎勵、抗命罰金一起乘；理智與天數不乘）：第 1~5 章 ×1／3／10／30／100 */
export const godMultOf = (day) => D().godMult[dayChapterOf(day) - 1];
export const godMult = (state) => godMultOf(currentDay(state));

/** 名冊前 4 強有效戰力總和（催熟艙嬰兒不算） */
function topFourPower(state) {
  return state.samsarites
    .filter((s) => s.location !== "pod")
    .map((s) => effectivePower(s))
    .sort((a, b) => b - a)
    .slice(0, 4)
    .reduce((a, b) => a + b, 0);
}

/**
 * 許願「想去副本」與突襲任務挑副本用：從「天數章節」與「已通關最高章節」較高者的那一章開始，
 * 找推薦戰力不超過（前 4 強總戰力 × powerShare）且已解鎖的副本；該章沒有就逐章往下找，
 * 全部都沒有才退回舊做法（推薦戰力 <= fallbackCap）。回傳副本陣列（可能是空的）。
 */
export function targetDungeons(state, fallbackCap) {
  const limit = topFourPower(state) * D().powerShare;
  const start = Math.max(dayChapter(state), highestClearedChapter(state));
  for (let ch = Math.min(start, CONFIG.space.maxLevel); ch >= 1; ch--) {
    const options = DUNGEONS.filter((d) => d.chapter === ch && d.recommendedPower <= limit && isUnlocked(state, d));
    if (options.length > 0) return options;
  }
  return DUNGEONS.filter((d) => d.recommendedPower <= fallbackCap);
}
