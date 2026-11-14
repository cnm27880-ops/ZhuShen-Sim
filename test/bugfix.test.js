// Bug 修復清單（2026-11-14）的回歸測試：每個 Bug 一組，依編號累積
import test from "node:test";
import assert from "node:assert/strict";

import { chanceDisplay } from "../src/engine/dungeon.js";

test("問題 6：通關率顯示最高 99%，並附失敗機率", () => {
  assert.deepEqual(chanceDisplay(0.9), { pct: 90, failPct: 10 });
  assert.deepEqual(chanceDisplay(0.9996), { pct: 99, failPct: 1 }, "99.96% 不能顯示成 100%");
  assert.deepEqual(chanceDisplay(1), { pct: 99, failPct: 1 });
  assert.deepEqual(chanceDisplay(0), { pct: 0, failPct: 100 });
  assert.equal(chanceDisplay(0.756).pct, 75, "向下取整，不樂觀進位");
});

// ───────── 共用輔助 ─────────
import { CONFIG } from "../src/data/config.js";
import { createNewGame, createSamsarite, currentDay } from "../src/engine/core.js";
import { addHate, areEnemies, softenHate, pairStatus } from "../src/engine/relations.js";
import { dailyNursery, podBabies, hatch } from "../src/engine/children.js";
import { popLimit } from "../src/engine/mandatory.js";
import { planAutoDispatch } from "../src/engine/dispatch.js";

function setup(n, seed = 7, rank = "C") {
  const state = createNewGame(seed);
  state.samsarites = [];
  const people = [];
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, rank);
    s.tags = [];
    state.samsarites.push(s);
    people.push(s);
  }
  return { state, people };
}

test("#8：突襲任務目標在休眠艙時，自動派遣不會規劃含他的隊伍", () => {
  const { state, people } = setup(4, 31, "S");
  for (const s of people) s.stats.power = 42;
  state.autoStrategy = "off";
  const target = people[3];
  state.god.mission = { samsariteId: target.id, dungeonId: "ghost_village", deadlineDay: 8, reward: 200 };
  target.podLockDays = 3;
  const plan = planAutoDispatch(state);
  assert.ok(!plan || !plan.party.some((s) => s.id === target.id), "休眠艙的人不該被排進隊伍");
});

test("#13：用耗材把仇恨降到死敵門檻以下，死敵狀態與復仇標記一併解除", () => {
  const { state, people: [a, b] } = setup(2);
  addHate(state, a, b, 100);
  addHate(state, b, a, 100);
  for (const k of [`${a.id}>${b.id}`, `${b.id}>${a.id}`]) {
    state.relations[k].status = "nemesis";
    state.relations[k].revenge = true;
  }
  assert.ok(areEnemies(state, a, b));
  softenHate(state, a, b, { reduce: 30 });
  assert.ok(areEnemies(state, a, b), "對方還恨著，死敵不解除");
  softenHate(state, b, a, { reduce: 30 });
  assert.ok(!areEnemies(state, a, b), "雙方都降到門檻以下：死敵解除");
  assert.equal(state.relations[`${a.id}>${b.id}`].revenge, false);
  assert.equal(pairStatus(state, a, b), undefined);
});

test("#14：空間人數已達上限，戀人不再生小孩", () => {
  const { state, people } = setup(popLimit(createNewGame(7)) , 8);
  const [a, b] = people;
  for (const k of [`${a.id}>${b.id}`, `${b.id}>${a.id}`]) state.relations[k] = { love: 80, hate: 0, status: "lover" };
  const saved = CONFIG.child.chance.lover;
  CONFIG.child.chance.lover = 1;
  try {
    for (let i = 0; i < 5; i++) dailyNursery(state);
    assert.equal(podBabies(state).length, 0, "人口已滿不該懷孕");
    state.samsarites.pop(); // 空出 1 格（不是 a、b）
    dailyNursery(state);
    assert.equal(podBabies(state).length, 1, "有空位就能生");
  } finally {
    CONFIG.child.chance.lover = saved;
  }
});

test("#23：催熟完成但人口已滿，嬰兒暫留艙內，有空位後才出艙", () => {
  const { state, people } = setup(popLimit(createNewGame(7)), 9);
  const baby = createSamsarite(state, "C");
  baby.tags = [];
  baby.location = "pod";
  baby.podDaysLeft = 1;
  state.samsarites.push(baby);
  dailyNursery(state);
  assert.equal(baby.location, "pod", "人口滿了，留在艙內");
  assert.equal(baby.podDaysLeft, 0);
  state.samsarites.splice(state.samsarites.indexOf(people[0]), 1);
  dailyNursery(state);
  assert.equal(baby.location, "space", "有空位就出艙");
  assert.ok(typeof hatch === "function" && currentDay(state) >= 1);
});

