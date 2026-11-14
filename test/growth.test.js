// Phase 4-B：基因鎖、個人強化、常規通關頓悟
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG, RANKS } from "../src/data/config.js";
import { createNewGame, createSamsarite, serialize, deserialize } from "../src/engine/core.js";
import {
  enhance,
  checkEnhance,
  breakGene,
  checkBreakGene,
  rollInsights,
  enhanceCostFor,
  enhanceGain,
  enhanceCapOf,
  insightCapOf,
} from "../src/engine/growth.js";

/** 建一個乾淨的遊戲 + 一個指定階級的人（不用開局那 3 個 C 級，避免干擾） */
function setup(rank = "C", points = 1000000) {
  const state = createNewGame(11);
  state.samsarites = [];
  state.points = points;
  const s = createSamsarite(state, rank);
  state.samsarites.push(s);
  return { state, s };
}

test("成長倍率：C 1.00／B 1.25／A 1.60／S 2.00，強化與頓悟增量 = round(基礎 × 倍率)", () => {
  assert.deepEqual(
    ["C", "B", "A", "S"].map((r) => RANKS[r].growthMult),
    [1.0, 1.25, 1.6, 2.0]
  );
  const expect = {
    C: { power: 8, hp: 8, defense: 2, speed: 2, luck: 2 },
    B: { power: 10, hp: 10, defense: 3, speed: 3, luck: 3 }, // round(2.5) = 3
    A: { power: 13, hp: 13, defense: 3, speed: 3, luck: 3 }, // round(12.8) = 13、round(3.2) = 3
    S: { power: 16, hp: 16, defense: 4, speed: 4, luck: 4 },
  };
  for (const rank of Object.keys(expect)) {
    const { s } = setup(rank);
    assert.deepEqual(enhanceGain(s), expect[rank], rank);
  }
});

test("基因鎖上限依階級固定：C 1／B 2／A 3／S 4；階段表數字正確", () => {
  assert.deepEqual(
    ["C", "B", "A", "S"].map((r) => RANKS[r].maxGene),
    [1, 2, 3, 4]
  );
  assert.deepEqual(CONFIG.gene.tiers.map((t) => t.enhanceCap), [3, 6, 10, 15, 20]);
  assert.deepEqual(CONFIG.gene.tiers.map((t) => t.powerMult), [1.0, 2.2, 4.8, 10.5, 23.0]);
  assert.deepEqual(CONFIG.gene.tiers.map((t) => t.cost), [0, 300, 1200, 4500, 16000]);
  const { s } = setup("S");
  assert.equal(s.geneLock, 0);
  assert.equal(enhanceCapOf(s), 3);
  assert.equal(insightCapOf(s), 4);
});

test("強化收費分段：1~3 次 80、4~6 次 220、7~10 次 650、11~15 次 1800、16~20 次 5000，第 21 次沒有", () => {
  const costs = Array.from({ length: 20 }, (_, i) => enhanceCostFor(i + 1));
  assert.deepEqual(costs, [
    ...Array(3).fill(80),
    ...Array(3).fill(220),
    ...Array(4).fill(650),
    ...Array(5).fill(1800),
    ...Array(5).fill(5000),
  ]);
  assert.equal(enhanceCostFor(21), null);
});

test("強化：扣積分（算累積花費）、五維增加、次數累計；達當階上限後不能再強化", () => {
  const { state, s } = setup("C", 5000);
  const before = { ...s.stats };
  const r = enhance(state, s.id);
  assert.equal(r.ok, true);
  assert.equal(state.points, 5000 - 80);
  assert.equal(state.totalSpent, 80);
  assert.equal(s.enhanceCount, 1);
  assert.equal(s.stats.power, before.power + 8);
  assert.equal(s.stats.hp, before.hp + 8);
  assert.equal(s.stats.defense, before.defense + 2);
  assert.equal(s.stats.speed, before.speed + 2);
  assert.equal(s.stats.luck, before.luck + 2);
  assert.equal(s.stats.sanity, before.sanity, "理智不受強化影響");
  assert.ok(state.events.some((e) => e.type === "enhance"));

  enhance(state, s.id);
  enhance(state, s.id);
  assert.equal(s.enhanceCount, 3);
  const blocked = checkEnhance(state, s.id);
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /突破基因鎖/);
  assert.equal(enhance(state, s.id).ok, false);
  assert.equal(s.enhanceCount, 3);
});

