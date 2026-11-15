// 批量回收與一鍵餵藥（試玩回饋）
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/data/config.js";
import { createNewGame, createSamsarite, recycleMany, recycleBlock } from "../src/engine/core.js";
import { useStockMany } from "../src/engine/inventory.js";

function setup(n) {
  const state = createNewGame(11);
  state.samsarites = [];
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, "C");
    state.samsarites.push(s);
  }
  return state;
}

test("批量回收：返還積分加總、剩下的人理智照舊累加扣除", () => {
  const state = setup(6);
  const [a, b, c] = state.samsarites;
  const before = state.points;
  const r = recycleMany(state, [a.id, b.id, c.id]);
  assert.equal(r.done.length, 3);
  assert.equal(state.samsarites.length, 3);
  assert.equal(state.points, before + r.refund);
  for (const s of state.samsarites) assert.equal(s.stats.sanity, 100 - 3 * CONFIG.recycle.sanityLoss);
});

test("批量回收：隊長、綁定神裝者、不在空間者會被跳過", () => {
  const state = setup(5);
  const [cap, bound, away, ok] = state.samsarites;
  state.squad.captainId = cap.id;
  bound.soulbound = { weapon: true };
  away.location = "run";
  assert.ok(recycleBlock(state, cap) && recycleBlock(state, bound) && recycleBlock(state, away));
  assert.equal(recycleBlock(state, ok), null);
  const r = recycleMany(state, [cap.id, bound.id, away.id, ok.id]);
  assert.equal(r.done.length, 1);
  assert.equal(r.skipped.length, 3);
  assert.equal(state.samsarites.length, 4);
});

test("一鍵餵藥：只餵有需求的人，用完為止", () => {
  const state = setup(4);
  const id = "t1_28"; // 鎮定劑（理智 +20）
  state.inventory = { [id]: 2 };
  for (const s of state.samsarites) s.stats.sanity = 100;
  state.samsarites[0].stats.sanity = 40;
  state.samsarites[1].stats.sanity = 30;
  state.samsarites[2].stats.sanity = 50;
  const r = useStockMany(state, id);
  assert.equal(r.fed.length, 2, "庫存 2 份，只餵最缺理智的 2 人");
  assert.equal(r.left, 0);
  assert.equal(state.samsarites[1].stats.sanity, 50, "理智最低的先餵");
  assert.equal(state.samsarites[0].stats.sanity, 60);
  assert.equal(state.samsarites[2].stats.sanity, 50, "第 3 人沒分到");
  assert.equal(state.samsarites[3].stats.sanity, 100, "不缺理智的不浪費");
});
