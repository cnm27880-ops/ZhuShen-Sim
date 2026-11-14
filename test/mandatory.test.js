// Phase 4-C-4：主神強制血腥任務
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/data/config.js";
import { createNewGame, createSamsarite, currentDay, advanceTick, serialize, deserialize } from "../src/engine/core.js";
import { startRun, hurt, roomPassRate, dungeonOfRun } from "../src/engine/dungeon.js";
import { step, tryAutoDispatch } from "../src/engine/dispatch.js";
import { effectivePower, luckRewardPct } from "../src/engine/tags.js";
import { dailyGod } from "../src/engine/godEvents.js";
import { MANDATORY_ID, mandatoryR, topPowerSum, popLimit, nextMandatoryDay, buildMandatoryDungeon } from "../src/engine/mandatory.js";

const F = CONFIG.forcedMission;

function setup(n, seed = 9, rank = "C") {
  const state = createNewGame(seed);
  state.samsarites = [];
  state.points = 1e6;
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, rank);
    s.tags = [];
    state.samsarites.push(s);
  }
  return state;
}
/** 推進到指定天數的開頭（currentDay === day） */
function toDay(state, day) {
  while (currentDay(state) < day) advanceTick(state);
}
const ids = (state, n = 4) => state.samsarites.slice(0, n).map((s) => s.id);

test("R = max(空間等級基準, 名冊前 4 強有效戰力總和 × 0.55)", () => {
  const state = setup(6);
  assert.equal(mandatoryR(state), F.baseR[0], "開局戰力很低，吃基準值");
  state.samsarites.forEach((s) => (s.stats.power = 10000));
  const top4 = state.samsarites.map(effectivePower).sort((a, b) => b - a).slice(0, 4).reduce((a, b) => a + b, 0);
  assert.equal(topPowerSum(state), top4);
  assert.equal(mandatoryR(state), Math.round(top4 * F.powerMult));
  state.spaceLevel = 3;
  state.samsarites.forEach((s) => (s.stats.power = 1));
  assert.equal(mandatoryR(state), F.baseR[2]);
  const d = buildMandatoryDungeon(state);
  assert.equal(d.rooms.length, F.rooms);
  assert.equal(d.reward, F.reward[2]);
});

test("計時：Day 15 保護期後開始，第一次在 Day 27；人口超標改 6 天", () => {
  const state = setup(3);
  assert.equal(nextMandatoryDay(state), 27);
  toDay(state, 26);
  assert.equal(state.mandatory.pending, null);
  toDay(state, 27);
  assert.equal(state.mandatory.pending.createdDay, 27);
  assert.equal(state.mandatory.pending.deadlineDay, 27 + F.deadlineDays);
  assert.ok(state.log.some((e) => e.type === "mandatory"));

  const big = setup(popLimit(setup(1)) + 1); // 超過 6 + 1×2 = 8
  assert.equal(popLimit(big), 8);
  assert.equal(nextMandatoryDay(big), 15 + F.overPopIntervalDays);
  big.samsarites.pop();
  assert.equal(nextMandatoryDay(big), 27, "回到上限內就恢復 12 天");
});

test("派隊後任務不再逾時；沒有任務時不能出發", () => {
  const state = setup(4);
  assert.equal(startRun(state, MANDATORY_ID, ids(state)).ok, false);
  toDay(state, 27);
  const r = startRun(state, MANDATORY_ID, ids(state));
  assert.equal(r.ok, true);
  assert.equal(state.mandatory.pending, null);
  const def = dungeonOfRun(r.run);
  assert.equal(def.recommendedPower, mandatoryR(state));
  assert.equal(r.run.envId, null);
  assert.equal(state.dungeonStats[MANDATORY_ID], undefined, "不留通關統計");
  toDay(state, 40);
  assert.equal(state.samsarites.length, 4, "派了就不會被抹殺");
});

test("單房通過率上限 80%；傷勢額外 +1", () => {
  const state = setup(4);
  state.samsarites.forEach((s) => (s.stats.power = 1e7));
  toDay(state, 27);
  const { run } = startRun(state, MANDATORY_ID, ids(state));
  const def = dungeonOfRun(run);
  const party = state.samsarites;
  assert.ok(roomPassRate(state, party, def, null, 0, 0) <= F.passCap + 1e-9);
  assert.equal(run.extraInjury, F.failInjuryExtra);
  const s = party[0];
  s.stats.defense = 0;
  s.stats.speed = 0;
  const entered = { ...run, enteredInjury: { [s.id]: 0 }, deaths: [] };
  hurt(state, entered, s, def);
  assert.ok(s.injury >= 2, "最輕的傷勢表是 1 級，加上額外 +1 至少重傷");
});

/** 跑完一場強制任務：回傳結算摘要（任務失敗時換個種子） */
function runMandatory(seed, mutate = () => {}) {
  const state = setup(4, seed);
  toDay(state, 27);
  const { run } = startRun(state, MANDATORY_ID, ids(state));
  mutate(run, state);
  for (let i = 0; i < 40 && state.runs.length; i++) step(state);
  return { state, report: state.runReports.at(-1) };
}

