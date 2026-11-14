// 嚴重 Bug 1／2：startRun 拒絕重複成員與被鎖定（🔒）的成員
import test from "node:test";
import assert from "node:assert/strict";

import { createNewGame } from "../src/engine/core.js";
import { startRun } from "../src/engine/dungeon.js";
import { DUNGEONS } from "../src/data/dungeons.js";

function setup() {
  const state = createNewGame(7);
  return { state, ids: state.samsarites.map((s) => s.id), dungeonId: DUNGEONS[0].id };
}

test("startRun：同一人重複出現在隊伍會被拒絕，且沒有人被送出去", () => {
  const { state, ids, dungeonId } = setup();
  const r = startRun(state, dungeonId, [ids[0], ids[0]]);
  assert.equal(r.ok, false);
  assert.equal(state.runs.length, 0);
  assert.equal(state.samsarites[0].location, "space");
  assert.equal(state.samsarites[0].runs, 0);
});

test("startRun：被鎖定（locked）的人不能派遣", () => {
  const { state, ids, dungeonId } = setup();
  state.samsarites[0].locked = true;
  const r = startRun(state, dungeonId, [ids[0], ids[1]]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /鎖定/);
  assert.equal(state.runs.length, 0);
  assert.equal(state.samsarites[1].location, "space");
});

test("startRun：正常隊伍照常出發", () => {
  const { state, ids, dungeonId } = setup();
  const r = startRun(state, dungeonId, [ids[0], ids[1]]);
  assert.equal(r.ok, true);
});
