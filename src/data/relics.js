// 60 件奇物（Phase 4-D-4）：每張副本世界綁 2 件——首通奇物（首次通關必得）＋隱藏奇物（貪婪探索的隱藏房掉落）。
// 全部存進 state.relicCodex（永久圖鑑）。每件提供「全隊有效戰力 +N%」微幅被動，
// 所有奇物加總後硬封頂 CONFIG.relic.powerCap（+25%），避免後期失控（引擎 engine/relics.js 的 relicBonusOf）。
// 數值：首通奇物 a、隱藏奇物 1.5a，a 依章節 [0.2%, 0.3%, 0.4%, 0.5%, 0.6%]；全收集原始總和 30%，封頂 25%。
// 文案：目前是結構化精簡名稱（2～7 字）；之後要換長文案只填 RELIC_TEXT[id] = { name, desc, icon }，機制與數值不受影響。

import { WORLD_LIST } from "./worlds.js";

export const RELIC_TEXT = {};

const A = [0.002, 0.003, 0.004, 0.005, 0.006];
const TIER_CN = ["", "一階", "二階", "三階", "四階", "五階"];

export const RELICS = WORLD_LIST.flatMap((w) => {
  const idx = WORLD_LIST.filter((x) => x.chapter === w.chapter).findIndex((x) => x.id === w.id) + 1;
  const a = A[w.chapter - 1];
  return [
    { id: `relic_${w.id}_first`, worldId: w.id, kind: "first", chapter: w.chapter, icon: "🏺", name: `${TIER_CN[w.chapter]}${idx}號信物`, powerPct: a, desc: `首通紀念：全隊有效戰力 +${(a * 100).toFixed(1)}%。` },
    { id: `relic_${w.id}_hidden`, worldId: w.id, kind: "hidden", chapter: w.chapter, icon: "💎", name: `${TIER_CN[w.chapter]}${idx}號秘寶`, powerPct: +(a * 1.5).toFixed(4), desc: `隱藏房戰利品：全隊有效戰力 +${(a * 1.5 * 100).toFixed(2)}%。` },
  ].map((r) => ({ ...r, ...(RELIC_TEXT[r.id] ?? {}) }));
});

export const getRelic = (id) => RELICS.find((r) => r.id === id);
export const firstRelicOf = (worldId) => RELICS.find((r) => r.worldId === worldId && r.kind === "first");
export const hiddenRelicOf = (worldId) => RELICS.find((r) => r.worldId === worldId && r.kind === "hidden");
