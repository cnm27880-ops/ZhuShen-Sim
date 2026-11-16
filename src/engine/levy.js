// 強徵私房錢（主管壓榨輪迴者）：玩家手動發動，按比例把輪迴者的私房錢收進公庫；被徵者可能拒繳。純規則，不碰畫面。
// 數字：CONFIG.levy；日誌句：src/data/logs.js（levy*）。沒有自動版（露葵 2026-11 拍板）。
// 錢全進公庫，但不計入主神考核的「公庫入帳」（避免玩家靠強徵灌 KPI）。
//
// state.levy：
//   rngState         獨立亂數流（拒繳判定用，不動主亂數）
//   cooldownUntilDay 這天之前不能再發動（所有檔位共用）
//   count／collected／refusals  累計次數／收到的積分／被拒繳的人次（給面板看）

import { CONFIG } from "../data/config.js";
import { rand } from "./rng.js";
import { emit, currentDay, upkeepOf } from "./core.js";
import { captainOf } from "./squad.js";
import { shiftAffinity, affinity, partnerOf } from "./relations.js";
import { setMood } from "./wishes.js";
import { logText } from "./templates.js";

const L = () => CONFIG.levy;

export function newLevyState(seed = 0) {
  return { rngState: (seed ^ 0x1e57) | 0, cooldownUntilDay: 0, count: 0, collected: 0, refusals: 0 };
}
const levyOf = (state) => (state.levy ??= newLevyState(state.rngState));

export const tierOf = (id) => L().tiers.find((t) => t.id === id);

/** 這個人最少要保留多少私房錢 */
export const reserveOf = (state, s) => Math.max(L().minReserve, upkeepOf(s, state) * L().reserveDays);

const crew = (state) => state.samsarites.filter((s) => s.location !== "pod");

/** 這個人在這一檔會被徵多少（不含拒繳判定） */
export function dueOf(state, s, tier) {
  return Math.max(0, Math.floor(((s.wallet ?? 0) - reserveOf(state, s)) * tier.pct));
}

/** 這個人在這一檔的拒繳率（隊長不會拒繳） */
export function refuseChance(state, s, tier) {
  const cap = captainOf(state);
  if (cap && cap.id === s.id) return 0;
  const B = L().refuseBonus;
  let c = tier.refuse;
  const san = s.stats.sanity ?? 100;
  if (san < L().veryLowSanityBelow) c += B.veryLowSanity;
  else if (san < L().lowSanityBelow) c += B.lowSanity;
  if (partnerOf(state, s)) c += B.partner;
  if (Object.values(s.soulbound ?? {}).some(Boolean)) c += B.soulbound;
  if (cap && affinity(state, s, cap) < 0) c += B.negativeAffinity;
  return Math.min(L().maxRefuse, c);
}

/** 現在能不能發動？回傳 { ok, reason } */
export function checkLevy(state, tierId) {
  const tier = tierOf(tierId);
  if (!tier) return { ok: false, reason: "沒有這個檔位" };
  if (state.gameOver) return { ok: false, reason: "遊戲已經結束" };
  const g = levyOf(state);
  const day = currentDay(state);
  if (day < g.cooldownUntilDay) return { ok: false, reason: `主管剛搜刮過，還要等 ${g.cooldownUntilDay - day} 天才能再開口` };
  if (!crew(state).some((s) => dueOf(state, s, tier) > 0)) return { ok: false, reason: "大家的私房錢都在保命底線以下，榨不出東西" };
  return { ok: true };
}

/** 預覽（不吃亂數）：全員都付的理論總額、可能被徵的人數、平均拒繳率 */
export function levyPreview(state, tierId) {
  const tier = tierOf(tierId);
  const people = crew(state).filter((s) => dueOf(state, s, tier) > 0);
  const total = people.reduce((n, s) => n + dueOf(state, s, tier), 0);
  const expected = people.reduce((n, s) => n + dueOf(state, s, tier) * (1 - refuseChance(state, s, tier)), 0);
  const avgRefuse = people.length ? people.reduce((n, s) => n + refuseChance(state, s, tier), 0) / people.length : 0;
  return { tier, people: people.length, total, expected: Math.round(expected), avgRefuse };
}

/** 發動強徵。回傳 { ok, reason } 或 { ok, collected, payers, refusers, tier } */
export function levyWallets(state, tierId) {
  const check = checkLevy(state, tierId);
  if (!check.ok) return check;
  const tier = tierOf(tierId);
  const g = levyOf(state);
  const day = currentDay(state);
  const cap = captainOf(state);
  const payers = [];
  const refusers = [];
  let collected = 0;
  for (const s of crew(state)) {
    const due = dueOf(state, s, tier);
    if (due <= 0) continue;
    if (rand(g) < refuseChance(state, s, tier)) {
      refusers.push(s);
      if (cap && cap.id !== s.id) shiftAffinity(state, s, cap, -(tier.affinity + L().refuseExtraAffinity));
      continue;
    }
    s.wallet -= due;
    collected += due;
    payers.push({ s, amount: due });
    s.stats.sanity = Math.max(0, s.stats.sanity - tier.sanity);
    if (cap && cap.id !== s.id && tier.affinity > 0) shiftAffinity(state, s, cap, -tier.affinity);
  }
  state.points += collected;
  g.count += 1;
  g.collected += collected;
  g.refusals += refusers.length;
  g.cooldownUntilDay = day + tier.cooldown;
  if (tier.mood) for (const s of crew(state)) setMood(state, s, "upset");
  emit(state, "levy", logText(state, "levyDone", { tier: tier.name, total: collected, n: payers.length }));
  if (refusers.length > 0) emit(state, "levy", logText(state, "levyRefuse", { names: refusers.map((s) => s.name).join("、"), n: refusers.length }));
  return { ok: true, collected, payers: payers.map((p) => ({ id: p.s.id, name: p.s.name, amount: p.amount })), refusers: refusers.map((s) => ({ id: s.id, name: s.name })), tier };
}
