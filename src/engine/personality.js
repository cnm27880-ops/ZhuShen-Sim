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

// ───────── v2：副本擋刀／背刺、叛逃與私奔門檻（純函式，不吃亂數；數字 CONFIG.personality.v2） ─────────

const V2 = () => CONFIG.personality.v2;
const v2On = () => !!(CONFIG.personality.enabled && V2()?.enabled);
const score = (s, axis) => s?.traits?.[axis] ?? 0;

/** 擋刀機率倍率（只看守護者本人）：利他高更敢擋、利他低不太想擋；膽識同理。關閉或沒特色回傳 1 */
export function protectMult(s) {
  if (!v2On()) return 1;
  const c = V2();
  let m = 1;
  const a = score(s, "altruism");
  if (a >= c.min) m *= c.protect.altruismHi;
  else if (a <= -c.min) m *= c.protect.altruismLo;
  const k = score(s, "courage");
  if (k >= c.min) m *= c.protect.courageHi;
  else if (k <= -c.min) m *= c.protect.courageLo;
  return m;
}

/** 陰謀者：利他 <= -min 且野心 >= +min（沒有背刺詞條也可能在副本裡背刺隊友） */
export function isSchemer(s) {
  if (!v2On() || !V2().schemer.enabled) return false;
  const c = V2();
  return score(s, "altruism") <= -c.min && score(s, "ambition") >= c.min;
}

/** 死忠：順從度 >= loyalMin，叛逃與私奔 100% 免疫 */
export function isLoyal(s) {
  return v2On() && score(s, "obedience") >= V2().loyalMin;
}

const shiftOf = (s, tbl) => {
  if (!v2On()) return 0;
  const o = score(s, "obedience");
  if (o >= V2().min) return tbl.obeyHi;
  if (o <= -V2().min) return tbl.obeyLo;
  return 0;
};
/** 叛逃淨好感門檻位移（加在 rogueAffinity 上：正＝更容易叛逃） */
export const defectAffinityShift = (s) => shiftOf(s, V2()?.defectShift ?? {});
/** 私奔淨好感門檻位移（加在 elope.affinity 上） */
export const elopeAffinityShift = (s) => shiftOf(s, V2()?.elopeShift ?? {});

/** 許願種類權重倍率（v3）：該軸 >= +min 乘 hi、<= -min 乘 lo；關閉或沒特色回傳 1。只調權重，不影響擲骰次數 */
export function wishWeightMult(s, kind) {
  const c = CONFIG.personality.v3;
  const w = c?.wishWeight?.[kind];
  if (!c?.enabled || !CONFIG.personality.enabled || !w) return 1;
  const v = s?.traits?.[w.axis] ?? 0;
  if (v >= c.min) return w.hi;
  if (v <= -c.min) return w.lo;
  return 1;
}

/** 陰謀者背刺專用亂數流（state.trait.clashRngState；缺欄位用本局種子補）。不動主亂數 */
export function clashRng(state) {
  const t = (state.trait ??= newTraitState(state.seed ?? 0));
  t.clashRngState ??= ((state.seed ?? 0) ^ 0xc1a5) | 0;
  return {
    get rngState() {
      return t.clashRngState;
    },
    set rngState(v) {
      t.clashRngState = v;
    },
  };
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