test("強化：不在主神空間（副本、催熟艙）不能強化；帶傷可以；錢不夠不能", () => {
  const { state, s } = setup("C", 5000);
  s.location = "dungeon";
  assert.equal(checkEnhance(state, s.id).ok, false);
  s.location = "pod";
  assert.equal(checkEnhance(state, s.id).ok, false);
  s.location = "space";
  s.injury = 2; // 重傷
  assert.equal(checkEnhance(state, s.id).ok, true);
  state.points = CONFIG.space.debtLimit[0] + 79; // 剩 79 可用，第 1 次要 80
  assert.equal(checkEnhance(state, s.id).ok, false);
  assert.equal(checkEnhance(state, 9999).ok, false, "找不到的人");
});

test("突破基因鎖：必須先點滿當階強化、空間等級夠、不超過階級上限、要花積分", () => {
  const { state, s } = setup("B", 100000);
  // 還沒點滿強化
  let c = checkBreakGene(state, s.id);
  assert.equal(c.ok, false);
  assert.match(c.reason, /點滿/);
  for (let i = 0; i < 3; i++) enhance(state, s.id);
  // 強化滿了，但空間 Lv.1 不夠（突破到 1 階要 Lv.2）
  c = checkBreakGene(state, s.id);
  assert.equal(c.ok, false);
  assert.match(c.reason, /Lv\.2/);

  state.spaceLevel = 2;
  const before = state.points;
  const r = breakGene(state, s.id);
  assert.equal(r.ok, true);
  assert.equal(s.geneLock, 1);
  assert.equal(state.points, before - 300);
  assert.equal(enhanceCapOf(s), 6, "強化次數上限提高到 6");
  assert.equal(insightCapOf(s), 8, "頓悟上限提高到 8");

  // 下一階要先點滿 6 次，且空間 Lv.3
  assert.equal(checkBreakGene(state, s.id).ok, false);
  for (let i = 0; i < 3; i++) enhance(state, s.id); // 第 4~6 次，各 220
  assert.equal(s.enhanceCount, 6);
  assert.match(checkBreakGene(state, s.id).reason, /Lv\.3/);
  state.spaceLevel = 3;
  assert.equal(breakGene(state, s.id).ok, true);
  assert.equal(s.geneLock, 2);

  // B 級上限 2 階：不能再突破
  for (let i = 0; i < 4; i++) enhance(state, s.id);
  state.spaceLevel = 4;
  c = checkBreakGene(state, s.id);
  assert.equal(c.ok, false);
  assert.match(c.reason, /上限/);
});

test("突破基因鎖：C 級最高 1 階；S 級可到 4 階；副本中不能突破", () => {
  const { state, s } = setup("C", 1000000);
  state.spaceLevel = 5;
  for (let i = 0; i < 3; i++) enhance(state, s.id);
  s.location = "dungeon";
  assert.equal(checkBreakGene(state, s.id).ok, false);
  s.location = "space";
  assert.equal(breakGene(state, s.id).ok, true);
  for (let i = 0; i < 3; i++) enhance(state, s.id);
  assert.equal(checkBreakGene(state, s.id).ok, false, "C 級卡在 1 階");

  const t = setup("S", 10000000);
  t.state.spaceLevel = 5;
  for (let tier = 1; tier <= 4; tier++) {
    while (t.s.enhanceCount < enhanceCapOf(t.s)) assert.equal(enhance(t.state, t.s.id).ok, true);
    assert.equal(breakGene(t.state, t.s.id).ok, true, `突破到第 ${tier} 階`);
  }
  assert.equal(t.s.geneLock, 4);
  while (t.s.enhanceCount < 20) enhance(t.state, t.s.id);
  assert.equal(t.s.enhanceCount, 20);
  assert.equal(checkEnhance(t.state, t.s.id).ok, false, "強化最多 20 次");
});

