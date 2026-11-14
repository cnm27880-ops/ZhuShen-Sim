// Phase 4-D-2：五階商品結構、8 格分槽黑市、情報 85 折、耗材／黑貨效果
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/data/config.js";
import { SHOP_ITEMS, getShopItem } from "../src/data/shopItems.js";
import { WORLD_IDS } from "../src/data/worlds.js";
import { createNewGame, createSamsarite, advanceTick, serialize, deserialize } from "../src/engine/core.js";
import { marketOf, refreshMarket, manualRefresh, manualRefreshCost, lockSlot, slotPrice, buyMarketSlot, checkMarketBuy, marketInfo } from "../src/engine/market.js";
import { buyItem, checkBuy } from "../src/engine/shop.js";
import { effectivePower, subStat, injuryShieldOf } from "../src/engine/tags.js";
import { startRun } from "../src/engine/dungeon.js";
import { getRel } from "../src/engine/relations.js";
import { step } from "../src/engine/dispatch.js";

function setup(n = 2, seed = 4) {
  const state = createNewGame(seed);
  state.samsarites = [];
  state.points = 1000000;
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, "C");
    s.tags = [];
    state.samsarites.push(s);
  }
  return state;
}
const kindOf = (item) => (item.category === "specialty" ? (item.slot === "bloodline" ? "bloodline" : "gear") : item.category);

test("商品資料表：id 唯一、五階 × 四分類齊全、特產綁定存在的世界、aiBuyTag 合法", () => {
  assert.equal(new Set(SHOP_ITEMS.map((i) => i.id)).size, SHOP_ITEMS.length);
  for (const t of [1, 2, 3, 4, 5]) {
    for (const cat of ["standard", "specialty", "consumable", "contraband"]) {
      assert.ok(SHOP_ITEMS.some((i) => i.tier === t && i.category === cat), `Tier ${t} 缺 ${cat}`);
    }
    assert.ok(SHOP_ITEMS.filter((i) => i.tier === t && i.category === "specialty" && i.slot === "bloodline").length >= 2);
  }
  for (const i of SHOP_ITEMS) {
    assert.ok(["survival", "aggro", "communal", "drama"].includes(i.aiBuyTag), i.id);
    assert.ok(i.price > 0 && i.name.length >= 2 && i.name.length <= 7, i.id);
    if (i.category === "specialty") assert.ok(WORLD_IDS.includes(i.worldId), `${i.id} 綁定的世界不存在`);
  }
  assert.equal(WORLD_IDS.length, 30);
  assert.equal(SHOP_ITEMS.filter((i) => i.category === "specialty" && i.slot === "bloodline").length, 30, "每個世界 1 個特產血統");
});

test("黑市：開局 8 格，嚴格分槽 3 特產武防 + 2 特產血統 + 2 耗材 + 1 黑貨，只抽目前階與前一階", () => {
  const state = setup();
  for (let round = 0; round < 40; round++) {
    state.totalSpent = [0, 700, 4000, 13000, 50000][round % 5];
    refreshMarket(state, { silent: true });
    const slots = marketOf(state).slots;
    assert.equal(slots.length, 8);
    const kinds = slots.map((s) => kindOf(getShopItem(s.itemId)));
    assert.deepEqual(kinds, ["gear", "gear", "gear", "bloodline", "bloodline", "consumable", "consumable", "contraband"]);
    assert.equal(new Set(slots.map((s) => s.itemId)).size, 8, "同一批不重複");
    const tier = [1, 2, 3, 4, 5][round % 5];
    for (const s of slots) assert.ok([tier, tier - 1].includes(getShopItem(s.itemId).tier), `Tier ${tier} 不該出現 ${s.itemId}`);
  }
});

test("黑市：每 3 天自動刷新；用獨立亂數流，不動主亂數", () => {
  const state = setup();
  const before = marketOf(state).slots.map((s) => s.itemId).join();
  state.tick = 0;
  for (let i = 0; i < CONFIG.ticksPerDay * 2; i++) advanceTick(state);
  assert.equal(marketOf(state).slots.map((s) => s.itemId).join(), before, "第 3 天前不換貨");
  for (let i = 0; i < CONFIG.ticksPerDay; i++) advanceTick(state);
  assert.notEqual(marketOf(state).slots.map((s) => s.itemId).join(), before, "第 4 天換貨");
  assert.equal(marketOf(state).nextRefreshDay, 7);
  assert.equal(marketInfo(state).daysLeft, 3);
  const mainRng = state.rngState;
  refreshMarket(state, { silent: true });
  manualRefresh(state);
  assert.equal(state.rngState, mainRng, "黑市刷新只用 market.rngState，沒動到主亂數");
});

