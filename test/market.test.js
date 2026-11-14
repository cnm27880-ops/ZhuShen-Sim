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

test("商品資料表（4-E-8）：200 件、五階各 40 件（8 常駐 + 18 特產 + 6 耗材 + 8 黑貨）、每世界 3 件特產、aiBuyTag 合法", () => {
  assert.equal(SHOP_ITEMS.length, 200);
  assert.equal(new Set(SHOP_ITEMS.map((i) => i.id)).size, 200);
  for (const t of [1, 2, 3, 4, 5]) {
    const items = SHOP_ITEMS.filter((i) => i.tier === t);
    assert.equal(items.length, 40);
    const count = (cat) => items.filter((i) => i.category === cat).length;
    assert.deepEqual([count("standard"), count("specialty"), count("consumable"), count("contraband")], [8, 18, 6, 8], `Tier ${t}`);
  }
  const valid = ["dps", "tank", "speed", "balanced", "luck", "heal", "sanity", "support", "taboo"];
  for (const i of SHOP_ITEMS) {
    assert.ok(valid.includes(i.aiBuyTag), i.id);
    assert.ok(i.price > 0 && i.name.length >= 2 && i.desc.length > 5, i.id);
    assert.ok(["weapon", "armor", "accessory", "bloodline", "consumable"].includes(i.slot), i.id);
    if (i.category === "specialty") assert.ok(WORLD_IDS.includes(i.worldId), `${i.id} 綁定的世界不存在`);
    for (const v of Object.values(i.stats)) assert.ok(Number.isFinite(v));
  }
  assert.equal(WORLD_IDS.length, 30);
  for (const w of WORLD_IDS) assert.equal(SHOP_ITEMS.filter((i) => i.worldId === w).length, 3, `${w} 要有 3 件特產`);
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

test("手動刷新：花公庫、同日遞增（基礎價 × n）、換日重置、不計入商店階級", () => {
  const state = setup();
  const base = CONFIG.market.manualBase[0];
  assert.equal(manualRefreshCost(state), base);
  const spent = state.totalSpent;
  const pts = state.points;
  assert.equal(manualRefresh(state).cost, base);
  assert.equal(manualRefresh(state).cost, base * 2);
  assert.equal(manualRefreshCost(state), base * 3, "第 3 次的價錢");
  assert.equal(state.points, pts - base * 3, "已付第 1、2 次（base + 2×base）");
  assert.equal(state.totalSpent, spent, "黑市手動刷新費不計入商店階級（#16）");
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
  assert.equal(buyItem(state, "t1_01", a.id).ok, true);
  assert.equal(a.soulbound.weapon, true);
  assert.equal(a.stats.sanity, 55);
  state.totalSpent = 700;
  a.wallet = 5000;
  const r = checkBuy(state, getShopItem("t2_01"), a, { payer: "wallet" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /綁定/);
  b.wallet = 500;
  const spent = state.totalSpent;
  assert.equal(buyItem(state, "t2_01", b.id, { payer: "wallet" }).ok, true);
  assert.equal(b.soulbound.weapon, undefined, "自己買的不綁定");
  assert.equal(b.wallet, 500 - 450);
  assert.equal(state.totalSpent, spent + 450);
  assert.equal(b.stats.sanity, 100);
});

test("血統槽：每人限 1，覆蓋舊血統；血統是白值，不是百分比；飾品是第 3 個裝備欄", () => {
  const state = setup(1);
  const [s] = state.samsarites;
  state.totalSpent = 700;
  const base = effectivePower(s);
  assert.equal(buyItem(state, "t1_07", s.id).ok, true, "常駐血統");
  assert.equal(effectivePower(s), base + 19);
  assert.equal(buyItem(state, "t1_08", s.id).ok, true);
  assert.equal(s.gear.bloodline, "t1_08", "新血統覆蓋舊血統");
  assert.equal(buyItem(state, "t1_08", s.id).ok, false, "不能重買同一個");
  assert.equal(buyItem(state, "t1_05", s.id).ok, true, "飾品欄");
  assert.equal(s.gear.accessory, "t1_05");
  assert.equal(effectivePower(s), base + 18 + 15);
});

test("常駐商店只賣常駐裝備與常備耗材；特產／黑貨只能走黑市", () => {
  const state = setup(1);
  const [s] = state.samsarites;
  assert.equal(buyItem(state, "t1_09", s.id).ok, false, "世界特產");
  assert.equal(buyItem(state, "t1_33", s.id).ok, false, "黑貨");
  assert.equal(buyItem(state, "t1_31", s.id).ok, false, "情報手札不是常備耗材");
  assert.equal(buyItem(state, "t1_01", s.id).ok, true);
  assert.equal(buyItem(state, "t1_09", s.id, { source: "market" }).ok, true, "黑市可買");
  s.stats.sanity = 50;
  assert.equal(buyItem(state, "t1_28", s.id).ok, true, "鎮定劑常駐");
});

test("出征耗材：進緩衝區（上限 3）、出發時合成單場 buff、回家清空；個人爆發戰力 +15%、戰後傷勢 +1", () => {
  const state = setup(1);
  const [s] = state.samsarites;
  s.stats.power = 3000;
  assert.equal(buyItem(state, "t1_32", s.id, { source: "market" }).ok, true);
  assert.equal(buyItem(state, "t1_32", s.id, { source: "market" }).ok, false, "同效果不疊加：再買一份等於白買（#19）");
  assert.equal(buyItem(state, "t1_37", s.id, { source: "market" }).ok, true);
  s.consumables.push("t1_32"); // 直接塞到上限，測試囤滿
  assert.equal(s.consumables.length, CONFIG.shop.consumableCap);
  assert.equal(buyItem(state, "t1_37", s.id, { source: "market" }).ok, false, "囤滿了");
  assert.equal(s.consumables.length, 3);
  s.consumables = ["t1_37"];
  const base = effectivePower(s);
  assert.equal(startRun(state, "ghost_village", [s.id]).ok, true);
  assert.deepEqual(s.consumables, []);
  assert.equal(s.runBuff.powerPct, 0.15);
  assert.equal(effectivePower(s), Math.round(3000 * 1.15));
  assert.ok(effectivePower(s) > base);
  assert.equal(buyItem(state, "t1_32", s.id, { source: "market" }).ok, false, "副本中不能買");
  let guard = 0;
  while (state.runs.length && guard++ < 100) step(state);
  const back = state.samsarites.find((x) => x.id === s.id);
  if (back) {
    assert.equal(back.runBuff, null);
    assert.ok(back.injury >= 1, "燃血類耗材：戰後傷勢 +1");
    assert.equal(effectivePower(back) <= Math.round(3000 * 1.0) + 1, true);
  }
});

test("即用耗材：傷藥降傷勢、沒受傷不能買；鎮定劑加理智、理智滿不能買", () => {
  const state = setup(1);
  const [s] = state.samsarites;
  assert.equal(checkBuy(state, getShopItem("t1_27"), s).ok, false, "沒受傷");
  s.injury = 2;
  assert.equal(buyItem(state, "t1_27", s.id).ok, true);
  assert.equal(s.injury, 1, "傷勢 -1");
  assert.equal(buyItem(state, "t1_29", s.id).ok, true);
  assert.equal(s.injury, 0, "急救針 -2 至痊癒");
  assert.equal(checkBuy(state, getShopItem("t1_28"), s).ok, false, "理智滿了");
  s.stats.sanity = 40;
  buyItem(state, "t1_28", s.id);
  assert.equal(s.stats.sanity, 60);
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
  assert.equal(state.squad.captainId, null);
  assert.equal(state.squad.style, null);
  assert.equal(state.squad.communalFund, 0);
  assert.equal(state.samsarites[0].customProfile, null);
  const old = JSON.parse(serialize(state));
  delete old.squad;
  delete old.samsarites[0].customProfile;
  const loaded = deserialize(JSON.stringify(old));
  assert.equal(loaded.squad.captainId, null);
  assert.equal(loaded.squad.style, null);
  assert.equal(loaded.squad.communalFund, 0);
  assert.equal(loaded.samsarites[0].customProfile, null);
});
