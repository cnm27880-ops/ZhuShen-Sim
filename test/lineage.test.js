// Phase 4-E-4：子嗣（世代、天賦 +25% 封頂、培育期）、先人遺物、叛逃野生 Boss（免疫紅線）
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/data/config.js";
import { createNewGame, createSamsarite, killSamsarite, setInjury, serialize, deserialize } from "../src/engine/core.js";
import { effectivePower, shopBonus } from "../src/engine/tags.js";
import { getShopItem } from "../src/data/shopItems.js";
import { appointCaptain, squadRng, captainOf } from "../src/engine/squad.js";
import { affinity, shiftAffinity } from "../src/engine/relations.js";
import { step } from "../src/engine/dispatch.js";
import { startRun } from "../src/engine/dungeon.js";
import {
  inducePregnancy, lineageBlock, applyLineage, speedUpPod, speedUpCost, leaveHeirloom, bestowHeirloom, heirloomHeirs,
  isDefectImmune, defectEligible, defect, dailyLineage, rogueDungeon, addChronicle, resolveRogueFight,
} from "../src/engine/lineage.js";
import { giveBirth } from "../src/engine/children.js";

function setup(n = 4, { level = 2, seed = 41 } = {}) {
  const state = createNewGame(seed);
  state.samsarites = [];
  state.spaceLevel = level;
  state.points = 100000;
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, "C");
    s.tags = [];
    s.stats.power = 30;
    state.samsarites.push(s);
  }
  return state;
}
const love = (state, a, b, v = 80) => {
  shiftAffinity(state, a, b, v);
  shiftAffinity(state, b, a, v);
};

test("孕育條件：雙向淨好感 >= 75、都沒重傷、在空間、冷卻 30 天、人口與催熟艙未滿", () => {
  const state = setup(3);
  const [a, b, c] = state.samsarites;
  assert.match(lineageBlock(state, a, b), /淨好感/);
  love(state, a, b, 80);
  assert.equal(lineageBlock(state, a, b), null);
  setInjury(a, 2);
  assert.match(lineageBlock(state, a, b), /重傷/);
  setInjury(a, 1);
  assert.equal(lineageBlock(state, a, b), null, "輕傷可以");
  b.location = "dungeon";
  assert.match(lineageBlock(state, a, b), /主神空間/);
  b.location = "space";
  const kid = inducePregnancy(state, a, b);
  assert.ok(kid);
  assert.match(lineageBlock(state, a, b), /冷卻/);
  assert.equal(state.cooldowns[`birth:${a.id}:${b.id}`] - 1, CONFIG.lineage.cooldownDays + Math.floor(state.tick / CONFIG.ticksPerDay), "冷卻 30 天");
  void c;
});

test("子嗣：進催熟艙培育 7 天；世代 = max(父,母)+1；記錄 parents；繼承一個家長性格詞條；寫進編年史", () => {
  const state = setup(2);
  const [a, b] = state.samsarites;
  a.tags = ["lecturer", "born_strong"];
  b.tags = ["salary_thief"];
  a.generation = 2;
  love(state, a, b, 80);
  const kid = inducePregnancy(state, a, b);
  assert.equal(kid.location, "pod");
  assert.equal(kid.podDaysLeft, 7);
  assert.equal(kid.generation, 3);
  assert.deepEqual(kid.parents, [a.id, b.id]);
  const parentTags = [...a.tags, ...b.tags];
  assert.ok(kid.tags.some((t) => parentTags.includes(t) && ["lecturer", "salary_thief", "overwork_reborn"].includes(t)) || kid.inheritedTags.length > 0);
  assert.ok(kid.inheritedTags.length > 0, "至少繼承一個家長詞條");
  assert.ok(state.chronicles.some((c) => c.kind === "birth" && c.text.includes("第 3 代")));
  // 7 天後長成輪迴者
  for (let d = 0; d < 7; d++) state.tick = (Math.floor(state.tick / 10) + 1) * 10 - 1, step(state);
  assert.equal(kid.location, "space");
});

