// Phase 4-A：空間等級、五章 20 關、飽和公式、可變房數與門檻、五維統一
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG, RANKS } from "../src/data/config.js";
import { DUNGEONS, getDungeon } from "../src/data/dungeons.js";
import { createNewGame, createSamsarite, upkeepOf, debtLimitOf, canAfford, endOfDay, serialize, deserialize } from "../src/engine/core.js";
import { startRun, clearChance, chanceAtLeast, roomPassRate, powerRate, isUnlocked, unlockedDungeons } from "../src/engine/dungeon.js";
import { planAutoDispatch, step } from "../src/engine/dispatch.js";

/** 開一局、清空名單，放 n 個沒有標籤、戰力固定的人 */
function setup(n = 4, power = 100000, seed = 3) {
  const state = createNewGame(seed);
  state.points = 100000;
  state.samsarites = [];
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, "C");
    s.tags = [];
    s.stats.power = power;
    state.samsarites.push(s);
  }
  return state;
}

/** 跑完一場，回傳結算摘要（受傷的先治好，避免帶傷死亡干擾） */
function runOnce(state, dungeonId) {
  for (const s of state.samsarites) s.injury = 0;
  const r = startRun(state, dungeonId, state.samsarites.slice(0, CONFIG.partyMax).map((s) => s.id));
  assert.equal(r.ok, true, r.reason);
  let guard = 0;
  while (state.runs.length && guard++ < 100) step(state);
  return state.lastRun;
}

test("新開局：600 分、3 個 C 級、空間 Lv.1；所有階級五維都在零階凡人範圍", () => {
  const state = createNewGame(1);
  assert.equal(state.points, 600);
  assert.equal(state.spaceLevel, 1);
  assert.equal(state.samsarites.length, 3);
  assert.ok(state.samsarites.every((s) => s.rank === "C"));
  for (const rank of Object.keys(RANKS)) {
    for (let i = 0; i < 30; i++) {
      const s = createSamsarite(state, rank).stats;
      assert.ok(s.power >= 26 && s.power <= 34, `${rank} power ${s.power}`);
      assert.ok(s.hp >= 90 && s.hp <= 110);
      for (const k of ["defense", "speed", "luck"]) assert.ok(s[k] >= 8 && s[k] <= 14, `${rank} ${k}`);
      assert.equal(s.sanity, 100);
    }
  }
});

test("飽和公式：戰力等於推薦戰力約 54.8%，翻倍約 66.7%，永遠不超過 85%", () => {
  assert.ok(Math.abs(powerRate(100, 100) - 0.85 / 1.55) < 1e-12);
  assert.ok(Math.abs(powerRate(200, 100) - 1.7 / 2.55) < 1e-12);
  assert.ok(powerRate(1e12, 100) < 0.85);
  assert.equal(powerRate(0, 100), 0);
});

test("過關門檻依章節：5/7/8/10/12 房分別要過 3/4/5/6/7 房", () => {
  const state = setup(1, 1000);
  state.spaceLevel = 5;
  for (let ch = 1; ch <= 5; ch++) {
    const d = DUNGEONS.find((x) => x.chapter === ch);
    const { rooms, toClear } = CONFIG.dungeon.chapters[ch - 1];
    const p = roomPassRate(state, state.samsarites, d);
    assert.ok(Math.abs(clearChance(state, state.samsarites, d) - chanceAtLeast(rooms, toClear, p)) < 1e-12, `第 ${ch} 章`);
  }
  assert.deepEqual(CONFIG.dungeon.chapters.map((c) => c.toClear), [3, 4, 5, 6, 7]);
});

test("還沒解鎖的章節不能進，自動派遣也不會挑", () => {
  const state = setup();
  assert.equal(isUnlocked(state, getDungeon("ch2_1")), false);
  assert.equal(startRun(state, "ch2_1", [state.samsarites[0].id]).ok, false);
  assert.ok(unlockedDungeons(state).every((d) => d.chapter === 1));
  assert.equal(planAutoDispatch(state).dungeon.chapter, 1);
  state.spaceLevel = 3;
  assert.equal(planAutoDispatch(state).dungeon.id, "ch3_3", "尾王還沒開放（守門），挑已解鎖中獎勵最高的（第 3 章第 3 關）");
  state.chapterClears[3] = CONFIG.bossGate.requiredClears;
  assert.equal(planAutoDispatch(state).dungeon.id, "ch3_4", "守門條件達成後，夠強就挑獎勵最高的（第 3 章尾王）");
});

test("首通本章尾王：空間升 1 級、記下第幾天、解鎖下一章；再打一次不會再升", () => {
  const state = setup();
  state.chapterClears[1] = CONFIG.bossGate.requiredClears; // 尾王守門條件（見 gate.test.js）
  let first = null;
  for (let i = 0; i < 20 && !first; i++) {
    const r = runOnce(state, "ch1_4");
    if (r.success) first = r;
  }
  assert.ok(first, "超強隊伍 20 場內一定會通關");
  assert.equal(first.levelUp, 2);
  assert.equal(state.spaceLevel, 2);
  assert.ok(state.chapterClearDay[1] >= 1);
  assert.ok(state.log.some((e) => e.text.includes("Lv.2")));
  assert.equal(isUnlocked(state, getDungeon("ch2_1")), true);
  for (let i = 0; i < 5; i++) runOnce(state, "ch1_4");
  assert.equal(state.spaceLevel, 2, "重打不會再升級");
  // 一般關卡首通不會升級
  const other = setup();
  for (let i = 0; i < 10 && !(other.dungeonStats.ghost_village?.clears > 0); i++) runOnce(other, "ghost_village");
  assert.equal(other.spaceLevel, 1);
});

