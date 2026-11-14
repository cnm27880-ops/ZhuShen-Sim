// Phase 4-C-5：英靈碑
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/data/config.js";
import { DUNGEONS } from "../src/data/dungeons.js";
import { createNewGame, createSamsarite, killSamsarite, recycle, setInjury, currentDay, advanceTick, serialize, deserialize } from "../src/engine/core.js";
import { effectivePower } from "../src/engine/tags.js";
import { hurt } from "../src/engine/dungeon.js";
import { qualifiesForStele, steleBonusOf, enshrine } from "../src/engine/memorial.js";

function setup(n, seed = 4) {
  const state = createNewGame(seed);
  state.samsarites = [];
  state.points = 1e6;
  const people = [];
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, "C");
    s.tags = [];
    state.samsarites.push(s);
    people.push(s);
  }
  return { state, people };
}
const fake = (state, gene, runs = 0) => ({ ...createSamsarite(state, "C"), geneLock: gene, runs });

test("入碑資格：基因鎖 ≥ 1 或出征 ≥ 15 場", () => {
  const { people: [s] } = setup(1);
  s.geneLock = 0;
  s.runs = 14;
  assert.equal(qualifiesForStele(s), false);
  s.runs = 15;
  assert.equal(qualifiesForStele(s), true);
  s.runs = 0;
  s.geneLock = 1;
  assert.equal(qualifiesForStele(s), true);
});

test("加成依生前基因鎖 2/4/8/13/20%，只取前 4 名，上限合計 +80%", () => {
  const { state } = setup(1);
  assert.deepEqual(CONFIG.stele.bonusByGene, [0.02, 0.04, 0.08, 0.13, 0.2]);
  for (const g of [0, 1, 2, 3, 4, 1]) enshrine(state, fake(state, g, 20), "dungeon"); // 基因鎖 0 靠出征場次入碑
  assert.equal(state.memorialStele.length, 6);
  assert.ok(Math.abs(steleBonusOf(state) - (0.2 + 0.13 + 0.08 + 0.04)) < 1e-9, "前 4 名：4、3、2、1 階");
  assert.deepEqual(state.memorialStele.map((e) => e.geneLock), [4, 3, 2, 1, 1, 0]);
  const full = setup(1).state;
  for (let i = 0; i < 6; i++) enshrine(full, fake(full, 4), "dungeon");
  assert.ok(Math.abs(steleBonusOf(full) - 0.8) < 1e-9);
});

test("不夠格不入碑；碑最多保留 keep 筆（加成低者淘汰）", () => {
  const { state } = setup(1);
  assert.equal(enshrine(state, fake(state, 0, 3), "dungeon"), null);
  assert.equal(state.memorialStele.length, 0);
  for (let i = 0; i < CONFIG.stele.keep + 5; i++) enshrine(state, fake(state, 1 + (i % 4)), "dungeon");
  assert.equal(state.memorialStele.length, CONFIG.stele.keep);
  const bonuses = state.memorialStele.map((e) => e.bonus);
  assert.deepEqual(bonuses, [...bonuses].sort((a, b) => b - a));
});

test("加成進有效戰力，全員（含之後新加入的人）都吃到；舊存檔讀檔會重算", () => {
  const { state, people: [a] } = setup(1);
  a.stats.power = 1000;
  a.geneLock = 0;
  const base = effectivePower(a);
  enshrine(state, fake(state, 4), "dungeon");
  assert.equal(a.steleBonus, 0.2);
  assert.equal(effectivePower(a), Math.round(base * 1.2));
  const late = createSamsarite(state, "C");
  assert.equal(late.steleBonus, 0.2, "之後入隊的人也有");
  const loaded = deserialize(serialize(state));
  assert.equal(loaded.samsarites[0].steleBonus, 0.2);
  const old = JSON.parse(serialize(state));
  delete old.memorialStele;
  const migrated = deserialize(JSON.stringify(old));
  assert.deepEqual(migrated.memorialStele, []);
  assert.equal(migrated.samsarites[0].steleBonus, 0);
});

test("副本戰死入碑；主動回收、空間內被同伴殺害不入碑", () => {
  const dungeon = DUNGEONS[0];
  let enshrined = null;
  for (let seed = 1; seed <= 60 && !enshrined; seed++) {
    const { state, people: [s] } = setup(1, seed);
    s.geneLock = 2;
    s.runs = 5;
    s.stats.defense = 0;
    s.stats.speed = 0;
    setInjury(s, 3);
    hurt(state, { enteredInjury: { [s.id]: 3 }, deaths: [], firstTime: false, partyIds: [s.id] }, s, dungeon);
    if (!state.samsarites.includes(s)) enshrined = state;
  }
  assert.ok(enshrined, "帶致命傷的人會死");
  const e = enshrined.memorialStele[0];
  assert.deepEqual([e.geneLock, e.bonus, e.kind, e.cause], [2, 0.08, "dungeon", "副本戰死"]);

  const { state, people: [a, b, c] } = setup(3);
  a.geneLock = 3;
  b.geneLock = 3;
  c.geneLock = 3;
  recycle(state, a.id);
  killSamsarite(state, b, "在主神空間被 X 當場殺害"); // 不傳 stele 參數 = 空間內殺人
  assert.equal(state.memorialStele.length, 0);
});

test("主神抹殺（強制任務逾時）入碑", () => {
  const { state } = setup(3, 5);
  state.samsarites.forEach((s) => (s.geneLock = 1));
  while (currentDay(state) < 29) advanceTick(state);
  assert.ok(state.graveyard.length >= 1);
  assert.equal(state.memorialStele.length, state.graveyard.length);
  assert.ok(state.memorialStele.every((e) => e.kind === "purge" && e.cause === "被主神抹殺" && e.bonus === 0.04));
  assert.ok(state.samsarites.every((s) => s.steleBonus === steleBonusOf(state)));
});
