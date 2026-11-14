// Phase 3-C：並行副本（多場同時進行、不重疊、統一時間、結算排隊、許願掛鉤、舊存檔遷移）
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/data/config.js";
import { DUNGEONS } from "../src/data/dungeons.js";
import { createNewGame, createSamsarite, serialize, deserialize, upkeepOf } from "../src/engine/core.js";
import { startRun } from "../src/engine/dungeon.js";
import { step, tryAutoDispatch } from "../src/engine/dispatch.js";
import { acceptWish } from "../src/engine/wishes.js";

const easy = DUNGEONS[0];

/** n 個超強的 C 階（戰力 9999、沒標籤），通關幾乎一定成功 */
function setup(n, power = 9999) {
  const state = createNewGame(11);
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

const runAll = (state) => {
  let guard = 0;
  while (state.runs.length && guard++ < 100) step(state);
};

test("可以同時派兩隊（含同一個副本），同一個人不能同時在兩場", () => {
  const state = setup(4);
  const [a, b, c, d] = state.samsarites;
  assert.equal(startRun(state, easy.id, [a.id, b.id]).ok, true);
  assert.equal(startRun(state, easy.id, [c.id]).ok, true, "同一個副本可同時第二場");
  assert.equal(startRun(state, DUNGEONS[1].id, [b.id, d.id]).ok, false, "b 已在副本裡");
  assert.equal(state.runs.length, 2);
  assert.notEqual(state.runs[0].id, state.runs[1].id);
  assert.equal(d.location, "space");
});

test("統一時間：兩場同時進行，一場副本 = 1 天；主神空間照常扣留守者的維持費、副本中的人不扣", () => {
  const state = setup(3);
  const [a, b, c] = state.samsarites;
  startRun(state, easy.id, [a.id]);
  startRun(state, easy.id, [b.id]);
  const before = state.points;
  let guard = 0;
  while (state.runs.length && guard++ < 100) step(state);
  assert.equal(state.tick, CONFIG.ticksPerDay, "兩場同時跑，總共只過 1 天");
  assert.equal(state.runs.length, 0);
  assert.equal(state.runReports.length, 2, "兩份結算摘要排隊");
  const rewards = state.runReports.reduce((sum, r) => sum + r.tax, 0);
  assert.equal(state.points, before - upkeepOf(c) + rewards);
  assert.ok(state.samsarites.every((s) => s.location === "space"));
});

test("每場副本每 roomTicks 個時段走一個房間，結算順序依開場順序", () => {
  const state = setup(2);
  const [a, b] = state.samsarites;
  const r1 = startRun(state, easy.id, [a.id]).run;
  step(state);
  step(state); // 兩個時段過去
  const r2 = startRun(state, easy.id, [b.id]).run; // 晚兩個時段開場
  assert.equal(r1.roomIndex, 1);
  assert.equal(r2.roomIndex, 0);
  step(state); // r1 走第 2 間（tick 2），r2 走第 1 間（tick 2）
  assert.equal(r1.roomIndex, 2);
  assert.equal(r2.roomIndex, 1);
  runAll(state);
  assert.deepEqual(state.runReports.map((r) => r.runId), [r1.id, r2.id]);
});

test("同副本兩場：先結算的吃首通，後結算的視為重打（只有一次首通獎勵、一件特殊獎勵）", () => {
  const state = setup(2);
  const [a, b] = state.samsarites;
  startRun(state, easy.id, [a.id]);
  startRun(state, easy.id, [b.id]);
  runAll(state);
  const [first, second] = state.runReports;
  assert.equal(first.success && second.success, true);
  assert.equal(first.firstClear, true);
  assert.equal(second.firstClear, false);
  assert.equal(state.collection.length, 1);
  assert.equal(state.dungeonStats[easy.id].clears, 2);
  assert.equal(state.dungeonStats[easy.id].attempts, 2);
});

test("自動派遣：一次排出多隊、不重疊；手動已出發的人不會被重複派", () => {
  const state = setup(8);
  state.settings.protect.noEnemies = false;
  const busy = state.samsarites[0];
  startRun(state, easy.id, [busy.id]);
  const sent = tryAutoDispatch(state);
  assert.ok(sent >= 2, `應該派出多隊，實際 ${sent}`);
  const ids = state.runs.flatMap((r) => r.partyIds);
  assert.equal(new Set(ids).size, ids.length, "沒有人同時在兩隊");
  assert.equal(ids.filter((id) => id === busy.id).length, 1);
});

test("全員出動、主神空間沒人也能正常跑完一天", () => {
  const state = setup(3);
  startRun(state, easy.id, [state.samsarites[0].id]);
  startRun(state, easy.id, [state.samsarites[1].id]);
  startRun(state, easy.id, [state.samsarites[2].id]);
  assert.doesNotThrow(() => runAll(state));
  assert.equal(state.runs.length, 0);
  assert.equal(state.gameOver, false);
});

test("全滅的副本也要等時間過完才結算，不會當機", () => {
  const state = setup(1, 1); // 戰力 1，一定被打
  const s = state.samsarites[0];
  s.stats.hp = 1;
  startRun(state, "ember_war", [s.id]);
  runAll(state);
  assert.equal(state.runs.length, 0);
  assert.equal(state.tick, CONFIG.ticksPerDay);
  assert.equal(state.runReports.length, 1);
});

test("許願「想去副本」：只有出征名單裡的人、且是那個副本結算時才會處理", () => {
  const state = setup(3);
  const [wisher, other, third] = state.samsarites;
  state.wishes.push({
    id: state.nextWishId++,
    kind: "dungeon",
    mode: "dungeon",
    samsariteId: wisher.id,
    createdDay: 1,
    deadlineDay: 99,
    status: "pending",
    params: { dungeonId: easy.id },
    text: "",
  });
  acceptWish(state, state.wishes[0].id);
  // 別人先去同一個副本、許願者去別的副本：許願不該被別人的結算完成
  startRun(state, easy.id, [other.id]);
  startRun(state, DUNGEONS[1].id, [wisher.id]);
  while (state.runs.some((r) => r.dungeonId === easy.id)) step(state);
  assert.equal(state.wishes.length, 1, "許願者不在那場，許願維持進行中");
  runAll(state);
  assert.equal(state.wishes.length, 1, "去了別的副本也不算");
  // 這次許願者真的去那個副本，同時另一隊也在跑
  startRun(state, easy.id, [wisher.id]);
  startRun(state, DUNGEONS[1].id, [third.id]);
  runAll(state);
  if (state.runReports.at(-1).success && state.runReports.some((r) => r.dungeonId === easy.id && r.success)) {
    assert.equal(state.wishes.length, 0, "通關後許願完成");
    assert.equal(state.samsarites.find((s) => s.id === wisher.id).mood?.kind, "happy");
  }
});

test("舊存檔（單一 state.run）能讀，並遷移成 state.runs", () => {
  const state = setup(2);
  const [a] = state.samsarites;
  const { run } = startRun(state, easy.id, [a.id]);
  step(state);
  step(state);
  step(state);
  const old = JSON.parse(serialize(state));
  const { runs: _runs, nextRunId: _n, runReports: _r, ...rest } = old;
  rest.run = { ...run, roomIndex: run.roomIndex }; // 舊格式：沒有 id／startTick
  delete rest.run.id;
  delete rest.run.startTick;
  const loaded = deserialize(JSON.stringify(rest));
  assert.equal(loaded.run, undefined);
  assert.equal(loaded.runs.length, 1);
  assert.equal(loaded.runs[0].dungeonId, easy.id);
  assert.equal(loaded.runs[0].startTick, loaded.tick - loaded.runs[0].roomIndex * CONFIG.roomTicks);
  assert.deepEqual(loaded.runReports, []);
  runAll(loaded);
  assert.equal(loaded.runs.length, 0);
  assert.equal(loaded.runReports.length, 1);
});

test("存檔往返：並行副本進行到一半存起來再讀，結果一致", () => {
  const state = setup(3);
  startRun(state, easy.id, [state.samsarites[0].id]);
  startRun(state, DUNGEONS[1].id, [state.samsarites[1].id]);
  for (let i = 0; i < 4; i++) step(state);
  const loaded = deserialize(serialize(state));
  assert.deepEqual(loaded.runs, state.runs);
  assert.equal(loaded.nextRunId, state.nextRunId);
});