import { buyItem, checkBuy } from "../src/engine/shop.js";
import { SHOP_ITEMS as SHOP_ITEMS_SYNC, getShopItem } from "../src/data/shopItems.js";
import { upgradeFacility } from "../src/engine/facilities.js";
import { shopTier, serialize, deserialize } from "../src/engine/core.js";

function shopState(n = 3) {
  const { state, people } = setup(n, 21);
  state.points = 100000;
  return { state, people };
}

test("#7：黑貨轉嫁對象照玩家選的人；沒選或選錯才隨機", () => {
  const { state, people: [a, b, c] } = shopState(3);
  state.totalSpent = 99999; // 解鎖高階
  const madness = SHOP_ITEMS_SYNC.find((i) => i.effect?.transferMadness);
  assert.ok(madness, "找得到奪舍禁符");
  state.samsarites.forEach((s) => (s.stats.sanity = 100));
  const r = buyItem(state, madness.id, a.id, { source: "market", victimId: c.id });
  assert.equal(r.ok, true);
  assert.ok(c.stats.sanity < 100, "被選中的人受害");
  assert.equal(b.stats.sanity, 100, "沒被選的人沒事");
});

test("#17：被鎖進休眠艙的人，手動商店不能幫他買東西", () => {
  const { state, people: [a] } = shopState(1);
  a.podLockDays = 5;
  const gear = SHOP_ITEMS_SYNC.find((i) => i.tier === 1 && i.kind === "gear" && i.category === "standard");
  const r = checkBuy(state, gear, a, {});
  assert.equal(r.ok, false);
  assert.match(r.reason, /休眠艙/);
});

test("#18：低階破鎖丹不能蓋掉身上較高階的破鎖加成", () => {
  const { state, people: [a] } = shopState(1);
  state.totalSpent = 99999;
  a.geneBuff = { target: 4, costDiscount: 0.3 };
  const low = SHOP_ITEMS_SYNC.find((i) => i.effect?.geneLockTarget === 1);
  assert.ok(low);
  assert.equal(checkBuy(state, low, a, { source: "market" }).ok, false);
  assert.deepEqual(a.geneBuff, { target: 4, costDiscount: 0.3 }, "原本的 Buff 沒被動到");
});

test("#19：已囤同效果且不低於它的出征耗材，不能再買一份", () => {
  const { state, people: [a] } = shopState(1);
  assert.equal(buyItem(state, "t1_37", a.id, { source: "market" }).ok, true);
  const again = buyItem(state, "t1_37", a.id, { source: "market" });
  assert.equal(again.ok, false);
  assert.equal(a.consumables.length, 1);
});

test("#16：升級基建不計入商店階級，不會一次跳兩階", () => {
  const { state } = shopState(1);
  state.points = 1000000;
  const before = state.totalSpent;
  const r = upgradeFacility(state, "gravity");
  assert.equal(r.ok, true);
  assert.equal(state.totalSpent, before, "基建花費不算商店累積花費");
  assert.equal(shopTier(state), 1);
});

test("#39：付款失敗就不給貨（防禦性）", () => {
  const { state, people: [a] } = shopState(1);
  const item = SHOP_ITEMS_SYNC.find((i) => i.tier === 1 && i.kind === "gear" && i.category === "standard");
  state.points = -100000; // 已超過高利貸上限
  const r = buyItem(state, item.id, a.id, {});
  assert.equal(r.ok, false);
  assert.ok(!a.gear?.[item.slot]);
});

import { step } from "../src/engine/dispatch.js";
import { startRun, runRoomTotal } from "../src/engine/dungeon.js";
import { mandatoryR } from "../src/engine/mandatory.js";
import { killSamsarite } from "../src/engine/core.js";

test("#10：強制任務在日界線逾時，剛好此刻回家的隊員先被補派，不會直接被抹殺", () => {
  const { state, people } = setup(3, 41);
  state.autoStrategy = "off";
  state.settings.autoDispatch = true;
  state.spaceLevel = 2;
  state.mandatory.lastDay = 0;
  assert.equal(startRun(state, "ghost_village", people.map((s) => s.id)).ok, true);
  const total = runRoomTotal(state.runs[0]) * CONFIG.roomTicks;
  assert.equal(total, CONFIG.ticksPerDay, "這場副本剛好 1 天（結束在日界線）");
  state.mandatory.pending = { id: 1, createdDay: 1, deadlineDay: 2 }; // 第 2 天一開始就逾時
  for (let i = 0; i < total; i++) step(state);
  assert.equal(state.graveyard.length, 0, "沒有人被抹殺");
  assert.ok(state.runs.some((r) => r.mandatory), "剛回家的人被補派去強制任務");
});

