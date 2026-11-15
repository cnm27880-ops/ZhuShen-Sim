// 第二批試玩回饋 18：小人名字不要永遠三個字（複姓 2 字 + 單名 1 字 → 2／3／4 個字都會出現）
import test from "node:test";
import assert from "node:assert/strict";
import { SURNAMES, GIVEN_NAMES } from "../src/data/names.js";
import { createNewGame, createSamsarite } from "../src/engine/core.js";

test("字庫：姓有 1 字也有 2 字、名有 1 字也有 2 字", () => {
  assert.ok(SURNAMES.some((n) => [...n].length === 2), "要有複姓");
  assert.ok(SURNAMES.some((n) => [...n].length === 1));
  assert.ok(GIVEN_NAMES.some((n) => [...n].length === 1), "要有單名");
  assert.ok(GIVEN_NAMES.some((n) => [...n].length === 2));
  assert.ok([...SURNAMES, ...GIVEN_NAMES].every((n) => [...n].length <= 2));
});

test("實際抽 400 個人：名字長度 2、3、4 個字都出現，最長 4 個字（卡片直式名字只取前 5 字，放得下）", () => {
  const state = createNewGame(5);
  const lengths = new Set();
  for (let i = 0; i < 400; i++) lengths.add([...createSamsarite(state, "C").name].length);
  assert.deepEqual([...lengths].sort(), [2, 3, 4]);
});
