// Phase 4-C-3：維持費改制、回收返還積分、絕境空投
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG, RANKS } from "../src/data/config.js";
import { createNewGame, createSamsarite, upkeepOf, upkeepPartsOf, setInjury, recycle, endOfDay, dailyAirdrop, serialize, deserialize } from "../src/engine/core.js";

function setup(n, rank = "C", points = 1000, seed = 5) {
  const state = createNewGame(seed);
  state.samsarites = [];
  state.points = points;
  const people = [];
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, rank);
    s.tags = [];
    state.samsarites.push(s);
    people.push(s);
  }
  return { state, people };
}

test("維持費：個人基因鎖基準費與空間底費分開算", () => {
  const { state, people: [s] } = setup(1, "S");
  state.spaceLevel = 5;
  for (let g = 0; g <= 4; g++) {
    s.geneLock = g;
    assert.deepEqual(upkeepPartsOf(s, state), { gene: CONFIG.space.upkeepGene[g], space: 36 });
    assert.equal(upkeepOf(s, state), Math.round((CONFIG.space.upkeepGene[g] + 36) * 2)); // S 級 +100%
  }
  s.geneLock = 0;
  setInjury(s, 3);
  assert.equal(upkeepOf(s, state), Math.round((8 + 36) * (1 + 1 + 1.5)));
  // 高等級空間、零階凡人的費用比舊制（180）低很多
  const c = createSamsarite(state, "C");
  assert.equal(upkeepOf(c, state), 44);
});

test("回收爐：依階級返還積分 C 30／B 80／A 250／S 800", () => {
  for (const [rank, refund] of [["C", 30], ["B", 80], ["A", 250], ["S", 800]]) {
    const { state, people: [s, other] } = setup(2, rank, 0);
    assert.equal(RANKS[rank].recycleRefund, refund);
    assert.equal(recycle(state, s.id), true);
    assert.equal(state.points, refund, rank);
    assert.equal(other.stats.sanity, 100 - CONFIG.recycle.sanityLoss);
  }
});

test("絕境空投：存活 < 2 且積分 < 120，連續滿 3 天空投 1 名 C 級", () => {
  const { state, people: [a] } = setup(1, "C", 50);
  a.location = "dungeon"; // 出征中也算存活，但這裡讓他不吃維持費，積分才好控制
  endOfDay(state);
  endOfDay(state);
  assert.equal(state.samsarites.length, 1, "還沒滿 3 天");
  endOfDay(state);
  assert.equal(state.samsarites.length, 2);
  const drop = state.samsarites[1];
  assert.equal(drop.rank, "C");
  assert.equal(drop.location, "space");
  assert.equal(state.airdrop.days, 0, "空投後計數歸零");
  assert.ok(state.log.some((e) => e.type === "airdrop"));
});

test("絕境空投：條件中斷（積分夠、人夠）計數歸零；催熟艙嬰兒不算存活；遊戲結束不空投", () => {
  const { state, people: [a] } = setup(1, "C", 50);
  state.airdrop.days = 2;
  state.points = 500; // 積分夠了
  assert.equal(dailyAirdrop(state), null);
  assert.equal(state.airdrop.days, 0);

  state.points = 50;
  const baby = createSamsarite(state, "C");
  baby.location = "pod";
  state.samsarites.push(baby);
  state.airdrop.days = 2;
  assert.ok(dailyAirdrop(state), "催熟艙的嬰兒不算存活，一個大人仍符合條件");

  state.airdrop.days = 2;
  state.gameOver = true;
  assert.equal(dailyAirdrop(state), null);
  const two = setup(2, "C", 50).state;
  two.airdrop.days = 2;
  assert.equal(dailyAirdrop(two), null, "有 2 人就不空投");
  assert.equal(a.rank, "C");
});

test("絕境空投：不動主亂數，存檔會保留計數，舊存檔補欄位", () => {
  const { state } = setup(1, "C", 50);
  state.airdrop.days = 2;
  const rng = state.rngState;
  dailyAirdrop(state);
  assert.equal(state.rngState, rng);
  state.airdrop.days = 1;
  assert.equal(deserialize(serialize(state)).airdrop.days, 1);
  const old = JSON.parse(serialize(state));
  delete old.airdrop;
  assert.equal(deserialize(JSON.stringify(old)).airdrop.days, 0);
});
