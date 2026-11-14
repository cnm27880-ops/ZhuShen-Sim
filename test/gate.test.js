// Phase 4-B：尾王守門、因果結晶掉落、通關頓悟的結算掛鉤
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/data/config.js";
import { DUNGEONS, getDungeon } from "../src/data/dungeons.js";
import { createNewGame, createSamsarite, serialize, deserialize } from "../src/engine/core.js";
import { startRun, isUnlocked, bossGateInfo, dungeonNumber } from "../src/engine/dungeon.js";
import { step } from "../src/engine/dispatch.js";

function makeStrong(state) {
  const s = createSamsarite(state, "C");
  s.tags = [];
  s.stats.power = 10000000;
  state.samsarites.push(s);
  return s;
}

/** 一局、n 個戰力超強、沒標籤的人（一定通關，除非運氣極差），可自訂空間等級 */
function setup(spaceLevel = 1, n = 4) {
  const state = createNewGame(21);
  state.points = 1000000;
  state.spaceLevel = spaceLevel;
  state.samsarites = [];
  for (let i = 0; i < n; i++) makeStrong(state);
  return state;
}

/** 把五章的尾王守門都打開（測結晶、頓悟時不想先刷 8 場） */
function openGates(state) {
  for (let ch = 1; ch <= 5; ch++) state.chapterClears[ch] = CONFIG.bossGate.requiredClears;
}

function runOnce(state, dungeonId, ids = null) {
  for (const s of state.samsarites) s.injury = 0;
  // 刷很多場時偶爾有人死在副本裡（同一場連續受傷），自動補強者讓隊伍保持滿員
  if (!ids) while (state.samsarites.length < CONFIG.partyMax) makeStrong(state);
  const party = ids ?? state.samsarites.slice(0, CONFIG.partyMax).map((s) => s.id);
  const r = startRun(state, dungeonId, party);
  assert.equal(r.ok, true, r.reason);
  let guard = 0;
  while (state.runs.length && guard++ < 100) step(state);
  return state.lastRun;
}

test("關卡編號：陣列順序 = 第 1~30 關，每章第 6 關是尾王", () => {
  assert.equal(DUNGEONS.length, 30);
  DUNGEONS.forEach((d, i) => {
    assert.equal(dungeonNumber(d), i + 1);
    assert.equal(!!d.boss, (i + 1) % 6 === 0, `第 ${i + 1} 關`);
  });
});

test("尾王守門：前 3 關合計成功結算滿 8 次才開放；失敗不算、尾王本身不算", () => {
  const state = setup(1);
  const boss = getDungeon("ch1_boss");
  assert.equal(CONFIG.bossGate.requiredClears, 8);
  assert.deepEqual(bossGateInfo(state, boss), { applies: true, have: 0, need: 8, open: false });
  assert.equal(isUnlocked(state, boss), false);
  const denied = startRun(state, "ch1_boss", [state.samsarites[0].id]);
  assert.equal(denied.ok, false);
  assert.match(denied.reason, /0\/8/);
  assert.equal(state.samsarites[0].location, "space", "被拒絕不會讓人進副本");
  assert.equal(bossGateInfo(state, getDungeon("ghost_village")).open, true, "一般關卡不受守門影響");

  // 不同關卡的成功都累計（含首通與重打）
  const plan = ["ghost_village", "silent_ark", "ember_war", "ghost_village", "ghost_village", "silent_ark", "ember_war"];
  plan.forEach((id, i) => {
    const r = runOnce(state, id);
    assert.equal(r.success, true, `${id} 第 ${i + 1} 場`);
    assert.equal(state.chapterClears[1], i + 1);
    assert.equal(isUnlocked(state, boss), false, "還差一場");
  });
  assert.equal(runOnce(state, "ghost_village").success, true);
  assert.equal(state.chapterClears[1], 8);
  assert.equal(isUnlocked(state, boss), true);
  assert.equal(bossGateInfo(state, boss).open, true);
});

