// A-2 壓力系統：主神抽成（邊際級距）＋主神考核（KPI）
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG, PAUSE_EVENTS } from "../src/data/config.js";
import { createNewGame, createSamsarite, advanceTick, killSamsarite, serialize, deserialize } from "../src/engine/core.js";
import { dailyPressure, titheOf, kpiStatus, pressureRecord, titheMultOf } from "../src/engine/pressure.js";
import { manualRefresh, manualRefreshCost } from "../src/engine/market.js";

const P = () => CONFIG.pressure;
const dayEnd = (state, day) => { state.tick = day * CONFIG.ticksPerDay; };

function game(level = 2) {
  const state = createNewGame(5);
  state.spaceLevel = level;
  state.samsarites = [];
  for (let i = 0; i < 3; i++) { const s = createSamsarite(state, "C"); s.tags = []; state.samsarites.push(s); }
  return state;
}

test("抽成：邊際級距只算超額、有單日上限、抽完不低於免稅額", () => {
  const L = P().exempt[1];
  assert.equal(titheOf(L, L), 0);
  assert.equal(titheOf(L - 1, L), 0);
  assert.equal(titheOf(L * 2, L), Math.floor(L * P().brackets[0].rate)); // 只在第一級距
  // 跨級距：5L = (3L-L)*0.2% + (5L-3L)*0.5%
  assert.equal(titheOf(L * 5, L), Math.floor(L * 2 * P().brackets[0].rate + L * 2 * P().brackets[1].rate));
  // 單日上限 2%
  const huge = L * 1000;
  assert.ok(titheOf(huge, L) <= huge * P().dailyCapPct);
  // 倍率放大後仍不會讓公庫跌破 L
  const p = L + 10;
  assert.ok(p - titheOf(p, L, 100) >= L);
  assert.equal(titheOf(1e9, 0), 0); // 免稅額 0 = 關閉
});

test("Lv.1 零觸發：不抽成、不開考核、不改狀態", () => {
  const state = game(1);
  state.points = 5e6;
  const before = JSON.stringify(state.pressure);
  for (let d = 1; d <= 100; d++) { dayEnd(state, d); dailyPressure(state); }
  assert.equal(state.points, 5e6);
  assert.equal(JSON.stringify(state.pressure), before);
  assert.equal(state.pressure.targets, null);
});

test("公庫低於免稅額不抽（含負債）", () => {
  const state = game(3);
  for (const pts of [-300, 0, 1000, CONFIG.pressure.exempt[2]]) {
    state.points = pts;
    dayEnd(state, 40);
    const t = state.pressure.titheTotal;
    dailyPressure(state);
    assert.equal(state.points, pts);
    assert.equal(state.pressure.titheTotal, t);
  }
});

test("Day 30 前不啟動；啟動後每日抽成並累計", () => {
  const state = game(2);
  state.points = 1e6;
  dayEnd(state, 29);
  dailyPressure(state);
  assert.equal(state.pressure.targets, null);
  assert.equal(state.points, 1e6);
  dayEnd(state, 30);
  dailyPressure(state);
  assert.ok(state.pressure.targets);
  assert.ok(state.points < 1e6);
  assert.equal(state.pressure.titheTotal, 1e6 - state.points);
});

function runPeriod(state, { clears, earned, deaths }) {
  pressureRecord(state, "clears", clears);
  pressureRecord(state, "earned", earned);
  pressureRecord(state, "deaths", deaths);
}

test("考核達標：理智 +10、抽成減半、全過送免費刷新；考核期滿自動開下一期", () => {
  const state = game(2);
  state.points = 100000;
  dayEnd(state, 30);
  dailyPressure(state);
  const t = state.pressure.targets;
  for (const s of state.samsarites) s.stats.sanity = 50;
  runPeriod(state, { clears: t.clears, earned: t.earned, deaths: 0 });
  assert.equal(kpiStatus(state).passed, 3);
  dayEnd(state, 60);
  dailyPressure(state);
  const p = state.pressure;
  assert.equal(p.history.at(-1).pass, true);
  assert.equal(p.history.at(-1).perfect, true);
  assert.equal(state.samsarites[0].stats.sanity, 60);
  assert.equal(p.freeRefresh, P().perfectFreeRefresh);
  assert.equal(p.count, 2);
  assert.equal(p.period.clears, 0);
  assert.equal(titheMultOf(state, 61), 0.5);
  // 免費刷新：不扣積分，用完恢復收費
  const pts = state.points;
  assert.equal(manualRefreshCost(state), 0);
  assert.ok(manualRefresh(state).ok);
  assert.equal(state.points, pts);
  assert.equal(p.freeRefresh, P().perfectFreeRefresh - 1);
});

