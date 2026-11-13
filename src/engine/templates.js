// 日誌模板引擎（Phase 2-C）：抽一個版本、把 {A}{B}、{react:池:A} 等欄位填起來。
// 純規則，不碰畫面；資料表在 src/data/logs.js（以及 src/data/relations.js 的 texts）。
//
// 重要：挑版本「不用」state 的主亂數（rngState），而是用「時間 + 計數器 + 模板名」算雜湊，
// 所以加了日誌變化也不會改變任何遊戲結果；同樣的操作序列仍然得到同樣的文字（可重現）。

import { LOGS, REACTIONS } from "../data/logs.js";

/** 字串 → 32 位元正整數（FNV-1a） */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 依 who 身上的標籤，從反應池挑一句；沒有對應標籤就用 default */
function reaction(who, pool, seed) {
  const table = REACTIONS[pool];
  if (!table) return "?";
  const matched = (who?.tags ?? []).filter((t) => table[t]);
  const phrases = matched.length > 0 ? table[matched[hash(seed + "t") % matched.length]] : table.default;
  return phrases[hash(seed + "p") % phrases.length];
}

/** 把一個模板填好。vars 的值是輪迴者物件（取 name）、字串或數字；缺的欄位會變成 "?"（測試會抓） */
export function renderTemplate(template, vars = {}, seed = "") {
  return template.replace(/\{([\w:]+)\}/g, (_, key) => {
    if (key.startsWith("react:")) {
      const [, pool, who] = key.split(":");
      return reaction(vars[who], pool, seed + key);
    }
    const v = vars[key];
    if (v === undefined || v === null) return "?";
    return typeof v === "object" ? (v.name ?? "?") : String(v);
  });
}

/**
 * 產生一條日誌文字。source 是 LOGS 的 key（字串），或直接給一個版本陣列（例如事件資料表的 texts）。
 * 會在 state.textSeq 記一個計數器（存檔會一起存），讓「同一時間的同一種事件」也能抽到不同版本。
 */
export function logText(state, source, vars = {}) {
  const list = typeof source === "string" ? LOGS[source] : source;
  if (!list || list.length === 0) throw new Error(`找不到日誌模板：${String(source)}`);
  const seq = (state.textSeq = (state.textSeq ?? 0) + 1);
  const seed = `${state.tick}|${seq}|${typeof source === "string" ? source : list[0]}`;
  return renderTemplate(list[hash(seed) % list.length], vars, seed);
}