test("手動刷新：花公庫、同日遞增（基礎價 × n）、換日重置、累加 totalSpent", () => {
  const state = setup();
  const base = CONFIG.market.manualBase[0];
  assert.equal(manualRefreshCost(state), base);
  const spent = state.totalSpent;
  const pts = state.points;
  assert.equal(manualRefresh(state).cost, base);
  assert.equal(manualRefresh(state).cost, base * 2);
  assert.equal(manualRefreshCost(state), base * 3, "第 3 次的價錢");
  assert.equal(state.points, pts - base * 3, "已付第 1、2 次（base + 2×base）");
  assert.equal(state.totalSpent, spent + base * 3, "黑市刷新費也累加進累積花費");
  state.tick += CONFIG.ticksPerDay;
  assert.equal(manualRefreshCost(state), base, "換日重置");
  state.spaceLevel = 3;
  assert.equal(manualRefreshCost(state), CONFIG.market.manualBase[2]);
  state.points = CONFIG.space.debtLimit[2] + 1;
  assert.equal(manualRefresh(state).ok, false, "付不起不刷新");
});

test("鎖格：最多鎖 1 格，刷新（含手動）不洗掉；售出的格子不能鎖；刷新後售出標記重置", () => {
  const state = setup();
  const m = marketOf(state);
  const keep = m.slots[3].itemId;
  assert.equal(lockSlot(state, 3).ok, true);
  assert.equal(lockSlot(state, 4).ok, false, "鎖定上限 1 格");
  refreshMarket(state, { silent: true });
  assert.equal(marketOf(state).slots[3].itemId, keep);
  assert.equal(marketOf(state).slots[3].locked, true);
  manualRefresh(state);
  assert.equal(marketOf(state).slots[3].itemId, keep);
  assert.equal(lockSlot(state, 3, false).ok, true);
  const s = state.samsarites[0];
  s.wallet = 1e6;
  state.totalSpent = 60000;
  refreshMarket(state, { silent: true });
  const idx = marketOf(state).slots.findIndex((x) => getShopItem(x.itemId).kind === "gear");
  assert.equal(buyMarketSlot(state, idx, s.id, { payer: "wallet" }).ok, true);
  assert.equal(marketOf(state).slots[idx].sold, true);
  assert.equal(lockSlot(state, idx).ok, false);
  assert.equal(checkMarketBuy(state, idx, s.id, { payer: "wallet" }).ok, false, "每格限購 1 次");
  refreshMarket(state, { silent: true });
  assert.equal(marketOf(state).slots.every((x) => !x.sold), true);
});

test("情報 85 折：特產綁定的世界情報滿格才打折，其他商品不打折", () => {
  const state = setup();
  state.totalSpent = 700;
  refreshMarket(state, { silent: true });
  const slot = marketOf(state).slots[0];
  const item = getShopItem(slot.itemId);
  assert.equal(slotPrice(state, slot).price, item.price);
  state.dungeonStats[item.worldId] = { attempts: 8, clears: 8, intel: 0.06 };
  assert.equal(slotPrice(state, slot).discounted, false, "情報未滿");
  state.dungeonStats[item.worldId].intel = CONFIG.dungeon.intel.max;
  const p = slotPrice(state, slot);
  assert.equal(p.discounted, true);
  assert.equal(p.price, Math.round(item.price * 0.85));
  const consumable = marketOf(state).slots[5];
  assert.equal(slotPrice(state, consumable).discounted, false);
  const s = state.samsarites[0];
  const pts = state.points;
  assert.equal(buyMarketSlot(state, 0, s.id).ok, true);
  assert.equal(state.points, pts - p.price, "實際扣折後價");
});

