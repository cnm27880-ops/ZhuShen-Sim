// 個性系統 v3：許願權重掛鉤個性，抗命＝真的不肯出征（強制任務與洲際碰撞照樣徵召）
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/data/config.js";

CONFIG.tension.enabled = false; // 這個檔案測抗命；無人看管的人際張力（見 test/tension.test.js）不要干擾
import { createNewGame, createSamsarite, serialize, deserialize } from "../src/engine/core.js";
import { wishWeightMult } from "../src/engine/personality.js";
import { startDefy, isDefiant, dailyWishes, refuseWish, maybeWish } from "../src/engine/wishes.js";
import { startRun } from "../src/engine/dungeon.js";
import { autoCandidates, autoMandatory } from "../src/engine/dispatch.js";
import { MANDATORY_ID } from "../src/engine/mandatory.js";
import { LOGS } from "../src/data/logs.js";

function setup(n, seed = 9) {
  const state = createNewGame(seed);
  state.samsarites = [];
  state.points = 1e6;
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, "C");
    s.tags = [];
    s.traits = { altruism: 0, ambition: 0, courage: 0, social: 0, obedience: 0 };
    state.samsarites.push(s);
  }
  return state;
}
const OLD_CHANCE = CONFIG.wish.chance;
const withV3 = (on, fn) => {
  const old = CONFIG.personality.v3.enabled;
  CONFIG.personality.v3.enabled = on;
  try {
    return fn();
  } finally {
    CONFIG.personality.v3.enabled = old;
  }
};

test("資料：有 defyStart 日誌句（至少 3 句）、每個許願種類權重表的軸合法", () => {
  assert.ok(LOGS.defyStart.length >= 3);
  for (const [kind, w] of Object.entries(CONFIG.personality.v3.wishWeight)) {
    assert.ok(["altruism", "ambition", "courage", "social", "obedience"].includes(w.axis), kind);
  }
});

test("許願權重：該軸高乘 hi、低乘 lo、沒特色為 1、關閉為 1", () => {
  const state = setup(1);
  const [s] = state.samsarites;
  const w = CONFIG.personality.v3.wishWeight;
  assert.equal(wishWeightMult(s, "dungeon"), 1);
  s.traits.courage = 60;
  assert.equal(wishWeightMult(s, "dungeon"), w.dungeon.hi);
  s.traits.courage = -60;
  assert.equal(wishWeightMult(s, "dungeon"), w.dungeon.lo);
  s.traits.obedience = -50;
  assert.equal(wishWeightMult(s, "vacation"), w.vacation.lo);
  assert.equal(wishWeightMult(s, "未知種類"), 1);
  withV3(false, () => assert.equal(wishWeightMult(s, "dungeon"), 1));
});

test("許願權重只調權重：每次 maybeWish 消耗的主亂數次數與個性無關", () => {
  const draws = (traits) => {
    const state = setup(1, 33);
    Object.assign(state.samsarites[0].traits, traits);
    CONFIG.wish.chance = 1;
    try {
      const before = state.rngState;
      maybeWish(state, state.samsarites[0]);
      return { moved: state.rngState !== before };
    } finally {
      CONFIG.wish.chance = OLD_CHANCE;
    }
  };
  assert.deepEqual(draws({ courage: 80 }).moved, draws({ courage: -80 }).moved);
});

test("startDefy：設定天數、取較長者、只在第一次寫日誌；嬰兒與關閉時不生效", () => {
  const state = setup(2);
  const [a, baby] = state.samsarites;
  baby.location = "pod";
  assert.equal(startDefy(state, a, 3), true);
  assert.equal(a.defyDays, 3);
  assert.equal(isDefiant(a), true);
  const logs = state.events.length;
  startDefy(state, a, 5);
  assert.equal(a.defyDays, 5);
  startDefy(state, a, 2);
  assert.equal(a.defyDays, 5, "不會縮短");
  assert.equal(state.events.length, logs, "已在抗命不重複寫日誌");
  assert.equal(startDefy(state, baby, 3), false);
  assert.equal(baby.defyDays, 0);
  withV3(false, () => assert.equal(startDefy(state, state.samsarites[1], 3), false));
});

