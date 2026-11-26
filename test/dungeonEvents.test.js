// 副本特殊事件（第 1 章試點）：資料表、目標選擇、一場一次、動態副本與侵蝕不觸發、報告與日誌、舊存檔、關閉時不擲亂數
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/data/config.js";
import { DUNGEON_EVENTS } from "../src/data/dungeonEvents.js";
import { CODEX_ALL } from "../src/data/tagCodex.js";
import { TYPE_CATEGORY } from "../src/data/logCategories.js";
import { getDungeon } from "../src/data/dungeons.js";
import { WORLD_LIST, worldIdOf } from "../src/data/worlds.js";
import { createNewGame, createSamsarite, serialize, deserialize } from "../src/engine/core.js";
import { startRun, stepRun } from "../src/engine/dungeon.js";
import { step } from "../src/engine/dispatch.js";
import { eventsOf, pickTarget, getRunEvent } from "../src/engine/dungeonEvents.js";
import { MANDATORY_ID } from "../src/engine/mandatory.js";
import { getRel } from "../src/engine/relations.js";

const ch1 = ["ch1_01", "ch1_02", "ch1_03", "ch1_04", "ch1_05", "ch1_boss"]; // 規格編號（引擎 id 用 worldIdOf 轉）
// 30 個世界的規格編號：第 1 章 1／3／5 關在引擎裡是語意 id，WORLD_LIST 順序 = 每章 5 個常規（01～05）＋尾王
const ALL_SPEC = [1, 2, 3, 4, 5].flatMap((c) => [...[1, 2, 3, 4, 5].map((k) => `ch${c}_0${k}`), `ch${c}_boss`]);
assert.equal(WORLD_LIST.length, ALL_SPEC.length);

function setup(n = 3, seed = 11) {
  const state = createNewGame(seed);
  state.points = 100000;
  state.spaceLevel = 5;
  state.samsarites = [];
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, "C");
    s.tags = [];
    s.stats.power = 99999; // 房間幾乎必過、不受傷
    s.stats.sanity = 100;
    state.samsarites.push(s);
  }
  return state;
}
const runAll = (state) => {
  let guard = 0;
  while (state.runs.length && guard++ < 200) step(state);
};
/** 開一場、強制指定事件，走到事件房間（roomIndex 2）剛結算完 */
function runWith(state, worldSpecId, eventId, ids) {
  const r = startRun(state, worldIdOf(worldSpecId), ids ?? state.samsarites.map((s) => s.id));
  assert.equal(r.ok, true, r.reason);
  r.run.eventId = eventId;
  return r.run;
}
const stepTo = (state, run, n) => {
  while (run.roomIndex < n) stepRun(state, run);
};

test("資料表：30 個世界各恰好 3 個事件，id 不重複、效果種類合法、數字合規", () => {
  assert.equal(DUNGEON_EVENTS.length, 90);
  assert.equal(new Set(DUNGEON_EVENTS.map((e) => e.id)).size, 90);
  const c = CONFIG.dungeonEvent;
  assert.deepEqual(c.chapters, [1, 2, 3, 4, 5]);
  assert.ok(c.chapterMult.every((m) => m === 1), "事件積分已是絕對數字，不能再乘章節倍率");
  for (const w of ALL_SPEC) {
    assert.equal(DUNGEON_EVENTS.filter((e) => e.world === w).length, 3, `${w} 要 3 個事件`);
    assert.ok(getDungeon(worldIdOf(w)), `${w} 找得到副本`);
    assert.equal(eventsOf(worldIdOf(w)).length, 3);
  }
  const codexNames = new Set(CODEX_ALL.map((t) => t.name));
  for (const e of DUNGEON_EVENTS) {
    assert.equal(e.room, Math.floor(getDungeon(worldIdOf(e.world)).rooms.length / 2), `${e.id} 要在中間房觸發`);
    assert.ok(["sanity", "injury", "points", "relation", "mood"].includes(e.fx.kind), e.id);
    if (e.fx.kind === "sanity") assert.ok(e.fx.value >= c.sanityMin && e.fx.value <= c.sanityMax, `${e.id} 理智超出上限`);
    if (e.fx.kind === "injury") assert.ok(["hurt", "heal"].includes(e.fx.mode));
    if (e.fx.kind === "relation") assert.ok(["love", "hate"].includes(e.fx.mode));
    if (e.fx.kind === "mood") assert.ok(["happy", "upset"].includes(e.fx.value));
    if (e.tag) assert.ok(codexNames.has(e.tag), `${e.id} 的詞條「${e.tag}」不在詞條庫`);
    assert.ok(e.text.includes("{name}") && e.log.includes("{name}"));
    // 日誌句寫死的數字要和 fx 一致（防止改了一邊忘了另一邊）
    if (["sanity", "points", "relation"].includes(e.fx.kind)) assert.ok(e.log.includes(String(Math.abs(e.fx.value))), `${e.id} log 數字與 fx 不符`);
    // 公庫積分事件不超過該副本通關獎勵的 35%（哈基米規格約 30%）
    if (e.fx.kind === "points") assert.ok(e.fx.value <= getDungeon(worldIdOf(e.world)).reward * 0.35, `${e.id} 積分過高`);
  }
});