test("天賦白值：依家長基因鎖給，傳承幾代都硬封頂 +25%（占孩子基礎戰力）", () => {
  const state = setup(2);
  const [a, b] = state.samsarites;
  a.geneLock = 2;
  b.geneLock = 2;
  const k1 = createSamsarite(state, "C");
  applyLineage(state, k1, [a, b], squadRng(state));
  assert.equal(k1.talentPct, 0.1, "平均基因鎖 2 × 5%");
  assert.equal(k1.inheritPower, Math.round(k1.stats.power * 0.1));
  // 滿基因鎖的家長 + 一路傳下去：封頂 25%
  a.geneLock = 4;
  b.geneLock = 4;
  a.talentPct = 0.25;
  b.talentPct = 0.25;
  const k2 = createSamsarite(state, "C");
  applyLineage(state, k2, [a, b], squadRng(state));
  assert.equal(k2.talentPct, 0.25);
  assert.equal(k2.inheritPower, Math.round(k2.stats.power * 0.25));
  // 連續 10 代
  let p = a;
  for (let g = 0; g < 10; g++) {
    const k = createSamsarite(state, "C");
    applyLineage(state, k, [p, { ...p, generation: p.generation }], squadRng(state));
    assert.ok(k.talentPct <= 0.25 + 1e-9);
    assert.ok(k.inheritPower <= Math.round(k.stats.power * 0.25));
    p = k;
  }
  assert.equal(p.generation, 11);
  // 沒有天賦的家長：0
  const z = setup(2).samsarites;
  const k3 = createSamsarite(state, "C");
  applyLineage(state, k3, z, squadRng(state));
  assert.equal(k3.inheritPower, 0);
});

test("3-F 戀人生的孩子也有世代與天賦，並共用同一套 giveBirth", () => {
  const state = setup(2);
  const [a, b] = state.samsarites;
  a.geneLock = 3;
  b.geneLock = 3;
  const kid = giveBirth(state, a, b);
  assert.equal(kid.generation, 2);
  assert.equal(kid.podDaysLeft, CONFIG.child.podDays, "3-F 仍是 3 天");
  assert.equal(kid.talentPct, 0.15);
});

test("加速培育：每剩 1 天花公庫 60 × 空間等級，立刻出艙", () => {
  const state = setup(2, { level: 3 });
  const [a, b] = state.samsarites;
  love(state, a, b);
  const kid = inducePregnancy(state, a, b);
  assert.equal(speedUpCost(state, kid), 7 * 60 * 3);
  const before = state.points;
  const r = speedUpPod(state, kid.id);
  assert.equal(r.ok, true);
  assert.equal(state.points, before - 1260);
  assert.equal(kid.location, "space");
  assert.equal(speedUpPod(state, kid.id).ok, false);
});

test("先人遺物：geneLock >= 2 老鳥或隊長副本戰死 → 最高階 1 件武防存進遺物庫（履歷、上限 8 件）；新人不會", () => {
  const state = setup(4);
  const [vet, rookie, cap] = state.samsarites;
  vet.geneLock = 2;
  vet.gear = { weapon: "weapon_steel", armor: "armor_cloth" }; // 二階武器：階層最高
  vet.maxBossChapter = 2;
  rookie.gear = { weapon: "weapon_club" };
  killSamsarite(state, rookie, "測試", null, "dungeon");
  assert.equal(state.armoryHeirlooms.length, 0, "新人不留遺物");
  killSamsarite(state, vet, "測試", null, "dungeon");
  assert.equal(state.armoryHeirlooms.length, 1);
  const h = state.armoryHeirlooms[0];
  assert.equal(h.itemId, "weapon_steel");
  assert.match(h.label, /曾討伐二章尾王/);
  assert.match(h.label, new RegExp(vet.name));
  // 隊長（geneLock 0）也算，履歷寫「初代隊長」
  cap.gear = { armor: "armor_cloth" };
  appointCaptain(state, cap.id);
  killSamsarite(state, cap, "測試", null, "dungeon");
  assert.equal(state.armoryHeirlooms.length, 2);
  assert.match(state.armoryHeirlooms[1].label, /初代隊長/);
  // 主動回收／空間內被殺（非副本戰死）不留遺物
  const x = createSamsarite(state, "C");
  x.geneLock = 3;
  x.gear = { weapon: "weapon_club" };
  state.samsarites.push(x);
  killSamsarite(state, x, "測試", null, null);
  assert.equal(state.armoryHeirlooms.length, 2);
  // 上限 8：最舊的被擠掉
  for (let i = 0; i < 10; i++) {
    const y = createSamsarite(state, "C");
    y.geneLock = 2;
    y.gear = { weapon: "weapon_club" };
    state.samsarites.push(y);
    state.tick += 1;
    killSamsarite(state, y, "測試", null, "dungeon");
  }
  assert.equal(state.armoryHeirlooms.length, 8);
  assert.ok(state.chronicles.some((c) => c.kind === "heirloom"));
});