test("結算：通關給基礎獎勵（含氣運）、不計守門、不掉結晶；戰死隊友讓存活者 +25%／人", () => {
  let plain = null;
  let bonus = null;
  for (let seed = 1; seed <= 40 && !(plain && bonus); seed++) {
    if (!plain) {
      const r = runMandatory(seed);
      if (r.report.success) plain = r;
    }
    if (!bonus) {
      const r = runMandatory(seed, (run) => run.deaths.push("某人", "某某"));
      if (r.report.success) bonus = r;
    }
  }
  assert.ok(plain && bonus, "40 個種子內要各出現一次成功");
  for (const { state, report } of [plain, bonus]) {
    assert.equal(report.mandatory, true);
    assert.equal(report.firstClear, false);
    assert.equal(report.karma, 0);
    assert.equal(state.chapterClears[1] ?? 0, 0, "不計尾王守門");
    assert.equal(state.karmaCrystals, 0);
  }
  const survivors = (st) => st.samsarites.filter((s) => s.location === "space");
  const expect = (st, deaths) => Math.round(F.reward[0] * (1 + deaths * F.deathRewardPct) * (1 + luckRewardPct(survivors(st))));
  assert.equal(plain.report.reward, expect(plain.state, 0));
  assert.equal(bonus.report.reward, expect(bonus.state, 2));
});

test("逾時未派：抹殺 1～2 名在空間的人，其他人理智大跌", () => {
  const counts = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const state = setup(5, seed);
    toDay(state, 27);
    assert.ok(state.mandatory.pending);
    toDay(state, 27 + F.deadlineDays);
    assert.equal(state.mandatory.pending, null);
    const dead = state.graveyard.length; // 期間可能有人生小孩，所以不能用人數相減
    counts.add(dead);
    assert.ok(dead >= 1 && dead <= 2);
    assert.ok(state.graveyard.every((g) => g.cause.includes("抹殺")));
    for (const s of state.samsarites) assert.ok(s.stats.sanity <= 100 - F.purgeSanityLoss + CONFIG.sanity.restRecover, `理智 ${s.stats.sanity}`);
  }
  assert.deepEqual([...counts].sort(), [1, 2], "兩種人數都會出現");
});

test("逾時抹殺：空間裡最後一個人不死，直接打成致命傷；名冊不會被抹光", () => {
  for (const n of [1, 2]) {
    let sparedSeen = false;
    for (let seed = 1; seed <= 30; seed++) {
      const state = setup(n, seed);
      toDay(state, 27 + F.deadlineDays);
      const adults = state.samsarites.filter((s) => !s.parents);
      assert.ok(adults.length >= 1, "名冊不會被抹光");
      if (n === 1) {
        assert.equal(adults[0].injury, 3);
        assert.equal(state.graveyard.length, 0);
        sparedSeen = true;
      } else if (state.graveyard.length === 1 && adults[0].injury === 3) sparedSeen = true; // 2 人被抽 2 個：只殺 1 個，留下的打成致命傷
    }
    assert.ok(sparedSeen, `${n} 人的情況要出現過保底`);
  }
});

test("強制任務待派時，主神搞事不擲新事件", () => {
  const state = setup(3);
  state.mandatory.pending = { id: 1, createdDay: 1, deadlineDay: 99 };
  for (let i = 0; i < 300; i++) {
    state.god.cooldownUntilDay = 0;
    dailyGod(state);
    assert.equal(state.god.pending, null);
  }
});

test("自動派遣：優先派最強的人去強制任務", () => {
  const state = setup(5);
  state.samsarites[3].stats.power = 500;
  state.settings.autoDispatch = true;
  toDay(state, 27);
  assert.ok(state.mandatory.pending);
  assert.equal(tryAutoDispatch(state) >= 1, true);
  assert.equal(state.mandatory.pending, null);
  const run = state.runs.find((r) => r.mandatory);
  assert.ok(run.partyIds.includes(state.samsarites[3].id), "最強的人一定在隊裡");
  assert.equal(run.partyIds.length, CONFIG.partyMax);
});

test("存檔：任務中途存讀檔，動態副本快照還在；舊存檔補 mandatory 欄位", () => {
  const state = setup(4);
  toDay(state, 27);
  startRun(state, MANDATORY_ID, ids(state));
  step(state);
  const loaded = deserialize(serialize(state));
  assert.equal(dungeonOfRun(loaded.runs[0]).recommendedPower, dungeonOfRun(state.runs[0]).recommendedPower);
  for (let i = 0; i < 40 && loaded.runs.length; i++) step(loaded);
  assert.equal(loaded.runs.length, 0);
  assert.equal(loaded.runReports.at(-1).mandatory, true);

  const old = JSON.parse(serialize(state));
  delete old.mandatory;
  assert.equal(deserialize(JSON.stringify(old)).mandatory.lastDay, F.startDay);
});
