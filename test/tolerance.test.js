// 常駐藥抗藥性：同一人、同一類藥、滾動 7 天，用越多效果越差（換高階藥也繞不過去）
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/data/config.js";
import { createNewGame, createSamsarite, setInjury } from "../src/engine/core.js";
import { buyItem, doseMult, recentDoses } from "../src/engine/shop.js";
import { buyStock, useStock, useStockMany } from "../src/engine/inventory.js";

function setup(n = 1) {
  const state = createNewGame(21);
  state.points = 1e7;
  state.spaceLevel = 5;
  state.chapterClearDay = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 };
  state.samsarites = [];
  for (let i = 0; i < n; i++) { const s = createSamsarite(state, "C"); s.tags = []; state.samsarites.push(s); }
  return state;
}
const day = (state, d) => { state.tick = (d - 1) * CONFIG.ticksPerDay; };

test("理智藥：第 1～4 次效果 100%／50%／25%／10%", () => {
  const state = setup();
  const [s] = state.samsarites;
  const gains = [];
  for (let i = 0; i < 4; i++) {
    s.stats.sanity = 0;
    assert.equal(buyItem(state, "t2_28", s.id).ok, true); // 寧神香丸 +30
    gains.push(s.stats.sanity);
  }
  assert.deepEqual(gains, [30, 15, 8, 3]);
});

test("治傷藥：全癒藥視為最多 3 級再打折；換高階藥算同一類", () => {
  const state = setup();
  const [s] = state.samsarites;
  setInjury(s, 3);
  assert.equal(buyItem(state, "t1_27", s.id).ok, true); // 第 1 次：降 1 級 → 2
  assert.equal(s.injury, 2);
  assert.equal(buyItem(state, "t4_27", s.id).ok, true); // 鳳血聖藥（全癒）第 2 次：3 級 × 50% = 2 級（四捨五入）
  assert.equal(s.injury, 0);
  setInjury(s, 3);
  assert.equal(buyItem(state, "t4_27", s.id).ok, true); // 第 3 次：3 × 25% ≈ 1
  assert.equal(s.injury, 2);
  assert.equal(recentDoses(state, s, "heal"), 3);
});

test("治傷與理智各算各的", () => {
  const state = setup();
  const [s] = state.samsarites;
  setInjury(s, 1);
  s.stats.sanity = 10;
  buyItem(state, "t1_27", s.id);
  assert.equal(doseMult(state, s, "heal"), 0.5);
  assert.equal(doseMult(state, s, "sanity"), 1);
});

test("滾動 7 天：過了窗口就恢復；沒效果可套用（理智已滿）不累計", () => {
  const state = setup();
  const [s] = state.samsarites;
  s.stats.sanity = 0;
  buyItem(state, "t1_28", s.id);
  assert.equal(recentDoses(state, s, "sanity"), 1);
  day(state, 1 + CONFIG.shop.tolerance.days - 1);
  assert.equal(recentDoses(state, s, "sanity"), 1, "第 7 天內仍算");
  day(state, 1 + CONFIG.shop.tolerance.days);
  assert.equal(recentDoses(state, s, "sanity"), 0);
  assert.equal(doseMult(state, s, "sanity"), 1);
  s.stats.sanity = 100;
  const n = recentDoses(state, s, "sanity");
  assert.equal(buyItem(state, "t1_28", s.id).ok, false, "理智已滿不能用");
  assert.equal(recentDoses(state, s, "sanity"), n);
});

test("黑市耗材不受抗藥性影響（只管常駐商店的藥）", () => {
  const state = setup();
  const [s] = state.samsarites;
  for (let i = 0; i < 3; i++) {
    s.stats.sanity = 0;
    assert.equal(buyItem(state, "t3_26", s.id, { source: "market" }).ok !== undefined, true);
  }
  assert.equal(recentDoses(state, s, "sanity"), 0);
});

test("倉庫：一鍵批量使用跳過抗藥性太強的人；手動仍可用", () => {
  const state = setup(2);
  const [a, b] = state.samsarites;
  a.stats.sanity = 0;
  b.stats.sanity = 0;
  buyStock(state, "t1_28", 10);
  assert.equal(useStock(state, "t1_28", a.id).ok, true); // a 已用 1 次 → 下一次 50%（剛好是門檻，仍會批量用）
  assert.equal(useStock(state, "t1_28", a.id).ok, true); // a 已用 2 次 → 25%
  a.stats.sanity = 0;
  const r = useStockMany(state, "t1_28");
  assert.deepEqual(r.fed, [b.name], "只餵 b，a 抗藥性太強被跳過");
  assert.equal(useStock(state, "t1_28", a.id).ok, true, "手動不擋");
});

test("設定：倍率表遞減、minBuyMult 在 0～1", () => {
  const T = CONFIG.shop.tolerance;
  for (let i = 1; i < T.mult.length; i++) assert.ok(T.mult[i] < T.mult[i - 1]);
  assert.ok(T.minBuyMult > 0 && T.minBuyMult <= 1);
});
