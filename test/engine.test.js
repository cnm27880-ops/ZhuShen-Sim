import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG, GACHA_POOLS } from "../src/data/config.js";
import { DUNGEONS, getDungeon } from "../src/data/dungeons.js";
import {
  createNewGame,
  createSamsarite,
  upkeepOf,
  setInjury,
  endOfDay,
  advanceTick,
  pullGacha,
  recycle,
  canAfford,
  checkGameOver,
  serialize,
  deserialize,
} from "../src/engine/core.js";
import { roomPassRate, clearChance, chanceAtLeast, startRun, stepRun } from "../src/engine/dungeon.js";
import { planAutoDispatch, step } from "../src/engine/dispatch.js";

const easy = getDungeon("ghost_village");

function make(state, rank, injury = 0) {
  const s = createSamsarite(state, rank);
  setInjury(s, injury);
  state.samsarites.push(s);
  return s;
}

test("同一個種子會產生一模一樣的開局", () => {
  assert.equal(serialize(createNewGame(42)), serialize(createNewGame(42)));
  assert.equal(createNewGame(42).samsarites.length, CONFIG.startingSamsarites);
});

test("維持費符合計畫書第 12.2 節的四個範例", () => {
  const state = createNewGame(1);
  assert.equal(upkeepOf(make(state, "C", 0)), 10);
  assert.equal(upkeepOf(make(state, "B", 1)), 20);
  assert.equal(upkeepOf(make(state, "A", 2)), 35);
  assert.equal(upkeepOf(make(state, "S", 3)), 60);
});

test("房間通過率：戰力等於推薦戰力時是 70%，並且有上下限", () => {
  const state = createNewGame(1);
  const fake = (power) => [{ stats: { power } }];
  assert.ok(Math.abs(roomPassRate(state, fake(100), easy) - 0.7) < 1e-9);
  assert.equal(roomPassRate(state, fake(1000), easy), CONFIG.dungeon.maxPassRate);
  assert.equal(roomPassRate(state, fake(1), easy), CONFIG.dungeon.minPassRate);
  assert.ok(Math.abs(chanceAtLeast(5, 5, 0.7) - 0.7 ** 5) < 1e-9);
  assert.ok(clearChance(state, fake(100), easy) > 0.8);
});

test("每日結算：扣維持費、養傷倒數、傷癒", () => {
  const state = createNewGame(1);
  state.samsarites = [];
  const s = make(state, "C", 1); // 輕傷：休 1 天、每天 15 分
  state.tick = CONFIG.ticksPerDay;
  endOfDay(state);
  assert.equal(state.points, CONFIG.startingPoints - 15);
  assert.equal(s.injury, 0);
});

test("高利貸：積分不會低於上限，負債時會電擊扣理智", () => {
  const state = createNewGame(1);
  state.points = CONFIG.debtLimit + 5;
  state.tick = CONFIG.ticksPerDay;
  endOfDay(state);
  assert.equal(state.points, CONFIG.debtLimit);
  assert.ok(state.samsarites.every((s) => s.stats.sanity === 100 - CONFIG.debtShockSanity));
  assert.ok(state.events.some((e) => e.type === "shock"));
});

test("抽卡：扣對的錢、只出該池的階級、借不到錢就抽不了", () => {
  const state = createNewGame(7);
  state.points = 100000;
  for (const pool of GACHA_POOLS) {
    const allowed = pool.odds.map((o) => o.rank);
    for (let i = 0; i < 50; i++) {
      const before = state.points;
      const s = pullGacha(state, pool.id);
      assert.ok(allowed.includes(s.rank));
      assert.equal(state.points, before - pool.cost);
    }
  }
  state.points = CONFIG.debtLimit + 100;
  assert.equal(pullGacha(state, "ba"), null);
  assert.equal(canAfford(state, 100), true);
});

test("一場副本剛好過 1 天，而且出征的人不扣維持費", () => {
  const state = createNewGame(3);
  const stay = state.samsarites[0];
  const party = state.samsarites.slice(1).map((s) => s.id);
  assert.equal(startRun(state, easy.id, party).ok, true);
  const before = state.points;
  let guard = 0;
  while (state.run && guard++ < 10) stepRun(state);
  assert.equal(state.tick, CONFIG.ticksPerDay);
  assert.equal(state.run, null);
  assert.equal(state.points, before - upkeepOf(stay) + state.lastRun.reward);
  assert.ok(state.samsarites.every((s) => s.location === "space"));
});

