// 團滅結局與評分（A-3 掛機壓力設計 階段 1）。
// 取消絕境空投後，遊戲有兩種真結局：
//   roster（死光）：名冊（不含催熟艙）為 0，而且連最便宜的卡池都抽不起。
//   debt（破產）：積分頂到破產線（debtLimitOf）連續滿 CONFIG.ending.debtGraceDays 天。
// 保護期（CONFIG.ending.protectDays 天）內：不判破產，名冊死光給一次性新手救濟。
// 結局時算出評分與稱號，存進 state.ending.result，給畫面顯示（局外成長之後再做）。
// 數字全在 CONFIG.ending；新手救濟用 state.ending 的獨立亂數流，不動主亂數。

import { CONFIG } from "../data/config.js";
import { logText } from "./templates.js";
import { emit, currentDay, canAfford, debtLimitOf, createSamsarite } from "./core.js"; // 循環引用只在執行時呼叫，沒問題

export function newEndingState(seed = 0) {
  return { rngState: (seed ^ 0xe9d1) | 0, debtDays: 0, reliefUsed: false, peakPoints: 0, maxGeneration: 0, result: null };
}

/** 取（必要時補）結局狀態，舊存檔沒有就補預設 */
export function endingOf(state) {
  const e = (state.ending ??= newEndingState(state.rngState));
  e.debtDays ??= 0;
  e.reliefUsed ??= false;
  e.peakPoints ??= 0;
  e.maxGeneration ??= 0;
  e.result ??= null;
  return e;
}

const aliveCount = (state) => state.samsarites.filter((s) => s.location !== "pod").length;

/** 最便宜、可用的卡池基礎價（不含本週漲價：沒人時沒有維持費，等到下週重置價格就回來了，不算卡死） */
function cheapestPoolBase(state) {
  return Math.min(
    ...CONFIG.gacha.pools
      .filter((p) => p.spaceLevel <= (state.spaceLevel ?? 1) && p.crystal <= (state.karmaCrystals ?? 0))
      .map((p) => p.base)
  );
}

/** 評分：回傳 { total, title, items: [{ key, label, value, points }] }（純函式，不吃亂數） */
export function scoreOf(state) {
  const w = CONFIG.ending.score;
  const e = endingOf(state);
  const clears = Object.values(state.dungeonStats ?? {}).reduce((n, d) => n + (d.clears ?? 0), 0);
  const peak = Math.max(e.peakPoints, state.points, CONFIG.startingPoints); // 峰值相對開局積分算：沒成長就沒有分數
  const items = [
    { key: "days", label: "撐過的天數", value: currentDay(state), points: currentDay(state) * w.perDay },
    { key: "bosses", label: "首通的尾王章數", value: Object.keys(state.chapterClearDay ?? {}).length, points: Object.keys(state.chapterClearDay ?? {}).length * w.perBossChapter },
    { key: "clears", label: "副本通關場數", value: clears, points: clears * w.perClear },
    { key: "stele", label: "英靈碑名單", value: state.memorialStele?.length ?? 0, points: (state.memorialStele?.length ?? 0) * w.perStele },
    { key: "generation", label: "最高世代", value: e.maxGeneration, points: e.maxGeneration * w.perGeneration },
    { key: "peak", label: "公庫峰值", value: Math.round(peak), points: Math.round(Math.log10(peak / CONFIG.startingPoints) * w.peakLog) },
  ];
  for (const it of items) it.points = Math.max(0, Math.round(it.points));
  const total = items.reduce((n, it) => n + it.points, 0);
  const title = [...CONFIG.ending.titles].reverse().find((t) => total >= t.min)?.title ?? CONFIG.ending.titles[0].title;
  return { total, title, items };
}

/** 結束遊戲：type = "roster"（死光）／"debt"（破產） */
export function finishGame(state, type) {
  if (state.gameOver) return;
  const e = endingOf(state);
  const score = scoreOf(state);
  state.gameOver = true;
  e.result = { type, day: currentDay(state), deaths: state.graveyard.length, ...score };
  emit(state, "gameOver", logText(state, type === "debt" ? "gameOverDebt" : "gameOverRoster", { score: score.total, title: score.title }));
}

/** 死光判定（checkGameOver 呼叫）：回傳 true 代表遊戲結束。保護期內第一次死光改發新手救濟 */
export function checkRosterEnding(state) {
  if (state.gameOver) return true;
  if (aliveCount(state) > 0 || canAfford(state, cheapestPoolBase(state))) return false;
  const e = endingOf(state);
  const cfg = CONFIG.ending;
  if (currentDay(state) < cfg.protectDays && !e.reliefUsed) {
    e.reliefUsed = true;
    const added = [];
    for (let i = 0; i < cfg.relief.count; i++) {
      const s = createSamsarite(state, cfg.relief.rank, e); // 獨立亂數流，不動主亂數
      state.samsarites.push(s);
      added.push(s);
    }
    emit(state, "relief", logText(state, "relief", { n: added.length }));
    return false;
  }
  finishGame(state, "roster");
  return true;
}

/** 每日結算尾端：記錄峰值、累計破產天數、判斷破產結局 */
export function dailyEnding(state) {
  if (state.gameOver) return;
  const e = endingOf(state);
  e.peakPoints = Math.max(e.peakPoints, state.points);
  for (const s of state.samsarites) e.maxGeneration = Math.max(e.maxGeneration, s.generation ?? 0);

  const cfg = CONFIG.ending;
  if (CONFIG.airdrop.rescue || currentDay(state) < cfg.protectDays || state.points > debtLimitOf(state)) { // rescue 開著 = 舊規則（不結束）
    e.debtDays = 0;
    return;
  }
  e.debtDays += 1;
  if (e.debtDays >= cfg.debtGraceDays) {
    finishGame(state, "debt");
    return;
  }
  emit(state, "endingWarn", logText(state, "debtWarn", { n: e.debtDays, left: cfg.debtGraceDays - e.debtDays }));
}
