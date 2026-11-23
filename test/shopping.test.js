// Phase 4-D-3：輪迴者自主逛街與成長 AI
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/data/config.js";
import { getShopItem } from "../src/data/shopItems.js";
import { createNewGame, createSamsarite, setInjury } from "../src/engine/core.js";
import { dailyShopping, isDramaProne, reservePctOf } from "../src/engine/shopping.js";
import { marketOf } from "../src/engine/market.js";
import { buyItem } from "../src/engine/shop.js";
import { getRel } from "../src/engine/relations.js";
import { setSpentTier } from "./helpers/tier.js";

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
  buyItem(state, "t1_01", s.id); // 賞賜 + 綁定
  setSpentTier(state, 4000); // Tier 3
  s.wallet = 100000;
  clearMarket(state);
  dailyShopping(state);
  assert.equal(s.gear.weapon, "t1_01", "綁定武器還在");
  assert.ok(s.gear.armor, "改買了防具");
});

test("自主強化：私房錢夠且花完仍留 20% → 強化；不夠 80% 就不買", () => {
  const state = setup(1);
  const [s] = state.samsarites;
  s.gear = { weapon: "weapon_myth", armor: "armor_myth", accessory: "t5_05", bloodline: "t5_07" }; // 裝備齊全、階層夠，才輪到強化
  setSpentTier(state, 50000);
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
  s.gear = { weapon: "weapon_myth", armor: "armor_myth", accessory: "t5_05", bloodline: "t5_07" };
  setSpentTier(state, 50000);
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
  s.gear = { weapon: "weapon_myth", armor: "armor_myth", accessory: "t5_05", bloodline: "t5_07" };
  s.enhanceCount = CONFIG.gene.tiers[0].enhanceCap; // 強化已點滿、突破條件不成立（空間 Lv.1）
  setSpentTier(state, 50);
  s.wallet = 1000;
  const pts = state.points;
  const before = marketOf(state).slots.filter((x) => x.sold).length;
  dailyShopping(state);
  assert.equal(state.points, pts, "公庫不動");
  assert.ok(marketOf(state).slots.filter((x) => x.sold).length > before || s.wallet === 1000, "買了就會有格子售罄");
});