test("尾王守門：失敗的結算不算次數", () => {
  let fails = 0;
  let wins = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const state = createNewGame(seed);
    state.samsarites = [];
    const s = createSamsarite(state, "C");
    s.tags = [];
    s.stats.power = 1; // 戰力 1 打第 1 關，幾乎必敗（偶爾運氣好）
    state.samsarites.push(s);
    const r = runOnce(state, "ghost_village", [s.id]);
    if (r.success) {
      wins++;
      assert.equal(state.chapterClears[1], 1);
    } else {
      fails++;
      assert.equal(state.chapterClears[1] ?? 0, 0, "失敗不算次數");
    }
  }
  assert.ok(fails >= 1, "至少要有一場失敗才測得到");
  assert.ok(wins + fails === 40);
});

test("尾王守門：每章獨立；已首通過的尾王不再受鎖（舊存檔相容）", () => {
  const state = setup(3);
  const ch3boss = getDungeon("ch3_boss");
  state.chapterClears[1] = 99; // 別章的次數不影響第 3 章
  assert.equal(isUnlocked(state, ch3boss), false);
  state.chapterClears[3] = 8;
  assert.equal(isUnlocked(state, ch3boss), true);

  // 舊存檔：沒有 chapterClears，但尾王已首通過（chapterClearDay 或 dungeonStats 有紀錄）→ 不鎖
  const old = setup(2);
  old.chapterClearDay[1] = 7;
  delete old.chapterClears;
  const loaded = deserialize(serialize(old));
  assert.deepEqual(loaded.chapterClears, {});
  assert.equal(isUnlocked(loaded, getDungeon("ch1_boss")), true, "第 1 章尾王首通過了");
  assert.equal(isUnlocked(loaded, getDungeon("ch2_boss")), false, "第 2 章尾王還沒");
  loaded.dungeonStats.ch2_boss = { attempts: 1, clears: 1 };
  assert.equal(isUnlocked(loaded, getDungeon("ch2_boss")), true, "有通關紀錄也算");
});

test("尾王守門：空間等級還不夠的章節，即使次數夠也不能進", () => {
  const state = setup(1);
  state.chapterClears[2] = 99;
  assert.equal(isUnlocked(state, getDungeon("ch2_boss")), false);
  assert.equal(startRun(state, "ch2_boss", [state.samsarites[0].id]).ok, false);
});

test("因果結晶：第 3 章尾王首通掉 2 顆、第 4／5 章前 3 張常規關與尾王各 1 顆（30 世界沿用 4-B 供應量），其餘首通不掉", () => {
  const K = CONFIG.karma;
  assert.equal(K.firstClear.ch3_boss, 2);
  for (const id of ["ch4_01", "ch4_02", "ch4_03", "ch4_boss", "ch5_01", "ch5_02", "ch5_03", "ch5_boss"]) assert.equal(K.firstClear[id], 1, id);
  assert.equal(Object.values(K.firstClear).reduce((n, v) => n + v, 0), 10, "首通必掉總供應量 = 4-B 的 10 顆");
  for (const d of DUNGEONS.filter((x) => x.chapter < 3 || ["ch3_01", "ch3_05", "ch4_05", "ch5_05"].includes(x.id))) assert.equal(K.firstClear[d.id], undefined, d.id);

  const saved = { ...K.chapterRoll };
  K.chapterRoll[4] = 0;
  K.chapterRoll[5] = 0; // 關掉機率掉落，只看首通必掉
  try {
    const state = setup(5);
    openGates(state);
    assert.equal(state.karmaCrystals, 0);
    let r = runOnce(state, "ch3_05"); // 第 11 關首通：不掉
    assert.equal(r.success, true);
    assert.equal(r.karma, 0);
    r = runOnce(state, "ch3_boss"); // 第 12 關首通：2 顆
    assert.equal(r.success && r.firstClear, true);
    assert.equal(r.karma, 2);
    assert.equal(state.karmaCrystals, 2);
    r = runOnce(state, "ch3_boss"); // 重打：不掉
    assert.equal(r.karma, 0);
    assert.equal(state.karmaCrystals, 2);
    r = runOnce(state, "ch4_01"); // 第 13 關首通：1 顆
    assert.equal(r.karma, 1);
    r = runOnce(state, "ch5_boss"); // 第 20 關首通：1 顆
    assert.equal(r.karma, 1);
    assert.equal(state.karmaCrystals, 4);
    assert.ok(state.events.some((e) => e.type === "karma"));
  } finally {
    Object.assign(K.chapterRoll, saved);
  }
});

