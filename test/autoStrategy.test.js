// Phase 4-E-8 UX：自動派遣看戰力下菜（safe／balanced／aggressive）、全超標待機不送死、強制任務徵召無視日常鎖
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG, PAUSE_EVENTS } from "../src/data/config.js";
import { createNewGame, createSamsarite, currentDay } from "../src/engine/core.js";
import { autoRatioGate, tryAutoDispatch, planAutoDispatch, autoMandatory, autoTargets } from "../src/engine/dispatch.js";
import { partyPower, clearChance, deathRisk } from "../src/engine/dungeon.js";
import { DUNGEONS } from "../src/data/dungeons.js";
import { dailyMandatory } from "../src/engine/mandatory.js";
import { checkAlerts } from "../src/engine/alerts.js";

/** boost：給全隊通過率加成（標籤 + 情報滿格），讓「通關率夠但戰力其實不夠」成為可能——這正是戰力門檻要擋的情況 */
function setup(power, n = 4, seed = 71, level = 3, boost = true) {
  const state = createNewGame(seed);
  state.samsarites = [];
  state.spaceLevel = level;
  state.points = 100000;
  state.settings.protect.noEnemies = false;
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, "C");
    s.tags = boost ? ["ex_customer_service", "luck_borrower"] : [];
    s.stats.power = power;
    state.samsarites.push(s);
  }
  if (boost) for (const d of DUNGEONS) state.dungeonStats[d.id] = { attempts: 9, clears: 9, intel: CONFIG.dungeon.intel.max };
  return state;
}

/** 只留「戰力門檻」這一項：把 safe 的其他規則（通關率、隊數、留守…）放鬆，才能單獨驗證 autoRatioGate */
function withLooseSafe(fn) {
  const saved = CONFIG.auto.rules.safe;
  CONFIG.auto.rules.safe = { minClear: 0.6, maxTeams: 99, maxInjury: 3, maxDeathRisk: 1, reserve: 0 };
  try {
    fn();
  } finally {
    CONFIG.auto.rules.safe = saved;
  }
}

test("風險策略門檻：safe 1.20／balanced 1.00（新手期 0.85）／aggressive 0.80／off 不檢查；預設 balanced", () => {
  const state = setup(30);
  assert.equal(state.autoStrategy, "balanced");
  assert.equal(autoRatioGate(state), 1.0);
  state.spaceLevel = 1;
  assert.equal(autoRatioGate(state), 0.85, "新手期放寬");
  state.spaceLevel = 3;
  state.autoStrategy = "safe";
  assert.equal(autoRatioGate(state), 1.2);
  state.autoStrategy = "aggressive";
  assert.equal(autoRatioGate(state), 0.8);
  state.autoStrategy = "off";
  assert.equal(autoRatioGate(state), 0);
});

test("看戰力下菜：打得過的槽照派；超標（戰力 < R × 倍率）就不挑；所有槽都打不過 → 待機、不硬派", () => withLooseSafe(() => {
  // 掃描戰力，找到「不設門檻會出征、safe 門檻卻擋下」的區間
  let found = null;
  for (let power = 10; power <= 900 && !found; power += 2) {
    const off = setup(power, 4, 71, 1);
    off.autoStrategy = "off";
    const planOff = planAutoDispatch(off);
    const safe = setup(power, 4, 71, 1);
    safe.autoStrategy = "safe";
    const planSafe = planAutoDispatch(safe);
    if (planOff && !planSafe) found = { power, planOff };
    if (planSafe) assert.ok(partyPower(planSafe.party) >= planSafe.dungeon.recommendedPower * 1.2 - 1e-9, "safe 只派戰力 >= R×1.2 的任務");
  }
  assert.ok(found, "找得到 safe 比 off 保守的戰力區間");
  const state = setup(found.power, 4, 71, 1);
  state.autoStrategy = "safe";
  state.settings.autoDispatch = true;
  assert.equal(tryAutoDispatch(state), 0, "全部超標：不出擊");
  assert.equal(state.runs.length, 0);
  assert.ok(state.samsarites.every((s) => s.location === "space"), "人都留在家休整");
  assert.ok(state.log.some((l) => l.type === "autoRisk"), "有提示");
  assert.ok(!state.log.some((l) => l.type === "autoIdle"));
}));