test("#11：強制任務 R 在發布時快照，之後戰力變動、主力出征都不會改變它", () => {
  const { state, people } = setup(4, 42);
  state.mandatory.pending = { id: 1, createdDay: 1, deadlineDay: 9 };
  state.mandatory.pending.R = mandatoryR(state);
  const r0 = state.mandatory.pending.R;
  people[0].stats.power += 5000;
  assert.equal(mandatoryR(state), r0, "戰力變動不影響已發布任務的 R");
  delete state.mandatory.pending.R;
  assert.ok(mandatoryR(state) !== r0, "沒快照時才即時計算");
});

test("#24：人死掉後，別人身上指向他的生死搭檔欄位被清掉", () => {
  const { state, people: [a, b, c] } = setup(3, 43);
  a.bondPartnerId = b.id;
  b.bondPartnerId = a.id;
  killSamsarite(state, a, "測試", null);
  assert.equal(b.bondPartnerId, null);
  assert.ok(c.bondPartnerId == null);
});

import { setTaxRate } from "../src/engine/wallet.js";
import { findProtector, runSocial, socialWeight } from "../src/engine/relations.js";
import { SOCIAL_EVENTS } from "../src/data/relations.js";
import { refreshStaleSlots, marketOf } from "../src/engine/market.js";
import { buildRivalDungeon } from "../src/engine/rivals.js";
import { checkAccept } from "../src/engine/wishes.js";

test("#38：稅率傳入 NaN／非數字時不寫入，維持現行稅率", () => {
  const { state } = setup(1);
  setTaxRate(state, 0.5);
  for (const bad of [NaN, Infinity, undefined, "abc"]) assert.equal(setTaxRate(state, bad), 0.5);
  assert.equal(state.taxRate, 0.5);
});

test("#37：沒有待派洲際任務時 buildRivalDungeon 回 null、不拋錯", () => {
  const { state } = setup(1);
  assert.equal(buildRivalDungeon(state, []), null);
});

test("#35：舊存檔遷移時，已售罄的黑市格不會復活成新商品，鎖定保留", () => {
  const { state } = setup(1);
  const m = marketOf(state);
  m.slots[0] = { index: 0, itemId: "legacy_old_item", sold: true, locked: false };
  m.slots[1] = { index: 1, itemId: "legacy_old_item2", sold: false, locked: true };
  refreshStaleSlots(state);
  assert.equal(m.slots[0].sold, true);
  assert.equal(m.slots[0].itemId, null, "已售格不復活");
  assert.equal(m.slots[1].locked, true, "鎖定保留");
  assert.equal(m.slots[1].sold, false);
});

test("#25：擋刀每位守護者各擲一次，不是只看第一位", () => {
  const { state, people: [v, g1, g2] } = setup(3, 51);
  for (const g of [g1, g2]) {
    state.relations[`${g.id}>${v.id}`] = { love: 90, hate: 0 }; // 雙向好感 90 = 愛慕
    state.relations[`${v.id}>${g.id}`] = { love: 90, hate: 0 };
  }
  let secondGuardSaved = 0;
  for (let i = 0; i < 400; i++) {
    const p = findProtector(state, [v, g1, g2], v);
    if (p?.id === g2.id) secondGuardSaved += 1;
  }
  assert.ok(secondGuardSaved > 0, "第二位守護者也有機會出手");
});

test("#26：對方已有戀人時，告白事件權重為 0", () => {
  const { state, people: [a, b, c] } = setup(3, 52);
  const confess = SOCIAL_EVENTS.find((e) => e.special === "confess");
  assert.ok(confess);
  state.relations[`${a.id}>${b.id}`] = { love: 80, hate: 0 };
  state.relations[`${b.id}>${c.id}`] = { love: 80, hate: 0, status: "lover" };
  state.relations[`${c.id}>${b.id}`] = { love: 80, hate: 0, status: "lover" };
  assert.equal(socialWeight(state, confess, a, b), 0, "b 已有戀人 c");
  assert.ok(typeof runSocial === "function");
});

test("#27：休假許願要在主神空間才能答應", () => {
  const { state, people: [a] } = setup(1, 53);
  state.wishes = [{ id: 1, samsariteId: a.id, mode: "rest", status: "pending", params: { rest: 2 }, deadlineDay: 9 }];
  a.location = "dungeon";
  assert.equal(checkAccept(state, state.wishes[0]).ok, false);
  a.location = "space";
  assert.equal(checkAccept(state, state.wishes[0]).ok, true);
});