test("賞賜遺物：裝備白值 +10%；子嗣／好感 >= 60 摯友穿上緬懷 +10 理智；換裝備後不再是遺物；子嗣優先排序", () => {
  const state = setup(4);
  const [vet, kid, friend, stranger] = state.samsarites;
  vet.geneLock = 2;
  vet.gear = { weapon: "weapon_steel" };
  kid.parents = [vet.id, 999];
  shiftAffinity(state, friend, vet, 70);
  killSamsarite(state, vet, "測試", null, "dungeon");
  const h = state.armoryHeirlooms[0];
  assert.deepEqual(heirloomHeirs(state, h).map((x) => x.kind), ["child", "friend", "other"]);
  const base = shopBonus(stranger, "power");
  stranger.stats.sanity = 50;
  const r0 = bestowHeirloom(state, h.id, stranger.id);
  assert.equal(r0.mourned, false);
  assert.equal(stranger.stats.sanity, 50);
  const item = getShopItem("weapon_steel");
  assert.equal(shopBonus(stranger, "power"), base + item.effect.power * 1.1);
  assert.equal(stranger.soulbound.weapon, true);
  assert.equal(state.armoryHeirlooms.length, 0);
  // 重新賞賜給子嗣與摯友
  for (const [who, expectMourn] of [[kid, true], [friend, true]]) {
    state.armoryHeirlooms = [{ ...h }];
    who.stats.sanity = 50;
    const r = bestowHeirloom(state, h.id, who.id);
    assert.equal(r.mourned, expectMourn);
    assert.equal(who.stats.sanity, 60);
    assert.ok(effectivePower(who) > 0);
  }
  assert.equal(bestowHeirloom(state, "nope", kid.id).ok, false);
});

function rogueSetup() {
  const state = setup(4, { level: 3 });
  const [cap, a, b, c] = state.samsarites;
  appointCaptain(state, cap.id);
  for (const s of [a, b, c]) {
    shiftAffinity(state, s, cap, -60); // 淨好感 -60
    s.stats.sanity = 10;
  }
  return { state, cap, a, b, c };
}

test("叛逃免疫紅線：隊長、對隊長好感 > 0、穿主神賞賜綁定裝、customProfile 標記者 100% 免疫", () => {
  const { state, cap, a, b, c } = rogueSetup();
  assert.equal(defectEligible(state, a), true);
  assert.equal(isDefectImmune(state, a), false);
  assert.equal(isDefectImmune(state, cap), true);
  // 綁定裝
  b.gear = { weapon: "weapon_club" };
  b.soulbound = { weapon: true };
  assert.equal(isDefectImmune(state, b), true);
  // customProfile
  c.customProfile = { name: "我的專屬角色" };
  assert.equal(isDefectImmune(state, c), true);
  // 好感 > 0
  shiftAffinity(state, a, cap, 100);
  assert.ok(affinity(state, a, cap) > 0);
  assert.equal(isDefectImmune(state, a), true);
  // 把機率拉到 100%：免疫者一個都不叛逃
  const keep = CONFIG.lineage.rogueChance;
  CONFIG.lineage.rogueChance = 1;
  try {
    for (let i = 0; i < 20; i++) dailyLineage(state);
    assert.equal(state.rogueBosses.length, 0);
    assert.equal(state.samsarites.length, 4);
  } finally {
    CONFIG.lineage.rogueChance = keep;
  }
});

test("叛逃：好感 <= -55 且理智 < 25、每天 15%；帶走私房錢、不進墳場；上限 5 名；寫進編年史", () => {
  const { state, a, b, c } = rogueSetup();
  a.wallet = 321;
  const keep = CONFIG.lineage.rogueChance;
  CONFIG.lineage.rogueChance = 1;
  try {
    dailyLineage(state);
  } finally {
    CONFIG.lineage.rogueChance = keep;
  }
  assert.equal(state.rogueBosses.length, 3, "三個符合條件的都叛逃（第 3 條規則：機率 100% 時）");
  assert.equal(state.rogueBosses.find((r) => r.name === a.name).wallet, 321);
  assert.equal(state.samsarites.some((s) => s.id === a.id), false);
  assert.equal(state.graveyard.length, 0);
  assert.ok(state.chronicles.filter((x) => x.kind === "defect").length === 3);
  void b; void c;
  // 條件不符：理智夠高就不叛逃
  const s2 = rogueSetup();
  s2.a.stats.sanity = 60;
  s2.b.stats.sanity = 60;
  s2.c.stats.sanity = 60;
  CONFIG.lineage.rogueChance = 1;
  try {
    dailyLineage(s2.state);
  } finally {
    CONFIG.lineage.rogueChance = keep;
  }
  assert.equal(s2.state.rogueBosses.length, 0);
  // 上限 5
  const s3 = setup(3, { level: 3 });
  for (let i = 0; i < 5; i++) s3.rogueBosses.push({ id: `x${i}`, name: `叛${i}`, wallet: 0, chapter: 3 });
  assert.equal(s3.rogueBosses.length, 5);
  appointCaptain(s3, s3.samsarites[0].id);
  const [, v1] = s3.samsarites;
  shiftAffinity(s3, v1, s3.samsarites[0], -70);
  v1.stats.sanity = 0;
  CONFIG.lineage.rogueChance = 1;
  try {
    dailyLineage(s3);
  } finally {
    CONFIG.lineage.rogueChance = keep;
  }
  assert.equal(s3.rogueBosses.length, 5);
  assert.equal(s3.samsarites.length, 3);
});

