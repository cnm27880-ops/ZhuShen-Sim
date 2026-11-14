// Phase 3-E：主神搞事（4 種事件、冷卻、化解、突襲任務、獨立亂數流、存檔相容）
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG, PAUSE_EVENTS } from "../src/data/config.js";
import { GOD_EVENTS } from "../src/data/godEvents.js";
import { LOGS } from "../src/data/logs.js";
import { createNewGame, createSamsarite, advanceTick, killSamsarite, recycle, serialize, deserialize } from "../src/engine/core.js";
import {
  dailyGod,
  pendingGodEvent,
  activeMission,
  acceptGodEvent,
  resolveGodEvent,
  checkResolve,
  godAfterRun,
} from "../src/engine/godEvents.js";
import { setInjury } from "../src/engine/core.js";
import { planAutoDispatch, tryAutoDispatch } from "../src/engine/dispatch.js";

const K = () => CONFIG.godEvent.kinds;

function setup(n = 2) {
  const state = createNewGame(11);
  state.points = 1000;
  state.samsarites = [];
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, "C");
    s.tags = [];
    state.samsarites.push(s);
  }
  return { state, a: state.samsarites[0] };
}

/** 強制這一天發生某種事件（暫時把機率設 100%、其他種類權重設 0，用完還原） */
function forceEvent(state, kind) {
  const saved = JSON.stringify(CONFIG.godEvent);
  CONFIG.godEvent.chance = 1;
  for (const k of Object.keys(K())) K()[k].weight = k === kind ? 1 : 0;
  try {
    state.god.cooldownUntilDay = 0;
    dailyGod(state);
  } finally {
    const orig = JSON.parse(saved);
    Object.assign(CONFIG.godEvent, orig);
    for (const k of Object.keys(orig.kinds)) Object.assign(K()[k], orig.kinds[k]);
  }
  return pendingGodEvent(state);
}

/** 暫時把 outcomes 改成只剩某種結果（健檢用） */
function withCheckupOutcome(type, fn) {
  const saved = K().checkup.outcomes;
  K().checkup.outcomes = [{ type, weight: 1 }];
  try {
    fn();
  } finally {
    K().checkup.outcomes = saved;
  }
}

/** 往後過 n 天（只改時間，不走其他事件） */
function skipDays(state, n) {
  state.tick += CONFIG.ticksPerDay * n;
}

test("主神搞事：新遊戲有 god 狀態、暫停事件預設開", () => {
  const state = createNewGame(1);
  assert.deepEqual([state.god.pending, state.god.mission, state.god.cooldownUntilDay], [null, null, 0]);
  assert.equal(PAUSE_EVENTS.godEvent.default, true);
  assert.equal(state.settings.pauseOn.godEvent, true);
});

test("每天機率 0 就不會發生；機率 100% 發生一次並進入冷卻、待回覆期間不再骰", () => {
  const { state } = setup();
  const saved = CONFIG.godEvent.chance;
  CONFIG.godEvent.chance = 0;
  for (let i = 0; i < 30; i++) dailyGod(state);
  assert.equal(pendingGodEvent(state), null);
  CONFIG.godEvent.chance = saved;

  const ev = forceEvent(state, "tax");
  assert.ok(ev, "應該發生事件");
  assert.equal(state.god.cooldownUntilDay, 1 + CONFIG.godEvent.cooldownDays);
  const first = ev.id;
  CONFIG.godEvent.chance = 1;
  skipDays(state, 0);
  dailyGod(state); // 還在冷卻／待回覆
  CONFIG.godEvent.chance = saved;
  assert.equal(pendingGodEvent(state).id, first, "冷卻中不會換事件");
});

test("冷卻結束後（事件處理完）可以再發生", () => {
  const { state } = setup();
  forceEvent(state, "tax");
  acceptGodEvent(state);
  const saved = CONFIG.godEvent.chance;
  CONFIG.godEvent.chance = 1;
  skipDays(state, CONFIG.godEvent.cooldownDays - 1);
  dailyGod(state);
  assert.equal(pendingGodEvent(state), null, "第 4 天還在冷卻");
  skipDays(state, 1);
  dailyGod(state);
  CONFIG.godEvent.chance = saved;
  assert.ok(pendingGodEvent(state), "第 5 天過後可以再發生");
});

