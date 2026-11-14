// 8 格分槽黑市（Phase 4-D-2）。純規則，不碰畫面；商品在 src/data/shopItems.js，數字在 CONFIG.market。
//   state.market = { rngState, nextRefreshDay, slots: [{ index, itemId, sold, locked }], manualDay, manualToday }
//   - 每 CONFIG.market.refreshDays（3）天自動刷新；嚴格分槽保底：3 特產武防 + 2 特產血統 + 2 耗材 + 1 黑貨，每格限購 1 次
//   - 抽樣範圍：目前已解鎖的最高 Tier 及前一階（最高階權重較高）
//   - 玩家可花公庫手動刷新（基礎價 [50,150,450,1200,3000] 依空間等級，同日第 n 次 = 基礎價 × n，日結重置）
//   - 最多鎖定 lockLimit（1）格：刷新不會洗掉
//   - 特產綁定的世界情報滿格 → 85 折
//   - 亂數用獨立流 state.market.rngState（黑市輪換、之後的任務榜刷新與突變抽樣也共用），不動主亂數

import { CONFIG } from "../data/config.js";
import { SHOP_ITEMS, getShopItem } from "../data/shopItems.js";
import { weighted } from "./rng.js";
import { emit, spend, shopTier, currentDay, getSamsarite } from "./core.js";
import { checkBuy, buyItem } from "./shop.js";
import { logText } from "./templates.js";

export function newMarketState(seed = 0) {
  return { rngState: (seed ^ 0x3a7e1) | 0, nextRefreshDay: CONFIG.market.refreshDays + 1, slots: [], manualDay: 0, manualToday: 0 };
}
export const marketOf = (state) => (state.market ??= newMarketState(state.rngState));

/** 某個格子種類的候選商品 */
function poolOf(kind) {
  if (kind === "gear") return SHOP_ITEMS.filter((i) => i.category === "specialty" && i.slot !== "bloodline");
  if (kind === "bloodline") return SHOP_ITEMS.filter((i) => i.category === "specialty" && i.slot === "bloodline");
  return SHOP_ITEMS.filter((i) => i.category === kind);
}

/**
 * 刷新黑市：被鎖定且還沒售出的格子原地保留，其餘重抽（售出標記重置）。
 * silent：開新局／遷移存檔的初始化不寫日誌
 */
export function refreshMarket(state, { silent = false } = {}) {
  const m = marketOf(state);
  const M = CONFIG.market;
  const tier = shopTier(state);
  const keep = new Map((m.slots ?? []).filter((s) => s.locked && !s.sold).map((s) => [s.index, s]));
  const taken = new Set([...keep.values()].map((s) => s.itemId));
  const slots = [];
  M.slotPlan.forEach((kind, index) => {
    if (keep.has(index)) return slots.push(keep.get(index));
    const cands = poolOf(kind)
      .filter((i) => (i.tier === tier || i.tier === tier - 1) && !taken.has(i.id))
      .map((i) => ({ item: i, weight: i.tier === tier ? M.curTierWeight : M.prevTierWeight }));
    if (cands.length === 0) return slots.push({ index, itemId: null, sold: true, locked: false });
    const hit = weighted(m, cands).item;
    taken.add(hit.id);
    slots.push({ index, itemId: hit.id, sold: false, locked: false });
  });
  m.slots = slots;
  m.nextRefreshDay = currentDay(state) + M.refreshDays;
  if (!silent) emit(state, "market", logText(state, "marketRefresh", { day: currentDay(state), n: slots.filter((s) => s.itemId).length }));
  return slots;
}

/** 每日結算掛鉤（在 advanceTick 跨日時呼叫）：到期自動刷新 */
export function dailyMarket(state) {
  const m = marketOf(state);
  if (m.slots.length === 0 || currentDay(state) >= m.nextRefreshDay) refreshMarket(state);
}

/** 手動刷新的價錢（同日第 n 次 = 基礎價 × n，換日重置） */
export function manualRefreshCost(state) {
  const m = marketOf(state);
  const n = m.manualDay === currentDay(state) ? m.manualToday : 0;
  return CONFIG.market.manualBase[(state.spaceLevel ?? 1) - 1] * (n + 1);
}

export function manualRefresh(state) {
  const cost = manualRefreshCost(state);
  if (!spend(state, cost)) return { ok: false, reason: "積分不夠（已達高利貸上限）", cost };
  const m = marketOf(state);
  m.manualToday = (m.manualDay === currentDay(state) ? m.manualToday : 0) + 1;
  m.manualDay = currentDay(state);
  refreshMarket(state);
  return { ok: true, cost };
}

/** 鎖定／解鎖一格（鎖定上限 CONFIG.market.lockLimit，只能鎖還沒售出的） */
export function lockSlot(state, index, locked = true) {
  const m = marketOf(state);
  const slot = m.slots[index];
  if (!slot || !slot.itemId) return { ok: false, reason: "沒有這一格" };
  if (!locked) {
    slot.locked = false;
    return { ok: true };
  }
  if (slot.sold) return { ok: false, reason: "已售罄的格子不能鎖定" };
  if (!slot.locked && m.slots.filter((s) => s.locked).length >= CONFIG.market.lockLimit) {
    return { ok: false, reason: `最多只能鎖定 ${CONFIG.market.lockLimit} 格` };
  }
  slot.locked = true;
  return { ok: true };
}

/** 世界情報是否已滿格 */
export function intelFull(state, worldId) {
  const v = state.dungeonStats?.[worldId]?.intel;
  return v !== undefined && v >= CONFIG.dungeon.intel.max - 1e-9;
}

/** 某格的實際售價：特產綁定的世界情報滿格 → 85 折 */
export function slotPrice(state, slot) {
  const item = getShopItem(slot?.itemId);
  if (!item) return { price: 0, discounted: false };
  const discounted = !!item.worldId && intelFull(state, item.worldId);
  return { price: discounted ? Math.round(item.price * CONFIG.market.intelDiscount) : item.price, discounted };
}

/** 能不能買這一格？opts：{ payer, victimId } */
export function checkMarketBuy(state, index, targetId, opts = {}) {
  const slot = marketOf(state).slots[index];
  if (!slot || !slot.itemId) return { ok: false, reason: "沒有這一格" };
  if (slot.sold) return { ok: false, reason: "已售罄" };
  const { price } = slotPrice(state, slot);
  return checkBuy(state, getShopItem(slot.itemId), getSamsarite(state, targetId), { ...opts, price, source: "market" });
}

/** 買黑市某一格（每格限購 1 次）。玩家預設用公庫（賞賜）；輪迴者自己買傳 { payer: "wallet" } */
export function buyMarketSlot(state, index, targetId, opts = {}) {
  const check = checkMarketBuy(state, index, targetId, opts);
  if (!check.ok) return check;
  const slot = marketOf(state).slots[index];
  const { price } = slotPrice(state, slot);
  const r = buyItem(state, slot.itemId, targetId, { ...opts, price, source: "market" });
  if (r.ok) {
    slot.sold = true;
    slot.locked = false;
  }
  return r;
}

/** 畫面用：整個黑市的狀況 */
export function marketInfo(state) {
  const m = marketOf(state);
  return {
    daysLeft: Math.max(0, m.nextRefreshDay - currentDay(state)),
    manualCost: manualRefreshCost(state),
    lockLimit: CONFIG.market.lockLimit,
    slots: m.slots.map((slot) => ({ ...slot, item: getShopItem(slot.itemId), ...slotPrice(state, slot) })),
  };
}
