// A-3 階段 2：離心力（人際張力與怨氣）。引擎 engine/tension.js，數字 CONFIG.tension。
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/data/config.js";
import { LOGS } from "../src/data/logs.js";
import { TENSION_KINDS } from "../src/data/tensionEvents.js";
import { createNewGame, createSamsarite, serialize, deserialize, currentDay, debtLimitOf, advanceTick } from "../src/engine/core.js";
import { pairProfile, dailyTension, tensionOf, pendingTension, resolveTension, tensionOptions, compensateCost, climateIndex } from "../src/engine/tension.js";
import { checkAlerts } from "../src/engine/alerts.js";
import { elopeCandidate } from "../src/engine/rivals.js";
import { appointCaptain } from "../src/engine/squad.js";
import { getRel } from "../src/engine/relations.js";

const SAVE = JSON.stringify(CONFIG.tension);
beforeEach(() => {
  Object.assign(CONFIG.tension, JSON.parse(SAVE));
  CONFIG.tension.baseChance = 0.001; // 倍率測試用低基礎機率，避免頂到 maxChance（正式值見 config.js）
});
afterEach(() => Object.assign(CONFIG.tension, JSON.parse(SAVE)));

const NEUTRAL = () => ({ altruism: 0, ambition: 0, courage: 0, social: 0, obedience: 0 });

/** n 個性格全中性、關係全空的人，都在主神空間 */
function room(n = 4, seed = 3) {
  const state = createNewGame(seed);
  state.points = 100000;
  state.samsarites = [];
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, "C");
    s.traits = NEUTRAL();
    state.samsarites.push(s);
  }
  state.relations = {};
  state.mandatory.lastDay = 1e9;
  return { state, a: state.samsarites[0], b: state.samsarites[1], c: state.samsarites[2], d: state.samsarites[3] };
}
const setDay = (state, day) => {
  state.tick = (day - 1) * CONFIG.ticksPerDay;
};
const rel = (state, a, b, v) => {
  state.relations[`${a.id}>${b.id}`] = { love: 0, hate: 0, ...v };
};
const sure = (state) => {
  CONFIG.tension.baseChance = 5; // 機率直接頂到 maxChance
  CONFIG.tension.maxChance = 1;
};
const open = (state, a, b) => {
  const before = tensionOf(state).pending.length;
  sure(state);
  dailyTension(state);
  const ev = tensionOf(state).pending.find((x) => [x.aId, x.bId].includes(a.id) && [x.aId, x.bId].includes(b.id));
  assert.ok(ev && tensionOf(state).pending.length >= before, "應該開出一件");
  Object.assign(CONFIG.tension, JSON.parse(SAVE));
  return ev;
};

test("新局與舊存檔：有張力狀態與怨氣欄位，舊存檔讀檔補預設", () => {
  const state = createNewGame(5);
  assert.deepEqual(state.tension.pending, []);
  assert.equal(state.samsarites[0].grudge, 0);
  const old = JSON.parse(serialize(state));
  delete old.tension;
  for (const s of old.samsarites) delete s.grudge;
  const back = deserialize(JSON.stringify(old));
  assert.ok(Array.isArray(back.tension.pending) && back.tension.rngState !== undefined);
  assert.equal(back.samsarites[0].grudge, 0);
});

test("設定與日誌：事件種類、暫停事件、警報線都在", () => {
  assert.ok(CONFIG.tension.enabled);
  for (const k of TENSION_KINDS) assert.ok(LOGS[`tension_${k.id}`]?.length >= 3, k.id);
  for (const k of ["tensionEscalate", "tensionBoom", "tensionMediateOk", "tensionMediateFail", "tensionCompensate", "tensionSeparate", "tensionCaptainAuto", "grudgeWarn", "grudgeDefy"]) assert.ok(LOGS[k]?.length >= 2, k);
  const state = createNewGame(1);
  assert.equal(state.settings.pauseOn.grudge, true);
  assert.equal(state.settings.pauseOn.tension, false);
});