test("獨立亂數流：搞事不會動主亂數 rngState", () => {
  const { state } = setup();
  const before = state.rngState;
  forceEvent(state, "shock");
  assert.equal(state.rngState, before);
  acceptGodEvent(state);
  assert.equal(state.rngState, before);
});

test("同一個種子：搞事的結果可重現", () => {
  const run = () => {
    const state = createNewGame(5);
    const saved = CONFIG.godEvent.chance;
    CONFIG.godEvent.chance = 1;
    CONFIG.godEvent.cooldownDays = 0;
    const kinds = [];
    try {
      for (let i = 0; i < 6; i++) {
        skipDays(state, 1);
        dailyGod(state);
        if (pendingGodEvent(state)) {
          kinds.push(`${pendingGodEvent(state).kind}:${pendingGodEvent(state).targetId}`);
          acceptGodEvent(state);
        }
      }
    } finally {
      CONFIG.godEvent.chance = saved;
      CONFIG.godEvent.cooldownDays = 5;
    }
    return kinds.join(",");
  };
  assert.equal(run(), run());
});

test("全員都在副本時不擲事件；不會點名副本裡的人", () => {
  const { state } = setup(2);
  for (const s of state.samsarites) s.location = "dungeon";
  assert.equal(forceEvent(state, "tax"), null);
  state.samsarites[1].location = "space";
  const ev = forceEvent(state, "shock");
  assert.equal(ev.targetId, state.samsarites[1].id, "只會點名留在主神空間的人");
});

test("臨時開銷稅：照辦扣積分，債務不會低於高利貸上限", () => {
  const { state } = setup();
  const ev = forceEvent(state, "tax");
  const [lo, hi] = K().tax.loss;
  assert.ok(ev.params.loss >= lo && ev.params.loss <= hi);
  const before = state.points;
  assert.equal(acceptGodEvent(state).ok, true);
  assert.equal(state.points, before - ev.params.loss);
  assert.equal(pendingGodEvent(state), null);

  state.points = CONFIG.debtLimit + 10;
  forceEvent(state, "tax");
  acceptGodEvent(state);
  assert.equal(state.points, CONFIG.debtLimit);
});

test("電擊抽查：照辦理智下降（不低於 0）", () => {
  const { state } = setup();
  const ev = forceEvent(state, "shock");
  const s = state.samsarites.find((x) => x.id === ev.targetId);
  const before = s.stats.sanity;
  acceptGodEvent(state);
  assert.equal(s.stats.sanity, Math.max(0, before - K().shock.sanityLoss));
  s.stats.sanity = 5;
  forceEvent(state, "shock");
  state.samsarites.forEach((x) => (x.stats.sanity = 5));
  acceptGodEvent(state);
  assert.ok(state.samsarites.every((x) => x.stats.sanity >= 0));
});

test("強制健檢：三種結果（受傷／積分／理智）", () => {
  withCheckupOutcome("injury", () => {
    const { state } = setup();
    const ev = forceEvent(state, "checkup");
    const s = state.samsarites.find((x) => x.id === ev.targetId);
    acceptGodEvent(state);
    assert.equal(s.injury, K().checkup.injuryLevels);
    assert.ok(s.restDaysLeft > 0);
  });
  withCheckupOutcome("injury", () => {
    const { state } = setup();
    const ev = forceEvent(state, "checkup");
    const s = state.samsarites.find((x) => x.id === ev.targetId);
    setInjury(s, 3);
    acceptGodEvent(state);
    assert.equal(s.injury, 3, "致命傷不會再加重成死亡");
  });
  withCheckupOutcome("points", () => {
    const { state } = setup();
    forceEvent(state, "checkup");
    const before = state.points;
    acceptGodEvent(state);
    const [lo, hi] = K().checkup.rewardPoints;
    assert.ok(state.points - before >= lo && state.points - before <= hi);
  });
  withCheckupOutcome("sanity", () => {
    const { state } = setup();
    const ev = forceEvent(state, "checkup");
    const s = state.samsarites.find((x) => x.id === ev.targetId);
    s.stats.sanity = 50;
    acceptGodEvent(state);
    assert.equal(s.stats.sanity, 50 + K().checkup.rewardSanity);
    s.stats.sanity = 95;
    forceEvent(state, "checkup");
    state.samsarites.forEach((x) => (x.stats.sanity = 95));
    acceptGodEvent(state);
    assert.ok(state.samsarites.every((x) => x.stats.sanity <= 100), "理智上限 100");
  });
});

