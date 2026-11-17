// A-3 階段 3：自動化中樞（調解中樞、人力調度處）。引擎 engine/automation.js，數字 CONFIG.automation。
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { CONFIG, PAUSE_EVENTS } from "../src/data/config.js";
import { createNewGame, createSamsarite, serialize, deserialize, currentDay } from "../src/engine/core.js";
import { tensionOf } from "../src/engine/tension.js";
import { automationOf, automationLevel, moduleActive, checkAutomationBuy, buyAutomation, repairCost, repairModule, dailyAutomation, autoMediate, setRecruitTarget, recruitCap } from "../src/engine/automation.js";

const SAVE_A = JSON.stringify(CONFIG.automation);
const SAVE_T = JSON.stringify(CONFIG.tension);
beforeEach(() => {
  Object.assign(CONFIG.automation, JSON.parse(SAVE_A));
  Object.assign(CONFIG.tension, JSON.parse(SAVE_T));
});
afterEach(() => {
  Object.assign(CONFIG.automation, JSON.parse(SAVE_A));
  Object.assign(CONFIG.tension, JSON.parse(SAVE_T));
});

/** n 個 C 級，都在主神空間，公庫 100000、空間 Lv.4（四級都買得起） */
function room(n = 4, seed = 3) {
  const state = createNewGame(seed);
  state.points = 100000;
  state.spaceLevel = 4;
  state.samsarites = [];
  for (let i = 0; i < n; i++) state.samsarites.push(createSamsarite(state, "C"));
  state.relations = {};
  state.mandatory.lastDay = 1e9;
  return state;
}

/** 直接塞一件張力事件（不經過產生機率） */
function addEvent(state, a, b, level = 1) {
  const t = tensionOf(state);
  const ev = { id: t.nextId++, kind: "quarrel", level, aId: a.id, bId: b.id, createdDay: currentDay(state), deadlineDay: currentDay(state) + 5, tried: false };
  t.pending.push(ev);
  return ev;
}
const setLevel = (state, id, lv) => {
  automationOf(state).levels[id] = lv;
};

test("新局全部 0 級；舊存檔讀檔補預設；設定與暫停事件都在", () => {
  const state = createNewGame(5);
  assert.equal(automationLevel(state, "mediate"), 0);
  assert.equal(automationLevel(state, "recruit"), 0);
  const old = JSON.parse(serialize(state));
  delete old.automation;
  const back = deserialize(JSON.stringify(old));
  assert.equal(back.automation.levels.mediate, 0);
  assert.ok(back.automation.rngState !== undefined);
  assert.equal(PAUSE_EVENTS.autoFault.default, true);
  for (const m of Object.values(CONFIG.automation.modules)) {
    assert.equal(m.cost.length, m.max);
    assert.equal(m.maint.length, m.max);
    assert.equal(m.fault.length, m.max);
  }
});

test("沒投資（全 0 級）：每日結算不扣錢、不消耗亂數、不補人", () => {
  const state = room(3);
  const points = state.points;
  const rng = automationOf(state).rngState;
  const n = state.samsarites.length;
  for (let i = 0; i < 5; i++) dailyAutomation(state);
  assert.equal(state.points, points);
  assert.equal(automationOf(state).rngState, rng);
  assert.equal(state.samsarites.length, n);
});

test("購買：受空間等級與公庫限制，買了扣款並升級", () => {
  const state = room(3);
  state.spaceLevel = 1;
  assert.equal(checkAutomationBuy(state, "mediate").ok, false);
  assert.match(checkAutomationBuy(state, "mediate").reason, /空間等級/);
  state.spaceLevel = 2;
  state.points = 0;
  assert.equal(checkAutomationBuy(state, "mediate").ok, false);
  state.points = 100000;
  const cost = CONFIG.automation.modules.mediate.cost[0];
  assert.equal(buyAutomation(state, "mediate").ok, true);
  assert.equal(state.points, 100000 - cost);
  assert.equal(automationLevel(state, "mediate"), 1);
  assert.equal(checkAutomationBuy(state, "mediate").ok, false); // Lv.2 要空間 Lv.3
  state.spaceLevel = 4;
  buyAutomation(state, "mediate");
  buyAutomation(state, "mediate");
  assert.equal(automationLevel(state, "mediate"), 3);
  assert.match(checkAutomationBuy(state, "mediate").reason, /上限/);
  assert.equal(checkAutomationBuy(state, "不存在").ok, false);
});