test("首通第 5 章尾王：主線通關，空間停在 Lv.5", () => {
  const state = setup();
  state.spaceLevel = 5;
  state.chapterClears[5] = CONFIG.bossGate.requiredClears;
  for (let i = 0; i < 20 && !state.chapterClearDay[5]; i++) runOnce(state, "ch5_4");
  assert.ok(state.chapterClearDay[5] >= 1);
  assert.equal(state.spaceLevel, 5);
  assert.ok(state.log.some((e) => e.type === "runEnd" && e.text.includes("主線")));
});

test("副本長度跟房數走：5 房 1 天、7 房 1.4 天、12 房 2.4 天", () => {
  for (const [id, ticks] of [["ghost_village", 10], ["ch2_1", 14], ["ch5_1", 24]]) {
    const state = setup();
    state.spaceLevel = 5;
    startRun(state, id, [state.samsarites[0].id]);
    let n = 0;
    while (state.runs.length && n < 100) {
      step(state);
      n += 1;
    }
    assert.equal(n, ticks, id);
    assert.equal(state.lastRun.rooms, getDungeon(id).rooms.length);
    if (state.lastRun.survivors.length > 0) assert.equal(state.lastRun.results.length, getDungeon(id).rooms.length); // 全滅的話剩下的房間不走
  }
});

test("維持費與破產線跟空間等級走", () => {
  const state = setup(1, 30);
  const s = state.samsarites[0];
  CONFIG.space.upkeepSpace.forEach((spaceFee, i) => {
    state.spaceLevel = i + 1;
    assert.equal(upkeepOf(s, state), CONFIG.space.upkeepGene[s.geneLock ?? 0] + spaceFee);
    assert.equal(debtLimitOf(state), CONFIG.space.debtLimit[i]);
  });
  state.spaceLevel = 2;
  state.points = -1400;
  assert.equal(canAfford(state, 100), true);
  assert.equal(canAfford(state, 101), false);
  state.points = -1495;
  state.tick = CONFIG.ticksPerDay;
  endOfDay(state); // 扣 16 分，但不能低於 -1500
  assert.equal(state.points, -1500);
});

test("存讀檔保留空間等級與章節紀錄；舊存檔沒有這些欄位就補預設", () => {
  const state = setup();
  state.spaceLevel = 3;
  state.chapterClearDay = { 1: 20, 2: 70 };
  const back = deserialize(serialize(state));
  assert.equal(back.spaceLevel, 3);
  assert.deepEqual(back.chapterClearDay, { 1: 20, 2: 70 });
  const old = JSON.parse(serialize(createNewGame(2)));
  delete old.spaceLevel;
  delete old.chapterClearDay;
  const loaded = deserialize(JSON.stringify(old));
  assert.equal(loaded.spaceLevel, 1);
  assert.deepEqual(loaded.chapterClearDay, {});
});

test("Phase 4-B 校正後的副本曲線：尾王是章內最高 R／獎勵；各章獎勵、尾王 R 逐章遞增", () => {
  const byChapter = (ch) => DUNGEONS.filter((d) => d.chapter === ch);
  for (let ch = 1; ch <= 5; ch++) {
    const list = byChapter(ch);
    assert.equal(list.length, 4, `第 ${ch} 章有 4 關`);
    const boss = list.find((d) => d.boss);
    for (const d of list.filter((x) => !x.boss)) {
      assert.ok(boss.recommendedPower > d.recommendedPower, `第 ${ch} 章尾王 R 要比 ${d.id} 高`);
      assert.ok(boss.reward > d.reward, `第 ${ch} 章尾王獎勵要比 ${d.id} 高`);
    }
    // 章內一般關：R 與獎勵都隨關卡編號遞增
    const normals = list.filter((x) => !x.boss);
    for (let i = 1; i < normals.length; i++) {
      assert.ok(normals[i].recommendedPower > normals[i - 1].recommendedPower, `第 ${ch} 章 R 遞增`);
      assert.ok(normals[i].reward > normals[i - 1].reward, `第 ${ch} 章獎勵遞增`);
    }
  }
  for (let ch = 2; ch <= 5; ch++) {
    const prev = byChapter(ch - 1);
    const cur = byChapter(ch);
    assert.ok(Math.min(...cur.map((d) => d.reward)) > Math.max(...prev.map((d) => d.reward)), `第 ${ch} 章最低獎勵要高於上一章最高獎勵`);
    assert.ok(cur.find((d) => d.boss).recommendedPower > prev.find((d) => d.boss).recommendedPower, `第 ${ch} 章尾王 R 要高於上一章尾王`);
    assert.ok(Math.min(...cur.map((d) => d.recommendedPower)) > Math.max(...prev.filter((d) => !d.boss).map((d) => d.recommendedPower)), `第 ${ch} 章一般關 R 要高於上一章一般關`);
  }
});