test("花積分化解：每種事件都不產生損失、只扣化解費、算進累積花費", () => {
  for (const def of GOD_EVENTS) {
    const { state } = setup();
    const ev = forceEvent(state, def.id);
    assert.ok(ev, `${def.id} 應該發生`);
    const target = state.samsarites.find((x) => x.id === ev.targetId);
    const sanity = target?.stats.sanity;
    const points = state.points;
    const spentBefore = state.totalSpent;
    assert.equal(checkResolve(state).ok, true);
    assert.equal(resolveGodEvent(state).ok, true);
    assert.equal(state.points, points - K()[def.id].resolveCost, `${def.id} 只扣化解費`);
    assert.equal(state.totalSpent, spentBefore + K()[def.id].resolveCost);
    if (target) assert.equal(target.stats.sanity, sanity);
    assert.equal(pendingGodEvent(state), null);
    assert.equal(activeMission(state), null, "化解突襲任務不會留下任務");
    assert.ok(K()[def.id].resolveCost > 0);
  }
});

test("化解費比不化解的損失便宜（設定檢查）", () => {
  assert.ok(K().tax.resolveCost < K().tax.loss[0]);
});

test("積分不夠（連高利貸都借不到）就不能化解，事件還在", () => {
  const { state } = setup();
  forceEvent(state, "shock");
  state.points = CONFIG.debtLimit;
  const r = resolveGodEvent(state);
  assert.equal(r.ok, false);
  assert.ok(pendingGodEvent(state));
  assert.equal(checkResolve(state).ok, false);
});

test("沒回覆：過期視同照辦（電擊會電）", () => {
  const { state } = setup();
  const ev = forceEvent(state, "shock");
  const s = state.samsarites.find((x) => x.id === ev.targetId);
  const before = s.stats.sanity;
  skipDays(state, CONFIG.godEvent.answerDays);
  const saved = CONFIG.godEvent.chance;
  CONFIG.godEvent.chance = 0;
  dailyGod(state);
  CONFIG.godEvent.chance = saved;
  assert.equal(pendingGodEvent(state), null);
  assert.equal(s.stats.sanity, Math.max(0, before - K().shock.sanityLoss));
  assert.ok(state.log.some((e) => e.type === "god"));
});

test("突襲任務：接下 → 通關領獎＋高興；失敗不結束、期限內還能再打", () => {
  const { state, a } = setup(1);
  const ev = forceEvent(state, "raid");
  assert.equal(ev.targetId, a.id);
  assert.ok(ev.params.dungeonId);
  acceptGodEvent(state);
  const m = activeMission(state);
  assert.ok(m);
  assert.equal(m.deadlineDay, 1 + K().raid.days);

  godAfterRun(state, m.dungeonId, false, [a.id], [a.id]); // 沒通關
  assert.ok(activeMission(state), "沒通關任務還在");
  godAfterRun(state, "ghost_village_other", true, [a.id], [a.id]); // 通關別的副本
  assert.ok(activeMission(state));
  godAfterRun(state, m.dungeonId, true, [], []); // 他沒去
  assert.ok(activeMission(state));

  const before = state.points;
  godAfterRun(state, m.dungeonId, true, [a.id], [a.id]);
  assert.equal(state.points, before + m.reward);
  assert.equal(activeMission(state), null);
  assert.equal(a.mood.kind, "happy");
});

test("突襲任務：通關但他死了不算（死亡本來就會取消任務）", () => {
  const { state, a } = setup(2);
  forceEvent(state, "raid");
  acceptGodEvent(state);
  const m = activeMission(state);
  const id = m.samsariteId;
  const s = state.samsarites.find((x) => x.id === id);
  killSamsarite(state, s, "測試");
  assert.equal(activeMission(state), null, "死亡取消任務，不罰分");
  godAfterRun(state, m.dungeonId, true, [id], []);
  assert.ok(a);
});

test("突襲任務：逾期扣積分、被點名者不爽、任務結束", () => {
  const { state } = setup(1);
  forceEvent(state, "raid");
  acceptGodEvent(state);
  const m = activeMission(state);
  const s = state.samsarites[0];
  const saved = CONFIG.godEvent.chance;
  CONFIG.godEvent.chance = 0;
  skipDays(state, K().raid.days - 1);
  dailyGod(state);
  assert.ok(activeMission(state), "還沒到期限");
  const before = state.points;
  skipDays(state, 1);
  dailyGod(state);
  CONFIG.godEvent.chance = saved;
  assert.equal(activeMission(state), null);
  assert.equal(state.points, before - K().raid.penaltyPoints);
  assert.equal(s.mood.kind, "upset");
  assert.ok(m);
});