test("產生率：中性一對 = 基礎機率；仇恨／死敵／雙向負好感／怨氣／低理智放大", () => {
  const { state, a, b } = room();
  const T = CONFIG.tension;
  assert.equal(pairProfile(state, a, b).p, T.baseChance);
  rel(state, a, b, { hate: 55 });
  assert.equal(pairProfile(state, a, b).p, T.baseChance * T.hateMult.dislike);
  rel(state, b, a, { hate: 85 });
  assert.equal(pairProfile(state, a, b).p, T.baseChance * T.hateMult.hate * T.negAffinityMult);
  rel(state, a, b, { hate: 100, status: "nemesis" });
  assert.equal(pairProfile(state, a, b).p, T.baseChance * T.hateMult.nemesis * T.negAffinityMult);
  state.relations = {};
  a.grudge = 50;
  b.grudge = 50;
  assert.equal(pairProfile(state, a, b).p, T.baseChance * 2);
  a.grudge = b.grudge = 0;
  a.stats.sanity = 20;
  assert.equal(pairProfile(state, a, b).p, T.baseChance * 2);
  a.stats.sanity = 50;
  assert.equal(pairProfile(state, a, b).p, T.baseChance * 1.3);
});

test("產生率：上限 maxChance", () => {
  const { state, a, b } = room();
  rel(state, a, b, { hate: 100, status: "nemesis" });
  rel(state, b, a, { hate: 100, status: "nemesis" });
  a.grudge = b.grudge = 100;
  a.stats.sanity = 0;
  CONFIG.tension.maxChance = 0.05;
  assert.equal(pairProfile(state, a, b).p, 0.05);
});

test("個性：野心對野心＝爭功奪位；利他對利己＝吃虧不平（A 是吃虧的人）；不服隊長＝對隊長不滿", () => {
  const { state, a, b, c } = room();
  const T = CONFIG.tension;
  a.traits.ambition = b.traits.ambition = 60;
  let p = pairProfile(state, a, b);
  assert.equal(p.kind, "rivalry");
  assert.equal(p.p, T.baseChance * T.ambitionMult);
  a.traits.ambition = b.traits.ambition = 0;
  b.traits.altruism = 50;
  a.traits.altruism = -50;
  p = pairProfile(state, a, b);
  assert.equal(p.kind, "exploit");
  assert.equal(p.wronged.id, b.id);
  assert.equal(p.p, T.baseChance * T.altruismMult);
  b.traits.altruism = a.traits.altruism = 0;
  appointCaptain(state, c.id);
  state.spaceLevel = 2;
  appointCaptain(state, c.id);
  a.traits.obedience = -60;
  rel(state, a, c, { hate: 20 });
  p = pairProfile(state, a, c);
  assert.equal(p.kind, "captain");
});

test("搶同一人：雙方對第三人好感都高＝爭風吃醋；其中一方是戀人倍率更高", () => {
  const { state, a, b, c } = room();
  const T = CONFIG.tension;
  rel(state, a, c, { love: 60 });
  rel(state, b, c, { love: 60 });
  let p = pairProfile(state, a, b);
  assert.equal(p.kind, "jealousy");
  assert.equal(p.p, T.baseChance * T.triangleMult);
  rel(state, a, c, { love: 60, status: "lover" });
  p = pairProfile(state, a, b);
  assert.equal(p.p, T.baseChance * T.triangleLoverMult);
});

test("預防：戀人、好友、拆開期間都會降低產生率", () => {
  const { state, a, b } = room();
  const T = CONFIG.tension;
  rel(state, a, b, { love: 60, status: "lover" });
  rel(state, b, a, { love: 60, status: "lover" });
  assert.ok(Math.abs(pairProfile(state, a, b).p - T.baseChance * T.loverMult * T.friendMult) < 1e-12);
  state.relations = {};
  rel(state, a, b, { love: 60 });
  rel(state, b, a, { love: 60 });
  assert.ok(Math.abs(pairProfile(state, a, b).p - T.baseChance * T.friendMult) < 1e-12);
  state.relations = {};
  tensionOf(state).apart[`${a.id}:${b.id}`] = currentDay(state) + 3;
  assert.ok(Math.abs(pairProfile(state, a, b).p - T.baseChance * T.apartMult) < 1e-12);
});

