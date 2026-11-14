// Phase 4-E-7：數值收尾與實測補丁——新手期維持費、赤字徵稅、主神事件套利掃描、互助金軟上限與補貼、叛逃放寬、共用生育冷卻
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/data/config.js";
import { GOD_EVENTS } from "../src/data/godEvents.js";
import { createNewGame, createSamsarite, upkeepOf, endOfDay } from "../src/engine/core.js";
import { distributeLoot, setTaxRate, taxSanityDaily } from "../src/engine/wallet.js";
import { godEventEconomics, resolveGodEvent } from "../src/engine/godEvents.js";
import { dailyShopping } from "../src/engine/shopping.js";
import { appointCaptain, captainOf, squadOf } from "../src/engine/squad.js";
import { shiftAffinity } from "../src/engine/relations.js";
import { defectEligible, isDefectImmune, inducePregnancy, lineageBlock, dailyLineage } from "../src/engine/lineage.js";
import { giveBirth, dailyNursery } from "../src/engine/children.js";

function setup(n = 4, { level = 2, seed = 51 } = {}) {
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

test("新手期：空間 Lv.1 維持費 -50%，Lv.2 起照舊", () => {
  const state = setup(1, { level: 1 });
  const s = state.samsarites[0];
  assert.equal(upkeepOf(s, state), Math.round(CONFIG.space.upkeepGene[0] * CONFIG.space.newbieUpkeepMult));
  state.spaceLevel = 2;
  assert.equal(upkeepOf(s, state), CONFIG.space.upkeepGene[0] + CONFIG.space.upkeepSpace[1]);
  const base = createNewGame(1);
  base.samsarites = [];
  assert.equal(upkeepOf(s, null), CONFIG.space.upkeepGene[0], "沒傳 state 當 Lv.2 以上的標準值");
});

test("赤字緊急徵用：公庫 < 0 時分潤臨時以 max(稅率, 75%) 抽稅，不改 state.taxRate、不觸發高稅率理智懲罰；回正後照原稅率", () => {
  const state = setup(3);
  setTaxRate(state, 0.4);
  const [a, b] = state.samsarites;
  state.points = -100;
  const r = distributeLoot(state, [a, b], 1000);
  assert.equal(r.deficit, true);
  assert.equal(r.tax, 750, "75% 入公庫");
  assert.equal(a.wallet, 125);
  assert.equal(state.points, -100 + 750);
  assert.equal(state.taxRate, 0.4, "稅率設定本身不動");
  a.stats.sanity = 50;
  taxSanityDaily(state, a);
  assert.equal(a.stats.sanity, 50, "0.4 稅率沒有每日扣理智");
  assert.ok(state.log.some((l) => l.text.includes("75%")), "日誌有註記");
  // 回正後照原稅率
  const r2 = distributeLoot(state, [a, b], 1000);
  assert.equal(r2.deficit, false);
  assert.equal(r2.tax, 400);
  // 稅率本來就比 75% 高時不降
  setTaxRate(state, 0.8);
  state.points = -5;
  assert.equal(distributeLoot(state, [a, b], 1000).tax, 800);
  // 全滅：全歸公庫，不算徵用
  state.points = -5;
  assert.equal(distributeLoot(state, [], 1000).deficit, false);
});

test("主神搞事不可同幣別套利：純扣積分的事件，化解必須帶非積分代價，或積分價 >= 直接最高扣分", () => {
  for (const ev of GOD_EVENTS) {
    const e = godEventEconomics(ev.id);
    if (!e.directNonPoint) {
      assert.ok(e.resolveNonPoint || e.resolvePoints >= e.directPointsMax, `${ev.id}：直接扣 ${e.directPointsMax} 分，化解只花 ${e.resolvePoints} 分且沒有其他代價（套利）`);
    }
    // 無論哪種：化解不能比「直接最高扣分 + 非積分損失」更貴到不合理——至少不為負
    assert.ok(e.resolvePoints >= 0);
  }
  const tax = godEventEconomics("tax");
  assert.equal(tax.directNonPoint, false, "臨時開銷稅是純扣積分");
  assert.equal(tax.resolveNonPoint, true, "所以化解要另付異質代價（全體理智）");
});

test("化解臨時開銷稅：花積分 ＋ 全體留守者理智下降", () => {
  const state = setup(3);
  state.god.pending = { id: 1, kind: "tax", mode: "tax", targetId: null, params: { loss: 100 }, text: "x", day: 1 };
  const before = state.points;
  const r = resolveGodEvent(state);
  assert.equal(r.ok, true);
  assert.equal(state.points, before - CONFIG.godEvent.kinds.tax.resolveCost);
  for (const s of state.samsarites) assert.equal(s.stats.sanity, 100 - CONFIG.godEvent.kinds.tax.resolveSanityAll);
  assert.equal(state.god.pending, null);
});

function communal(n = 4) {
  const state = setup(n);
  state.samsarites[0].tags = ["lecturer"];
  appointCaptain(state, state.samsarites[0].id);
  assert.equal(state.squad.style, "communal");
  return state;
}

test("互助金：捐獻率 25%；互助金 >= 15000 × 空間等級 後老鳥暫停捐獻", () => {
  const state = communal(3);
  const [cap, vet] = state.samsarites;
  for (const s of [cap, vet]) s.gear = { weapon: "weapon_club", armor: "armor_cloth" };
  state.samsarites[2].gear = { weapon: "weapon_club", armor: "armor_cloth" };
  vet.wallet = 1000;
  dailyShopping(state);
  assert.ok(squadOf(state).communalFund > 0 && squadOf(state).communalFund <= 250 + 1, `捐了約 25%：${squadOf(state).communalFund}`);
  // 滿了不捐
  state.squad.communalFund = CONFIG.squad.communal.fundCapPerLevel * state.spaceLevel;
  vet.wallet = 1000;
  const fund = state.squad.communalFund;
  dailyShopping(state);
  assert.ok(vet.wallet >= 900 || state.squad.communalFund === fund, "滿了就暫停捐獻");
  assert.ok(state.squad.communalFund <= fund, "沒有再增加");
});

test("互助金補貼：受重傷者治療費、低於隊長且 1 階的人衝 2 階基因鎖都有補", () => {
  const state = communal(3);
  const [cap, a, b] = state.samsarites;
  for (const s of state.samsarites) s.gear = { weapon: "weapon_club", armor: "armor_cloth" };
  state.squad.communalFund = 5000;
  // 重傷：沒私房錢也買得到藥
  a.injury = 2;
  a.wallet = 0;
  dailyShopping(state);
  assert.ok(a.shopLog.some((l) => l.text.includes("互助金補貼")), "治療費有補");
  // 2 階基因鎖：隊長 2 階、b 為 1 階，強化點滿、空間 Lv.3
  state.spaceLevel = 3;
  state.squad.communalFund = 50000;
  cap.geneLock = 2;
  b.geneLock = 1;
  b.enhanceCount = CONFIG.gene.tiers[1].enhanceCap;
  b.rank = "A";
  b.wallet = 10;
  state.totalSpent = 0; // 商店維持第 1 階，免得他先拿錢去換裝
  const w0 = b.geneLock;
  dailyShopping(state);
  assert.equal(b.geneLock, w0 + 1, "互助金補貼他衝上 2 階基因鎖");
  assert.ok(captainOf(state));
});

test("叛逃放寬：淨好感 <= -45 且（理智 < 45 或持有 demon_path）；免疫名單照舊 100%", () => {
  const state = setup(5, { level: 3 });
  appointCaptain(state, state.samsarites[0].id);
  const [cap, a, b, c, d] = state.samsarites;
  for (const s of [a, b, c, d]) shiftAffinity(state, s, cap, -50);
  a.stats.sanity = 40; // < 45
  b.stats.sanity = 80;
  c.stats.sanity = 80;
  c.tags = ["demon_path"];
  d.stats.sanity = 50;
  assert.equal(defectEligible(state, a), true);
  assert.equal(defectEligible(state, b), false, "理智高且沒入魔");
  assert.equal(defectEligible(state, c), true, "demon_path 即使理智高也算");
  assert.equal(defectEligible(state, d), false, "理智 50 不算");
  // 淨好感 -44 不夠
  const e = createSamsarite(state, "C");
  e.tags = [];
  e.stats.sanity = 0;
  state.samsarites.push(e);
  shiftAffinity(state, e, cap, -44);
  assert.equal(defectEligible(state, e), false);
  // 免疫
  c.customProfile = { name: "專屬" };
  assert.equal(isDefectImmune(state, c), true);
  a.gear = { weapon: "weapon_club" };
  a.soulbound = { weapon: true };
  assert.equal(isDefectImmune(state, a), true);
  // 機率 100% 時：只有 b、d 之外「符合且不免疫」的人會走；a、c 都免疫 → 無人叛逃
  const keep = CONFIG.lineage.rogueChance;
  CONFIG.lineage.rogueChance = 1;
  try {
    dailyLineage(state);
  } finally {
    CONFIG.lineage.rogueChance = keep;
  }
  assert.equal(state.rogueBosses.length, 0);
});

test("孕育冷卻 60 天，3-F 與 4-E 共用同一把雙親冷卻鎖", () => {
  assert.equal(CONFIG.lineage.cooldownDays, 60);
  const state = setup(2);
  const [a, b] = state.samsarites;
  shiftAffinity(state, a, b, 90);
  shiftAffinity(state, b, a, 90);
  giveBirth(state, a, b); // 3-F 路徑（戀人生子）也上同一把鎖
  assert.match(lineageBlock(state, a, b), /冷卻/);
  const key = Object.keys(state.cooldowns).find((k) => k.startsWith("birth:"));
  assert.equal(state.cooldowns[key] - 1 - Math.floor(state.tick / CONFIG.ticksPerDay), 60);
  // 反過來：孕育生過，3-F 每日檢定也被擋（同一個 key）
  const s2 = setup(2);
  const [c, d] = s2.samsarites;
  shiftAffinity(s2, c, d, 90);
  shiftAffinity(s2, d, c, 90);
  s2.relations[`${c.id}>${d.id}`].status = "lover";
  s2.relations[`${d.id}>${c.id}`].status = "lover";
  assert.ok(inducePregnancy(s2, c, d));
  const n0 = s2.samsarites.length;
  const keep = CONFIG.child.chance.lover;
  CONFIG.child.chance.lover = 1;
  try {
    for (let i = 0; i < 20; i++) dailyNursery(s2);
  } finally {
    CONFIG.child.chance.lover = keep;
  }
  assert.equal(s2.samsarites.length, n0, "冷卻中不會再生");
  void endOfDay;
});
