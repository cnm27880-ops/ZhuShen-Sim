// Phase 4-E-6：小隊系統整合——決定性、存讀檔接續、forceStyle、副本結算全流程接上流派分潤
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/data/config.js";
import { createNewGame, createSamsarite, serialize, deserialize, currentDay } from "../src/engine/core.js";
import { step } from "../src/engine/dispatch.js";
import { startRun } from "../src/engine/dungeon.js";
import { appointCaptain, styleOf, captainOf, bump } from "../src/engine/squad.js";

function play(seed, days, { level = 2, tweak = null } = {}) {
  const state = createNewGame(seed);
  state.spaceLevel = level;
  state.points = 5000;
  state.settings.autoDispatch = true;
  tweak?.(state);
  while (currentDay(state) <= days && !state.gameOver) step(state);
  return state;
}

test("決定性：同種子、同操作 → 小隊與編年史完全相同（含獨立亂數流）", () => {
  const a = play(77, 40);
  const b = play(77, 40);
  assert.equal(serialize(a), serialize(b));
  assert.ok(a.squad.captainId != null, "跑 40 天後一定有隊長");
  assert.ok(a.chronicles.length > 0);
});

test("存讀檔：中途存檔再讀回來繼續跑，結果與不中斷一路跑完一致", () => {
  const straight = play(78, 50);
  const half = play(78, 25);
  const loaded = deserialize(serialize(half));
  loaded.settings.autoDispatch = true;
  while (currentDay(loaded) <= 50 && !loaded.gameOver) step(loaded);
  assert.equal(serialize(loaded), serialize(straight));
});

test("空間 Lv.1（隊長系統沒啟用）：沒有隊長、沒有編年史政變、沒有 5:2:1 人際事件", () => {
  const s = play(79, 30, { level: 1, tweak: (st) => { st.spaceLevel = 1; } });
  if (s.spaceLevel === 1) {
    assert.equal(s.squad.captainId, null);
    assert.equal(s.squad.counters.drama ?? 0, 0);
    assert.equal(s.squad.counters.coup ?? 0, 0);
  }
});

test("forceStyle：CONFIG.squad.forceStyle 讓任何隊長都開啟指定流派（sim 用）", () => {
  const keep = CONFIG.squad.forceStyle;
  CONFIG.squad.forceStyle = "farming";
  try {
    const state = createNewGame(5);
    state.spaceLevel = 2;
    appointCaptain(state, state.samsarites[0].id);
    assert.equal(styleOf(state), "farming");
  } finally {
    CONFIG.squad.forceStyle = keep;
  }
});

test("副本結算全流程：共產流 → 存活隊員私房錢均等；養殖流 → 隊長拿 80% 稅後；摘要 tax／share 吻合", () => {
  for (const [tag, check] of [
    ["lecturer", (s, members) => assert.equal(new Set(members.map((m) => m.wallet)).size, 1)],
    ["smiling_tiger", (s, members) => {
      const cap = captainOf(s);
      const rest = members.filter((m) => m.id !== cap.id);
      assert.ok(cap.wallet > rest[0].wallet * 3, `隊長 ${cap.wallet} vs 隊員 ${rest[0].wallet}`);
    }],
  ]) {
    const state = createNewGame(9);
    state.spaceLevel = 2;
    state.samsarites = [];
    for (let i = 0; i < 4; i++) {
      const s = createSamsarite(state, "C");
      s.tags = i === 0 ? [tag] : [];
      s.stats.power = 8000;
      state.samsarites.push(s);
    }
    appointCaptain(state, state.samsarites[0].id);
    const ids = state.samsarites.map((s) => s.id);
    assert.equal(startRun(state, "ghost_village", ids).ok, true);
    let guard = 0;
    while (state.runs.length && guard++ < 200) step(state);
    const rep = state.lastRun;
    assert.ok(rep.success, "戰力碾壓必過");
    const members = state.samsarites;
    const wallets = members.reduce((n, m) => n + m.wallet, 0);
    assert.ok(Math.abs(wallets + rep.tax - rep.reward) <= members.length, "稅＋私房錢 = 總積分（零頭歸公庫）");
    check(state, members);
  }
});

test("計數器 bump：累計次數會跟著存檔", () => {
  const state = createNewGame(3);
  bump(state, "coup");
  bump(state, "coup", 2);
  assert.equal(deserialize(serialize(state)).squad.counters.coup, 3);
});