test("期望事件量隨在家人數平方成長，沒有人數上限", () => {
  const expected = (n) => {
    const { state } = room(n);
    let sum = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) sum += pairProfile(state, state.samsarites[i], state.samsarites[j]).p;
    return sum;
  };
  assert.ok(Math.abs(expected(24) / expected(6) - 276 / 15) < 1e-9);
  assert.ok(expected(60) > expected(24) * 5, "60 人沒有被任何上限擋下");
});

test("事件開立：每對最多一件待辦，只在都在空間的人之間產生", () => {
  const { state, a, b, c } = room(3);
  b.location = "dungeon";
  sure(state);
  dailyTension(state);
  const evs = tensionOf(state).pending;
  assert.equal(evs.length, 1);
  assert.deepEqual([evs[0].aId, evs[0].bId].sort(), [a.id, c.id].sort());
  const n = evs.length;
  dailyTension(state); // 同一對已有待辦，不再開
  assert.equal(tensionOf(state).pending.length, n);
});

test("期限用遊戲日：沒過日界線不會逾期，過了才升級", () => {
  const { state, a, b } = room(2);
  const ev = open(state, a, b);
  assert.equal(ev.level, 1);
  assert.equal(ev.deadlineDay, ev.createdDay + CONFIG.tension.deadlineDays[0]);
  for (let i = 0; i < 5; i++) dailyTension(state); // 同一天呼叫再多次也不會逾期
  assert.equal(pendingTension(state)[0].level, 1);
  setDay(state, ev.deadlineDay);
  CONFIG.tension.baseChance = 0;
  dailyTension(state);
  const now = pendingTension(state)[0];
  assert.equal(now.level, 2);
  assert.equal(now.deadlineDay, ev.deadlineDay + CONFIG.tension.deadlineDays[1]);
});

test("無視：逾期後雙方怨氣與仇恨上升，等級 3 逾期爆發並進入冷卻", () => {
  const { state, a, b } = room(2);
  CONFIG.tension.baseChance = 0;
  const T = CONFIG.tension;
  CONFIG.tension.baseChance = 5;
  CONFIG.tension.maxChance = 1;
  dailyTension(state);
  CONFIG.tension.baseChance = 0;
  let total = 0;
  for (let lv = 1; lv <= 3; lv++) {
    const ev = pendingTension(state)[0];
    assert.equal(ev.level, lv);
    setDay(state, ev.deadlineDay);
    dailyTension(state);
    total += T.ignoreGrudge[lv - 1];
  }
  assert.equal(pendingTension(state).length, 0);
  assert.equal(tensionOf(state).stats.booms, 1);
  assert.ok(a.grudge > 0 && b.grudge > 0 && a.grudge <= total);
  assert.ok(getRel(state, a, b).hate >= T.ignoreHate);
  assert.ok(Object.keys(tensionOf(state).pairCool).length === 1);
});

test("調停：成功→怨氣仇恨下降事件結束；失敗→更糟且只能試一次", () => {
  const { state, a, b } = room(2);
  rel(state, a, b, { hate: 30 });
  a.grudge = b.grudge = 20;
  let ev = open(state, a, b);
  const g0 = a.grudge; // open() 內有跨日結算，怨氣已先消退 1
  const h0 = getRel(state, a, b).hate;
  CONFIG.tension.mediate.min = CONFIG.tension.mediate.max = 1;
  const ok = resolveTension(state, ev.id, "mediate");
  assert.equal(ok.success, true);
  assert.equal(a.grudge, g0 + CONFIG.tension.mediate.okGrudge);
  assert.equal(getRel(state, a, b).hate, h0 + CONFIG.tension.mediate.okHate);
  assert.equal(pendingTension(state).length, 0);

  const two = room(2, 4);
  ev = open(two.state, two.a, two.b);
  CONFIG.tension.mediate.min = CONFIG.tension.mediate.max = 0;
  const bad = resolveTension(two.state, ev.id, "mediate");
  assert.equal(bad.success, false);
  assert.equal(two.a.grudge, CONFIG.tension.mediate.failGrudge);
  assert.equal(pendingTension(two.state).length, 1);
  assert.equal(resolveTension(two.state, ev.id, "mediate").ok, false, "不能重複調停");
  assert.equal(tensionOptions(two.state, pendingTension(two.state)[0]).mediate.ok, false);
});