test("頓悟：機率 100% 時存活者都頓悟（戰力 + 一項副屬性），累計上限 (階數 + 1) × 4", () => {
  const saved = CONFIG.insight.chance;
  CONFIG.insight.chance = 1;
  try {
    const { state, s } = setup("S");
    const before = { ...s.stats };
    const hits = rollInsights(state, [s]);
    assert.equal(hits.length, 1);
    assert.equal(s.insightCount, 1);
    assert.equal(s.stats.power, before.power + 6, "S 級戰力 +round(3 × 2.0)");
    const sub = hits[0].subStat;
    assert.ok(["hp", "defense", "speed", "luck"].includes(sub));
    assert.equal(s.stats[sub], before[sub] + 4, "副屬性 +round(2 × 2.0)");
    for (const other of ["hp", "defense", "speed", "luck"].filter((k) => k !== sub)) assert.equal(s.stats[other], before[other]);
    assert.ok(state.events.some((e) => e.type === "insight"));

    for (let i = 0; i < 10; i++) rollInsights(state, [s]);
    assert.equal(s.insightCount, 4, "0 階上限 4 次");
    s.geneLock = 2;
    for (let i = 0; i < 20; i++) rollInsights(state, [s]);
    assert.equal(s.insightCount, 12, "2 階上限 12 次");
  } finally {
    CONFIG.insight.chance = saved;
  }
});

test("頓悟：機率 0% 不會觸發；不動主亂數（用獨立亂數流）", () => {
  const { state, s } = setup("A");
  const saved = CONFIG.insight.chance;
  CONFIG.insight.chance = 0;
  try {
    assert.equal(rollInsights(state, [s]).length, 0);
  } finally {
    CONFIG.insight.chance = saved;
  }
  const mainBefore = state.rngState;
  for (let i = 0; i < 50; i++) rollInsights(state, [s]);
  assert.equal(state.rngState, mainBefore, "主亂數沒被動到");
});

test("頓悟：預設 12% 機率，大量擲骰接近 12%", () => {
  const { state } = setup("C");
  let hit = 0;
  const N = 3000;
  for (let i = 0; i < N; i++) {
    const s = createSamsarite(state, "C");
    hit += rollInsights(state, [s]).length;
  }
  assert.ok(hit / N > 0.09 && hit / N < 0.15, `實際 ${(hit / N).toFixed(3)}`);
});

test("存檔：新欄位會存、舊存檔缺欄位會補預設值", () => {
  const { state, s } = setup("A", 100000);
  enhance(state, s.id);
  const loaded = deserialize(serialize(state));
  assert.equal(loaded.samsarites[0].enhanceCount, 1);
  assert.equal(loaded.samsarites[0].geneLock, 0);

  const old = JSON.parse(serialize(state));
  for (const p of old.samsarites) {
    delete p.geneLock;
    delete p.enhanceCount;
    delete p.insightCount;
    delete p.inheritPower;
  }
  delete old.growth;
  delete old.karmaCrystals;
  delete old.gacha;
  delete old.chapterClears;
  const migrated = deserialize(JSON.stringify(old));
  const p = migrated.samsarites[0];
  assert.deepEqual([p.geneLock, p.enhanceCount, p.insightCount, p.inheritPower], [0, 0, 0, 0]);
  assert.equal(migrated.karmaCrystals, 0);
  assert.deepEqual(migrated.chapterClears, {});
  assert.equal(typeof migrated.growth.rngState, "number");
  assert.ok(migrated.gacha.pools.basic && migrated.gacha.pools.divine);
});
