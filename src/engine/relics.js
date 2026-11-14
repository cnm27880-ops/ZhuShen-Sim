// 奇物圖鑑引擎（Phase 4-D-4）：首通奇物＋貪婪探索的隱藏奇物，共 60 件，永久存在 state.relicCodex。
// 純規則，不碰畫面；資料在 src/data/relics.js，數字在 CONFIG.relic。
// 全隊被動：每件奇物 +N% 有效戰力，全部加總後硬封頂 CONFIG.relic.powerCap（+25%）。
// effectivePower 沒有 state 參數，所以把加成寫進每人 s.relicBonus（跟英靈碑 steleBonus 同樣的做法）。

import { CONFIG } from "../data/config.js";
import { RELICS, getRelic } from "../data/relics.js";
import { emit } from "./core.js";
import { logText } from "./templates.js";

export const hasRelic = (state, id) => (state.relicCodex ?? []).includes(id);

/** 已收集奇物的原始加成總和（未封頂） */
export function relicRawBonus(state) {
  return (state.relicCodex ?? []).reduce((n, id) => n + (getRelic(id)?.powerPct ?? 0), 0);
}
/** 實際生效的全隊戰力加成（封頂 CONFIG.relic.powerCap） */
export function relicBonusOf(state) {
  return Math.min(CONFIG.relic.powerCap, relicRawBonus(state));
}
/** 把目前的奇物加成寫進每位輪迴者（圖鑑變動、讀檔後呼叫；新人入隊時 createSamsarite 也會帶） */
export function refreshRelicBonus(state) {
  const b = relicBonusOf(state);
  for (const s of state.samsarites ?? []) s.relicBonus = b;
}

/** 取得一件奇物。已擁有回傳 { relic, dup: true }（呼叫端自行轉成積分），否則加入圖鑑 */
export function grantRelic(state, relic) {
  if (!relic) return null;
  state.relicCodex ??= [];
  if (state.relicCodex.includes(relic.id)) return { relic, dup: true };
  state.relicCodex.push(relic.id);
  refreshRelicBonus(state);
  emit(state, "relic", logText(state, "relicGet", { relic: relic.name, kind: relic.kind === "first" ? "首通奇物" : "隱藏奇物", n: state.relicCodex.length, total: RELICS.length, pct: Math.round(relicBonusOf(state) * 1000) / 10 }));
  return { relic, dup: false };
}

/** 畫面用：圖鑑進度與加成 */
export function relicInfo(state) {
  return {
    owned: (state.relicCodex ?? []).length,
    total: RELICS.length,
    raw: relicRawBonus(state),
    bonus: relicBonusOf(state),
    cap: CONFIG.relic.powerCap,
    list: RELICS.map((r) => ({ ...r, have: hasRelic(state, r.id) })),
  };
}
