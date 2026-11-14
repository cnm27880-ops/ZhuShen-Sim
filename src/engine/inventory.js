// 物資倉庫（功能 1、2）：公庫批量買常備藥（傷藥、鎮定劑…）進倉庫，之後在物資面板選人使用。純規則，不碰畫面。
// 只有「常駐商店賣的即用耗材（permanent 的 kind "use"）」走倉庫；出征耗材、黑市貨、裝備照舊（買了直接生效／穿上）。
// 花費計入商店階級（等同商店消費）。

import { CONFIG } from "../data/config.js";
import { SHOP_ITEMS, getShopItem, isNewItem } from "../data/shopItems.js";
import { emit, spend, canAfford, shopTier, getSamsarite } from "./core.js";
import { applyUse, useBlock, isPermanent } from "./shop.js";
import { logText } from "./templates.js";

export const MAX_BATCH = 99; // 單次最多買幾份

/** 能進倉庫的商品：常駐商店賣的即用耗材 */
export const isStockable = (item) => !!item && isNewItem(item.id) && item.kind === "use" && isPermanent(item);

/** 常駐商店的藥品／消耗品清單（依階層由低到高） */
export function stockableItems() {
  return SHOP_ITEMS.filter(isStockable).sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id));
}

/** 倉庫裡的東西：[{ item, count }]，依階層、id 排序 */
export function stockList(state) {
  return Object.entries(state.inventory ?? {})
    .filter(([, n]) => n > 0)
    .map(([id, count]) => ({ item: getShopItem(id), count }))
    .filter((r) => r.item)
    .sort((a, b) => a.item.tier - b.item.tier || a.item.id.localeCompare(b.item.id));
}

export const stockCount = (state, itemId) => state.inventory?.[itemId] ?? 0;

/** 買 qty 份進倉庫（公庫付）。回傳 { ok, reason, total } */
export function checkBuyStock(state, itemId, qty = 1) {
  const item = getShopItem(itemId);
  if (!isStockable(item)) return { ok: false, reason: "這件商品不能囤進倉庫" };
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_BATCH) return { ok: false, reason: `一次要買 1～${MAX_BATCH} 份` };
  if (item.tier > shopTier(state)) return { ok: false, reason: `Tier ${item.tier} 還沒解鎖（累積花費 ${CONFIG.shopTierUnlock[item.tier - 1]} 分）` };
  const total = item.price * qty;
  if (!canAfford(state, total)) return { ok: false, reason: "積分不夠（連主神高利貸都借不到）", total };
  return { ok: true, total };
}

export function buyStock(state, itemId, qty = 1) {
  const check = checkBuyStock(state, itemId, qty);
  if (!check.ok) return check;
  if (!spend(state, check.total)) return { ok: false, reason: "積分不夠（連主神高利貸都借不到）", total: check.total };
  const item = getShopItem(itemId);
  state.inventory ??= {};
  state.inventory[itemId] = (state.inventory[itemId] ?? 0) + qty;
  emit(state, "shop", `🛒 公庫買進【${item.name}】×${qty}，花 ${check.total} 分，存進物資倉庫（現有 ${state.inventory[itemId]}）。`);
  return { ok: true, total: check.total, count: state.inventory[itemId] };
}

/** 這件物資對這個人現在有沒有用？回傳 null（可用）或原因 */
export function stockUseBlock(state, itemId, s) {
  const item = getShopItem(itemId);
  if (!item) return "沒有這件物資";
  if (stockCount(state, itemId) < 1) return "倉庫裡沒有這件物資了";
  if (!s) return "請先選一個人";
  if (s.location !== "space") return `${s.name} 不在主神空間`;
  return useBlock(state, item, s);
}

/** 從倉庫拿 1 份對 targetId 使用 */
export function useStock(state, itemId, targetId) {
  const s = getSamsarite(state, targetId);
  const why = stockUseBlock(state, itemId, s);
  if (why) return { ok: false, reason: why };
  const item = getShopItem(itemId);
  const note = applyUse(state, item, s, {});
  state.inventory[itemId] -= 1;
  if (state.inventory[itemId] <= 0) delete state.inventory[itemId];
  emit(state, "shop", logText(state, "shopUse", { A: s, item: item.name, note }), { samsariteId: s.id });
  return { ok: true, note };
}

/**
 * 這個人對這件物資的「需求程度」（越大越需要，0 = 用不到）：理智藥看缺多少理智、傷藥看傷勢等級。
 * 物資面板用它把最需要的人排最前面。
 */
export function needOf(item, s) {
  const e = item?.effect ?? {};
  let need = 0;
  if (e.sanity) need = Math.max(need, Math.min(e.sanity, 100 - s.stats.sanity) + (100 - s.stats.sanity) / 100);
  if (e.healInjury) need = Math.max(need, s.injury * 30);
  return need;
}

/** 全體在空間的員工，依對這件物資的需求由高到低排（同需求理智低的在前）；附上不能用的原因 */
export function stockTargets(state, itemId) {
  const item = getShopItem(itemId);
  return state.samsarites
    .filter((s) => s.location === "space")
    .map((s) => ({ s, need: needOf(item, s), block: stockUseBlock(state, itemId, s) }))
    .sort((a, b) => (a.block === null ? 0 : 1) - (b.block === null ? 0 : 1) || b.need - a.need || a.s.stats.sanity - b.s.stats.sanity || a.s.id - b.s.id);
}
