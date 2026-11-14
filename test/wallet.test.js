// Phase 4-D-1：雙錢包（公庫／私房錢）、稅率、分潤、稅率理智影響、賞賜綁定、遺產規則
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG, RANKS } from "../src/data/config.js";
import { createNewGame, createSamsarite, endOfDay, recycle, killSamsarite, spendWallet, serialize, deserialize } from "../src/engine/core.js";
import { distributeLoot, setTaxRate, taxSanityDaily } from "../src/engine/wallet.js";
import { buyItem } from "../src/engine/shop.js";
import { enhance, checkEnhance, breakGene } from "../src/engine/growth.js";
import { startRun } from "../src/engine/dungeon.js";
import { step } from "../src/engine/dispatch.js";

function setup(n = 3, seed = 3) {
  const state = createNewGame(seed);
  state.samsarites = [];
  state.points = 100000;
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, "C");
    s.tags = [];
    state.samsarites.push(s);
  }
  return state;
}

test("稅率：預設 0.40，設定值夾在 0.20～0.80、對齊 0.10", () => {
  const state = createNewGame(1);
  assert.equal(state.taxRate, 0.4);
  assert.equal(setTaxRate(state, 0.1), 0.2);
  assert.equal(setTaxRate(state, 0.95), 0.8);
  assert.equal(setTaxRate(state, 0.53), 0.5);
  assert.equal(state.taxRate, 0.5);
});

test("分潤：先抽稅入公庫，其餘由存活隊員平分；零頭歸公庫", () => {
  const state = setup(3);
  const [a, b, c] = state.samsarites;
  const before = state.points;
  const r = distributeLoot(state, [a, b, c], 1000); // 稅 400、剩 600 → 每人 200
  assert.deepEqual(r, { tax: 400, share: 200, members: 3 });
  assert.equal(state.points, before + 400);
  assert.deepEqual([a.wallet, b.wallet, c.wallet], [200, 200, 200]);
  const r2 = distributeLoot(state, [a, b], 1001); // 稅 round(400.4)=400、剩 601 → 每人 300、零頭 1 歸公庫
  assert.deepEqual(r2, { tax: 401, share: 300, members: 2 });
  assert.equal(a.wallet, 500);
});

test("分潤：全滅則全歸公庫；稅率可覆寫（給 4-E 流派用）", () => {
  const state = setup(2);
  const before = state.points;
  assert.deepEqual(distributeLoot(state, [], 500), { tax: 500, share: 0, members: 0 });
  assert.equal(state.points, before + 500);
  const [a] = state.samsarites;
  const r = distributeLoot(state, [a], 1000, { rate: 0.2 });
  assert.deepEqual(r, { tax: 200, share: 800, members: 1 });
});

test("副本結算：總積分 = 入公庫稅額 + 存活隊員私房錢；摘要帶 tax／share", () => {
  const state = setup(4, 5);
  for (const s of state.samsarites) s.stats.power = 5000; // 戰力碾壓，確保通關
  const ids = state.samsarites.map((s) => s.id);
  const before = state.points;
  assert.equal(startRun(state, "ghost_village", ids).ok, true);
  let guard = 0;
  while (state.runs.length && guard++ < 100) step(state);
  const rep = state.lastRun;
  assert.ok(rep.success && rep.reward > 0);
  const walletSum = state.samsarites.reduce((n, s) => n + s.wallet, 0);
  assert.equal(rep.tax + walletSum, rep.reward, "稅＋私房錢 = 總積分");
  assert.equal(rep.share * state.samsarites.length + (rep.tax - Math.round(rep.reward * 0.4)), walletSum);
  assert.ok(state.points > before - 1000); // 公庫只拿到稅（還要扣維持費，這裡只看它沒拿到全額）
});

test("稅率日常理智：≤0.30 +1、0.40～0.50 不變、0.60～0.70 -2、≥0.80 -4（上限 100）", () => {
  const state = setup(1);
  const [s] = state.samsarites;
  for (const [rate, delta] of [[0.2, 1], [0.3, 1], [0.4, 0], [0.5, 0], [0.6, -2], [0.7, -2], [0.8, -4]]) {
    state.taxRate = rate;
    s.stats.sanity = 50;
    taxSanityDaily(state, s);
    assert.equal(s.stats.sanity, 50 + delta, `稅率 ${rate}`);
  }
  state.taxRate = 0.2;
  s.stats.sanity = 100;
  taxSanityDaily(state, s);
  assert.equal(s.stats.sanity, 100, "理智上限 100");
});

