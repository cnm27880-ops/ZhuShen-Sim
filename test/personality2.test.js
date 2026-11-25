// 個性系統 v2：副本擋刀／背刺、叛逃與私奔門檻掛鉤個性
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/data/config.js";
import { createNewGame, createSamsarite } from "../src/engine/core.js";
import { protectMult, isSchemer, isLoyal, defectAffinityShift, elopeAffinityShift } from "../src/engine/personality.js";
import { findProtector, pickClash, addLove, addHate, pairLevel } from "../src/engine/relations.js";
import { isDefectImmune, defectEligible } from "../src/engine/lineage.js";
import { isElopeImmune, elopeCandidate } from "../src/engine/rivals.js";
import { squadOf, captainOf } from "../src/engine/squad.js";

function setup(n, seed = 7) {
  const state = createNewGame(seed);
  state.samsarites = [];
  const people = [];
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, "C");
    s.tags = [];
    s.traits = { altruism: 0, ambition: 0, courage: 0, social: 0, obedience: 0 };
    state.samsarites.push(s);
    people.push(s);
  }
  return { state, people };
}
const setTraits = (s, t) => Object.assign(s.traits, t);
const withV2 = (on, fn) => {
  const old = CONFIG.personality.v2.enabled;
  CONFIG.personality.v2.enabled = on;
  try {
    return fn();
  } finally {
    CONFIG.personality.v2.enabled = old;
  }
};

test("v2 倍率與判定：沒特色回傳預設值；關閉 v2 一律回傳預設值", () => {
  const { people: [a] } = setup(1);
  assert.equal(protectMult(a), 1);
  assert.equal(isSchemer(a), false);
  assert.equal(isLoyal(a), false);
  assert.equal(defectAffinityShift(a), 0);
  assert.equal(elopeAffinityShift(a), 0);

  setTraits(a, { altruism: 60, courage: 50, ambition: 0, obedience: 80 });
  const p = CONFIG.personality.v2.protect;
  assert.ok(Math.abs(protectMult(a) - p.altruismHi * p.courageHi) < 1e-9);
  assert.equal(isLoyal(a), true);
  assert.equal(defectAffinityShift(a), CONFIG.personality.v2.defectShift.obeyHi);
  assert.equal(elopeAffinityShift(a), CONFIG.personality.v2.elopeShift.obeyHi);

  setTraits(a, { altruism: -60, courage: -50, ambition: 50, obedience: -50 });
  assert.ok(Math.abs(protectMult(a) - p.altruismLo * p.courageLo) < 1e-9);
  assert.equal(isSchemer(a), true);
  assert.equal(defectAffinityShift(a), CONFIG.personality.v2.defectShift.obeyLo);
  assert.equal(elopeAffinityShift(a), CONFIG.personality.v2.elopeShift.obeyLo);

  withV2(false, () => {
    assert.equal(protectMult(a), 1);
    assert.equal(isSchemer(a), false);
    setTraits(a, { obedience: 90 });
    assert.equal(isLoyal(a), false);
    assert.equal(defectAffinityShift(a), 0);
    assert.equal(elopeAffinityShift(a), 0);
  });
});

test("擋刀：利他者比利己者更常出手，擲骰次數不變（同種子主亂數前進量相同）", () => {
  const rate = (altruism, seed) => {
    const { state, people: [guard, victim, other] } = setup(3, seed);
    setTraits(guard, { altruism });
    addLove(state, guard, victim, 100);
    addLove(state, victim, guard, 100);
    assert.ok(["adore", "soulmate"].includes(pairLevel(state, guard, victim)));
    let hit = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) if (findProtector(state, [guard, victim, other], victim)?.id === guard.id) hit++;
    return hit / N;
  };
  const hi = rate(80, 11);
  const lo = rate(-80, 11);
  const mid = rate(0, 11);
  assert.ok(hi > mid && mid > lo, `hi ${hi} mid ${mid} lo ${lo}`);
  assert.ok(Math.abs(mid - CONFIG.relations.protectChance) < 0.03);
  assert.ok(Math.abs(hi - CONFIG.relations.protectChance * CONFIG.personality.v2.protect.altruismHi) < 0.03);
  assert.ok(Math.abs(lo - CONFIG.relations.protectChance * CONFIG.personality.v2.protect.altruismLo) < 0.03);

  // 擲骰次數：每次呼叫只擲 1 次（只有 1 位守護者），不論機率多少 → 兩種個性下主亂數前進量相同
  const adv = (altruism) => {
    const { state, people: [guard, victim, other] } = setup(3, 21);
    setTraits(guard, { altruism });
    addLove(state, guard, victim, 100);
    addLove(state, victim, guard, 100);
    const before = state.rngState;
    findProtector(state, [guard, victim, other], victim);
    return state.rngState === before ? 0 : 1;
  };
  assert.equal(adv(80), adv(-80));
});