test("#30：連續建立兩局（即使同一毫秒）種子也不同", () => {
  const seeds = new Set();
  for (let i = 0; i < 50; i++) seeds.add(createNewGame().seed);
  assert.equal(seeds.size, 50);
});

import { applyAutoMode, currentAutoMode } from "../src/engine/autoMode.js";
import { AUTO_MODES, PAUSE_EVENTS } from "../src/data/config.js";

test("功能 4：三種自動模式套用後設定正確，偵測得回來；手動改開關變成自訂", () => {
  const { state } = setup(1, 61);
  applyAutoMode(state, "easy");
  assert.equal(state.settings.autoDispatch, true);
  assert.equal(state.autoStrategy, "balanced");
  const paused = Object.keys(PAUSE_EVENTS).filter((k) => state.settings.pauseOn[k]);
  assert.deepEqual(paused.sort(), ["death", "mandatory", "wish"], "省心模式只在死人／許願／強制任務暫停");
  assert.equal(currentAutoMode(state), "easy");

  applyAutoMode(state, "balanced");
  assert.equal(state.autoStrategy, "safe", "均衡模式用保守策略");
  for (const [k, def] of Object.entries(PAUSE_EVENTS)) assert.equal(!!state.settings.pauseOn[k], def.default, `${k} 重大事件才暫停`);
  assert.equal(currentAutoMode(state), "balanced");

  applyAutoMode(state, "control");
  assert.equal(state.settings.autoDispatch, false);
  assert.ok(Object.keys(PAUSE_EVENTS).every((k) => state.settings.pauseOn[k]), "掌控模式全部暫停");
  assert.equal(currentAutoMode(state), "control");

  state.settings.pauseOn.death = false; // 進階自訂改了一項
  assert.equal(currentAutoMode(state), "custom");
  assert.equal(applyAutoMode(state, "nope"), null);
  assert.equal(Object.keys(AUTO_MODES).length, 3);
});

import { buyStock, useStock, stockList, stockTargets, needOf, stockCount } from "../src/engine/inventory.js";

test("功能 1、2：批量買藥進倉庫、從倉庫選人使用，最缺理智的排最前面", () => {
  const { state, people: [a, b, c] } = setup(3, 71);
  state.points = 5000;
  a.stats.sanity = 90;
  b.stats.sanity = 20;
  c.stats.sanity = 60;
  const spentBefore = state.totalSpent;
  const r = buyStock(state, "t1_28", 10); // 鎮定劑 ×10
  assert.equal(r.ok, true);
  const price = getShopItem("t1_28").price;
  assert.equal(state.points, 5000 - price * 10);
  assert.equal(stockCount(state, "t1_28"), 10);
  assert.equal(state.totalSpent, spentBefore + price * 10, "常備藥計入商店階級");
  assert.deepEqual(stockList(state).map((x) => [x.item.id, x.count]), [["t1_28", 10]]);

  const order = stockTargets(state, "t1_28").map((t) => t.s.id);
  assert.deepEqual(order, [b.id, c.id, a.id], "理智最低的排最前面");
  const u = useStock(state, "t1_28", b.id);
  assert.equal(u.ok, true);
  assert.equal(b.stats.sanity, 40);
  assert.equal(stockCount(state, "t1_28"), 9);
  assert.ok(needOf(getShopItem("t1_28"), c) > needOf(getShopItem("t1_28"), a));
});

test("功能 1、2：不能囤的商品、錢不夠、數量不合法、用不到的人都會被擋", () => {
  const { state, people: [a] } = setup(1, 72);
  state.points = 50;
  assert.equal(buyStock(state, "t1_01", 1).ok, false, "裝備不進倉庫");
  assert.equal(buyStock(state, "t1_28", 0).ok, false);
  assert.equal(buyStock(state, "t1_28", 1000).ok, false);
  assert.equal(buyStock(state, "t1_28", 500).ok, false, "錢不夠");
  assert.equal(stockCount(state, "t1_28"), 0);
  assert.equal(useStock(state, "t1_28", a.id).ok, false, "倉庫沒貨");
  state.points = 5000;
  buyStock(state, "t1_28", 2);
  a.stats.sanity = 100;
  assert.equal(useStock(state, "t1_28", a.id).ok, false, "理智已滿用不到");
  assert.equal(stockCount(state, "t1_28"), 2, "沒用掉就不扣");
});

test("功能 2：舊存檔補 inventory 欄位", () => {
  const state = createNewGame(5);
  delete state.inventory;
  assert.deepEqual(deserialize(serialize(state)).inventory, {});
});