test("調停成功率：順從、隊長信任、理智高 → 更高", () => {
  const { state, a, b } = room(3);
  const ev = open(state, a, b);
  const base = tensionOptions(state, ev).mediate.chance;
  a.traits.obedience = b.traits.obedience = 80;
  assert.ok(tensionOptions(state, ev).mediate.chance > base);
  a.traits.obedience = b.traits.obedience = -80;
  assert.ok(tensionOptions(state, ev).mediate.chance < base);
  a.traits.obedience = b.traits.obedience = 0;
  a.stats.sanity = b.stats.sanity = 20;
  assert.ok(tensionOptions(state, ev).mediate.chance < base);
});

test("補償：花公庫、受補償者怨氣降、另一方怨氣與仇恨升；價格近期遞增；沒錢不行", () => {
  const { state, a, b } = room(2);
  a.grudge = b.grudge = 40;
  const ev = open(state, a, b);
  const cost1 = compensateCost(state, ev, a.id);
  const [gA, gB] = [a.grudge, b.grudge];
  const before = state.points;
  const r = resolveTension(state, ev.id, "compensate", { payeeId: a.id });
  assert.equal(r.ok, true);
  assert.equal(state.points, before - cost1);
  assert.equal(a.grudge, gA + CONFIG.tension.compensate.payeeGrudge);
  assert.equal(b.grudge, gB + CONFIG.tension.compensate.otherGrudge);
  assert.ok(getRel(state, b, a).hate >= CONFIG.tension.compensate.otherHate);
  assert.ok(getRel(state, a, b).love >= CONFIG.tension.compensate.payeeAffinity);
  // 近期同一人再補償：價格 × repeatMult
  tensionOf(state).pairCool = {};
  const ev2 = open(state, a, b);
  assert.equal(compensateCost(state, ev2, a.id), Math.round(compensateCost(state, ev2, b.id) * CONFIG.tension.compensate.repeatMult));
  state.points = debtLimitOf(state);
  assert.equal(resolveTension(state, ev2.id, "compensate", { payeeId: a.id }).ok, false);
  assert.equal(tensionOptions(state, ev2).compensate.ok, false);
});

test("拆開：指定一人放假、該對產生率下降；在副本裡的人不能被放假", () => {
  const { state, a, b } = room(2);
  const ev = open(state, a, b);
  b.location = "dungeon";
  assert.equal(resolveTension(state, ev.id, "separate", { restId: b.id }).ok, false);
  b.location = "space";
  const r = resolveTension(state, ev.id, "separate", { restId: b.id });
  assert.equal(r.ok, true);
  assert.equal(b.vacationDays, CONFIG.tension.apart.vacationDays);
  assert.ok(Math.abs(pairProfile(state, a, b).p - CONFIG.tension.baseChance * CONFIG.tension.apartMult) < 1e-12);
  assert.equal(pendingTension(state).length, 0);
});

test("隊長自動調停：只處理等級 1、隊長不在事件裡；寫日誌", () => {
  const { state, a, b, c } = room(3);
  state.spaceLevel = 2;
  appointCaptain(state, c.id);
  const ev = open(state, a, b);
  CONFIG.tension.baseChance = 0;
  CONFIG.tension.captainAuto.chance = 1;
  dailyTension(state);
  assert.ok(!pendingTension(state).some((x) => x.id === ev.id), "a、b 的等級 1 事件被隊長處理掉");
  assert.ok(tensionOf(state).stats.auto >= 1);
  assert.ok(state.log.some((l) => l.type === "tension" && l.text.includes(c.name)));
  // 等級 2 不處理
  const two = room(3, 8);
  two.state.spaceLevel = 2;
  appointCaptain(two.state, two.c.id);
  const e2 = open(two.state, two.a, two.b);
  e2.level = 2;
  CONFIG.tension.baseChance = 0;
  dailyTension(two.state);
  assert.ok(pendingTension(two.state).some((x) => x.id === e2.id), "等級 2 隊長不處理");
});