test("維護費：每天扣、付不起當天停擺且不借債、有錢後自動恢復", () => {
  CONFIG.automation.modules.mediate.fault = [0, 0, 0];
  const state = room(3);
  setLevel(state, "mediate", 1);
  const fee = CONFIG.automation.modules.mediate.maint[0];
  dailyAutomation(state);
  assert.equal(state.points, 100000 - fee);
  assert.equal(moduleActive(state, "mediate"), true);
  assert.equal(automationOf(state).stats.maintPaid, fee);

  state.tick += CONFIG.ticksPerDay; // 隔天
  state.points = fee - 1;
  dailyAutomation(state);
  assert.equal(state.points, fee - 1, "付不起就不扣");
  assert.equal(moduleActive(state, "mediate"), false);
  assert.equal(automationOf(state).unpaid.mediate, true);
  assert.equal(automationOf(state).stats.offDays, 1);

  state.tick += CONFIG.ticksPerDay;
  state.points = 1000;
  dailyAutomation(state);
  assert.equal(moduleActive(state, "mediate"), true);
  assert.equal(automationOf(state).unpaid.mediate, false);
});

test("故障：故障後不運作、不扣維護費、發 autoFault 事件；一定要手動維修才恢復", () => {
  CONFIG.automation.modules.mediate.fault = [1, 1, 1];
  const state = room(3);
  setLevel(state, "mediate", 1);
  dailyAutomation(state);
  assert.equal(automationOf(state).broken.mediate, true);
  assert.equal(state.points, 100000, "故障當天不扣維護費");
  assert.ok(state.events.some((e) => e.type === "autoFault"));
  assert.equal(moduleActive(state, "mediate"), false);

  CONFIG.automation.modules.mediate.fault = [0, 0, 0];
  for (let i = 0; i < 5; i++) {
    state.tick += CONFIG.ticksPerDay;
    dailyAutomation(state);
  }
  assert.equal(automationOf(state).broken.mediate, true, "沒有自動修復");
  assert.equal(state.points, 100000, "壞著不會扣維護費");

  const cost = repairCost(state, "mediate");
  assert.equal(cost, CONFIG.automation.modules.mediate.maint[0] * CONFIG.automation.repairMult);
  assert.equal(repairModule(state, "mediate").ok, true);
  assert.equal(state.points, 100000 - cost);
  assert.equal(automationOf(state).broken.mediate, false);
  assert.equal(repairModule(state, "mediate").ok, false, "沒壞不能修");
  state.tick += CONFIG.ticksPerDay;
  dailyAutomation(state);
  assert.equal(moduleActive(state, "mediate"), true);
});

test("維修：公庫不夠就修不了", () => {
  const state = room(3);
  setLevel(state, "mediate", 3);
  automationOf(state).broken.mediate = true;
  state.points = -1e9;
  assert.equal(repairModule(state, "mediate").ok, false);
  assert.equal(automationOf(state).broken.mediate, true);
});

test("調解中樞：只處理等級 1、容量有限、不處理已試過或等級 3 的事件", () => {
  CONFIG.automation.modules.mediate.fault = [0, 0, 0];
  CONFIG.automation.modules.mediate.chanceMult = [1000, 1000, 1000]; // 必成功，方便數件數
  const state = room(8);
  const [a, b, c, d, e, f, g, h] = state.samsarites;
  setLevel(state, "mediate", 1); // 容量 1、只處理等級 1
  dailyAutomation(state);
  const ev1 = addEvent(state, a, b, 1);
  const ev2 = addEvent(state, c, d, 1);
  const ev3 = addEvent(state, e, f, 2);
  autoMediate(state);
  const left = tensionOf(state).pending.map((x) => x.id);
  assert.equal(left.length, 2, "Lv.1 一天只處理 1 件");
  assert.ok(left.includes(ev3.id), "等級 2 的事件 Lv.1 不碰");
  assert.equal(automationOf(state).stats.handled, 1);
  assert.equal(automationOf(state).stats.ok, 1);
  assert.ok(!left.includes(ev1.id) || !left.includes(ev2.id));

  // Lv.3：容量 3、最高處理等級 2，但等級 3 永遠不碰
  setLevel(state, "mediate", 3);
  state.tick += CONFIG.ticksPerDay;
  dailyAutomation(state);
  const ev4 = addEvent(state, g, h, 3);
  autoMediate(state);
  const ids = tensionOf(state).pending.map((x) => x.id);
  assert.ok(ids.includes(ev4.id), "等級 3 留給人");
  assert.ok(!ids.includes(ev3.id), "等級 2 的事件 Lv.3 會處理");
});