test("買裝備：公庫買 = 綁定 + 理智 +5；私房錢買 = 不綁定、不能覆蓋綁定裝備；一律累加 totalSpent", () => {
  const state = setup();
  const [a, b] = state.samsarites;
  a.stats.sanity = 50;
  assert.equal(buyItem(state, "weapon_club", a.id).ok, true);
  assert.equal(a.soulbound.weapon, true);
  assert.equal(a.stats.sanity, 55);
  state.totalSpent = 700;
  a.wallet = 5000;
  const r = checkBuy(state, getShopItem("weapon_steel"), a, { payer: "wallet" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /綁定/);
  b.wallet = 500;
  const spent = state.totalSpent;
  assert.equal(buyItem(state, "weapon_steel", b.id, { payer: "wallet" }).ok, true);
  assert.equal(b.soulbound.weapon, undefined, "自己買的不綁定");
  assert.equal(b.wallet, 500 - 380);
  assert.equal(state.totalSpent, spent + 380);
  assert.equal(b.stats.sanity, 100);
});

test("血統槽：每人限 1，覆蓋舊血統；有效戰力吃 powerPct，特產武防只在綁定世界加通過率", () => {
  const state = setup(1);
  const [s] = state.samsarites;
  state.totalSpent = 700;
  const bloods = SHOP_ITEMS.filter((i) => i.slot === "bloodline" && i.tier === 1);
  const base = effectivePower(s);
  assert.equal(buyItem(state, bloods[0].id, s.id, { source: "market" }).ok, true);
  assert.equal(effectivePower(s), Math.round(s.stats.power * (1 + bloods[0].effect.powerPct)));
  assert.ok(effectivePower(s) > base);
  assert.equal(buyItem(state, bloods[1].id, s.id, { source: "market" }).ok, true);
  assert.equal(s.gear.bloodline, bloods[1].id, "新血統覆蓋舊血統");
  assert.equal(buyItem(state, bloods[1].id, s.id, { source: "market" }).ok, false, "不能重買同一個");
});

test("常駐商店只賣制式與常備耗材；特產／黑貨只能走黑市", () => {
  const state = setup(1);
  const [s] = state.samsarites;
  assert.equal(buyItem(state, "spec_ghost_village_weapon", s.id).ok, false);
  assert.equal(buyItem(state, "contra_love_t1", s.id).ok, false);
  assert.equal(buyItem(state, "weapon_club", s.id).ok, true);
});

test("出征耗材：進緩衝區（上限 3）、出發時套成單場 buff、回家清空", () => {
  const state = setup(1);
  const [s] = state.samsarites;
  s.stats.power = 3000;
  const item = getShopItem("cons_tactic_t1");
  const shield = getShopItem("cons_shield_t1");
  for (let i = 0; i < CONFIG.shop.consumableCap; i++) assert.equal(buyItem(state, item.id, s.id, { source: "market" }).ok, true);
  assert.equal(buyItem(state, item.id, s.id, { source: "market" }).ok, false, "囤滿了");
  assert.equal(s.consumables.length, 3);
  const def = subStat(s, "defense");
  assert.equal(startRun(state, "ghost_village", [s.id]).ok, true);
  assert.deepEqual(s.consumables, []);
  assert.equal(s.runBuff.defense, 12);
  assert.equal(subStat(s, "defense"), def + 12);
  assert.equal(buyItem(state, shield.id, s.id, { source: "market" }).ok, false, "副本中不能買");
  let guard = 0;
  while (state.runs.length && guard++ < 100) step(state);
  const back = state.samsarites.find((x) => x.id === s.id);
  if (back) {
    assert.equal(back.runBuff, null);
    assert.equal(subStat(back, "defense"), def);
  }
});

test("強制任務延期耗材：+2 天；沒有待派任務不能買", () => {
  const state = setup(1);
  const [s] = state.samsarites;
  const item = getShopItem("cons_extend_t1");
  assert.equal(checkBuy(state, item, s, { source: "market" }).ok, false);
  state.mandatory.pending = { deadlineDay: 10 };
  assert.equal(buyItem(state, item.id, s.id, { source: "market" }).ok, true);
  assert.equal(state.mandatory.pending.deadlineDay, 12);
});

test("狗血黑貨：單向加好感／忘情水／捏造人偶／鎖私人休眠艙", () => {
  const state = setup(3);
  const [a, b, c] = state.samsarites;
  assert.equal(checkBuy(state, getShopItem("contra_love_t1"), a, { source: "market" }).ok, false, "沒選對象");
  assert.equal(checkBuy(state, getShopItem("contra_love_t1"), a, { source: "market", victimId: a.id }).ok, false, "對象不能是自己");
  buyItem(state, "contra_love_t1", a.id, { source: "market", victimId: b.id });
  assert.equal(getRel(state, b, a).love, 15, "b 對 a 好感 +15");
  assert.equal(getRel(state, a, b).love, 0, "單向");
  buyItem(state, "contra_forget_t1", a.id, { source: "market", victimId: b.id });
  assert.equal(getRel(state, b, a).love, 0);
  buyItem(state, "drama_custom_doll", a.id, { source: "market", victimId: b.id });
  assert.equal(getRel(state, c, b).love, 0, "好感下限 0，仇恨上升");
  assert.equal(getRel(state, c, b).hate, 5);
  assert.equal(getRel(state, a, b).hate, 5);
  buyItem(state, "contra_pod_t1", a.id, { source: "market", victimId: c.id });
  assert.equal(c.podLockDays, 3);
  assert.equal(startRun(state, "ghost_village", [c.id]).ok, false, "被鎖休眠艙不能派遣");
  for (let i = 0; i < 3 * CONFIG.ticksPerDay; i++) advanceTick(state);
  assert.equal(c.podLockDays, 0);
  assert.equal(c.lockedInPodBy, null);
});

test("存檔：黑市與逛街亂數流往返；舊存檔補預設並上貨", () => {
  const state = setup();
  lockSlot(state, 2);
  const back = deserialize(serialize(state));
  assert.deepEqual(back.market, state.market);
  assert.equal(back.aiShopRngState, state.aiShopRngState);
  const old = JSON.parse(serialize(state));
  delete old.market;
  delete old.aiShopRngState;
  const loaded = deserialize(JSON.stringify(old));
  assert.equal(loaded.market.slots.length, 8);
  assert.equal(typeof loaded.aiShopRngState, "number");
});

test("預留欄位（4-E／未來使用）：state.squad、s.customProfile 有預設值，舊存檔遷移補上", () => {
  const state = setup(1);
  assert.deepEqual(state.squad, { captainId: null, style: null });
  assert.equal(state.samsarites[0].customProfile, null);
  const old = JSON.parse(serialize(state));
  delete old.squad;
  delete old.samsarites[0].customProfile;
  const loaded = deserialize(JSON.stringify(old));
  assert.deepEqual(loaded.squad, { captainId: null, style: null });
  assert.equal(loaded.samsarites[0].customProfile, null);
});