test("叛逃 Boss 戰力隨當前章節推薦值動態錨定", () => {
  const s1 = setup(2, { level: 1 });
  const s4 = setup(2, { level: 4 });
  assert.ok(rogueDungeon(s4).recommendedPower > rogueDungeon(s1).recommendedPower * 10);
  assert.equal(rogueDungeon(s1).chapter, 1);
  assert.equal(rogueDungeon(s4).boss, true);
});

test("叛逃 Boss 亂入：擊敗追回賞金（含他的私房錢）、機率掉結晶；不敵全員 injury+1 撤退算失敗", () => {
  const state = setup(4, { level: 2 });
  const ids = state.samsarites.map((s) => s.id);
  for (const s of state.samsarites) s.stats.power = 100000; // 戰力碾壓
  state.rogueBosses.push({ id: "rbT", name: "叛徒甲", rank: "C", geneLock: 0, wallet: 400, day: 1, chapter: 2 });
  CONFIG.lineage.rogueEncounter = 1;
  try {
    assert.equal(startRun(state, "ghost_village", ids).ok, true);
  } finally {
    CONFIG.lineage.rogueEncounter = 0.1;
  }
  assert.equal(state.runs[0].rogueId, "rbT");
  const pointsBefore = state.points;
  let guard = 0;
  while (state.runs.length && guard++ < 100) step(state);
  const rep = state.lastRun;
  assert.equal(rep.rogue.win, true);
  assert.ok(rep.rogue.bounty >= 400);
  assert.equal(state.rogueBosses.length, 0);
  assert.ok(state.points > pointsBefore - 200);
  assert.ok(state.chronicles.some((c) => c.kind === "slain"));

  // 不敵：玩家全員弱 → 帶傷撤退
  const weak = setup(2, { level: 2 });
  weak.rogueBosses.push({ id: "rbW", name: "叛徒乙", rank: "C", geneLock: 0, wallet: 0, day: 1, chapter: 2 });
  const boss = weak.rogueBosses[0];
  const r = resolveRogueFight(weak, boss, weak.samsarites, false);
  assert.equal(r.win, false);
  assert.equal(weak.samsarites.every((s) => s.injury === 1), true);
  assert.equal(weak.rogueBosses.length, 1, "沒打贏，Boss 還在");
});

test("沒有叛逃 Boss 時出發不消耗亂數；舊存檔/新存檔讀寫遺物與叛逃 Boss", () => {
  const state = setup(3);
  const rng0 = state.squadRngState;
  startRun(state, "ghost_village", state.samsarites.map((s) => s.id));
  assert.equal(state.squadRngState, rng0);
  state.rogueBosses.push({ id: "z", name: "Z", wallet: 1, chapter: 1 });
  state.armoryHeirlooms.push({ id: "h", itemId: "weapon_club", slot: "weapon", ownerName: "老王", label: "「元老・老王遺留」" });
  addChronicle(state, "boss", "測試大事紀");
  const loaded = deserialize(serialize(state));
  assert.equal(loaded.rogueBosses[0].id, "z");
  assert.equal(loaded.armoryHeirlooms[0].label, "「元老・老王遺留」");
  assert.equal(loaded.chronicles.at(-1).text, "測試大事紀");
});

test("編年史最多保留最近 100 條", () => {
  const state = setup(2);
  for (let i = 0; i < 130; i++) addChronicle(state, "drama", `第 ${i} 條`);
  assert.equal(state.chronicles.length, 100);
  assert.equal(state.chronicles[0].text, "第 30 條");
  assert.equal(captainOf(state), null);
});