test("日誌分類：副本事件歸「戰鬥」", () => {
  assert.equal(TYPE_CATEGORY.dungeonEvent, "battle");
});

test("目標選擇：有詞條優先（多人取 id 最小）；沒詞條或沒人有就取 id 最小", () => {
  const state = setup(3);
  const [a, b, c] = state.samsarites;
  const ev = getRunEvent("ev_ch1_03_a"); // 恐怖片作死專家
  assert.equal(pickTarget(ev, [c, b, a]).id, a.id, "沒人有詞條 → id 最小");
  b.tags = ["horror_fool"];
  c.tags = ["horror_fool"];
  assert.equal(pickTarget(ev, [a, b, c]).id, b.id, "b、c 都有 → id 較小的 b");
  const none = getRunEvent("ev_ch1_01_c"); // tag 無
  assert.equal(pickTarget(none, [c, b, a]).id, a.id);
  const heal = getRunEvent("ev_ch1_02_a");
  c.injury = 1;
  assert.equal(pickTarget(heal, [a, b, c]).id, c.id, "治傷事件優先選有輕傷的人");
});

test("觸發時機：第 3 間房（index 2）結算完才發生，一場只觸發一次", () => {
  const state = setup(3);
  const run = runWith(state, "ch1_03", "ev_ch1_03_c");
  stepTo(state, run, 2);
  assert.equal(run.events, undefined, "前兩間房還沒有事件");
  stepRun(state, run); // 走第 3 間房
  assert.equal(run.roomIndex, 3);
  assert.equal(run.events.length, 1);
  assert.equal(run.eventFired, true);
  stepTo(state, run, 5);
  assert.equal(run.events.length, 1, "一場最多 1 次");
  assert.equal(state.dungeonEvents.seen.ev_ch1_03_c, 1);
});

test("效果：理智（夾上限、不低於 1）、輕傷（只有無傷變輕傷）、公庫積分、好感／仇恨、心情", () => {
  // 理智 -10，理智 5 → 不低於 1
  let state = setup(2);
  state.samsarites[0].stats.sanity = 5;
  state.samsarites[0].tags = ["horror_fool"];
  let run = runWith(state, "ch1_03", "ev_ch1_03_a");
  stepTo(state, run, 3);
  assert.ok(state.samsarites[0].stats.sanity >= 1 && state.samsarites[0].stats.sanity <= 5);
  // 理智 +10 不超過 100
  state = setup(2);
  state.samsarites[0].stats.sanity = 95;
  run = runWith(state, "ch1_03", "ev_ch1_03_c");
  stepTo(state, run, 3);
  assert.ok(state.samsarites[0].stats.sanity <= 100);
  // 輕傷：無傷 → 輕傷；已有重傷 → 不動
  state = setup(2);
  run = runWith(state, "ch1_03", "ev_ch1_03_b");
  stepTo(state, run, 3);
  assert.equal(state.samsarites[0].injury, 1);
  assert.equal(run.events[0].applied, true);
  state = setup(2);
  state.samsarites[0].injury = 2;
  run = runWith(state, "ch1_03", "ev_ch1_03_b");
  stepTo(state, run, 3);
  assert.equal(state.samsarites[0].injury, 2);
  assert.equal(run.events[0].applied, false);
  assert.match(run.events[0].line, /沒造成任何影響|沒留下任何痕跡/);
  // 公庫積分：直接 +30，不記考核營收、不算累積花費
  state = setup(2);
  const before = state.points;
  const spent = state.totalSpent;
  run = runWith(state, "ch1_01", "ev_ch1_01_a");
  stepTo(state, run, 3);
  assert.equal(state.points - before, 30);
  assert.equal(state.totalSpent, spent);
  assert.equal(state.pressure?.earned ?? 0, 0, "不記考核營收");
  // 仇恨 +15（雙向）、好感 +15
  state = setup(2);
  const [a, b] = state.samsarites;
  run = runWith(state, "ch1_01", "ev_ch1_01_c");
  stepTo(state, run, 3);
  assert.equal(getRel(state, a, b).hate, 15);
  assert.equal(getRel(state, b, a).hate, 15);
  // 心情
  state = setup(2);
  state.samsarites[0].tags = [];
  run = runWith(state, "ch1_05", "ev_ch1_05_b");
  stepTo(state, run, 3);
  assert.equal(state.samsarites[0].mood?.kind, "upset");
});

test("單人隊伍的關係事件不會報錯（沒有對象，效果落空）", () => {
  const state = setup(1);
  const run = runWith(state, "ch1_04", "ev_ch1_04_b");
  stepTo(state, run, 3);
  assert.equal(run.events[0].applied, false);
});

