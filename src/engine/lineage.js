// 跨代子嗣、先人遺物、叛逃野生 Boss 與《空間編年史》（Phase 4-E-1 起陸續實作，4-E-4 完整版）。純規則，不碰畫面。
// 數字在 CONFIG.lineage／CONFIG.squad；亂數用 state.squadRngState（engine/squad.js 的 squadRng）。

import { CONFIG } from "../data/config.js";
import { currentDay } from "./core.js";

// ───────── 空間編年史 ─────────

/**
 * 記一條大事紀。kind：boss（尾王首通）／captain（冊封、順延）／coup（政變、奪權）／snub（空降不服）／
 * stele（英靈碑）／birth（二代目誕生）／defect（叛徒出走）／slain（討伐叛徒）／heirloom（先人遺物）／drama（修羅場）。
 * 最多留最近 CONFIG.squad.chronicleMax（100）條。
 */
export function addChronicle(state, kind, text) {
  const list = (state.chronicles ??= []);
  list.push({ day: currentDay(state), kind, text });
  if (list.length > CONFIG.squad.chronicleMax) list.splice(0, list.length - CONFIG.squad.chronicleMax);
}