test("調解中樞：失敗和手動失敗一樣有後果，事件標為已試過、不會再被自動處理", () => {
  CONFIG.automation.modules.mediate.fault = [0, 0, 0];
  CONFIG.automation.modules.mediate.chanceMult = [0, 0, 0]; // 必失敗
  const state = room(4);
  const [a, b] = state.samsarites;
  setLevel(state, "mediate", 2);
  dailyAutomation(state);
  const ev = addEvent(state, a, b, 1);
  const g0 = (a.grudge ?? 0) + (b.grudge ?? 0);
  autoMediate(state);
  assert.equal(ev.tried, true);
  assert.equal(automationOf(state).stats.fail, 1);
  assert.equal((a.grudge ?? 0) + (b.grudge ?? 0), g0 + 2 * CONFIG.tension.mediate.failGrudge);
  autoMediate(state);
  assert.equal(automationOf(state).stats.handled, 1, "已試過的事件不再自動處理");
});

test("調解中樞：故障、停擺、沒投資時完全不處理", () => {
  CONFIG.automation.modules.mediate.chanceMult = [1000, 1000, 1000];
  const state = room(4);
  const [a, b] = state.samsarites;
  const ev = addEvent(state, a, b, 1);
  autoMediate(state); // 0 級
  assert.equal(tensionOf(state).pending.length, 1);
  setLevel(state, "mediate", 3);
  autoMediate(state); // 今天還沒付維護費
  assert.equal(tensionOf(state).pending.length, 1);
  dailyAutomation(state);
  automationOf(state).broken.mediate = true;
  autoMediate(state); // 故障
  assert.equal(tensionOf(state).pending.length, 1);
  assert.equal(ev.tried, false);
});

test("人力調度處：名冊低於目標才補、每天最多 1 人、目標被等級上限夾住", () => {
  CONFIG.automation.modules.recruit.fault = [0, 0, 0];
  const state = room(2);
  setLevel(state, "recruit", 1);
  assert.equal(recruitCap(state), 6);
  assert.equal(setRecruitTarget(state, 99), 6, "超過上限會被夾住");
  assert.equal(setRecruitTarget(state, 4), 4);
  dailyAutomation(state);
  assert.equal(state.samsarites.length, 3, "一天只補 1 人");
  assert.equal(automationOf(state).stats.recruits, 1);
  state.tick += CONFIG.ticksPerDay;
  dailyAutomation(state);
  assert.equal(state.samsarites.length, 4);
  state.tick += CONFIG.ticksPerDay;
  dailyAutomation(state);
  assert.equal(state.samsarites.length, 4, "達到目標就不再補");
});

test("人力調度處：公庫不夠寬裕、故障時不補人", () => {
  CONFIG.automation.modules.recruit.fault = [0, 0, 0];
  const state = room(2);
  setLevel(state, "recruit", 1);
  setRecruitTarget(state, 6);
  state.points = 150; // 買得起最便宜的卡池也不夠留 15 天維持費
  dailyAutomation(state);
  assert.equal(state.samsarites.length, 2);

  const s2 = room(2);
  setLevel(s2, "recruit", 1);
  setRecruitTarget(s2, 6);
  automationOf(s2).broken.recruit = true;
  dailyAutomation(s2);
  assert.equal(s2.samsarites.length, 2);
});

test("人力調度處：催熟艙的嬰兒不算名冊人數", () => {
  CONFIG.automation.modules.recruit.fault = [0, 0, 0];
  const state = room(2);
  state.samsarites[1].location = "pod";
  setLevel(state, "recruit", 1);
  setRecruitTarget(state, 2);
  dailyAutomation(state);
  assert.equal(state.samsarites.length, 3, "名冊只有 1 人（嬰兒不算），所以要補");
});

test("存檔往返：自動化狀態完整保留", () => {
  const state = room(3);
  setLevel(state, "mediate", 2);
  automationOf(state).broken.recruit = true;
  automationOf(state).recruitTarget = 5;
  const back = deserialize(serialize(state));
  assert.equal(back.automation.levels.mediate, 2);
  assert.equal(back.automation.broken.recruit, true);
  assert.equal(back.automation.recruitTarget, 5);
});