test("每日倒數：只在主神空間倒數，副本裡不倒", () => {
  const state = setup(2);
  const [a, b] = state.samsarites;
  a.defyDays = 2;
  b.defyDays = 2;
  b.location = "dungeon";
  dailyWishes(state);
  assert.equal(a.defyDays, 1);
  assert.equal(b.defyDays, 2);
  dailyWishes(state);
  dailyWishes(state);
  assert.equal(a.defyDays, 0);
  assert.equal(isDefiant(a), false);
});

test("抗命的人：一般派遣被拒絕（附原因）；強制任務與洲際碰撞照樣派得出去", () => {
  const state = setup(4);
  const [a, b] = state.samsarites;
  a.defyDays = 2;
  const r = startRun(state, "ghost_village", [a.id, b.id]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /抗命/);
  assert.equal(a.location, "space");

  state.mandatory.pending = { id: 1, createdDay: 1, deadlineDay: 99 };
  const m = startRun(state, MANDATORY_ID, [a.id, b.id]);
  assert.equal(m.ok, true, m.reason);
  assert.equal(a.location, "dungeon", "強制任務照樣徵召抗命者");
});

test("自動派遣：不挑抗命的人；強制任務自動徵召不排除他們（最後期限不會因抗命而被抹殺）", () => {
  const state = setup(5);
  const [a, ...rest] = state.samsarites;
  a.defyDays = 3;
  assert.ok(!autoCandidates(state).includes(a));
  assert.equal(autoCandidates(state).length, rest.length);

  // 全部人都抗命：一般自動派遣不派；但強制任務到最後期限仍會派人
  for (const s of state.samsarites) s.defyDays = 3;
  assert.equal(autoCandidates(state).length, 0);
  state.mandatory.pending = { id: 1, createdDay: 1, deadlineDay: 2 }; // 今天就是最後期限
  const sent = autoMandatory(state);
  assert.equal(sent, 1);
  assert.ok(state.runs.length === 1 && state.runs[0].partyIds.length > 0);
});

test("拒絕許願：順從度低的人額外抗命；順從的人只有不爽", () => {
  const stateA = setup(1, 41);
  const [rebel] = stateA.samsarites;
  rebel.traits.obedience = -60;
  CONFIG.wish.chance = 1;
  try {
    assert.equal(maybeWish(stateA, rebel), true);
  } finally {
    CONFIG.wish.chance = OLD_CHANCE;
  }
  refuseWish(stateA, stateA.wishes[0].id);
  assert.equal(rebel.defyDays, CONFIG.personality.v3.refuseDefy.days);
  assert.equal(rebel.mood.kind, "upset");

  const stateB = setup(1, 41);
  const [good] = stateB.samsarites;
  good.traits.obedience = 30;
  CONFIG.wish.chance = 1;
  try {
    maybeWish(stateB, good);
  } finally {
    CONFIG.wish.chance = OLD_CHANCE;
  }
  refuseWish(stateB, stateB.wishes[0].id);
  assert.equal(good.defyDays, 0);
  assert.equal(good.mood.kind, "upset");
});

test("存檔：defyDays 讀檔保留，舊存檔缺欄位補 0", () => {
  const state = setup(2);
  state.samsarites[0].defyDays = 2;
  const back = deserialize(serialize(state));
  assert.equal(back.samsarites[0].defyDays, 2);
  const raw = JSON.parse(serialize(state));
  for (const s of raw.samsarites) delete s.defyDays;
  const old = deserialize(JSON.stringify(raw));
  assert.equal(old.samsarites[0].defyDays, 0);
});
