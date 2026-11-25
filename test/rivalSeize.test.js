// A1：野心競爭（rivalry 雙人事件）→ 宿怨標記 → 隊長缺位時的奪權
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/data/config.js";
import { TRAIT_DUETS } from "../src/data/traitEvents.js";
import { createNewGame, createSamsarite, killSamsarite, serialize, deserialize } from "../src/engine/core.js";
import { playTraitDuet } from "../src/engine/traitEvents.js";
import { appointCaptain, dailySquad, captainOf, addRivalMark, rivalMarkBetween, squadOf } from "../src/engine/squad.js";
import { currentDay } from "../src/engine/core.js";

const rivalry = TRAIT_DUETS.find((e) => e.id === "rivalry");

/** n 個無標籤 C 級（流派相同、好感為 0）；第 0 個當隊長 */
function setup(n, powers, seed = 21) {
  const state = createNewGame(seed);
  state.samsarites = [];
  state.spaceLevel = 2;
  state.points = 100000;
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, "C");
    s.tags = [];
    s.stats.power = powers[i] ?? 30;
    s.joinedDay = 1;
    s.traits = { altruism: 0, ambition: 60, courage: 0, social: 0, obedience: 0 };
    state.samsarites.push(s);
  }
  return state;
}
const withCfg = (patch, fn) => {
  const R = CONFIG.personality.rivalSeize;
  const old = { ...R };
  Object.assign(R, patch);
  try {
    return fn();
  } finally {
    Object.assign(R, old);
  }
};
const coups = (state) => state.chronicles.filter((c) => c.kind === "coup").length;

test("rivalry 事件記標記：勝者＝戰力較高者，平手比 id，不擲任何亂數", () => {
  const state = setup(4, [90, 50, 70, 30]);
  const [, a, b] = state.samsarites;
  appointCaptain(state, state.samsarites[0].id);
  const before = [state.rngState, state.squadRngState, state.trait?.rngState];
  assert.equal(playTraitDuet(state, a, b, rivalry).ok, true);
  const m = squadOf(state).rivalMarks;
  assert.equal(m.length, 1);
  assert.equal(m[0].winnerId, b.id, "b 戰力 70 > a 50");
  assert.deepEqual([state.rngState, state.squadRngState, state.trait?.rngState], before, "標記不動任何亂數流");
  // 平手：id 小者勝
  const t = setup(4, [90, 60, 60, 30]);
  const mk = addRivalMark(t, t.samsarites[2], t.samsarites[1]);
  assert.equal(mk.winnerId, t.samsarites[1].id);
});

test("標記：同一對只留最新一筆、超過 markCap 丟最舊、過了 markDays 失效", () => {
  const state = setup(10, []);
  const p = state.samsarites;
  addRivalMark(state, p[1], p[2]);
  addRivalMark(state, p[2], p[1]);
  assert.equal(squadOf(state).rivalMarks.length, 1, "同一對只留一筆");
  for (let i = 3; i < 10; i++) addRivalMark(state, p[1], p[i]);
  assert.equal(squadOf(state).rivalMarks.length, CONFIG.personality.rivalSeize.markCap);
  assert.equal(rivalMarkBetween(state, p[1], p[2]), null, "最舊的被丟掉");
  assert.ok(rivalMarkBetween(state, p[1], p[9]));
  // 過期
  const day = currentDay(state);
  squadOf(state).rivalMarks.find((m) => m.b === p[9].id).day = day - CONFIG.personality.rivalSeize.markDays - 1;
  assert.equal(rivalMarkBetween(state, p[1], p[9]), null);
});

test("隊長缺位：差距 < 15% 且流派相同、沒宿怨 → 不奪權；有標記 → 奪權；關閉功能 → 不奪權", () => {
  const run = (mark) => {
    const state = setup(4, [80, 100, 95, 20]);
    appointCaptain(state, state.samsarites[0].id);
    if (mark) addRivalMark(state, state.samsarites[1], state.samsarites[2]);
    killSamsarite(state, state.samsarites[0], "測試", null);
    dailySquad(state);
    return state;
  };
  assert.equal(coups(run(false)), 0, "沒有標記 = 和平順延（與改動前相同）");
  const s = run(true);
  assert.equal(coups(s), 1, "有標記視同宿怨 → 爆發奪權戰");
  assert.equal(s.squad.counters.rivalSeize, 1, "統計有記錄");
  withCfg({ enabled: false }, () => {
    const off = run(true);
    assert.equal(off.squad.rivalMarks, undefined, "關閉時不寫標記");
    assert.equal(coups(off), 0);
  });
});

test("標記不能繞過戰力差距門檻：差 > 15% 照樣和平順延", () => {
  const state = setup(4, [80, 100, 60, 20]);
  appointCaptain(state, state.samsarites[0].id);
  addRivalMark(state, state.samsarites[1], state.samsarites[2]);
  killSamsarite(state, state.samsarites[0], "測試", null);
  dailySquad(state);
  assert.equal(coups(state), 0);
});

test("標記勝者的奪權擲骰戰力加成：加成放大時勝者明顯較常上位；預設 +10% 只小幅偏向勝者", () => {
  const trials = 300;
  const winnerShare = () => {
    let wins = 0;
    for (let seed = 1; seed <= trials; seed++) {
      const state = setup(4, [80, 100, 100, 20], seed);
      appointCaptain(state, state.samsarites[0].id);
      const [, a, b] = state.samsarites;
      const mk = addRivalMark(state, a, b);
      mk.winnerId = b.id; // 戰力同為 100：指定 b 為標記勝者
      killSamsarite(state, state.samsarites[0], "測試", null);
      dailySquad(state);
      if (captainOf(state)?.id === b.id) wins++;
    }
    return wins / trials;
  };
  const big = withCfg({ winnerPowerPct: 9 }, winnerShare);
  assert.ok(big > 0.8, `加成 ×10 時勝者應約 91% 上位，實測 ${big}`);
  const normal = winnerShare();
  assert.ok(normal > 0.4 && normal < 0.65, `預設 +10% 約 52%，實測 ${normal}`);
});

test("舊存檔沒有 rivalMarks 欄位照常運作；有標記的存檔可存讀", () => {
  const state = setup(4, [80, 100, 95, 20]);
  appointCaptain(state, state.samsarites[0].id);
  assert.equal(rivalMarkBetween(state, state.samsarites[1], state.samsarites[2]), null);
  addRivalMark(state, state.samsarites[1], state.samsarites[2]);
  const back = deserialize(serialize(state));
  assert.ok(rivalMarkBetween(back, back.samsarites[1], back.samsarites[2]), "標記存讀後還在");
});
