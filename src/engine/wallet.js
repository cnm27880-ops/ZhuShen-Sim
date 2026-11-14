// 雙錢包活體經濟（Phase 4-D-1）：公庫稅率、結算分潤、稅率對理智的日常影響、私房錢的充公規則。
// 純規則，不碰畫面；數字全在 CONFIG.tax／CONFIG.wallet。
//   state.points   = 主神公庫（每日維持費、抽卡、賞賜裝備、公庫補助強化／突破、黑市手動刷新）
//   s.wallet       = 輪迴者私房錢（副本分潤；自己逛街、強化用，見 engine/shopping.js）
//   state.taxRate  = 公庫稅率（0.20～0.80，步進 0.10）

import { CONFIG } from "../data/config.js";
import { emit } from "./core.js";
import { styleOf, captainOf, worthOf } from "./squad.js";
import { effectivePower } from "./tags.js";
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
 * 結算分潤鉤子：總積分先抽 round(總額 × 稅率) 入公庫，剩下由「當場存活隊員」入私房錢（除不盡的零頭歸公庫；
 * 全滅則全歸公庫）。保持獨立函式，4-E 的小隊流派在這裡覆寫「剩下的怎麼分」（opts.rate 可取代 state.taxRate）。
 * 流派（需空間 Lv.2 以上且有隊長，engine/squad.js）：
 *   communal 100% 絕對均分；bond 帶傷存活者 ×1.25；farming 隊長在隊獨吞 80%（留守仍強抽 35% 保護費）；
 *   elite 按戰力^1.4；mercenary 稅後總額 +18% 商業溢價、按身價比例。
 * opts：{ run, dungeon }（run 用來判斷隊長是否隨隊出征）。
 * 回傳 { tax, share, shares, members, style }：tax = 入公庫的總額（含零頭）、share = 每人平均分到的私房錢、shares = { 輪迴者 id: 實拿 }。
 */
export function distributeLoot(state, team, totalPoints, opts = {}) {
  const total = Math.max(0, Math.round(totalPoints));
  const rate = opts.rate ?? taxRateOf(state);
  const members = team.filter(Boolean);
  let tax = members.length === 0 ? total : Math.round(total * rate);
  const shares = {};
  let share = 0;
  const style = members.length > 0 ? styleOf(state) : null;
  if (members.length > 0) {
    let rest = total - tax;
    const F = CONFIG.squad;
    const weights = new Map(members.map((s) => [s.id, 1]));
    if (style === "bond") {
      for (const s of members) if (s.injury >= 1) weights.set(s.id, F.bond.woundedWeight);
    } else if (style === "elite") {
      for (const s of members) weights.set(s.id, effectivePower(s) ** F.elite.powerExp);
    } else if (style === "mercenary") {
      rest = Math.round(rest * (1 + F.mercenary.premium));
      for (const s of members) weights.set(s.id, worthOf(s) + F.mercenary.worthBase);
    } else if (style === "farming") {
      const cap = captainOf(state);
      const inRun = cap && members.some((s) => s.id === cap.id);
      if (inRun) {
        const take = Math.floor(rest * F.farming.captainShare);
        shares[cap.id] = take;
        rest -= take;
        weights.delete(cap.id);
        if (weights.size === 0) {
          shares[cap.id] += rest; // 隊長一個人活著回來：全拿
          rest = 0;
        }
      } else if (cap && !(opts.run?.partyIds ?? []).includes(cap.id)) {
        const fee = Math.floor(rest * F.farming.guardFeePct); // 隊長留守：強抽保護費
        cap.wallet = (cap.wallet ?? 0) + fee;
        rest -= fee;
        shares[cap.id] = (shares[cap.id] ?? 0) + fee;
        emit(state, "wallet", logText(state, "farmingFee", { A: cap, fee }));
      }
    }
    const sum = [...weights.values()].reduce((n, w) => n + w, 0);
    let paid = 0;
    for (const s of members) {
      if (!weights.has(s.id)) continue;
      const got = sum > 0 ? Math.floor((rest * weights.get(s.id)) / sum) : 0;
      shares[s.id] = (shares[s.id] ?? 0) + got;
      paid += got;
    }
    tax += rest - paid; // 零頭歸公庫
    for (const s of members) if (shares[s.id]) s.wallet = (s.wallet ?? 0) + shares[s.id];
    const vals = members.map((s) => shares[s.id] ?? 0);
    share = Math.floor(vals.reduce((n, v) => n + v, 0) / members.length);
  }
  state.points += tax;
  return { tax, share, shares, members: members.length, style };
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
