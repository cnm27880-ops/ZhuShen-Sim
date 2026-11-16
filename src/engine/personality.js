// 輪迴者個性引擎 v1a：五條隱藏維度的雜湊產生、原型判定、側寫資料整理。純規則，不碰畫面，不吃任何亂數流。
// 分數 = 「遊戲種子＋輪迴者 id＋軸名」的雜湊 → 四個均勻值相加（近似常態）→ 詞條偏移 → 夾在 ±100。
// 所以同一局同一個人永遠是同一組分數；舊存檔讀檔時用同一套雜湊補上，不會壞檔，也不動主亂數。
// 數字：CONFIG.personality；資料表：data/personality.js。

import { CONFIG } from "../data/config.js";
import { TRAIT_AXES, AXIS_INFO, ARCHETYPES, PLAIN_ARCHETYPE, PROFILE_LINES, TAG_TRAIT_BIAS } from "../data/personality.js";

/** 字串 → 0～1 的均勻值（FNV-1a ＋ murmur3 最後攪拌，相似字串也不會得到相近的值） */
function unit(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const clamp = (n) => Math.max(-100, Math.min(100, n));

/** 單一軸的原始分數（不含詞條偏移）。seed 為 null 的舊存檔用固定字串 */
export function rawTraitScore(seed, id, axis) {
  const key = `${seed ?? "legacy"}|${id}|${axis}`;
  let sum = 0;
  for (let k = 0; k < 4; k++) sum += unit(`${key}|${k}`);
  // 四個 U(0,1) 相加：平均 2、標準差 sqrt(4/12)
  return ((sum - 2) / Math.sqrt(4 / 12)) * CONFIG.personality.sd;
}

/** 產生一個人的五軸分數（四捨五入成整數） */
export function rollTraits(state, s) {
  const out = {};
  for (const axis of TRAIT_AXES) {
    let v = rawTraitScore(state.seed, s.id, axis);
    if (CONFIG.personality.tagBias) {
      for (const t of s.tags ?? []) v += (TAG_TRAIT_BIAS[t]?.[axis] ?? 0) * CONFIG.personality.tagBias;
    }
    out[axis] = Math.round(clamp(v));
  }
  return out;
}

/** 舊存檔／新建立的人補齊個性欄位（已有就不動） */
export function ensureTraits(state, s) {
  s.traits ??= rollTraits(state, s);
  s.traitSeen ??= [];
  s.traitEventLast ??= {};
}

export function newTraitState(seed = 0) {
  return { rngState: (seed ^ 0x7a17) | 0 };
}

/** 絕對值最大的軸（平手依 TRAIT_AXES 順序）；回傳 { axis, sign, abs } */
export function dominantAxis(s) {
  let best = null;
  for (const axis of TRAIT_AXES) {
    const v = s.traits?.[axis] ?? 0;
    if (!best || Math.abs(v) > best.abs) best = { axis, sign: v >= 0 ? 1 : -1, abs: Math.abs(v) };
  }
  return best;
}

/** 原型名稱：揭露次數不夠回傳 null（畫面顯示「尚未看透」）；最大軸沒到門檻是「普通人」 */
export function archetypeOf(s) {
  if (!s.traits || (s.traitSeen?.length ?? 0) < CONFIG.personality.archetypeAfter) return null;
  const d = dominantAxis(s);
  if (!d || d.abs < CONFIG.personality.eventMin) return PLAIN_ARCHETYPE;
  return ARCHETYPES[d.axis][d.sign];
}

/** 該軸這一端第 n 次揭露要用哪一句（循環） */
export function profileLine(axis, sign, n) {
  const lines = PROFILE_LINES[axis][sign];
  return lines[n % lines.length];
}

/** 給畫面用：只有已揭露的側寫與原型，沒有任何數字 */
export function traitProfile(s) {
  const seen = (s.traitSeen ?? []).map((e) => ({ day: e.day, axis: e.axis, axisName: AXIS_INFO[e.axis].name, text: e.text }));
  return { archetype: archetypeOf(s), seen, need: CONFIG.personality.archetypeAfter };
}
