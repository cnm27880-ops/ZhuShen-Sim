// Phase 4-F-3：永久基建（造價、結晶門檻、共產補貼、開鎖折扣封頂、各設施效果）與位面侵蝕 1★～10★
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/data/config.js";
import { FACILITY_ORDER } from "../src/data/facilities.js";
import { createNewGame, createSamsarite, advanceTick, serialize, deserialize } from "../src/engine/core.js";
import { levelCost, checkUpgrade, upgradeFacility, communalSubsidy, dailyFacilities, podsHeal, gravityPct, podDaysCut, talentFloor, intelGainBonus, rivalRewardBonus, refreshFacilityBonus } from "../src/engine/facilities.js";
import { checkBreakGene } from "../src/engine/growth.js";
import { effectivePower } from "../src/engine/tags.js";
import { giveBirth } from "../src/engine/children.js";
import { startRun, dungeonOfRun } from "../src/engine/dungeon.js";
import { step } from "../src/engine/dispatch.js";
import { erosionBlock, applyErosion, erosionRMult, erosionRewardMult } from "../src/engine/erosion.js";
import { getDungeon, DUNGEONS } from "../src/data/dungeons.js";
import { planAutoDispatch } from "../src/engine/dispatch.js";

function setup(n = 4, { level = 4, seed = 5 } = {}) {
  const state = createNewGame(seed);
  state.samsarites = [];
  state.spaceLevel = level;
  state.points = 5e6;
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, "C");
    s.tags = [];
    state.samsarites.push(s);
  }
  return state;
}

test("每座設施各級造價等比遞增，滿級總和約等於設定的總造價", () => {
  for (const id of FACILITY_ORDER) {
    const d = CONFIG.facility.defs[id];
    let sum = 0;
    let prev = 0;
    for (let lv = 1; lv <= d.max; lv++) {
      const c = levelCost(id, lv);
      assert.ok(c > prev, `${id} 第 ${lv} 級要比上一級貴`);
      prev = c;
      sum += c;
    }
    assert.ok(Math.abs(sum - d.totalCost) <= d.max, `${id} 總造價 ${sum} 應約為 ${d.totalCost}`);
  }
  assert.equal(CONFIG.facility.defs.gravity.max, 10);
  assert.equal(CONFIG.facility.defs.nursery.max, 5);
  assert.equal(CONFIG.facility.defs.radar.max, 5);
});

test("升級扣積分；Lv.6 起要侵蝕結晶（重力 2/4/6/9/12），結晶不足不能升", () => {
  const state = setup();
  state.facilities.gravity = 5;
  const before = state.points;
  let r = upgradeFacility(state, "gravity");
  assert.equal(r.ok, false, "第 6 級要 2 顆結晶");
  assert.match(r.reason, /侵蝕結晶/);
  assert.equal(state.points, before, "失敗不扣錢");
  state.erosionCrystals = 2;
  r = upgradeFacility(state, "gravity");
  assert.equal(r.ok, true);
  assert.equal(state.facilities.gravity, 6);
  assert.equal(state.erosionCrystals, 0);
  assert.equal(state.points, before - levelCost("gravity", 6));
  assert.deepEqual(CONFIG.facility.defs.gravity.crystalAt.slice(5), [2, 4, 6, 9, 12]);
  assert.deepEqual(CONFIG.facility.defs.pods.crystalAt.slice(5), [1, 2, 4, 6, 8]);
  assert.deepEqual(CONFIG.facility.defs.nursery.crystalAt.slice(3), [5, 10]);
  assert.deepEqual(CONFIG.facility.defs.radar.crystalAt.slice(3), [4, 8]);
  // 滿級不能再升
  state.facilities.nursery = 5;
  assert.equal(checkUpgrade(state, "nursery").ok, false);
});

test("共產互助金補貼：只有 communal 流派、超過軟上限的部分、最多折抵 30% 造價", () => {
  const state = setup();
  const lv = 3;
  const cost = levelCost("radar", lv);
  state.facilities.radar = lv - 1;
  state.squad.communalFund = 1e6;
  assert.equal(communalSubsidy(state, cost), 0, "沒有隊長／不是共產流不補貼");
  const cap = state.samsarites[0];
  state.squad.captainId = cap.id;
  state.squad.style = "communal";
  const soft = CONFIG.squad.communal.fundCapPerLevel * state.spaceLevel;
  assert.equal(communalSubsidy(state, cost), Math.round(cost * 0.3), "超額很多：折抵 30%");
  state.squad.communalFund = soft + 100;
  assert.equal(communalSubsidy(state, cost), 100, "超額只有 100：只能折抵 100");
  state.squad.communalFund = soft - 1;
  assert.equal(communalSubsidy(state, cost), 0, "沒超過軟上限不動用");
  state.squad.communalFund = 1e6;
  const pts = state.points;
  const r = upgradeFacility(state, "radar");
  assert.equal(r.ok, true);
  assert.equal(state.points, pts - (cost - Math.round(cost * 0.3)));
  assert.equal(state.squad.communalFund, 1e6 - Math.round(cost * 0.3));
});

