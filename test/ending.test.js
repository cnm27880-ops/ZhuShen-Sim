// A-3 掛機壓力設計 階段 1：取消空投、團滅結局（死光／破產）、新手救濟、結局評分
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/data/config.js";
import { createNewGame, createSamsarite, checkGameOver, dailyAirdrop, endOfDay, serialize, deserialize, debtLimitOf } from "../src/engine/core.js";
import { scoreOf, dailyEnding } from "../src/engine/ending.js";

const afterProtect = (state) => {
  state.tick = CONFIG.ticksPerDay * (CONFIG.ending.protectDays + 5);
};

/** 名冊清空、積分壓到連最便宜的卡池都付不起 */
function broke(state) {
  state.samsarites = [];
  state.points = debtLimitOf(state) + 10;
}

test("空投預設停用：條件符合也不會空投", () => {
  assert.equal(CONFIG.airdrop.enabled, false);
  assert.equal(CONFIG.airdrop.rescue, false);
  const state = createNewGame(7);
  state.samsarites = [state.samsarites[0]];
  state.points = 10;
  state.airdrop.days = 99;
  assert.equal(dailyAirdrop(state), null);
  assert.equal(state.samsarites.length, 1);
});

test("死光結局：保護期後，名冊（不含催熟艙）為 0 且抽不起最便宜卡池 = 結束並算評分", () => {
  const state = createNewGame(11);
  afterProtect(state);
  broke(state);
  const baby = createSamsarite(state, "C");
  baby.location = "pod"; // 嬰兒不算名冊
  state.samsarites.push(baby);
  assert.equal(checkGameOver(state), true);
  assert.equal(state.gameOver, true);
  const r = state.ending.result;
  assert.equal(r.type, "roster");
  assert.ok(r.total > 0);
  assert.equal(r.items.length, 6);
  assert.ok(state.log.some((e) => e.type === "gameOver"));
});

test("死光但抽得起初級池：還不算結束", () => {
  const state = createNewGame(11);
  afterProtect(state);
  state.samsarites = [];
  state.points = 500;
  assert.equal(checkGameOver(state), false);
  assert.equal(state.gameOver, false);
});

test("新手救濟：保護期內第一次死光發 3 名 C 級（只有一次、不動主亂數），第二次才結束", () => {
  const state = createNewGame(21);
  broke(state);
  const rng = state.rngState;
  assert.equal(checkGameOver(state), false);
  assert.equal(state.samsarites.length, CONFIG.ending.relief.count);
  assert.ok(state.samsarites.every((s) => s.rank === CONFIG.ending.relief.rank && s.location === "space"));
  assert.equal(state.rngState, rng, "救濟用獨立亂數流");
  assert.equal(state.ending.reliefUsed, true);
  assert.ok(state.log.some((e) => e.type === "relief"));
  // 再死光、仍在保護期：不再救濟，直接結束
  broke(state);
  assert.equal(checkGameOver(state), true);
  assert.equal(state.ending.result.type, "roster");
});

test("保護期過後死光，沒有救濟", () => {
  const state = createNewGame(21);
  afterProtect(state);
  broke(state);
  assert.equal(checkGameOver(state), true);
  assert.equal(state.ending.reliefUsed, false);
});

test("破產結局：頂到破產線連續 3 天才結束；中途回到線上就歸零", () => {
  const state = createNewGame(31);
  afterProtect(state);
  state.points = debtLimitOf(state);
  endOfDay(state);
  assert.equal(state.ending.debtDays, 1);
  assert.equal(state.gameOver, false);
  assert.ok(state.log.some((e) => e.type === "endingWarn"));
  endOfDay(state);
  assert.equal(state.ending.debtDays, 2);
  state.points = 500; // 副本賺了一筆
  endOfDay(state);
  assert.equal(state.ending.debtDays, 0);
  state.points = debtLimitOf(state);
  for (let i = 0; i < CONFIG.ending.debtGraceDays; i++) endOfDay(state);
  assert.equal(state.gameOver, true);
  assert.equal(state.ending.result.type, "debt");
});

test("保護期內不判破產結局", () => {
  const state = createNewGame(31);
  state.points = debtLimitOf(state);
  for (let i = 0; i < 6; i++) endOfDay(state);
  assert.equal(state.gameOver, false);
  assert.equal(state.ending.debtDays, 0);
});

test("舊空投救援旗標（rescue）打開時：維持舊行為，死光與破產都不結束", () => {
  const state = createNewGame(41);
  afterProtect(state);
  CONFIG.airdrop.rescue = true;
  try {
    broke(state);
    assert.equal(checkGameOver(state), false);
    state.points = debtLimitOf(state);
    for (let i = 0; i < 5; i++) dailyEnding(state);
    assert.equal(state.gameOver, false);
  } finally {
    CONFIG.airdrop.rescue = false;
  }
});

test("評分：純函式、不動亂數，隨進度增加；稱號依分數", () => {
  const state = createNewGame(51);
  const rng = state.rngState;
  const a = scoreOf(state);
  assert.equal(state.rngState, rng);
  assert.deepEqual(scoreOf(state), a);
  assert.equal(a.title, CONFIG.ending.titles[0].title);
  state.tick = CONFIG.ticksPerDay * 100;
  state.chapterClearDay = { 1: 30, 2: 80 };
  state.dungeonStats = { x: { attempts: 20, clears: 15 } };
  state.memorialStele = [{}, {}];
  state.ending.peakPoints = 100000;
  state.ending.maxGeneration = 2;
  const b = scoreOf(state);
  const w = CONFIG.ending.score;
  const peak = b.items.find((i) => i.key === "peak");
  assert.equal(b.items.find((i) => i.key === "days").points, 101 * w.perDay);
  assert.equal(b.items.find((i) => i.key === "bosses").points, 2 * w.perBossChapter);
  assert.equal(b.items.find((i) => i.key === "clears").points, 15 * w.perClear);
  assert.equal(b.items.find((i) => i.key === "stele").points, 2 * w.perStele);
  assert.equal(b.items.find((i) => i.key === "generation").points, 2 * w.perGeneration);
  assert.equal(peak.points, Math.round(Math.log10(100000 / CONFIG.startingPoints) * w.peakLog));
  assert.ok(b.total > a.total);
  assert.equal(b.title, [...CONFIG.ending.titles].reverse().find((t) => b.total >= t.min).title);
});

test("存檔：結局欄位會保存；舊存檔補預設", () => {
  const state = createNewGame(61);
  afterProtect(state);
  state.ending.debtDays = 2;
  state.ending.reliefUsed = true;
  const loaded = deserialize(serialize(state));
  assert.equal(loaded.ending.debtDays, 2);
  assert.equal(loaded.ending.reliefUsed, true);
  const old = JSON.parse(serialize(state));
  delete old.ending;
  const fixed = deserialize(JSON.stringify(old));
  assert.equal(fixed.ending.debtDays, 0);
  assert.equal(fixed.ending.reliefUsed, false);
  assert.equal(fixed.ending.result, null);
});