test("搞事：愛搞事的人有 5% 機率偷買黑貨對隊友使用（用獨立亂數流）", () => {
  let dramas = 0;
  const trials = 1500;
  const mainRngs = new Set();
  for (let seed = 1; seed <= trials; seed++) {
    const state = setup(2, seed);
    const [a, b] = state.samsarites;
    a.tags = ["green_tea"];
    a.gear = { weapon: "weapon_myth", armor: "armor_myth", accessory: "t5_05", bloodline: "t5_07" };
    a.enhanceCount = CONFIG.gene.tiers[0].enhanceCap;
    a.wallet = 100000;
    setSpentTier(state, 50);
    // 黑市最後一格換成黑貨耗材：贖罪苦酒（化解隊內仇恨），方便驗證
    const slot = marketOf(state).slots[7];
    slot.itemId = "t1_40";
    slot.sold = false;
    const main = state.rngState;
    dailyShopping(state);
    mainRngs.add(state.rngState === main);
    if (slot.sold) {
      dramas++;
      assert.ok(a.shopLog.some((l) => l.text.includes("贖罪苦酒")));
    }
  }
  assert.deepEqual([...mainRngs], [true], "不動主亂數");
  assert.ok(dramas / trials > 0.03 && dramas / trials < 0.08, `搞事比例約 5%（實際 ${(dramas / trials).toFixed(3)}）`);
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

test("搞事冷卻：買過黑貨後 10 天內不再偷買，第 10 天後恢復", () => {
  const saved = CONFIG.shopping.dramaChance;
  CONFIG.shopping.dramaChance = 1;
  try {
    const state = setup(2, 9);
    const [a] = state.samsarites;
    a.tags = ["green_tea"];
    a.gear = { weapon: "weapon_myth", armor: "armor_myth", accessory: "t5_05", bloodline: "t5_07" };
    a.enhanceCount = CONFIG.gene.tiers[0].enhanceCap;
    a.wallet = 100000;
    setSpentTier(state, 50);
    const put = () => Object.assign(marketOf(state).slots[7], { itemId: "t1_40", sold: false });
    put();
    dailyShopping(state);
    assert.equal(marketOf(state).slots[7].sold, true, "第一次必買（機率 1）");
    assert.equal(a.lastDramaDay, 1);
    put();
    state.tick = CONFIG.ticksPerDay * 5; // 第 6 天：冷卻中
    dailyShopping(state);
    assert.equal(marketOf(state).slots[7].sold, false, "冷卻中不買");
    state.tick = CONFIG.ticksPerDay * 10; // 第 11 天：滿 10 天
    dailyShopping(state);
    assert.equal(marketOf(state).slots[7].sold, true, "冷卻結束可再買");
  } finally {
    CONFIG.shopping.dramaChance = saved;
  }
});

// ───────── 個性掛鉤 v1b ②：利他者代付、利己者囤錢偏黑貨 ─────────
const withTraits = (s, altruism) => (s.traits = { altruism, ambition: 0, courage: 0, social: 0, obedience: 0 });
const aidSetup = () => {
  const state = setup(2, 11);
  clearMarket(state);
  const [a, b] = state.samsarites;
  withTraits(a, 80);
  withTraits(b, 0);
  a.wallet = 2000;
  b.wallet = 0;
  setInjury(b, 2);
  return { state, a, b };
};

test("個性：沒有個性特徵（或功能關閉）時，逛街結果與亂數流完全不變", () => {
  const run = (mutate) => {
    const state = setup(3, 21);
    state.samsarites.forEach((s, i) => {
      s.wallet = 800 + i * 300;
      withTraits(s, 0);
    });
    mutate?.(state);
    for (let d = 0; d < 5; d++) dailyShopping(state);
    return JSON.stringify([state.aiShopRngState, state.samsarites.map((s) => [s.wallet, s.shopLog])]);
  };
  const base = run();
  // 關閉個性功能，即使分數極端也與「沒有個性」逐項相同
  CONFIG.shopping.trait.enabled = false;
  try {
    const off = (() => {
      const state = setup(3, 21);
      state.samsarites.forEach((s, i) => {
        s.wallet = 800 + i * 300;
        withTraits(s, i === 0 ? 90 : -90);
      });
      for (let d = 0; d < 5; d++) dailyShopping(state);
      return JSON.stringify([state.aiShopRngState, state.samsarites.map((s) => [s.wallet, s.shopLog])]);
    })();
    assert.equal(off, base);
  } finally {
    CONFIG.shopping.trait.enabled = true;
  }
});

test("利他者代付：重傷同伴買不起藥 → 轉帳讓他買藥，記冷卻與日誌", () => {
  const { state, a, b } = aidSetup();
  const before = state.aiShopRngState;
  assert.ok(dailyShopping(state) >= 1);
  assert.ok(b.injury < 2, "同伴傷勢下降");
  assert.ok(a.wallet < 2000, "利他者掏了錢");
  assert.notEqual(a.lastAidDay, undefined, "有記冷卻日");
  assert.ok(a.shopLog.some((l) => /代付醫藥費（-(\d+)）/.test(l.text)), "利他者有日誌");
  const gift = Number(a.shopLog.find((l) => /代付醫藥費/.test(l.text)).text.match(/-(\d+)/)[1]);
  assert.ok(gift > 0 && gift <= Math.floor(2000 * CONFIG.shopping.trait.aid.giftPctMax), "不超過私房錢 30%");
  assert.ok(b.shopLog.some((l) => /接濟/.test(l.text)), "同伴有日誌");
  assert.equal(b.wallet, 0, "轉進去的錢全拿去買藥");
  void before;
});

test("利他者代付：不觸發的情境", () => {
  const A = CONFIG.shopping.trait.aid;
  const cases = {
    利他度不夠: ({ a }) => withTraits(a, 20),
    自己理智低於門檻: () => (A.minSanity = 101),
    自己重傷且自己也買不到藥: ({ a }) => {
      setInjury(a, 2);
      a.dosage = { heal: [0, 0, 0, 0], sanity: [] }; // 抗藥性太強，自己的急救不會動
    },
    同伴只是輕傷: ({ b }) => setInjury(b, 1),
    同伴買得起: ({ b }) => (b.wallet = 1000),
    功能關閉: () => (CONFIG.shopping.trait.enabled = false),
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const ctx = aidSetup();
    const savedSan = A.minSanity;
    try {
      mutate(ctx);
      dailyShopping(ctx.state);
      assert.equal(ctx.a.lastAidDay, undefined, `${name}：不應代付`);
      assert.ok(!ctx.a.shopLog?.some((l) => /代付/.test(l.text)), `${name}：沒有代付日誌`);
    } finally {
      CONFIG.shopping.trait.enabled = true;
      A.minSanity = savedSan;
    }
  }
});

test("利他者代付：冷卻內不再代付，冷卻過後恢復", () => {
  const { state, a, b } = aidSetup();
  dailyShopping(state);
  const first = a.lastAidDay;
  assert.notEqual(first, undefined);
  a.wallet = 2000;
  b.wallet = 0;
  setInjury(b, 2);
  dailyShopping(state); // 同一天：冷卻中
  assert.equal(a.lastAidDay, first);
  assert.equal(b.injury, 2);
  a.lastAidDay = first - CONFIG.shopping.trait.aid.cooldownDays; // 冷卻剛好過了
  dailyShopping(state);
  assert.equal(a.lastAidDay, first, "冷卻過後恢復代付");
  assert.ok(b.injury < 2);
});

test("利他者代付：同伴因抗藥性不會買 → 根本不轉帳", () => {
  const { state, a, b } = aidSetup();
  const d = state.tick; // 任何當天紀錄都在滾動 7 天內
  void d;
  b.dosage = { heal: [0, 0, 0, 0], sanity: [] };
  dailyShopping(state);
  assert.equal(a.lastAidDay, undefined);
  assert.equal(b.wallet, 0);
  assert.equal(b.injury, 2);
});

test("利己者：備用金多留 15%；利他度不到門檻或利他者不受影響；強化臨界值改變", () => {
  const T = CONFIG.shopping.trait;
  const state = setup(1, 31);
  const [s] = state.samsarites;
  withTraits(s, -80);
  assert.ok(Math.abs(reservePctOf(s) - (CONFIG.shopping.reservePct + T.hoard.extraReservePct)) < 1e-9);
  withTraits(s, -20);
  assert.equal(reservePctOf(s), CONFIG.shopping.reservePct);
  withTraits(s, 80);
  assert.equal(reservePctOf(s), CONFIG.shopping.reservePct, "利他者備用金不變");
  // 臨界：第 1 次強化 80 分 = 私房錢 × 0.7 → 一般人（留 20%）買得起，利己者（留 35%）買不起
  const s2 = setup(2, 32);
  clearMarket(s2);
  setSpentTier(s2, 50000);
  const [normal, selfish] = s2.samsarites;
  for (const x of [normal, selfish]) x.gear = { weapon: "weapon_myth", armor: "armor_myth", accessory: "t5_05", bloodline: "t5_07" };
  withTraits(normal, 0);
  withTraits(selfish, -80);
  normal.wallet = selfish.wallet = Math.ceil(80 / 0.7);
  dailyShopping(s2);
  assert.equal(normal.enhanceCount, 1, "一般人自費強化");
  assert.equal(selfish.enhanceCount, 0, "利己者備用金較高，強化費太貴就不買");
});

test("利己者偏愛黑貨：黑市權重 ×3，但抽樣次數（亂數流推進）與一般人相同", () => {
  const run = (altruism) => {
    const state = setup(1, 41);
    const [s] = state.samsarites;
    s.gear = { weapon: "weapon_myth", armor: "armor_myth", accessory: "t5_05", bloodline: "t5_07" };
    setSpentTier(state, 50000);
    withTraits(s, altruism);
    s.wallet = 100000;
    const before = state.aiShopRngState;
    dailyShopping(state);
    return { moved: state.aiShopRngState !== before, bought: s.shopLog?.length ?? 0 };
  };
  const a = run(0);
  const b = run(-80);
  assert.equal(a.moved, b.moved, "權重改變不影響抽樣次數");
});