test("開啟基因鎖折扣：共鳴碑每級 -2%，與破鎖耗材加算，總折扣封頂 -45%", () => {
  const state = setup(1, { level: 5 });
  const s = state.samsarites[0];
  s.enhanceCount = CONFIG.gene.tiers[0].enhanceCap; // 先點滿當階強化
  const base = CONFIG.gene.tiers[1].cost;
  assert.equal(checkBreakGene(state, s.id).cost, base, "沒有共鳴碑沒折扣");
  state.facilities.stele = 5; // -10%
  assert.equal(checkBreakGene(state, s.id).cost, Math.round(base * 0.9));
  s.geneBuff = { target: 1, costDiscount: 0.25 }; // 耗材 25% + 碑 10% = 35%
  assert.equal(checkBreakGene(state, s.id).cost, Math.round(base * 0.65));
  state.facilities.stele = 10; // 25% + 20% = 45%，剛好封頂
  assert.equal(checkBreakGene(state, s.id).cost, Math.round(base * 0.55));
  s.geneBuff = { target: 1, costDiscount: 0.3 }; // 30% + 20% = 50% → 封頂 45%
  assert.equal(checkBreakGene(state, s.id).cost, Math.round(base * 0.55), "總折扣封頂 -45%");
});

test("重力修煉室：全隊基礎戰力 +3%／級，新入隊者也有", () => {
  const state = setup(2);
  const s = state.samsarites[0];
  s.stats.power = 1000;
  const base = effectivePower(s);
  state.facilities.gravity = 10;
  refreshFacilityBonus(state);
  assert.equal(gravityPct(state), 0.3);
  assert.equal(effectivePower(s), Math.round(1000 * 1.3));
  assert.ok(effectivePower(s) > base);
  const fresh = createSamsarite(state, "C");
  assert.equal(fresh.facilityBonus, 0.3);
});

test("生命溫養艙：重傷痊癒機會 +5%／級、留守理智額外 +0.5／級；沒蓋不消耗亂數", () => {
  const state = setup(1);
  const s = state.samsarites[0];
  s.injury = 2;
  const rng0 = state.facilityRngState;
  assert.equal(podsHeal(state, s), false);
  assert.equal(state.facilityRngState, rng0, "沒溫養艙不動亂數流");
  state.facilities.pods = 10; // 50%
  let healed = 0;
  for (let i = 0; i < 400; i++) {
    s.injury = 2;
    if (podsHeal(state, s)) healed += 1;
  }
  assert.ok(healed > 140 && healed < 260, `約 50%，實際 ${healed}/400`);
  assert.equal(CONFIG.facility.defs.pods.perLevel.restSanity, 0.5);
});

test("萬界育嬰堂：培育期 -5%／級、資質下限 +4%／級；星界觀測樞：情報與洲際獎勵 +10%／+8%／級", () => {
  const state = setup(4);
  state.facilities.nursery = 5;
  assert.equal(Math.round(podDaysCut(state) * 100), 25);
  assert.equal(Math.round(talentFloor(state) * 100), 20);
  const [a, b] = state.samsarites;
  const baby = giveBirth(state, a, b, { podDays: 8 });
  assert.equal(baby.podDaysLeft, 6, "8 天 × 0.75");
  assert.ok(baby.talentPct >= 0.2 - 1e-9, "出世資質下限 20%");
  state.facilities.radar = 5;
  assert.equal(Math.round(intelGainBonus(state) * 100), 50);
  assert.equal(Math.round(rivalRewardBonus(state) * 100), 40);
});

test("自動建設：只在公庫高於 30000 × 空間等級時動用，花到水位以下就停", () => {
  const state = setup(2, { level: 4 });
  state.autoUpgradeFacilities = true;
  const water = CONFIG.facility.safeWaterPerLevel * 4;
  state.points = water - 1;
  dailyFacilities(state);
  assert.equal(FACILITY_ORDER.reduce((n, id) => n + state.facilities[id], 0), 0, "水位以下不建");
  state.points = water + 200000;
  dailyFacilities(state);
  assert.ok(FACILITY_ORDER.some((id) => state.facilities[id] > 0), "有餘裕就建");
  assert.ok(state.points >= water, "不會把公庫花到水位以下");
  state.autoUpgradeFacilities = false;
  const snap = JSON.stringify(state.facilities);
  state.points = 1e7;
  dailyFacilities(state);
  assert.equal(JSON.stringify(state.facilities), snap, "開關關掉就不建");
});