test("擋刀機率有上限", () => {
  const { state, people: [guard, victim] } = setup(2);
  setTraits(guard, { altruism: 90, courage: 90 });
  addLove(state, guard, victim, 100);
  addLove(state, victim, guard, 100);
  const old = CONFIG.relations.protectChance;
  CONFIG.relations.protectChance = 0.9;
  try {
    let hit = 0;
    for (let i = 0; i < 4000; i++) if (findProtector(state, [guard, victim], victim)) hit++;
    assert.ok(hit / 4000 < CONFIG.personality.v2.protect.cap + 0.03);
  } finally {
    CONFIG.relations.protectChance = old;
  }
});

test("陰謀者背刺：只動自己的亂數流 clashRngState，不動主亂數；非陰謀者不背刺", () => {
  const { state, people: [a, b, c] } = setup(3, 31);
  setTraits(a, { altruism: -70, ambition: 70 });
  const mainBefore = state.rngState;
  const clash = pickClash(state, [a, b, c], 2, 1e9); // mult 極大 → 機率 1
  assert.ok(clash);
  assert.equal(clash.kind, "backstab");
  assert.equal(clash.attacker.id, a.id);
  assert.notEqual(clash.victim.id, a.id);
  assert.equal(state.rngState, mainBefore, "主亂數不動");
  assert.notEqual(state.trait.clashRngState, undefined);

  // 沒有陰謀者：沒事發生、也不建立／動用陰謀者的流
  const g = setup(3, 31);
  const before = g.state.rngState;
  assert.equal(pickClash(g.state, g.people, 2, 1e9), null);
  assert.equal(g.state.rngState, before);

  // 關閉 v2：陰謀者不背刺
  withV2(false, () => assert.equal(pickClash(state, [a, b, c], 2, 1e9), null));
  // 一個人的隊伍不背刺
  assert.equal(pickClash(state, [a], 2, 1e9), null);
});

test("背刺詞條者照舊：不被陰謀者規則重複判定", () => {
  const { state, people: [a, b] } = setup(2, 41);
  a.tags = ["backstabber"];
  setTraits(a, { altruism: -70, ambition: 70 });
  const clash = pickClash(state, [a, b], 2, 1e9);
  assert.equal(clash.kind, "backstab");
  assert.equal(state.trait?.clashRngState, undefined, "有詞條的人走原本的主亂數流");
});

function captainSetup() {
  const { state, people } = setup(4, 51);
  state.spaceLevel = 3;
  const [cap, s] = people;
  squadOf(state).captainId = cap.id;
  assert.equal(captainOf(state).id, cap.id);
  s.location = "space";
  s.stats.sanity = 20;
  return { state, cap, s };
}

test("叛逃：順從度 ≥70 完全免疫；門檻依順從度位移", () => {
  const { state, cap, s } = captainSetup();
  addHate(state, s, cap, 42); // 淨好感 -42
  assert.equal(isDefectImmune(state, s), false);
  assert.equal(defectEligible(state, s), false, "預設門檻 -45，-42 不夠");

  setTraits(s, { obedience: -50 }); // 門檻 -40
  assert.equal(defectEligible(state, s), true);
  setTraits(s, { obedience: 50 }); // 門檻 -50
  addHate(state, s, cap, 5); // -47
  assert.equal(defectEligible(state, s), false);
  setTraits(s, { obedience: 0 });
  assert.equal(defectEligible(state, s), true, "預設 -45，-47 夠");

  setTraits(s, { obedience: 80 });
  assert.equal(isDefectImmune(state, s), true);
  withV2(false, () => assert.equal(isDefectImmune(state, s), false));
});

test("私奔：死忠免疫；門檻依順從度位移；隊長與綁定規則不變", () => {
  const { state, cap, s } = captainSetup();
  s.stats.sanity = 100;
  addHate(state, s, cap, 10); // 淨好感 -10
  const config = CONFIG.rival.elope;
  assert.ok(config.affinity === -5);
  assert.equal(elopeCandidate(state, s, cap), true, "-10 <= -5");
  setTraits(s, { obedience: 50 }); // 門檻 -15
  assert.equal(elopeCandidate(state, s, cap), false);
  setTraits(s, { obedience: -50 }); // 門檻 0
  addHate(state, s, cap, -8); // -2：預設不夠，順從度低則夠
  assert.equal(elopeCandidate(state, s, cap), true);
  setTraits(s, { obedience: 0 });
  assert.equal(elopeCandidate(state, s, cap), false);

  assert.equal(isElopeImmune(state, s), false);
  setTraits(s, { obedience: 90 });
  assert.equal(isElopeImmune(state, s), true);
  withV2(false, () => assert.equal(isElopeImmune(state, s), false));
  assert.equal(isElopeImmune(state, cap), true, "隊長仍免疫");
});