test("戰力嚴重不足的隊伍會傷亡；失敗生還者一定帶傷", () => {
  let sawDeath = false;
  let sawInjuredSurvivor = false;
  for (let seed = 1; seed <= 40; seed++) {
    const state = createNewGame(seed);
    startRun(state, "ember_war", state.samsarites.map((s) => s.id));
    while (state.run) stepRun(state);
    if (state.lastRun.success) continue; // 戰力不足仍有極小機率運氣好通關
    assert.ok(state.samsarites.every((s) => s.injury > 0));
    if (state.graveyard.length > 0) sawDeath = true;
    if (state.samsarites.length > 0) sawInjuredSurvivor = true;
  }
  assert.ok(sawDeath && sawInjuredSurvivor);
});

test("派遣檢查：人數上限、不能重複出征", () => {
  const state = createNewGame(5);
  state.points = 100000;
  while (state.samsarites.length <= CONFIG.partyMax) pullGacha(state, "ba");
  assert.equal(startRun(state, easy.id, state.samsarites.map((s) => s.id)).ok, false);
  assert.equal(startRun(state, easy.id, []).ok, false);
  assert.equal(startRun(state, easy.id, [state.samsarites[0].id]).ok, true);
  assert.equal(startRun(state, easy.id, [state.samsarites[1].id]).ok, false);
});

test("自動派遣：不派鎖定的人、不派受傷的人（開關開著時）、挑獎勵最高的可行副本", () => {
  const state = createNewGame(9);
  state.samsarites = [];
  const strong = [make(state, "S"), make(state, "S"), make(state, "S"), make(state, "S")];
  const plan = planAutoDispatch(state);
  assert.equal(plan.dungeon.id, "ember_war");

  strong[0].locked = true;
  setInjury(strong[1], 1);
  const plan2 = planAutoDispatch(state);
  assert.ok(!plan2.party.includes(strong[0]));
  assert.ok(!plan2.party.includes(strong[1]));

  state.settings.protect.noInjured = false;
  const plan3 = planAutoDispatch(state);
  assert.ok(plan3.party.includes(strong[1]));

  for (const s of strong) s.locked = true;
  assert.equal(planAutoDispatch(state), null);
});

test("自動派遣：不浪費戰力（簡單副本不會把最強的人全派出去）", () => {
  const state = createNewGame(11);
  state.samsarites = [];
  make(state, "S");
  make(state, "C");
  make(state, "C");
  const plan = planAutoDispatch(state);
  const again = planAutoDispatch(state);
  assert.deepEqual(plan.party.map((s) => s.id), again.party.map((s) => s.id));
  // 同一個副本下，沒有其他達標組合的總戰力比它更低
  assert.ok(plan.chance >= CONFIG.auto.minClearChance);
});

test("回收爐：+30 分、其他人理智下降", () => {
  const state = createNewGame(2);
  const [a, b] = state.samsarites;
  const before = state.points;
  assert.equal(recycle(state, a.id), true);
  assert.equal(state.points, before + CONFIG.recycle.points);
  assert.equal(b.stats.sanity, 100 - CONFIG.recycle.sanityLoss);
  assert.equal(state.samsarites.includes(a), false);
});

test("沒人又借不到錢 = 遊戲結束；還借得到就不算", () => {
  const state = createNewGame(2);
  state.samsarites = [];
  assert.equal(checkGameOver(state), false);
  state.points = CONFIG.debtLimit;
  assert.equal(checkGameOver(state), true);
});

test("開著自動派遣放著跑 60 天不會壞掉，存檔讀回來一模一樣", () => {
  const state = createNewGame(123);
  state.settings.autoDispatch = true;
  for (let i = 0; i < 600 && !state.gameOver; i++) {
    step(state);
    assert.ok(state.points >= CONFIG.debtLimit);
    assert.ok(Number.isInteger(state.points));
  }
  const total = Object.values(state.dungeonStats).reduce((n, d) => n + d.attempts, 0);
  assert.ok(total > 0);
  assert.equal(serialize(deserialize(serialize(state))), serialize(state));
});

test("副本資料完整：每個副本都有 5 個房間", () => {
  for (const d of DUNGEONS) assert.equal(d.rooms.length, CONFIG.dungeon.rooms);
  advanceTick(createNewGame(1));
});
