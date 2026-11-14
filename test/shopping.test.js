// Phase 4-D-3：輪迴者自主逛街與成長 AI
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/data/config.js";
import { getShopItem } from "../src/data/shopItems.js";
import { createNewGame, createSamsarite, setInjury } from "../src/engine/core.js";
import { dailyShopping, isDramaProne } from "../src/engine/shopping.js";
import { marketOf } from "../src/engine/market.js";
import { buyItem } from "../src/engine/shop.js";
import { getRel } from "../src/engine/relations.js";

function setup(n = 1, seed = 6) {
  const state = createNewGame(seed);
  state.samsarites = [];
  state.points = 100000;
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, "A");
    s.tags = [];
    state.samsarites.push(s);
  }
  return state;
}
const clearMarket = (state) => marketOf(state).slots.forEach((s) => (s.sold = true));

test("條件：私房錢 > 0、在空間、沒被鎖休眠艙才逛街；沒錢／在副本不動", () => {
  const state = setup(3);
  const [a, b, c] = state.samsarites;
  a.wallet = 0;
  b.wallet = 500;
  b.location = "dungeon";
  c.wallet = 500;
  c.podLockDays = 2;
  c.lockedInPodBy = 0;
  const rng = state.aiShopRngState;
  assert.equal(dailyShopping(state), 0);
  assert.equal(state.aiShopRngState, rng, "沒人符合就不消耗亂數");
  assert.equal(b.wallet, 500);
  assert.equal(c.wallet, 500);
});

test("緊急保命：重傷買治傷耗材、理智 < 45 買回理智耗材（優先於換裝與強化）", () => {
  const state = setup(1);
  const [s] = state.samsarites;
  s.wallet = 1000;
  setInjury(s, 2);
  s.stats.sanity = 100;
  assert.equal(dailyShopping(state) >= 1, true);
  assert.ok(s.injury < 2, "傷勢下降");
  assert.equal(s.gear.weapon === undefined || s.shopLog.length >= 1, true);
  const state2 = setup(1);
  const [t] = state2.samsarites;
  t.wallet = 1000;
  t.stats.sanity = 30;
  dailyShopping(state2);
  assert.ok(t.stats.sanity > 30, "理智回升");
  assert.match(t.shopLog[0].text, /鎮定劑|鎮靜劑/);
});

test("基礎換裝：缺武器防具就用私房錢買（不綁定），一天最多 2 次動作", () => {
  const state = setup(1);
  const [s] = state.samsarites;
  s.wallet = 100000;
  clearMarket(state);
  dailyShopping(state);
  assert.ok(s.gear.weapon && s.gear.armor, "武器與防具都買了");
  assert.equal(s.soulbound.weapon, undefined);
  assert.ok(s.wallet < 100000);
  const n = s.shopLog.length;
  assert.ok(n <= CONFIG.shopping.maxActionsPerDay, `一天最多 ${CONFIG.shopping.maxActionsPerDay} 次（實際 ${n}）`);
});

test("絕不覆蓋綁定裝備：公庫賞賜的武器不會被自己換掉，改買另一格", () => {
  const state = setup(1);
  const [s] = state.samsarites;
  buyItem(state, "weapon_club", s.id); // 賞賜 + 綁定
  state.totalSpent = 4000; // Tier 3
  s.wallet = 100000;
  clearMarket(state);
  dailyShopping(state);
  assert.equal(s.gear.weapon, "weapon_club", "綁定武器還在");
  assert.ok(s.gear.armor, "改買了防具");
});

test("自主強化：私房錢夠且花完仍留 20% → 強化；不夠 80% 就不買", () => {
  const state = setup(1);
  const [s] = state.samsarites;
  s.gear = { weapon: "weapon_myth", armor: "armor_myth" }; // 裝備齊全、階層夠，才輪到強化
  state.totalSpent = 50000;
  clearMarket(state);
  s.wallet = 90; // 第 1 次強化 80 分，但 80 > 90 × 0.8 = 72
  dailyShopping(state);
  assert.equal(s.enhanceCount, 0);
  s.wallet = 100; // 80 <= 100 × 0.8
  dailyShopping(state);
  assert.equal(s.enhanceCount, 1);
  assert.equal(s.wallet, 20);
});

