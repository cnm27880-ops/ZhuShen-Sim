// 動態任務榜（Phase 4-D-4）：常規副本改成「3 個任務槽」出征，每槽隨機附帶 1 個突變詞綴；各章尾王常駐在獨立尾王區、不佔槽。
//   state.board = { slots: [{ id, dungeonId, mutationId, running, runId }], nextRotateDay, nextId }
//   - 每 CONFIG.board.rotateDays（2）天自動輪換（已有隊伍出發的槽不動）；派隊的槽「結算後」立即補新槽
//   - 抽槽：從已解鎖章節的常規副本抽，章節權重偏向目前最高章（同章 5／前一章 3／更早 1）；同一時間榜上不重複同一個副本
//   - 抽槽與突變都用獨立亂數流 state.market.rngState，不動主亂數
// 突變詞綴資料在 src/data/mutations.js；效果的實際套用在 engine/dungeon.js（R 倍率、獎勵、理智、內鬥、速度鎖血、隱藏房機率、同行好感）。

import { CONFIG } from "../data/config.js";
import { DUNGEONS } from "../data/dungeons.js";
import { MUTATIONS, getMutation } from "../data/mutations.js";
import { rand, weighted } from "./rng.js";
import { currentDay, emit } from "./core.js";
import { marketOf } from "./market.js";
import { applyMutation } from "./dungeon.js";
import { logText } from "./templates.js";

export function newBoardState() {
  return { slots: [], nextRotateDay: CONFIG.board.rotateDays + 1, nextId: 1 };
}
export const boardOf = (state) => (state.board ??= newBoardState());

/** 目前能出現在榜上的常規副本（章節 ≤ 空間等級） */
const regulars = (state) => DUNGEONS.filter((d) => !d.boss && d.chapter <= (state.spaceLevel ?? 1));

function rollDungeon(state, exclude) {
  const m = marketOf(state);
  const top = state.spaceLevel ?? 1;
  const W = CONFIG.board.chapterWeight;
  let pool = regulars(state).filter((d) => !exclude.has(d.id));
  if (pool.length === 0) pool = regulars(state);
  const chapters = [...new Set(pool.map((d) => d.chapter))].map((c) => ({ chapter: c, weight: c === top ? W.top : c === top - 1 ? W.prev : W.older }));
  const ch = weighted(m, chapters).chapter;
  const inCh = pool.filter((d) => d.chapter === ch);
  return inCh[Math.floor(rand(m) * inCh.length)];
}

/** 補滿任務槽到 CONFIG.board.slots 個 */
export function fillBoard(state) {
  const b = boardOf(state);
  while (b.slots.length < CONFIG.board.slots) {
    const d = rollDungeon(state, new Set(b.slots.map((s) => s.dungeonId)));
    const mut = weighted(marketOf(state), MUTATIONS);
    b.slots.push({ id: b.nextId++, dungeonId: d.id, mutationId: mut.id, running: false, runId: null });
  }
}

/** 輪換：丟掉沒有隊伍出發的槽，重新補滿 */
export function rotateBoard(state, { silent = false } = {}) {
  const b = boardOf(state);
  b.slots = b.slots.filter((s) => s.running);
  fillBoard(state);
  b.nextRotateDay = currentDay(state) + CONFIG.board.rotateDays;
  if (!silent) emit(state, "board", logText(state, "boardRotate", { day: currentDay(state) }));
}

/** 每日結算掛鉤：到期輪換；順便補滿（升級解鎖新章、舊存檔遷移後榜是空的） */
export function dailyBoard(state) {
  const b = boardOf(state);
  if (currentDay(state) >= b.nextRotateDay) rotateBoard(state);
  else fillBoard(state);
}

/** 這場副本結算後：把它出發的槽移除並立刻補新槽（startRun 帶 slotId 的場次） */
export function afterRunBoard(state, run) {
  if (run.slotId == null) return;
  const b = boardOf(state);
  const before = b.slots.length;
  b.slots = b.slots.filter((s) => s.id !== run.slotId);
  if (b.slots.length < before) fillBoard(state);
}

/** 榜上每個槽的「實際副本」（已套突變詞綴的 R 倍率）與詞綴；自動派遣與畫面用 */
export function boardTargets(state) {
  return boardOf(state).slots.map((slot) => {
    const base = DUNGEONS.find((d) => d.id === slot.dungeonId);
    return { slot, dungeon: applyMutation(base, slot.mutationId), mutation: getMutation(slot.mutationId) };
  });
}
