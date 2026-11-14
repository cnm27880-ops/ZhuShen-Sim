// 雙錢包活體經濟（Phase 4-D-1）：公庫稅率、結算分潤、稅率對理智的日常影響、私房錢的充公規則。
// 純規則，不碰畫面；數字全在 CONFIG.tax／CONFIG.wallet。
//   state.points   = 主神公庫（每日維持費、抽卡、賞賜裝備、公庫補助強化／突破、黑市手動刷新）
//   s.wallet       = 輪迴者私房錢（副本分潤；自己逛街、強化用，見 engine/shopping.js）
//   state.taxRate  = 公庫稅率（0.20～0.80，步進 0.10）

import { CONFIG } from "../data/config.js";
import { emit } from "./core.js";
import { logText } from "./templates.js";

export const taxRateOf = (state) => state.taxRate ?? CONFIG.tax.default;

/** 設定稅率：夾在 min～max、對齊 step；回傳實際生效的稅率 */
export function setTaxRate(state, value) {
  const { min, max, step } = CONFIG.tax;
  const v = Math.min(max, Math.max(min, Math.round(Number(value) / step) * step));
  state.taxRate = Math.round(v * 100) / 100;
  return state.taxRate;
}

/**
 * 結算分潤鉤子：總積分先抽 round(總額 × 稅率) 入公庫，剩下由「當場存活隊員」平分入私房錢（除不盡的零頭歸公庫；
 * 全滅則全歸公庫）。保持獨立函式，4-E 的小隊流派可以覆寫分潤比例（傳入 opts.rate 取代 state.taxRate）。
 * 回傳 { tax, share, members }：tax = 入公庫的總額（含零頭）、share = 每人分到的私房錢。
 */
export function distributeLoot(state, team, totalPoints, opts = {}) {
  const total = Math.max(0, Math.round(totalPoints));
  const rate = opts.rate ?? taxRateOf(state);
  const members = team.filter(Boolean);
  let tax = members.length === 0 ? total : Math.round(total * rate);
  let share = 0;
  if (members.length > 0) {
    const rest = total - tax;
    share = Math.floor(rest / members.length);
    tax += rest - share * members.length; // 零頭歸公庫
    for (const s of members) s.wallet = (s.wallet ?? 0) + share;
  }
  state.points += tax;
  return { tax, share, members: members.length };
}

/** 稅率的每日理智影響（只對在空間的人，endOfDay 逐人呼叫）：低稅 +1、高稅 -2、極高稅 -4 */
export function taxSanityDaily(state, s) {
  const T = CONFIG.tax;
  const rate = Math.round(taxRateOf(state) * 100) / 100;
  let d = 0;
  if (rate <= T.lowAt) d = T.lowSanity;
  else if (rate >= T.crushAt) d = -T.crushSanity;
  else if (rate >= T.highAt) d = -T.highSanity;
  if (d !== 0) s.stats.sanity = Math.max(0, Math.min(100, s.stats.sanity + d));
}

/** 私房錢處理：pct 歸公庫、其餘消散（回收傳 1 = 全歸公庫；戰死傳 0.5）。回傳歸公庫的金額 */
export function forfeitWallet(state, s, pct) {
  const w = s.wallet ?? 0;
  s.wallet = 0;
  if (w <= 0) return 0;
  const back = Math.round(w * pct);
  state.points += back;
  emit(state, "wallet", logText(state, pct >= 1 ? "walletRecycle" : "walletForfeit", { A: s, wallet: w, back, lost: w - back }));
  return back;
}