test("自主開基因鎖：點滿當階強化、空間等級夠、私房錢夠 → 突破", () => {
  const state = setup(1);
  const [s] = state.samsarites;
  s.gear = { weapon: "weapon_myth", armor: "armor_myth" };
  state.totalSpent = 50000;
  state.spaceLevel = 2;
  clearMarket(state);
  s.enhanceCount = CONFIG.gene.tiers[0].enhanceCap;
  s.wallet = 1000;
  dailyShopping(state);
  assert.equal(s.geneLock, 1);
  assert.ok(s.wallet <= 700, "突破花了 300（同一天第 2 個動作可能接著強化）");
});

test("性格偏好：有閒錢會搶購黑市未售罄商品（不碰公庫）", () => {
  const state = setup(1);
  const [s] = state.samsarites;
  s.gear = { weapon: "weapon_myth", armor: "armor_myth" };
  s.enhanceCount = CONFIG.gene.tiers[0].enhanceCap; // 強化已點滿、突破條件不成立（空間 Lv.1）
  state.totalSpent = 50;
  s.wallet = 1000;
  const pts = state.points;
  const before = marketOf(state).slots.filter((x) => x.sold).length;
  dailyShopping(state);
  assert.equal(state.points, pts, "公庫不動");
  assert.ok(marketOf(state).slots.filter((x) => x.sold).length > before || s.wallet === 1000, "買了就會有格子售罄");
});

test("搞事：愛搞事的人有 15% 機率偷買黑貨對隊友使用（用獨立亂數流）", () => {
  let dramas = 0;
  const trials = 400;
  const mainRngs = new Set();
  for (let seed = 1; seed <= trials; seed++) {
    const state = setup(2, seed);
    const [a, b] = state.samsarites;
    a.tags = ["green_tea"];
    a.gear = { weapon: "weapon_myth", armor: "armor_myth" };
    a.enhanceCount = CONFIG.gene.tiers[0].enhanceCap;
    a.wallet = 100000;
    state.totalSpent = 50;
    // 黑市最後一格換成黑貨：迷魂香，方便驗證
    const slot = marketOf(state).slots[7];
    slot.itemId = "contra_love_t1";
    slot.sold = false;
    const main = state.rngState;
    dailyShopping(state);
    mainRngs.add(state.rngState === main);
    if (slot.sold) {
      dramas++;
      assert.equal(getRel(state, b, a).love, 15, "對隊友下了迷魂香");
    }
  }
  assert.deepEqual([...mainRngs], [true], "不動主亂數");
  assert.ok(dramas / trials > 0.08 && dramas / trials < 0.25, `搞事比例約 15%（實際 ${(dramas / trials).toFixed(3)}）`);
});

test("非愛搞事的人不會偷買黑貨；isDramaProne 判斷", () => {
  const state = setup(2);
  const [a, b] = state.samsarites;
  assert.equal(isDramaProne(state, a), false);
  a.stats.sanity = 30;
  assert.equal(isDramaProne(state, a), true);
  a.stats.sanity = 100;
  a.tags = ["backstabber"];
  assert.equal(isDramaProne(state, a), true);
  a.tags = [];
  state.relations[`${a.id}>${b.id}`] = { love: 85, hate: 0 };
  assert.equal(isDramaProne(state, a), true, "愛慕對象在空間 = 偏執");
  void getShopItem;
});

test("可重現：同一個種子逛兩次結果一樣", () => {
  const run = () => {
    const state = setup(3, 11);
    for (const s of state.samsarites) s.wallet = 3000;
    for (let i = 0; i < 5; i++) dailyShopping(state);
    return JSON.stringify(state.samsarites.map((s) => [s.wallet, s.gear, s.enhanceCount, s.shopLog.length]));
  };
  assert.equal(run(), run());
});