test("待機提示不洗版：連續多天都打不過，風險提示最多每 3 天一次", () => withLooseSafe(() => {
  let power = 0;
  const probe = (p) => {
    const a = setup(p, 4, 71, 1);
    a.autoStrategy = "off";
    const b = setup(p, 4, 71, 1);
    b.autoStrategy = "safe";
    return planAutoDispatch(a) && !planAutoDispatch(b);
  };
  for (let p = 10; p <= 900; p += 2) if (probe(p)) {
    power = p;
    break;
  }
  assert.ok(power > 0);
  const state = setup(power, 4, 71, 1);
  state.autoStrategy = "safe";
  for (let day = 1; day <= 7; day++) {
    state.tick = (day - 1) * CONFIG.ticksPerDay;
    tryAutoDispatch(state);
  }
  const n = state.log.filter((l) => l.type === "autoRisk").length;
  assert.equal(n, 3, "第 1、4、7 天各一次");
  assert.equal(currentDay(state), 7);
}));

test("aggressive 比 balanced 敢打：同一支隊伍，門檻較低時能挑的槽更多（只多不少）", () => {
  for (let power = 300; power <= 6000; power += 300) {
    const bal = setup(power);
    const agg = setup(power);
    agg.autoStrategy = "aggressive";
    const pb = planAutoDispatch(bal);
    const pa = planAutoDispatch(agg);
    if (pb) assert.ok(pa, `戰力 ${power}：balanced 能派，aggressive 也要能派`);
  }
  // 目標清單用的是套突變後的實際 R（板上目標的 dungeon 已套 R 倍率）
  const state = setup(1000);
  for (const t of autoTargets(state)) assert.ok(t.dungeon.recommendedPower > 0);
  void clearChance;
});

test("強制任務徵召（問題 3）：平常尊重鎖定，鎖定精銳不派；只有最後期限且沒人可派才放寬並提示", () => {
  const state = setup(30, 5, 72, 2);
  const [a, b, c, d, e] = state.samsarites;
  a.stats.power = 400;
  b.stats.power = 380;
  a.locked = true;
  b.locked = true;
  for (const s of [c, d, e]) s.stats.power = 30;
  state.settings.autoDispatch = true;
  state.mandatory.pending = { id: 1, createdDay: 1, deadlineDay: 3 };
  state.tick = CONFIG.ticksPerDay * 2; // 第 3 天 = 最後期限
  assert.equal(autoMandatory(state), 1);
  const run = state.runs.find((r) => r.mandatory);
  assert.ok(run);
  assert.ok(!run.partyIds.includes(a.id) && !run.partyIds.includes(b.id), "鎖定的人不被徵召");
  assert.equal(run.partyIds.length, 3, "池子裡只有 3 個沒鎖的人，全派");

  // 全員鎖定：期限前不派（等），最後期限才放寬硬派並跳提示
  const all = setup(30, 3, 75, 2);
  for (const s of all.samsarites) s.locked = true;
  all.mandatory.pending = { id: 1, createdDay: 1, deadlineDay: 5 };
  all.tick = CONFIG.ticksPerDay * 1; // 第 2 天，離期限還久
  assert.equal(autoMandatory(all), 0, "期限前全員鎖定：不硬派");
  assert.equal(all.runs.length, 0);
  all.tick = CONFIG.ticksPerDay * 4; // 第 5 天 = 最後期限
  assert.equal(autoMandatory(all), 1, "最後期限放寬");
  assert.ok(all.log.some((l) => l.type === "mandatory" && l.text.includes("強行徵召")), "有跳提示");

  // 日常自動派遣不挑鎖定的人
  const daily = setup(30, 5, 73, 2);
  daily.samsarites[0].stats.power = 5000;
  daily.samsarites[0].locked = true;
  daily.autoStrategy = "off";
  const plan = planAutoDispatch(daily);
  if (plan) assert.ok(!plan.party.some((s) => s.locked), "日常自動派遣不挑鎖定的人");
});

test("強制任務徵召：傷員（保護開著）排在池外，健康的先上", () => {
  const state = setup(30, 4, 76, 2);
  const [a, b] = state.samsarites;
  a.stats.power = 500;
  a.injury = 1; // 最強但帶傷
  state.mandatory.pending = { id: 1, createdDay: 1, deadlineDay: 9 };
  state.tick = CONFIG.ticksPerDay * 1;
  assert.equal(autoMandatory(state), 1);
  const run = state.runs.find((r) => r.mandatory);
  assert.ok(!run.partyIds.includes(a.id), "保護開著，傷員不徵召");
  assert.ok(run.partyIds.includes(b.id));
});