test("強制任務、位面侵蝕、關閉開關、非試點章節都不觸發也不擲亂數", () => {
  // 強制任務
  let state = setup(4);
  state.mandatory.pending = { day: 1, deadlineDay: 9 };
  const r = startRun(state, MANDATORY_ID, state.samsarites.map((s) => s.id));
  if (r.ok) assert.equal(r.run.eventId, undefined);
  // 侵蝕
  state = setup(3);
  state.maxErosion = 1;
  const rng0 = state.dungeonEventRngState;
  const first = getDungeon(worldIdOf("ch1_01"));
  state.dungeonStats[first.id] = { attempts: 1, clears: 1, intel: 0 };
  const e = startRun(state, first.id, state.samsarites.map((s) => s.id), { erosion: 1 });
  if (e.ok) {
    assert.equal(e.run.eventId, undefined);
    assert.equal(state.dungeonEventRngState, rng0, "侵蝕出征不擲亂數");
  }
  // 關閉
  state = setup(3);
  const rng1 = state.dungeonEventRngState;
  CONFIG.dungeonEvent.enabled = false;
  try {
    const off = startRun(state, worldIdOf("ch1_01"), state.samsarites.map((s) => s.id));
    assert.equal(off.run.eventId, undefined);
    assert.equal(state.dungeonEventRngState, rng1);
  } finally {
    CONFIG.dungeonEvent.enabled = true;
  }
  // 沒開的章節：不擲（暫時把章節清單縮回第 1 章驗證）
  state = setup(3);
  const rng2 = state.dungeonEventRngState;
  const oldChapters = CONFIG.dungeonEvent.chapters;
  CONFIG.dungeonEvent.chapters = [1];
  try {
    const ch2 = WORLD_LIST.find((w) => w.chapter === 2);
    const ok = startRun(state, ch2.id, state.samsarites.map((s) => s.id));
    if (ok.ok) assert.equal(ok.run.eventId, undefined);
    assert.equal(state.dungeonEventRngState, rng2);
  } finally {
    CONFIG.dungeonEvent.chapters = oldChapters;
  }
});

test("事件不動主亂數流：開場擲事件前後主亂數序列只差副本本身的消耗（獨立流）", () => {
  const a = setup(3, 5);
  const b = setup(3, 5);
  CONFIG.dungeonEvent.enabled = false;
  startRun(a, worldIdOf("ch1_01"), a.samsarites.map((s) => s.id));
  CONFIG.dungeonEvent.enabled = true;
  startRun(b, worldIdOf("ch1_01"), b.samsarites.map((s) => s.id));
  assert.equal(a.rngState, b.rngState, "開場擲事件不消耗主亂數");
  assert.notEqual(a.dungeonEventRngState, b.dungeonEventRngState, "只動事件流");
});

test("報告與日誌：整場跑完後 report.events 與日誌都有事件，seen 計數累加", () => {
  const state = setup(3);
  const run = runWith(state, "ch1_02", "ev_ch1_02_b");
  runAll(state);
  assert.equal(state.lastRun.events.length, 1);
  assert.equal(state.lastRun.events[0].id, "ev_ch1_02_b");
  assert.ok(state.log.some((l) => l.type === "dungeonEvent" && l.text.includes("反鎖的車門")));
  assert.equal(state.dungeonEvents.seen.ev_ch1_02_b, 1);
  assert.ok(run);
});

test("第 2～5 章：事件在各章的中間房觸發，積分不再乘章節倍率", () => {
  const state = setup(2);
  state.chapterClears = { 5: 99 }; // 打開第 5 章尾王守門
  for (const m of state.samsarites) m.stats.power = 1e9; // 第 5 章尾王很強：確保前 6 間房都過、沒人戰死
  const before = state.points;
  const ev = getRunEvent("ev_ch5_boss_a"); // 公庫積分 +8640，第 7 間房（index 6）
  assert.equal(ev.room, 6);
  const run = runWith(state, "ch5_boss", ev.id);
  stepTo(state, run, 6);
  assert.equal(run.events, undefined, "第 6 間房前不觸發");
  stepRun(state, run);
  assert.equal(run.roomIndex, 7);
  assert.equal(run.events.length, 1);
  assert.equal(state.points - before, 8640, "不乘章節倍率");
});

test("開場每個世界都會從自己的 3 個事件裡挑，多場抽樣能抽到全部 3 種", () => {
  const state = setup(1);
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    state.samsarites[0].location = "space";
    const r = startRun(state, worldIdOf("ch1_04"), [state.samsarites[0].id]);
    seen.add(r.run.eventId);
    state.runs = [];
  }
  assert.equal(seen.size, 3);
  for (const id of seen) assert.equal(getRunEvent(id).world, "ch1_04");
});

test("舊存檔：缺 dungeonEventRngState／dungeonEvents 會補預設，進行中的舊場次不觸發", () => {
  const state = setup(3);
  delete state.dungeonEventRngState;
  delete state.dungeonEvents;
  const loaded = deserialize(serialize(state));
  assert.equal(typeof loaded.dungeonEventRngState, "number");
  assert.deepEqual(loaded.dungeonEvents, { seen: {} });
  const run = startRun(loaded, worldIdOf("ch1_01"), loaded.samsarites.map((s) => s.id)).run;
  delete run.eventId; // 舊場次沒有 eventId
  stepTo(loaded, run, 4);
  assert.equal(run.events, undefined);
});
