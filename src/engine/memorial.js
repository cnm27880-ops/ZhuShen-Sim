// 英靈碑引擎（Phase 4-C-5）：基因鎖夠高、或身經百戰的輪迴者，戰死／被主神抹殺時刻上英靈碑，提供全隊戰力加成。純規則，不碰畫面。
// 數字：CONFIG.stele。入碑時機（只有「副本戰死」與「主神抹殺」，主動回收、空間內被同伴殺害不算）由呼叫端傳入 killSamsarite 的 stele 參數。
// state.memorialStele：[{ name, rank, geneLock, runs, day, cause, kind, bonus }]，依 bonus 由高到低（同加成較早入碑者在前），最多 CONFIG.stele.keep 筆。
// 加成取前 topN 名加總，寫進每位輪迴者的 s.steleBonus（effectivePower 讀它，因為 effectivePower 沒有 state 參數）。

import { CONFIG } from "../data/config.js";
import { emit, currentDay } from "./core.js"; // 循環引用：只在執行時呼叫，載入時不碰
import { logText } from "./templates.js";
import { squadSteleMult } from "./squad.js";
import { addChronicle } from "./lineage.js";

/** 這個人死的時候夠不夠格入碑：基因鎖 ≥ 1 或生涯出戰 ≥ 15 場 */
export function qualifiesForStele(s) {
  return (s.geneLock ?? 0) >= CONFIG.stele.minGene || (s.runs ?? 0) >= CONFIG.stele.minRuns;
}

/** 全隊戰力加成（0.2 = +20%）：碑上加成最高的前 N 名加總 */
export function steleBonusOf(state) {
  return (state?.memorialStele ?? [])
    .slice(0, CONFIG.stele.topN)
    .reduce((sum, e) => sum + e.bonus, 0);
}

/** 把目前的碑加成寫到每位輪迴者身上（碑變動、讀檔時呼叫；新輪迴者在 createSamsarite 就會帶上） */
export function refreshSteleBonus(state) {
  const bonus = steleBonusOf(state);
  for (const s of state.samsarites) s.steleBonus = bonus;
}

/** 入碑。s 已從名單移除也沒關係（只讀它的欄位）。不夠格就不處理，回傳 null */
export function enshrine(state, s, kind, steleMult = squadSteleMult(state)) {
  if (!qualifiesForStele(s)) return null;
  const list = (state.memorialStele ??= []);
  const before = steleBonusOf(state);
  const gene = Math.min(s.geneLock ?? 0, CONFIG.stele.bonusByGene.length - 1);
  const entry = { name: s.name, rank: s.rank, geneLock: s.geneLock ?? 0, runs: s.runs ?? 0, day: currentDay(state), cause: kind === "purge" ? "被主神抹殺" : "副本戰死", kind, bonus: Math.round(CONFIG.stele.bonusByGene[gene] * steleMult * 10000) / 10000 }; // 羈絆流 ×1.5（4-E-2）
  list.push(entry);
  list.sort((a, b) => b.bonus - a.bonus || a.day - b.day); // 穩定排序：同加成先入碑者在前
  if (list.length > CONFIG.stele.keep) list.length = CONFIG.stele.keep;
  refreshSteleBonus(state);
  const after = steleBonusOf(state);
  const text = logText(state, "steleAdd", { A: s, gene: entry.geneLock, before: Math.round(before * 100), after: Math.round(after * 100) });
  emit(state, "stele", text);
  addChronicle(state, "stele", text); // 元老戰死入碑，寫進編年史（4-E-5）
  return entry;
}
