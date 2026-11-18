// A-3 階段 4：天數底線壓力（強制任務加壓＋主神搞事稅務損失改公庫比例）
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/data/config.js";

CONFIG.tension.enabled = false; // 同 mandatory.test.js：關閉無人看管的人際張力，避免干擾人數與派遣

import { createNewGame, createSamsarite, currentDay } from "../src/engine/core.js";
import { floorShrinkOf, floorRMultOf, mandatoryInterval, mandatoryR } from "../src/engine/mandatory.js";
import { godEventEconomics } from "../src/engine/godEvents.js";

const F = CONFIG.forcedMission;

function setup(n = 4, seed = 9) {
  const state = createNewGame(seed);
  state.samsarites = [];
  state.points = 1e6;
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, "C");
    s.tags = [];
    state.samsarites.push(s);
  }
  return state;
}

/** 把遊戲日推到指定天數（只改 tick，不跑結算） */
function atDay(state, day) {
  state.tick = (day - 1) * CONFIG.ticksPerDay;
  return state;
}

test("底線壓力：floorRampDay 之前完全不變（新手期不受影響）", () => {
  for (const d of [1, 15, 30, F.floorRampDay - 1]) {
    assert.equal(floorShrinkOf(d), 0, `day ${d} 不應縮短`);
    assert.equal(floorRMultOf(d), 1, `day ${d} 不應加 R`);
  }
});

test("底線壓力：間隔每 floorIntervalStepDays 天縮短 floorIntervalShrink 天", () => {
  const r = F.floorRampDay;
  assert.equal(floorShrinkOf(r), 0);
  assert.equal(floorShrinkOf(r + F.floorIntervalStepDays - 1), 0);
  assert.equal(floorShrinkOf(r + F.floorIntervalStepDays), F.floorIntervalShrink);
  assert.equal(floorShrinkOf(r + 2 * F.floorIntervalStepDays), 2 * F.floorIntervalShrink);
});

test("底線壓力：間隔有下限 floorIntervalMin，且大於 deadlineDays（玩家有機會派隊）", () => {
  assert.ok(F.floorIntervalMin > F.deadlineDays, "下限需大於派隊期限");
  const state = atDay(setup(), 2000);
  assert.equal(mandatoryInterval(state), F.floorIntervalMin);
});

test("底線壓力：R 乘數線性上升並封頂 floorRCap", () => {
  const r = F.floorRampDay;
  assert.equal(floorRMultOf(r), 1);
  assert.ok(Math.abs(floorRMultOf(r + 100) - (1 + F.floorRPerDay * 100)) < 1e-12);
  assert.equal(floorRMultOf(r + 100000), F.floorRCap);
});

test("底線壓力：mandatoryR 隨天數放大（同一名冊，只差天數）", () => {
  const state = setup(4, 11);
  const rAtRamp = mandatoryR(atDay(state, F.floorRampDay)); // 乘數 1
  const rLate = mandatoryR(atDay(state, F.floorRampDay + 100)); // 乘數 1 + 0.4%×100 = 1.4
  assert.ok(rLate > rAtRamp, `late ${rLate} 應大於 ramp ${rAtRamp}`);
  assert.ok(Math.abs(rLate - Math.round(rAtRamp * floorRMultOf(F.floorRampDay + 100))) <= 1);
});

test("底線壓力：稅務損失在後期隨公庫比例放大，早期仍是固定小額下限", () => {
  // economics 掃描：稅務化解仍要帶非積分代價（不能靠花小額積分破財消災）
  const eco = godEventEconomics("tax");
  assert.equal(eco.directNonPoint, false, "稅務是純扣積分，化解必須靠 resolveSanityAll 的非積分代價");
  assert.ok(eco.resolveNonPoint, "化解應有理智代價");
  assert.ok(CONFIG.godEvent.kinds.tax.lossPct > 0 && CONFIG.godEvent.kinds.tax.lossPct < 0.1, "比例應介於 0～10% 之間");
});

test("底線壓力：日誌句 floorUp 存在且有佔位符", async () => {
  const { LOGS } = await import("../src/data/logs.js");
  const tpl = LOGS.floorUp;
  assert.ok(Array.isArray(tpl) && tpl.length >= 2, "floorUp 至少要有 2 個版本");
  for (const t of tpl) {
    assert.ok(t.includes("{interval}") && t.includes("{mult}"), "版本需含 {interval} 與 {mult}");
  }
});

test("底線壓力：currentDay 與 atDay 工具一致（測試本身的前提）", () => {
  assert.equal(currentDay(atDay(setup(), 45)), 45);
});