test("因果結晶：第 4 章任一副本通關 15%、第 5 章 25% 機率掉 1 顆（與首通必掉可疊加）", () => {
  assert.deepEqual(CONFIG.karma.chapterRoll, { 4: 0.15, 5: 0.25 });
  const K = CONFIG.karma;
  const saved = { ...K.chapterRoll };
  K.chapterRoll[4] = 1;
  try {
    const state = setup(5);
    let r = runOnce(state, "ch4_01"); // 首通必掉 1 + 機率 1 = 2
    assert.equal(r.karma, 2);
    r = runOnce(state, "ch4_01"); // 重打：只剩機率掉落
    assert.equal(r.karma, 1);
    r = runOnce(state, "ch3_05"); // 第 3 章沒有機率掉落
    assert.equal(r.karma, 0);
    assert.equal(state.karmaCrystals, 3);
  } finally {
    Object.assign(K.chapterRoll, saved);
  }

  // 實際機率：第 5 章 25%（重打同一關，扣掉首通那一場）
  const state = setup(5);
  runOnce(state, "ch5_01");
  state.karmaCrystals = 0;
  const N = 400;
  for (let i = 0; i < N; i++) runOnce(state, "ch5_01");
  assert.ok(state.karmaCrystals / N > 0.17 && state.karmaCrystals / N < 0.33, `實際 ${(state.karmaCrystals / N).toFixed(3)}`);
});

test("失敗的副本不掉結晶、不頓悟", () => {
  const K = CONFIG.karma;
  const saved = { ...K.chapterRoll };
  K.chapterRoll[4] = 1;
  const savedChance = CONFIG.insight.chance;
  CONFIG.insight.chance = 1;
  try {
    let sawFail = false;
    for (let seed = 1; seed <= 20 && !sawFail; seed++) {
      const state = createNewGame(seed);
      state.spaceLevel = 5;
      state.samsarites = [];
      const s = createSamsarite(state, "C");
      s.tags = [];
      s.stats.power = 1;
      state.samsarites.push(s);
      const r = runOnce(state, "ch4_01");
      if (r.success) continue;
      sawFail = true;
      assert.equal(r.karma, 0);
      assert.deepEqual(r.insights, []);
      assert.equal(state.karmaCrystals, 0);
      for (const p of state.samsarites) assert.equal(p.insightCount, 0);
    }
    assert.ok(sawFail);
  } finally {
    Object.assign(K.chapterRoll, saved);
    CONFIG.insight.chance = savedChance;
  }
});

test("通關頓悟：機率 100% 時，結算成功後每位存活隊員頓悟一次，摘要有紀錄", () => {
  const savedChance = CONFIG.insight.chance;
  CONFIG.insight.chance = 1;
  try {
    const state = setup(1);
    const before = state.samsarites.map((s) => s.stats.power);
    const r = runOnce(state, "ghost_village");
    assert.equal(r.success, true);
    assert.equal(r.insights.length, r.survivors.length);
    for (const s of state.samsarites) assert.equal(s.insightCount, 1);
    state.samsarites.forEach((s, i) => assert.equal(s.stats.power, before[i] + 3, "C 級戰力 +3"));
    assert.ok(state.events.some((e) => e.type === "insight"));
  } finally {
    CONFIG.insight.chance = savedChance;
  }
});

test("通關頓悟與結晶不動主亂數：同種子下副本結果與沒有這兩個系統時一致（機率歸零對照）", () => {
  // 同一個種子、同樣操作：頓悟機率 0% 與 100% 時，副本的主亂數序列（rngState）必須一樣
  const run = (chance) => {
    const saved = CONFIG.insight.chance;
    CONFIG.insight.chance = chance;
    try {
      const state = setup(1);
      runOnce(state, "ghost_village");
      runOnce(state, "silent_ark");
      return state.rngState;
    } finally {
      CONFIG.insight.chance = saved;
    }
  };
  assert.equal(run(0), run(1));
});
