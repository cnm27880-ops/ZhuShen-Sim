// Phase 3-F：生小孩與主神催熟艙（懷孕機率、催熟 3 天、標籤繼承、嬰兒限制、獨立亂數流、存檔相容）
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG, PAUSE_EVENTS } from "../src/data/config.js";
import { LOGS } from "../src/data/logs.js";
import { getTag } from "../src/data/tags.js";
import { createNewGame, createSamsarite, advanceTick, endOfDay, upkeepOf, recycle, serialize, deserialize } from "../src/engine/core.js";
import { dailyNursery, giveBirth, podBabies, podCost } from "../src/engine/children.js";
import { tryAutoDispatch } from "../src/engine/dispatch.js";
import { startRun } from "../src/engine/dungeon.js";

const C = () => CONFIG.child;

/** 一對戀人／靈魂伴侶，都在主神空間 */
function couple(status = "lover", seed = 5) {
  const state = createNewGame(seed);
  state.points = 5000;
  state.samsarites = [];
  const a = createSamsarite(state, "B");
  const b = createSamsarite(state, "A");
  state.samsarites.push(a, b);
  state.relations = {
    [`${a.id}>${b.id}`]: { love: 60, hate: 0, status },
    [`${b.id}>${a.id}`]: { love: 60, hate: 0, status },
  };
  return { state, a, b };
}

const days = (state, n) => {
  for (let i = 0; i < n * CONFIG.ticksPerDay; i++) advanceTick(state);
};

test("giveBirth：嬰兒進催熟艙，不能派遣，標籤欄位完整", () => {
  const { state, a, b } = couple();
  const child = giveBirth(state, a, b);
  assert.equal(child.location, "pod");
  assert.equal(child.podDaysLeft, C().podDays);
  assert.deepEqual(child.parents, [a.id, b.id]);
  assert.ok(["B", "A", "S"].includes(child.rank));
  assert.ok(child.tags.length >= 4 && child.tags.length <= 5);
  assert.equal(new Set(child.tags).size, child.tags.length, "標籤不重複");
  assert.equal(podBabies(state).length, 1);
  assert.ok(state.events.some((e) => e.type === "birth"));
  // 嬰兒不能出征
  assert.equal(startRun(state, "village", [child.id]).ok, false);
});

test("催熟艙：每天只收 podUpkeep，三天後長成輪迴者並發出 hatch 事件", () => {
  const { state, a, b } = couple();
  const child = giveBirth(state, a, b);
  assert.equal(upkeepOf(child), C().podUpkeep);
  assert.equal(podCost(state), C().podUpkeep);
  state.events.length = 0;
  for (let d = 1; d <= C().podDays; d++) {
    state.points = 5000;
    endOfDay(state);
    assert.equal(5000 - state.points, upkeepOf(a) + upkeepOf(b) + C().podUpkeep, "帳單 = 兩位家長 + 嬰兒固定費");
    dailyNursery(state);
    assert.equal(child.location, d < C().podDays ? "pod" : "space");
  }
  assert.equal(child.podDaysLeft, 0);
  assert.ok(state.events.some((e) => e.type === "hatch" && e.samsariteId === child.id));
  assert.equal(podBabies(state).length, 0);
});

test("嬰兒不能被回收、不會被自動派遣挑中", () => {
  const { state, a, b } = couple();
  const child = giveBirth(state, a, b);
  child.stats.power = 9999;
  assert.equal(recycle(state, child.id), false);
  tryAutoDispatch(state);
  assert.ok(state.runs.every((r) => !r.partyIds.includes(child.id)));
});