test("考核未達標：罰金不超過上限、不低於 L、理智不低於 20、抽成加課、連敗加重", () => {
  const state = game(2);
  const L = P().exempt[1];
  state.points = 500000;
  dayEnd(state, 30);
  dailyPressure(state);
  for (const s of state.samsarites) s.stats.sanity = 90;
  state.samsarites[2].stats.sanity = 10; // 本來就低於地板的人不再扣
  const pts0 = state.points;
  dayEnd(state, 60);
  dailyPressure(state);
  const p = state.pressure;
  const r1 = p.history.at(-1);
  assert.equal(r1.pass, false);
  assert.ok(r1.fine > 0 && r1.fine <= Math.round(pts0 * P().failFineCapPct));
  assert.equal(state.samsarites[0].stats.sanity, 90 - P().failSanity);
  assert.equal(state.samsarites[2].stats.sanity, 10);
  assert.equal(titheMultOf(state, 61), 1.5);
  assert.equal(p.streak, 1);
  // 連敗：罰金與理智 ×1.5
  dayEnd(state, 90);
  dailyPressure(state);
  assert.equal(p.streak, 2);
  assert.equal(state.samsarites[0].stats.sanity, 90 - P().failSanity - Math.round(P().failSanity * 1.5));
  assert.ok(state.points >= L);
  // 連敗 2 次後下期目標減免 15%
  const base = P().targetClears[1];
  assert.ok(p.targets.clears <= Math.round(base * 1.1 * 0.85) + 1);
});

test("公庫低於 L 時罰金為 0，只有理智與加課；絕不罰進負債", () => {
  const state = game(2);
  state.points = 1000;
  dayEnd(state, 30);
  dailyPressure(state);
  dayEnd(state, 60);
  dailyPressure(state);
  assert.equal(state.points, 1000);
  assert.equal(state.pressure.history.at(-1).fine, 0);
  assert.equal(state.pressure.history.at(-1).pass, false);
});

test("副本戰死／被抹殺才計入考核戰死；空間內被殺不算", () => {
  const state = game(2);
  dayEnd(state, 30);
  dailyPressure(state);
  killSamsarite(state, state.samsarites[0], "測試", null, "dungeon");
  assert.equal(state.pressure.period.deaths, 1);
  killSamsarite(state, state.samsarites[0], "測試", null, null);
  assert.equal(state.pressure.period.deaths, 1);
});

test("獨立亂數流：主亂數不受影響；舊存檔補預設；暫停事件預設關", () => {
  const a = game(2), b = game(2);
  a.points = b.points = 1e6;
  delete b.pressure; // 模擬舊存檔
  const c = deserialize(serialize(b));
  assert.ok(c.pressure && c.pressure.targets === null);
  const rngBefore = a.rngState;
  dayEnd(a, 30); dailyPressure(a); dayEnd(a, 60); dailyPressure(a);
  assert.equal(a.rngState, rngBefore);
  assert.equal(PAUSE_EVENTS.kpi.default, false);
});

test("整合：advanceTick 逐日推進，Lv.1 的種子結果與壓力系統無關", () => {
  const a = createNewGame(9), b = createNewGame(9);
  b.pressure.rngState = 12345; // 壓力亂數流不同也不該影響任何東西
  for (let i = 0; i < CONFIG.ticksPerDay * 40; i++) { advanceTick(a); advanceTick(b); }
  assert.equal(a.rngState, b.rngState);
  assert.equal(a.points, b.points);
});
