// 裝備被動、日結／出戰影響與爆發耗材的共用解析（Phase 4-E-8）。純規則，不碰畫面。
// 被動資料在 src/data/shopItems.js 的 PASSIVES（結構化欄位，不硬編碼單一 id）；穿著期間（s.gear 裡的商品帶 passive）才生效。
// 亂數：入魔傾向用 state.squadRngState（engine/squad.js 的 squadRng），不動主亂數。

import { CONFIG } from "../data/config.js";
import { getShopItem } from "../data/shopItems.js";
import { rand } from "./rng.js";

/** 這個人穿著的所有帶被動的裝備 */
export function passivesOf(s) {
  return Object.values(s.gear ?? {})
    .map((id) => getShopItem(id)?.passive)
    .filter(Boolean);
}

/** 加總型被動（dailySanity／runSanity／partyRunSanity／coupPowerBonus） */
export function passiveSum(s, key) {
  return passivesOf(s).reduce((n, p) => n + (p[key] ?? 0), 0);
}

/** 倍率型被動（captainHateMult／captainLoveMult），多件連乘；沒有就 1 */
export function gearMult(s, key) {
  return passivesOf(s).reduce((m, p) => m * (p[key] ?? 1), 1);
}

/** 穿著帶有入魔傾向的裝備 */
export const hasDemonGear = (s) => passivesOf(s).some((p) => p.demonTendency);

/** 這個人穿著的裝備有沒有會害理智的被動（AI 理智低時不買用；也給 UI 警示） */
export function sanityHarm(item) {
  const p = item?.passive;
  const e = item?.effect ?? {};
  return (p?.dailySanity ?? 0) < 0 || (p?.runSanity ?? 0) < 0 || (p?.partyRunSanity ?? 0) < 0 || (e.partyPostRunSanity ?? 0) < 0;
}

const clampSan = (v) => Math.max(0, Math.min(100, v));

/** 日結（core.endOfDay 逐人呼叫，只對在主神空間的人）：裝備被動的每日理智變化；穿著入魔裝備每天有機率獲得走火入魔詞條 */
export function gearDaily(state, s) {
  const d = passiveSum(s, "dailySanity");
  if (d !== 0) s.stats.sanity = clampSan(s.stats.sanity + d);
  if (hasDemonGear(s) && !(s.tags ?? []).includes("demon_path") && rand({ get rngState() { return state.squadRngState; }, set rngState(v) { state.squadRngState = v; } }) < CONFIG.shop.demonTendencyChance) {
    (s.tags ??= []).push("demon_path");
  }
}

/** 副本結算（存活隊員）：出戰扣理智（runSanity）、隨機扣隊友理智（partyRunSanity）。回傳不需要 */
export function gearAfterRun(state, survivors) {
  const rng = { get rngState() { return state.squadRngState; }, set rngState(v) { state.squadRngState = v; } };
  for (const s of survivors) {
    const r = passiveSum(s, "runSanity");
    if (r !== 0) s.stats.sanity = clampSan(s.stats.sanity + r);
  }
  for (const s of survivors) {
    const p = passiveSum(s, "partyRunSanity");
    const others = survivors.filter((o) => o.id !== s.id);
    if (p !== 0 && others.length > 0) {
      const t = others[Math.floor(rand(rng) * others.length)];
      t.stats.sanity = clampSan(t.stats.sanity + p);
    }
  }
}