test("標籤繼承：inheritChance = 1 時，父母有的同類標籤一定被抄；0 時完全不抄", () => {
  const prev = C().inheritChance;
  try {
    CONFIG.child.inheritChance = 1;
    const { state, a, b } = couple("soulmate", 9);
    const child = giveBirth(state, a, b);
    const parentTags = [...a.tags, ...b.tags];
    assert.ok(child.inheritedTags.length > 0);
    assert.ok(child.inheritedTags.every((t) => parentTags.includes(t)));
    assert.ok(child.tags.every((t) => getTag(t)), "標籤都是資料表裡存在的");

    CONFIG.child.inheritChance = 0;
    const second = couple("soulmate", 9);
    const kid = giveBirth(second.state, second.a, second.b);
    assert.equal(kid.tags.filter((t) => [...second.a.tags, ...second.b.tags].includes(t)).length, kid.inheritedTags.length);
  } finally {
    CONFIG.child.inheritChance = prev;
  }
});

test("懷孕條件：戀人才會生；一方在副本、冷卻中、催熟艙滿了都不會生", () => {
  const prev = { ...C().chance };
  try {
    CONFIG.child.chance = { lover: 1, soulmate: 1 };
    // 普通朋友不會生
    const friends = couple("lover");
    friends.state.relations = {};
    dailyNursery(friends.state);
    assert.equal(podBabies(friends.state).length, 0);

    // 一方在副本
    const away = couple("lover");
    away.a.location = "dungeon";
    dailyNursery(away.state);
    assert.equal(podBabies(away.state).length, 0);

    // 正常生一個，冷卻中不再生
    const ok = couple("soulmate");
    dailyNursery(ok.state);
    assert.equal(podBabies(ok.state).length, 1);
    dailyNursery(ok.state);
    assert.equal(podBabies(ok.state).length, 1, "冷卻中");

    // 催熟艙滿了
    const full = couple("lover");
    for (let i = 0; i < C().maxInPod; i++) full.state.samsarites.push({ ...createSamsarite(full.state, "C"), location: "pod", podDaysLeft: 3 });
    dailyNursery(full.state);
    assert.equal(podBabies(full.state).length, C().maxInPod);
  } finally {
    CONFIG.child.chance = prev;
  }
});

test("不動主亂數：生小孩不改變 state.rngState 的序列", () => {
  const { state, a, b } = couple();
  const before = state.rngState;
  giveBirth(state, a, b);
  dailyNursery(state);
  assert.equal(state.rngState, before);
});

test("存檔：嬰兒存讀後還在催熟艙；舊存檔缺 nursery 欄位會補上", () => {
  const { state, a, b } = couple();
  const child = giveBirth(state, a, b);
  const back = deserialize(serialize(state));
  const kid = back.samsarites.find((s) => s.id === child.id);
  assert.equal(kid.location, "pod");
  assert.equal(kid.podDaysLeft, C().podDays);

  const old = JSON.parse(serialize(state));
  delete old.nursery;
  for (const s of old.samsarites) {
    delete s.podDaysLeft;
    delete s.parents;
  }
  const migrated = deserialize(JSON.stringify(old));
  assert.ok(migrated.nursery && typeof migrated.nursery.rngState === "number");
  assert.equal(migrated.samsarites[0].podDaysLeft, 0);
});

test("長時間模擬：靈魂伴侶一定生得出小孩，且催熟完成後可正常加入", () => {
  const { state } = couple("soulmate", 21);
  state.points = 100000;
  state.mandatory.lastDay = 1e9; // 這個測試沒人派隊，關掉主神強制任務（否則逾時會被抹殺，4-C-4）
  days(state, 120);
  const kids = state.samsarites.filter((s) => s.parents);
  assert.ok(kids.length > 0, "120 天內至少生過一個");
  assert.ok(kids.every((k) => k.location !== "pod" || k.podDaysLeft > 0));
});

test("設定與日誌：暫停事件 birth／hatch 存在，日誌模板完整", () => {
  assert.ok(PAUSE_EVENTS.birth && PAUSE_EVENTS.hatch);
  for (const key of ["birth", "hatch", "hatchPlain"]) assert.ok(LOGS[key]?.length >= 2, key);
  const { state } = couple();
  assert.equal(state.settings.pauseOn.birth, true);
});