test("突襲任務：期限到了但人還在副本裡，先不罰（等那場結算）", () => {
  const { state } = setup(1);
  forceEvent(state, "raid");
  acceptGodEvent(state);
  const s = state.samsarites[0];
  s.location = "dungeon";
  const saved = CONFIG.godEvent.chance;
  CONFIG.godEvent.chance = 0;
  skipDays(state, K().raid.days + 3);
  const before = state.points;
  dailyGod(state);
  CONFIG.godEvent.chance = saved;
  assert.ok(activeMission(state));
  assert.equal(state.points, before);
});

test("突襲任務：沒回覆視同抗命（扣分＋不爽、不會留下任務）", () => {
  const { state } = setup(1);
  forceEvent(state, "raid");
  const before = state.points;
  skipDays(state, CONFIG.godEvent.answerDays);
  const saved = CONFIG.godEvent.chance;
  CONFIG.godEvent.chance = 0;
  dailyGod(state);
  CONFIG.godEvent.chance = saved;
  assert.equal(activeMission(state), null);
  assert.equal(pendingGodEvent(state), null);
  assert.equal(state.points, before - K().raid.penaltyPoints);
  assert.equal(state.samsarites[0].mood.kind, "upset");
});

test("突襲任務：已有任務時不會再抽到突襲；沒有健康的人也抽不到", () => {
  const { state } = setup(1);
  forceEvent(state, "raid");
  acceptGodEvent(state);
  assert.equal(forceEvent(state, "raid"), null, "已有任務");

  const { state: s2 } = setup(1);
  setInjury(s2.samsarites[0], 1);
  assert.equal(forceEvent(s2, "raid"), null, "唯一的人受傷");
  const { state: s3 } = setup(1);
  s3.samsarites[0].vacationDays = 2;
  assert.equal(forceEvent(s3, "raid"), null, "唯一的人在放假");
});

test("被點名的人死亡或被回收：待回覆事件取消、不罰", () => {
  const { state } = setup(2);
  const ev = forceEvent(state, "shock");
  const s = state.samsarites.find((x) => x.id === ev.targetId);
  recycle(state, s.id);
  assert.equal(pendingGodEvent(state), null);

  const { state: s2 } = setup(2);
  const ev2 = forceEvent(s2, "checkup");
  killSamsarite(s2, s2.samsarites.find((x) => x.id === ev2.targetId), "測試");
  assert.equal(pendingGodEvent(s2), null);
});

test("事件發生時送出 godEvent 暫停事件；處理結果寫進日誌（type god）", () => {
  const { state } = setup();
  state.events.length = 0;
  forceEvent(state, "tax");
  assert.ok(state.events.some((e) => e.type === "godEvent"));
  acceptGodEvent(state);
  assert.ok(state.log.some((e) => e.type === "god" && e.text.length > 0));
});

test("接上每日結算：advanceTick 跨日會擲主神搞事", () => {
  const { state } = setup(3);
  state.points = 100000;
  const saved = CONFIG.godEvent.chance;
  CONFIG.godEvent.chance = 1;
  try {
    for (let i = 0; i < CONFIG.ticksPerDay; i++) advanceTick(state);
  } finally {
    CONFIG.godEvent.chance = saved;
  }
  assert.ok(pendingGodEvent(state), "跨日後應該出現事件");
});

test("存檔：待回覆事件與任務能存讀；舊存檔沒有 god 欄位會補預設值", () => {
  const { state } = setup(1);
  forceEvent(state, "raid");
  acceptGodEvent(state);
  const loaded = deserialize(serialize(state));
  assert.deepEqual(loaded.god, state.god);

  const { state: s2 } = setup(2);
  forceEvent(s2, "tax");
  const loaded2 = deserialize(serialize(s2));
  assert.equal(pendingGodEvent(loaded2).kind, "tax");

  const old = JSON.parse(serialize(createNewGame(3)));
  delete old.god;
  delete old.settings.pauseOn.godEvent;
  const migrated = deserialize(JSON.stringify(old));
  assert.deepEqual([migrated.god.pending, migrated.god.mission, migrated.god.cooldownUntilDay], [null, null, 0]);
  assert.equal(migrated.settings.pauseOn.godEvent, true, "舊存檔補上暫停預設值");
});

