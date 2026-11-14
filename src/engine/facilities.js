// 主神空間永久基建（Phase 4-F-3）。純規則，不碰畫面。數字：CONFIG.facility；名稱：src/data/facilities.js。
//
//   state.facilities            { gravity, pods, stele, nursery, radar }：各設施目前等級（0 起）
//   state.erosionCrystals       侵蝕結晶（位面侵蝕通關掉落，升到高等級設施要消耗）
//   state.autoUpgradeFacilities 自動建設開關（日結：公庫高於 30000 × 空間等級 時自動升級可負擔的設施）
//   s.facilityBonus             每位輪迴者身上的「重力修煉室」戰力加成（effectivePower 沒有 state 參數，所以同英靈碑／奇物寫進個人欄位）
// 亂數：生命溫養艙的額外痊癒用獨立亂數流 state.facilityRngState，不動主亂數。

import { CONFIG } from "../data/config.js";
import { FACILITY_ORDER, FACILITY_TEXT } from "../data/facilities.js";
import { emit, spend, canAfford, setInjury } from "./core.js";
import { styleOf } from "./squad.js";
import { rand } from "./rng.js";
import { logText } from "./templates.js";

const F = () => CONFIG.facility;
const def = (id) => F().defs[id];

export const newFacilities = () => Object.fromEntries(FACILITY_ORDER.map((id) => [id, 0]));
export const facilityLevel = (state, id) => state.facilities?.[id] ?? 0;
export const facilityTotal = (state) => FACILITY_ORDER.reduce((n, id) => n + facilityLevel(state, id), 0);

/** 把 state.facilityRngState 包成 rand() 吃得下的物件 */
function facRng(state) {
  return {
    get rngState() {
      return state.facilityRngState;
    },
    set rngState(v) {
      state.facilityRngState = v;
    },
  };
}

/** 升到第 lv 級（從 1 算起）要花多少積分：等比遞增，滿級總和 = totalCost */
export function levelCost(id, lv) {
  const d = def(id);
  const g = F().costGrowth;
  const first = (d.totalCost * (g - 1)) / (g ** d.max - 1);
  return Math.round(first * g ** (lv - 1));
}

/** 共產流專屬補貼：隊長流派是 communal 且互助金超過軟上限（15000 × 空間等級）時，超額部分最多折抵這次造價的 30% */
export function communalSubsidy(state, cost) {
  if (styleOf(state) !== "communal") return 0;
  const over = (state.squad?.communalFund ?? 0) - CONFIG.squad.communal.fundCapPerLevel * (state.spaceLevel ?? 1);
  return over > 0 ? Math.min(Math.round(cost * F().communalSubsidyPct), Math.floor(over)) : 0;
}

/** 現在能不能升級。回傳 { ok, reason, cost, crystals, subsidy, pay, next } */
export function checkUpgrade(state, id) {
  const d = def(id);
  if (!d) return { ok: false, reason: "沒有這個設施" };
  const lv = facilityLevel(state, id);
  if (lv >= d.max) return { ok: false, reason: "已達等級上限", next: lv };
  const next = lv + 1;
  const cost = levelCost(id, next);
  const crystals = d.crystalAt[next - 1] ?? 0;
  const subsidy = communalSubsidy(state, cost);
  const pay = cost - subsidy;
  const info = { cost, crystals, subsidy, pay, next };
  if ((state.erosionCrystals ?? 0) < crystals) return { ok: false, reason: `需要侵蝕結晶 ${crystals} 顆（目前 ${state.erosionCrystals ?? 0}）`, ...info };
  if (!canAfford(state, pay)) return { ok: false, reason: "積分不夠（已達高利貸上限）", ...info };
  return { ok: true, ...info };
}

/** 升級：扣積分（共產流先用互助金折抵）、扣結晶、等級 +1 */
export function upgradeFacility(state, id, { auto = false } = {}) {
  const c = checkUpgrade(state, id);
  if (!c.ok) return c;
  if (!spend(state, c.pay, false)) return { ...c, ok: false, reason: "積分不夠（已達高利貸上限）" }; // 基建不計入商店階級（#16）；防禦性檢查（#39）
  if (c.subsidy > 0) state.squad.communalFund -= c.subsidy;
  state.erosionCrystals -= c.crystals;
  state.facilities[id] = c.next;
  refreshFacilityBonus(state);
  const t = FACILITY_TEXT[id];
  emit(state, "facility", logText(state, "facilityUp", { name: `${t.icon}${t.name}`, lv: c.next, max: def(id).max, cost: c.pay, sub: c.subsidy > 0 ? `（互助金折抵 ${c.subsidy}）` : "", auto: auto ? "（自動建設）" : "" }));
  return c;
}

/** 日結：自動建設。公庫扣掉造價後仍高於安全水位（30000 × 空間等級）才升級，便宜的設施優先 */
export function dailyFacilities(state) {
  if (!state.autoUpgradeFacilities || state.gameOver) return;
  const water = F().safeWaterPerLevel * (state.spaceLevel ?? 1);
  for (let guard = 0; guard < 20; guard++) {
    const options = FACILITY_ORDER.map((id) => ({ id, c: checkUpgrade(state, id) })).filter((o) => o.c.ok && state.points - o.c.pay >= water);
    if (options.length === 0) return;
    options.sort((a, b) => a.c.pay - b.c.pay);
    upgradeFacility(state, options[0].id, { auto: true });
  }
}

// ───────── 各設施的效果查詢 ─────────

const per = (state, id, key) => facilityLevel(state, id) * (def(id).perLevel[key] ?? 0);

/** 重力修煉室：全隊基礎戰力加成（加進 effectivePower 的百分比區） */
export const gravityPct = (state) => per(state, "gravity", "powerPct");
export function refreshFacilityBonus(state) {
  const b = gravityPct(state);
  for (const s of state.samsarites ?? []) s.facilityBonus = b;
}
/** 生命溫養艙：重傷（injury >= 2）自然痊癒再降 1 級的機率 */
export const healChanceBonus = (state) => per(state, "pods", "healChance");
export const restSanityBonus = (state) => per(state, "pods", "restSanity");
/** 法則共鳴碑：開鎖費用折扣（和破鎖耗材加算後封頂） */
export const geneDiscountOf = (state) => per(state, "stele", "geneDiscount");
/** 萬界育嬰堂：培育天數縮短比例與出世資質下限 */
export const podDaysCut = (state) => per(state, "nursery", "podDaysCut");
export const talentFloor = (state) => per(state, "nursery", "talentFloor");
/** 星界觀測樞：情報獲取倍率加成、洲際團戰勝利加成 */
export const intelGainBonus = (state) => per(state, "radar", "intelGain");
export const rivalRewardBonus = (state) => per(state, "radar", "rivalReward");

/** 每日結算（在 endOfDay 逐人休養時呼叫）：生命溫養艙讓重傷者多一次痊癒機會。沒有溫養艙不消耗亂數 */
export function podsHeal(state, s) {
  const chance = healChanceBonus(state);
  if (chance <= 0 || s.injury < 2) return false;
  if (rand(facRng(state)) < chance) {
    setInjury(s, s.injury - 1);
    return true;
  }
  return false;
}

/** 畫面用 */
export function facilityInfo(state) {
  return FACILITY_ORDER.map((id) => ({ id, ...FACILITY_TEXT[id], lv: facilityLevel(state, id), max: def(id).max, check: checkUpgrade(state, id) }));
}
