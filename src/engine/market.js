// 8 格分槽黑市（Phase 4-D-2）。純規則，不碰畫面；商品在 src/data/shopItems.js，數字在 CONFIG.market。
//   state.market = { rngState, nextRefreshDay, slots: [{ index, itemId, sold, locked }], manualDay, manualToday }
//   - 每 CONFIG.market.refreshDays（3）天自動刷新；嚴格分槽保底：3 特產武防 + 2 特產血統 + 2 耗材 + 1 黑貨，每格限購 1 次
//   - 抽樣範圍：目前已解鎖的最高 Tier 及前一階（最高階權重較高）
//   - 玩家可花公庫手動刷新（基礎價 [50,150,450,1200,3000] 依空間等級，同日第 n 次 = 基礎價 × n，日結重置）
//   - 最多鎖定 lockLimit（1）格：刷新不會洗掉
//   - 特產綁定的世界情報滿格 → 85 折
//   - 亂數用獨立流 state.market.rngState（黑市輪換、之後的任務榜刷新與突變抽樣也共用），不動主亂數

import { squadMarketMult } from "./squad.js"; // 傭兵流黑市 95 折（4-E-2；循環引用只在執行時呼叫）
import { CONFIG } from "../data/config.js";
import { SHOP_ITEMS, getShopItem, isNewItem } from "../data/shopItems.js";
import { DUNGEONS } from "../data/dungeons.js";
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

/** 世界情報條填了幾成（0～1；情報條實際值是 -3%～+9% 的通過率加成，這裡換算成進度） */
export function intelFill(state, worldId) {
  const ic = CONFIG.dungeon.intel;
  const v = state.dungeonStats?.[worldId]?.intel ?? ic.start;
  return Math.min(1, Math.max(0, (v - ic.start) / (ic.max - ic.start)));
}

/** 已解鎖章節、情報還沒滿的世界（世界情報道具的目標） */
export function intelTargets(state) {
  return DUNGEONS.filter((d) => d.chapter <= (state.spaceLevel ?? 1) && !intelFull(state, d.id));
}

/** 替某世界增加情報 gainPct 個百分點（35 = 填 35%，滿格 100%）；沒打過的世界也會建立情報紀錄 */
export function gainIntel(state, worldId, gainPct) {
  const ic = CONFIG.dungeon.intel;
  const stats = (state.dungeonStats[worldId] ??= { attempts: 0, clears: 0, intel: ic.start });
  stats.intel = Math.min(ic.max, (stats.intel ?? ic.start) + (gainPct / 100) * (ic.max - ic.start));
  return stats.intel;
}

/** 舊存檔的黑市貨架若含舊版失效商品（不在新 200 件表內）：只把那一格自動重抽，其他格不動（4-E-8 存檔相容） */
export function refreshStaleSlots(state) {
  const m = marketOf(state);
  const tier = shopTier(state);
  const taken = new Set(m.slots.filter((s) => s.itemId && isNewItem(s.itemId)).map((s) => s.itemId));
  let n = 0;
  m.slots = m.slots.map((slot) => {
    if (slot.itemId && isNewItem(slot.itemId)) return slot;
    n += 1;
    const kind = CONFIG.market.slotPlan[slot.index];
    const cands = poolOf(kind)
      .filter((i) => (i.tier === tier || i.tier === tier - 1) && !taken.has(i.id))
      .map((i) => ({ item: i, weight: i.tier === tier ? CONFIG.market.curTierWeight : CONFIG.market.prevTierWeight }));
    if (cands.length === 0) return { index: slot.index, itemId: null, sold: true, locked: false };
    const hit = weighted(m, cands).item;
    taken.add(hit.id);
    return { index: slot.index, itemId: hit.id, sold: false, locked: false };
  });
  return n;
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
  // 情報滿格 85 折；傭兵流再 95 折，兩者乘算（約 8 折，4-E-2）
  return { price: Math.round(item.price * (discounted ? CONFIG.market.intelDiscount : 1) * squadMarketMult(state)), discounted };
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