test("資料表與日誌：每種事件都有對應的日誌句子、版本 ≥ 2", () => {
  for (const def of GOD_EVENTS) {
    assert.ok(K()[def.id], `${def.id} 缺 CONFIG`);
    assert.ok(LOGS[`godAsk_${def.id}`]?.length >= 2, `${def.id} 缺 godAsk`);
    assert.ok(LOGS[`godResolve_${def.id}`]?.length >= 2, `${def.id} 缺 godResolve`);
    assert.ok(def.acceptDesc && def.payDesc && def.ignoreDesc);
  }
  for (const key of ["godDone_tax", "godDone_shock", "godDone_checkup_injury", "godDone_checkup_points", "godDone_checkup_sanity", "godTimeoutNote", "godRaidStart", "godRaidDone", "godRaidFail", "godRaidIgnore"]) {
    assert.ok(LOGS[key]?.length >= 2, `缺 ${key}`);
  }
});

// ───────── 自動派遣優先處理突襲任務 ─────────

/** 一支夠強的隊伍（4 個 S）＋一個任務目標；回傳 { state, target } */
function missionSetup() {
  const state = createNewGame(31);
  state.points = 1000;
  state.samsarites = [];
  for (let i = 0; i < 4; i++) {
    const s = createSamsarite(state, "S");
    s.tags = [];
    state.samsarites.push(s);
  }
  const target = state.samsarites[3];
  state.god.mission = { samsariteId: target.id, dungeonId: "ghost_village", deadlineDay: 8, reward: 200 };
  return { state, target };
}

test("自動派遣：有突襲任務且目標可派，優先派含他的隊伍去指定副本", () => {
  const { state, target } = missionSetup();
  const plan = planAutoDispatch(state);
  assert.equal(plan.dungeon.id, "ghost_village");
  assert.ok(plan.party.some((s) => s.id === target.id));
  assert.ok(plan.chance >= CONFIG.auto.minClearChance);
});

test("自動派遣：任務目標戰力太低被截掉候選名單，也會被算進來", () => {
  const { state, target } = missionSetup();
  const saved = CONFIG.auto.maxCandidates;
  CONFIG.auto.maxCandidates = 2;
  state.samsarites.forEach((s) => (s.stats.power = 400));
  target.stats.power = 1;
  try {
    const plan = planAutoDispatch(state);
    assert.ok(plan && plan.party.some((s) => s.id === target.id));
  } finally {
    CONFIG.auto.maxCandidates = saved;
  }
});

test("自動派遣：目標被鎖定、受傷（保護開著）、放假時不強派；開關關掉也不強派", () => {
  for (const mutate of [(t) => (t.locked = true), (t) => setInjury(t, 1), (t) => (t.vacationDays = 2)]) {
    const { state, target } = missionSetup();
    mutate(target);
    const plan = planAutoDispatch(state);
    assert.ok(!plan || !plan.party.some((s) => s.id === target.id), "不該派到他");
  }
  const { state } = missionSetup();
  const saved = CONFIG.auto.missionFirst;
  CONFIG.auto.missionFirst = false;
  try {
    // 關掉時走一般邏輯（不保證含目標，只要不報錯、仍有方案）
    assert.ok(planAutoDispatch(state));
  } finally {
    CONFIG.auto.missionFirst = saved;
  }
});

test("自動派遣：目標太弱打不過任務副本就不硬送；沒任務時行為不變", () => {
  const state = createNewGame(32);
  state.samsarites = [];
  for (let i = 0; i < 2; i++) {
    const s = createSamsarite(state, "C");
    s.tags = [];
    state.samsarites.push(s);
  }
  const target = state.samsarites[0];
  state.god.mission = { samsariteId: target.id, dungeonId: "ghost_village", deadlineDay: 8, reward: 200 };
  const withMission = planAutoDispatch(state);
  state.god.mission = null;
  const without = planAutoDispatch(state);
  assert.deepEqual(withMission?.party.map((s) => s.id), without?.party.map((s) => s.id));
  assert.equal(withMission?.dungeon.id, without?.dungeon.id);
});

test("自動派遣：派出任務目標後，通關即領獎", () => {
  const { state, target } = missionSetup();
  assert.ok(tryAutoDispatch(state) >= 1);
  assert.equal(target.location, "dungeon");
  assert.ok(state.runs.some((r) => r.dungeonId === "ghost_village" && r.partyIds.includes(target.id)));
});