test("策略整套規則（問題 1、2）：每輪派隊數、通關率門檻、留守人數依策略不同", () => {
  const R = CONFIG.auto.rules;
  assert.ok(R.safe.minClear > R.balanced.minClear && R.balanced.minClear > R.aggressive.minClear);
  assert.ok(R.safe.maxTeams < R.balanced.maxTeams && R.balanced.maxTeams < R.aggressive.maxTeams);
  assert.ok(R.safe.reserve > R.balanced.reserve && R.balanced.reserve > R.aggressive.reserve);
  // 8 個強人（戰力足以同時派多隊）：各策略一輪派出的隊數不超過上限，且留守人數達標
  for (const [key, rule] of [["safe", R.safe], ["balanced", R.balanced], ["aggressive", R.aggressive]]) {
    const state = setup(400, 8, 77, 1);
    state.autoStrategy = key;
    const sent = tryAutoDispatch(state);
    assert.ok(sent <= rule.maxTeams, `${key}：一輪最多 ${rule.maxTeams} 隊，實派 ${sent}`);
    const home = state.samsarites.filter((s) => s.location === "space").length;
    assert.ok(home >= rule.reserve || sent === 0, `${key}：留守至少 ${rule.reserve} 人，實留 ${home}`);
  }
  const off = setup(400, 8, 77, 1);
  off.autoStrategy = "off";
  assert.ok(tryAutoDispatch(off) >= 1, "off 維持舊行為");
});

test("穩健策略不派傷員、也不派有死亡風險的隊伍（問題 4）", () => {
  const state = setup(400, 6, 78, 1);
  state.autoStrategy = "safe";
  state.settings.protect.noInjured = false; // 關掉玩家的傷員保護，單看策略本身
  for (const s of state.samsarites) s.injury = 1;
  assert.equal(planAutoDispatch(state), null, "全員帶傷，穩健不派");
  state.autoStrategy = "aggressive";
  assert.ok(planAutoDispatch(state), "激進可以派傷員");
});

test("deathRisk：健康隊伍風險低於帶傷隊伍；通過率越低風險越高", () => {
  const state = setup(300, 4, 79, 1);
  const party = state.samsarites;
  const d = DUNGEONS[0];
  const healthy = deathRisk(state, party, d);
  party[0].injury = 3;
  const injured = deathRisk(state, party, d);
  assert.ok(injured > healthy, "帶致命傷風險更高");
  assert.ok(healthy >= 0 && injured <= 1);
  party[0].injury = 0;
  for (const s of party) s.stats.power = 5;
  assert.ok(deathRisk(state, party, d) > healthy, "戰力太低風險更高");
});

test("新暫停警報（問題 5）：重傷／致命傷、理智 < 20 各只在跨過門檻時提醒一次", () => {
  const state = setup(30, 3, 80, 1);
  const [a] = state.samsarites;
  checkAlerts(state);
  assert.ok(!state.events.some((e) => e.type === "injurySevere" || e.type === "lowSanity"));
  a.injury = 2;
  a.stats.sanity = 10;
  checkAlerts(state);
  assert.equal(state.events.filter((e) => e.type === "injurySevere").length, 1);
  assert.equal(state.events.filter((e) => e.type === "lowSanity").length, 1);
  checkAlerts(state);
  assert.equal(state.events.filter((e) => e.type === "injurySevere").length, 1, "不重複提醒");
  a.injury = 0;
  a.stats.sanity = 60;
  checkAlerts(state); // 恢復後重新武裝
  a.injury = 3;
  checkAlerts(state);
  assert.equal(state.events.filter((e) => e.type === "injurySevere").length, 2, "再次惡化會再提醒");
  assert.ok("injurySevere" in PAUSE_EVENTS && "lowSanity" in PAUSE_EVENTS);
});

test("強制任務：刷出當下發事件、倒數最後 1 天未派再提醒一次（只提醒一次），事件類型 mandatory（自動暫停設定可控）", () => {
  const state = setup(50, 3, 74, 2);
  state.tick = CONFIG.ticksPerDay * 20; // 超過保護期
  state.mandatory.lastDay = 0;
  dailyMandatory(state);
  const day = currentDay(state);
  assert.ok(state.mandatory.pending, "刷出任務");
  assert.ok(state.events.some((e) => e.type === "mandatory"), "刷出當下有 mandatory 事件");
  const before = state.events.filter((e) => e.type === "mandatory").length;
  state.tick = CONFIG.ticksPerDay * (state.mandatory.pending.deadlineDay - 2); // 剩最後 1 天
  assert.equal(currentDay(state), state.mandatory.pending.deadlineDay - 1);
  dailyMandatory(state);
  assert.equal(state.events.filter((e) => e.type === "mandatory").length, before + 1, "最後 1 天提醒");
  assert.ok(state.log.some((l) => l.text.includes("最後 1 天")));
  dailyMandatory(state);
  assert.equal(state.events.filter((e) => e.type === "mandatory").length, before + 1, "不重複提醒");
  assert.ok(day >= 1);
  assert.equal(CONFIG.auto.holdForMandatory !== undefined, true);
});