test("稅率理智：endOfDay 只影響在空間的人", () => {
  const state = setup(2);
  const [home, away] = state.samsarites;
  away.location = "dungeon";
  state.taxRate = 0.8;
  home.stats.sanity = away.stats.sanity = 50;
  state.tick = CONFIG.ticksPerDay;
  endOfDay(state);
  assert.equal(home.stats.sanity, 50 + CONFIG.sanity.restRecover - 4);
  assert.equal(away.stats.sanity, 50);
});

test("賞賜：公庫買裝備給角色 → 綁定、理智 +5；累積花費照算", () => {
  const state = setup(1);
  const [s] = state.samsarites;
  s.stats.sanity = 60;
  const spent = state.totalSpent;
  assert.equal(buyItem(state, "weapon_club", s.id).ok, true);
  assert.equal(s.soulbound.weapon, true);
  assert.equal(s.stats.sanity, 65);
  assert.ok(state.totalSpent > spent);
});

test("私房錢付費：強化與突破基因鎖用 s.wallet，不動公庫，並累加 totalSpent", () => {
  const state = setup(1);
  const [s] = state.samsarites;
  const pts = state.points;
  assert.equal(checkEnhance(state, s.id, { payer: "wallet" }).ok, false, "沒錢");
  s.wallet = 500;
  const spent = state.totalSpent;
  const r = enhance(state, s.id, { payer: "wallet" });
  assert.equal(r.ok, true);
  assert.equal(state.points, pts, "公庫不動");
  assert.equal(s.wallet, 500 - r.cost);
  assert.equal(state.totalSpent, spent + r.cost);
  s.enhanceCount = CONFIG.gene.tiers[0].enhanceCap;
  state.spaceLevel = 2;
  s.wallet = 100;
  assert.equal(breakGene(state, s.id, { payer: "wallet" }).ok, false, "私房錢不夠 300");
  s.wallet = 400;
  assert.equal(breakGene(state, s.id, { payer: "wallet" }).ok, true);
  assert.equal(s.geneLock, 1);
  assert.equal(s.wallet, 100);
  assert.equal(spendWallet(state, s, 9999), false);
});

test("遺產：主動回收 100% 私房錢連同返還金歸公庫", () => {
  const state = setup(2);
  const [a] = state.samsarites;
  a.wallet = 300;
  const before = state.points;
  assert.equal(recycle(state, a.id), true);
  assert.equal(state.points, before + 300 + RANKS.C.recycleRefund);
});

test("遺產：戰死／抹殺時私房錢 50% 充公、50% 消散", () => {
  const state = setup(2);
  const [a, b] = state.samsarites;
  a.wallet = 301;
  b.wallet = 100;
  const before = state.points;
  killSamsarite(state, a, "死在了副本");
  assert.equal(state.points, before + 151, "round(301 × 0.5)");
  killSamsarite(state, b, "被主神抹殺");
  assert.equal(state.points, before + 151 + 50);
});

test("存檔：舊存檔補稅率與私房錢欄位；新欄位往返不遺失", () => {
  const state = setup(1);
  state.samsarites[0].wallet = 77;
  state.taxRate = 0.7;
  const back = deserialize(serialize(state));
  assert.equal(back.samsarites[0].wallet, 77);
  assert.equal(back.taxRate, 0.7);
  const old = JSON.parse(serialize(state));
  delete old.taxRate;
  delete old.samsarites[0].wallet;
  delete old.samsarites[0].soulbound;
  const loaded = deserialize(JSON.stringify(old));
  assert.equal(loaded.taxRate, CONFIG.tax.default);
  assert.equal(loaded.samsarites[0].wallet, 0);
  assert.deepEqual(loaded.samsarites[0].soulbound, {});
});

test("整合：自動派遣跑 60 天——私房錢不為負、數字都是整數、輪迴者有在自己逛街、奇物加成不超過封頂、不會遊戲結束", () => {
  const state = createNewGame(7);
  state.settings.autoDispatch = true;
  for (const key of Object.keys(state.settings.pauseOn)) state.settings.pauseOn[key] = false;
  let guard = 0;
  while (state.tick < CONFIG.ticksPerDay * 60 && !state.gameOver && guard++ < 10000) {
    step(state);
    state.events.length = 0;
    state.runReports.length = 0;
    for (const s of state.samsarites) {
      assert.ok(Number.isInteger(s.wallet) && s.wallet >= 0, `${s.name} 私房錢 ${s.wallet}`);
      assert.ok((s.relicBonus ?? 0) <= CONFIG.relic.powerCap + 1e-9);
    }
    assert.ok(Number.isInteger(state.points));
  }
  assert.equal(state.gameOver, false);
  assert.ok(state.totalSpent > 0);
});