test("怨氣自然消退", () => {
  const { state, a } = room(2);
  CONFIG.tension.baseChance = 0;
  a.grudge = 10;
  dailyTension(state);
  assert.equal(a.grudge, 10 - CONFIG.tension.grudgeDecay);
});

/** 只留一種後果、必定觸發 */
function crisisOnly(kind) {
  CONFIG.tension.baseChance = 0;
  CONFIG.tension.crisisChance = 1;
  for (const k of Object.keys(CONFIG.tension.outcomes)) CONFIG.tension.outcomes[k] = k === kind ? 1 : 0;
}

test("後果：叛逃——離開名冊成為野生 Boss；隊長免疫；綁定裝備不免疫", () => {
  const { state, a, b } = room(3);
  crisisOnly("defect");
  a.grudge = 80;
  a.soulbound = { weapon: true }; // 4-E 的叛逃免疫在這裡不適用
  dailyTension(state);
  assert.ok(!state.samsarites.includes(a));
  assert.equal(state.rogueBosses.length, 1);
  assert.equal(tensionOf(state).stats.outcomes.defect, 1);

  const two = room(3, 9);
  two.state.spaceLevel = 2;
  appointCaptain(two.state, two.a.id);
  crisisOnly("defect");
  two.a.grudge = 90;
  CONFIG.tension.outcomes.defy = 1; // 隊長不能叛逃，只剩抗命可抽
  dailyTension(two.state);
  assert.ok(two.state.samsarites.includes(two.a));
  assert.equal(two.state.rogueBosses.length, 0);
});

test("後果：互殺——仇恨最高者被攻擊，動手的人被主神懲罰；沒有夠恨的對象就不會抽到", () => {
  const { state, a, b } = room(3);
  crisisOnly("kill");
  CONFIG.tension.outcomes.defy = 0;
  a.grudge = 80;
  rel(state, a, b, { hate: 95 });
  a.stats.power = 100000; // 讓 b 必死
  dailyTension(state);
  assert.ok(!state.samsarites.includes(b) || b.injury > 0);
  assert.ok(state.log.some((l) => l.text.includes("主神") || l.type === "relation"));
  assert.equal(tensionOf(state).stats.outcomes.kill, 1);
  const lone = room(3, 11);
  crisisOnly("kill");
  CONFIG.tension.outcomes.defy = 1; // 沒有夠恨的對象，只剩抗命
  lone.a.grudge = 80;
  dailyTension(lone.state);
  assert.equal(tensionOf(lone.state).stats.outcomes.kill, 0);
  assert.equal(tensionOf(lone.state).stats.outcomes.defy, 1);
});

test("後果：政變——需要隊長與至少兩名怨氣夠高又不喜歡隊長的人", () => {
  const { state, a, b, c, d } = room(4);
  state.spaceLevel = 2;
  appointCaptain(state, d.id);
  crisisOnly("coup");
  CONFIG.tension.outcomes.defy = 0;
  a.grudge = b.grudge = 80;
  rel(state, a, d, { hate: 50 });
  rel(state, b, d, { hate: 50 });
  dailyTension(state);
  assert.equal(tensionOf(state).stats.outcomes.coup, 1);
  assert.ok(state.log.some((l) => l.type === "drama" && l.text.includes(d.name)));
  // 只有一個人不夠
  const solo = room(4, 12);
  solo.state.spaceLevel = 2;
  appointCaptain(solo.state, solo.d.id);
  crisisOnly("coup");
  CONFIG.tension.outcomes.defy = 1;
  solo.a.grudge = 80;
  rel(solo.state, solo.a, solo.d, { hate: 50 });
  dailyTension(solo.state);
  assert.equal(tensionOf(solo.state).stats.outcomes.coup, 0);
});

test("後果：抗命——套用「不爽」心情；後果之後怨氣回落到門檻以下", () => {
  const { state, a } = room(2);
  crisisOnly("defy");
  a.grudge = 95;
  dailyTension(state);
  assert.equal(a.mood?.kind, "upset");
  assert.equal(a.grudge, CONFIG.tension.afterOutcome - CONFIG.tension.grudgeDecay === a.grudge ? a.grudge : Math.min(95, CONFIG.tension.afterOutcome));
  assert.ok(a.grudge <= CONFIG.tension.afterOutcome);
});