test("存檔：新欄位讀回；舊存檔補預設", () => {
  const state = setup(2);
  state.facilities.gravity = 3;
  state.erosionCrystals = 7;
  const back = deserialize(serialize(state));
  assert.equal(back.facilities.gravity, 3);
  assert.equal(back.erosionCrystals, 7);
  const old = JSON.parse(serialize(state));
  for (const k of ["facilities", "erosionCrystals", "autoUpgradeFacilities", "autoErosion", "rivals", "facilityRngState", "seed"]) delete old[k];
  const fixed = deserialize(JSON.stringify(old));
  assert.equal(fixed.facilities.gravity, 0);
  assert.equal(fixed.erosionCrystals, 0);
  assert.equal(fixed.autoUpgradeFacilities, false);
  assert.ok(fixed.rivals);
});

// ───────── 位面侵蝕 ─────────

test("侵蝕倍率：R × 1.45^k、積分 × 1.32^k；未解鎖／未首通／星級超界都被擋", () => {
  const w = getDungeon("ghost_village");
  const state = setup(4, { level: 3 });
  assert.match(erosionBlock(state, w, 1), /第 3 章尾王/, "空間 Lv.4 才解鎖");
  state.spaceLevel = 4;
  assert.match(erosionBlock(state, w, 1), /已首通/, "沒首通的世界不能侵蝕");
  state.dungeonStats[w.id] = { attempts: 1, clears: 1 };
  assert.equal(erosionBlock(state, w, 0), null);
  for (const k of [1, 5, 10]) assert.equal(erosionBlock(state, w, k), null);
  assert.ok(erosionBlock(state, w, 11));
  assert.ok(erosionBlock(state, w, -1));
  assert.equal(applyErosion(w, 0), w);
  for (const k of [1, 3, 10]) {
    assert.equal(applyErosion(w, k).recommendedPower, Math.round(w.recommendedPower * 1.45 ** k));
    assert.ok(Math.abs(erosionRewardMult(k) - 1.32 ** k) < 1e-9);
  }
  assert.equal(erosionRMult(0), 1);
  assert.equal(erosionRewardMult(0), 1);
});

test("侵蝕出征：有效 R 被放大；成功通關固定掉 k 顆侵蝕結晶並記錄最高星級；失敗不掉", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const state = setup(4, { level: 4, seed });
    state.samsarites.forEach((s) => (s.stats.power = 100000));
    const w = getDungeon("ghost_village");
    state.dungeonStats[w.id] = { attempts: 1, clears: 1, intel: 0.09 };
    const bad = startRun(state, w.id, state.samsarites.map((s) => s.id), { erosion: 11 });
    assert.equal(bad.ok, false);
    const r = startRun(state, w.id, state.samsarites.map((s) => s.id), { erosion: 3 });
    assert.equal(r.ok, true);
    assert.equal(dungeonOfRun(r.run).recommendedPower, Math.round(w.recommendedPower * 1.45 ** 3));
    const tax = state.points;
    for (let i = 0; i < 40 && state.runs.length; i++) step(state);
    const rep = state.lastRun;
    assert.equal(rep.erosion, 3);
    if (rep.success) {
      assert.equal(rep.erosionCrystals, 3);
      assert.equal(state.erosionCrystals, 3);
      assert.equal(state.maxErosion, 3);
      assert.ok(state.points > tax);
      return;
    }
    assert.equal(state.erosionCrystals, 0, "失敗沒有結晶");
  }
  assert.fail("20 個種子都沒成功通關過，不合理");
});

test("自動挑戰侵蝕：只在主線卡關／全通後才接手，挑可安全吃下的最高星級；開關關掉就不碰", () => {
  const state = setup(4, { level: 4 });
  state.samsarites.forEach((s) => (s.stats.power = 3000));
  for (const d of DUNGEONS.filter((x) => x.chapter <= 3)) state.dungeonStats[d.id] = { attempts: 5, clears: 5, intel: 0.09 }; // 第 1～3 章全首通過
  state.board.slots = []; // 任務榜清空：最前線第 4 章沒有可打的槽 = 主線卡關
  state.autoStrategy = "off";
  state.autoErosion = false;
  const normal = planAutoDispatch(state);
  assert.ok(!normal?.erosion, "開關關著不會挑侵蝕");
  state.autoErosion = true;
  const plan = planAutoDispatch(state);
  assert.ok(plan && plan.erosion >= 1 && plan.erosion <= 10, "卡關時改打侵蝕");
  const eff = applyErosion(plan.dungeon, plan.erosion);
  assert.ok(plan.chance >= CONFIG.auto.minClearChance, "只挑可安全吃下的星級");
  assert.equal(eff.recommendedPower, Math.round(plan.dungeon.recommendedPower * 1.45 ** plan.erosion));
  state.spaceLevel = 3; // 侵蝕還沒解鎖
  assert.ok(!planAutoDispatch(state)?.erosion);
});
