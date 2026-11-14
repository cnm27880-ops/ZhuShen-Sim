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