test("警報：怨氣跨過警戒線提醒一次，降到重新武裝線以下才會再提醒", () => {
  const { state, a } = room(2);
  const count = () => state.log.filter((l) => l.type === "grudge").length;
  a.grudge = CONFIG.tension.warnAt;
  checkAlerts(state);
  checkAlerts(state);
  assert.equal(count(), 1);
  a.grudge = CONFIG.tension.rearmAt + 5; // 還沒降到重新武裝線
  checkAlerts(state);
  a.grudge = CONFIG.tension.warnAt + 5;
  checkAlerts(state);
  assert.equal(count(), 1);
  a.grudge = 0;
  checkAlerts(state);
  a.grudge = CONFIG.tension.warnAt;
  checkAlerts(state);
  assert.equal(count(), 2);
});

test("私奔候選：怨氣爆表也算", () => {
  const { state, a, c } = room(3);
  state.spaceLevel = 2;
  appointCaptain(state, c.id);
  rel(state, a, c, { love: 30 });
  a.stats.sanity = 100;
  assert.equal(elopeCandidate(state, a, c), false);
  a.grudge = CONFIG.tension.elopeGrudge;
  assert.equal(elopeCandidate(state, a, c), true);
});

test("空間氣氛：依最高怨氣分三級，等級改變才寫一行日誌", () => {
  const { state, a } = room(2);
  CONFIG.tension.baseChance = 0;
  assert.equal(climateIndex(state), 0);
  a.grudge = CONFIG.tension.climate[0] + 10; // 比門檻高一些，避免每日消退 1 點就掉回平靜
  dailyTension(state);
  assert.equal(tensionOf(state).climate, "brewing");
  const n = state.log.filter((l) => l.type === "tension").length;
  dailyTension(state);
  assert.equal(state.log.filter((l) => l.type === "tension").length, n, "沒變不重寫");
  a.grudge = CONFIG.tension.climate[1] + 5;
  dailyTension(state);
  assert.equal(tensionOf(state).climate, "volatile");
});

test("當事人死亡／離開：待辦事件自動清掉", () => {
  const { state, a, b, c } = room(3);
  const ev = open(state, a, b);
  state.samsarites = state.samsarites.filter((s) => s.id !== a.id);
  CONFIG.tension.baseChance = 0;
  dailyTension(state);
  assert.ok(!pendingTension(state).some((x) => x.id === ev.id));
  assert.ok(c);
});

test("獨立亂數流：張力只動 state.tension.rngState，不動主亂數；關閉時完全不動", () => {
  const { state } = room(6);
  const main = state.rngState;
  const mine = state.tension.rngState;
  dailyTension(state);
  assert.equal(state.rngState, main);
  assert.notEqual(state.tension.rngState, mine);
  const off = room(6);
  CONFIG.tension.enabled = false;
  const m2 = off.state.tension.rngState;
  dailyTension(off.state);
  assert.equal(off.state.tension.rngState, m2);
  assert.equal(off.state.tension.pending.length, 0);
});

test("存檔往返：待辦事件、冷卻、怨氣都保留", () => {
  const { state, a, b } = room(2);
  open(state, a, b);
  a.grudge = 42;
  const back = deserialize(serialize(state));
  assert.equal(back.tension.pending.length, 1);
  assert.equal(back.samsarites.find((s) => s.id === a.id).grudge, 42);
});

test("接上主迴圈：跨日時 advanceTick 會呼叫 dailyTension（待辦事件的期限會被處理）", () => {
  const { state, a, b } = room(2);
  const ev = open(state, a, b);
  CONFIG.tension.baseChance = 0;
  state.tick = (ev.deadlineDay - 1) * CONFIG.ticksPerDay - 1;
  advanceTick(state);
  assert.equal(currentDay(state), ev.deadlineDay);
  assert.equal(pendingTension(state)[0]?.level ?? 0, 2, "逾期升級");
});

test("遊戲結束後不再產生事件", () => {
  const { state } = room(4);
  state.gameOver = true;
  sure(state);
  dailyTension(state);
  assert.equal(tensionOf(state).pending.length, 0);
});
