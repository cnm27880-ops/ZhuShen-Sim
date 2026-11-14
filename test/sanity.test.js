// Phase 4-C-2：理智閉環（戰力／內鬥檔位、扣理智來源、休息恢復、歸零暴走、走火入魔標籤）
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/data/config.js";
import { createNewGame, createSamsarite, endOfDay, setInjury, advanceTick, serialize, deserialize } from "../src/engine/core.js";
import { effectivePower, sanityPowerPct, sanityClashMult } from "../src/engine/tags.js";
import { startRun, stepRun } from "../src/engine/dungeon.js";
import { addHate, addLove, afterDeath, getRel, pickClash } from "../src/engine/relations.js";
import { dailySanity } from "../src/engine/sanity.js";

function setup(n, seed = 3) {
  const state = createNewGame(seed);
  state.samsarites = [];
  state.points = 1000000;
  const people = [];
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, "C");
    s.tags = [];
    state.samsarites.push(s);
    people.push(s);
  }
  return { state, people };
}

test("理智檔位：≥70 無懲罰、30～69 戰力 -10%、0～29 戰力 -25%", () => {
  const { people: [s] } = setup(1);
  s.stats.sanity = 100;
  const base = effectivePower(s);
  for (const [v, pct, mult] of [[70, 0, 1], [69, -0.1, 1.5], [30, -0.1, 1.5], [29, -0.25, 2.5], [1, -0.25, 2.5], [0, -0.25, 2.5]]) {
    s.stats.sanity = v;
    assert.equal(sanityPowerPct(s), pct, `理智 ${v}`);
    assert.equal(sanityClashMult(s), mult, `理智 ${v}`);
  }
  s.stats.sanity = 20;
  assert.equal(effectivePower(s), Math.round(base * 0.75));
});

test("隊內內鬥機率隨兩人中較低的理智放大（死敵 50% → ×2.5 封頂 100%）", () => {
  const rate = (sanityB) => {
    let n = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const { state, people } = setup(2, seed);
      addHate(state, people[0], people[1], 100);
      people[1].stats.sanity = sanityB;
      if (pickClash(state, people, 1)) n += 1;
    }
    return n;
  };
  const normal = rate(100);
  assert.ok(normal > 10 && normal < 50, `正常 ${normal}`);
  assert.equal(rate(20), 60, "理智 < 30：50% × 2.5 ≥ 100%，一定內鬥");
  assert.ok(rate(50) > normal, "理智 30～69 ×1.5 比正常高");
});

test("走火入魔：自己對別人的好感獲取減半，別人對他照常，一般人不受影響", () => {
  const { state, people: [a, b, c] } = setup(3);
  b.tags = ["demon_path"];
  addLove(state, b, a, 10); // b（入魔者）喜歡 a：減半
  addLove(state, a, b, 10); // a 喜歡 b：照常
  addLove(state, a, c, 10);
  assert.equal(getRel(state, b, a).love, 5);
  assert.equal(getRel(state, a, b).love, 10);
  assert.equal(getRel(state, a, c).love, 10);
  assert.equal(effectivePower(b), Math.round(b.stats.power * 1.08));
});

test("單房失敗：受害者理智 -5", () => {
  let fails = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const { state, people: [s] } = setup(1, seed);
    s.stats.power = 1;
    assert.equal(startRun(state, "ghost_village", [s.id]).ok, true);
    const run = state.runs[0];
    state.log = [];
    stepRun(state, run);
    const failed = state.log.some((e) => e.type === "roomFail");
    if (failed) {
      fails += 1;
      assert.equal(s.stats.sanity, 100 - CONFIG.sanity.roomFailLoss);
    } else assert.equal(s.stats.sanity, 100);
  }
  assert.ok(fails > 10, "戰力 1 的人大多會失敗");
});

test("同隊戰死：其他隊員理智 -10；空間內的死亡仍是舊的 -3", () => {
  const { state, people: [dead, mate, home] } = setup(3);
  state.samsarites = [mate, home];
  afterDeath(state, dead, null, [mate]); // 副本內戰死，隊友 = mate
  assert.equal(mate.stats.sanity, 100 - CONFIG.sanity.teammateDeathLoss);
  assert.equal(home.stats.sanity, 100, "留在空間的人沒看到");
  afterDeath(state, dead, null);
  assert.equal(home.stats.sanity, 100 - CONFIG.relations.deathFearSanity);
});

test("休息日：人在空間（含帶傷）每日 +3，上限 100；出征中的人不恢復", () => {
  const { state, people: [a, b, c] } = setup(3);
  a.stats.sanity = 50;
  b.stats.sanity = 50;
  setInjury(b, 3); // 躺床的重傷員也要回理智
  c.stats.sanity = 50;
  c.location = "dungeon";
  endOfDay(state);
  assert.equal(a.stats.sanity, 53);
  assert.equal(b.stats.sanity, 53);
  assert.equal(c.stats.sanity, 50);
  a.stats.sanity = 99;
  endOfDay(state);
  assert.equal(a.stats.sanity, 100);
});

test("理智歸零日結：暴走（入魔砍人或自殘），發作後理智回升到 40", () => {
  let demon = 0;
  let selfHarm = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const { state, people: [a, b] } = setup(2, seed);
    a.stats.sanity = 0;
    dailySanity(state);
    assert.equal(a.stats.sanity, CONFIG.sanity.crashRecoverTo);
    if (a.tags.includes("demon_path")) {
      demon += 1;
      assert.equal(b.injury, 1);
      assert.equal(a.injury, 0);
    } else {
      selfHarm += 1;
      assert.equal(a.injury, 1);
      assert.equal(b.injury, 0);
    }
  }
  assert.ok(demon > 20 && selfHarm > 20, `入魔 ${demon}／自殘 ${selfHarm}`);
});

test("暴走邊界：沒有其他人就自殘；傷勢封頂致命傷不致死；理智 > 0 或不在空間不發作", () => {
  const { state, people: [a] } = setup(1);
  a.stats.sanity = 0;
  setInjury(a, 3);
  dailySanity(state);
  assert.equal(a.injury, 3);
  assert.ok(state.samsarites.includes(a));
  assert.equal(a.stats.sanity, 40);

  const { state: s2, people: [b, c] } = setup(2);
  b.stats.sanity = 1;
  c.stats.sanity = 0;
  c.location = "dungeon";
  dailySanity(s2);
  assert.equal(b.stats.sanity, 1);
  assert.equal(c.stats.sanity, 0);
});

test("存檔：理智暴走的亂數流會存進去，舊存檔缺欄位會補", () => {
  const { state } = setup(1);
  advanceTick(state);
  const loaded = deserialize(serialize(state));
  assert.deepEqual(loaded.sanity, state.sanity);
  const old = JSON.parse(serialize(state));
  delete old.sanity;
  assert.ok(typeof deserialize(JSON.stringify(old)).sanity.rngState === "number");
});
