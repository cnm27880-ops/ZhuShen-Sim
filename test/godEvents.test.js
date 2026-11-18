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

  state.points = CONFIG.space.debtLimit[0] + 10;
  forceEvent(state, "tax");
  acceptGodEvent(state);
  assert.equal(state.points, CONFIG.space.debtLimit[0]);
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

test("花積分化解：每種事件都不產生損失、只扣化解費、不計入商店階級", () => {
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
    assert.equal(state.totalSpent, spentBefore, "化解費不計入商店階級（#16）");
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
  state.points = CONFIG.space.debtLimit[0];
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
  state.autoStrategy = "off"; // 驗證任務優先邏輯，不套用策略規則
  state.points = 1000;
  state.samsarites = [];
  for (let i = 0; i < 4; i++) {
    const s = createSamsarite(state, "S");
    s.tags = [];
    s.stats.power = 42; // 4-E-8：R ×1.4，隊員戰力同比放大，維持原本的通關率
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
    // 關掉時走一般邏輯（不保證含目標，只要不報錯、仍有方案）；4-D-4：自動派遣只挑任務榜上的槽，先確保榜上有簡單的副本
    state.board.slots = [{ id: 900, dungeonId: "ghost_village", mutationId: "calm_wind", running: false, runId: null }];
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

// ───────── 第四批 7、8：天數章節 ─────────
import { dayChapterOf, godMultOf, targetDungeons } from "../src/engine/dayChapter.js";
import { resolveCostOf } from "../src/engine/godEvents.js";
import { maybeWish } from "../src/engine/wishes.js";
import { DUNGEONS } from "../src/data/dungeons.js";

const atDay = (state, day) => {
  state.tick = (day - 1) * CONFIG.ticksPerDay;
};

test("天數對應章節：Day <30 → 1、30~69 → 2、70~174 → 3、175~319 → 4、320 以上 → 5；倍率 ×1／3／10／30／100", () => {
  const got = [1, 29, 30, 69, 70, 174, 175, 319, 320, 999].map(dayChapterOf);
  assert.deepEqual(got, [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.deepEqual([1, 30, 70, 175, 320].map(godMultOf), [1, 3, 10, 30, 100]);
});

test("主神搞事積分跟著天數章節乘倍率：Day 150（第 3 章 ×10）化解費不再是 20 分，化解仍比不化解便宜", () => {
  for (const [day, mult] of [[1, 1], [40, 3], [150, 10], [250, 30], [400, 100]]) {
    for (const kind of ["tax", "shock", "checkup", "raid"]) {
      const { state } = setup(3);
      state.points = 1e9;
      atDay(state, day);
      state.samsarites.forEach((s) => (s.stats.power = 100000));
      const ev = forceEvent(state, kind);
      if (!ev) continue; // 突襲任務可能沒有可指定的副本
      assert.equal(ev.params.mult, mult, `${kind} Day ${day}`);
      const cost = resolveCostOf(state, ev);
      assert.equal(cost, K()[kind].resolveCost * mult);
      if (kind === "tax") {
        // A-3 階段 4：損失 = max(固定小額×倍率, 公庫×lossPct)；公庫 10 億時比例項主導
        assert.ok(ev.params.loss >= K().tax.loss[0] * mult, "不低於固定小額下限");
        assert.ok(ev.params.loss >= Math.round(state.points * K().tax.lossPct), "不低於公庫比例下限");
        assert.ok(cost < ev.params.loss, "化解費要比損失便宜");
      }
      if (kind === "raid") assert.ok(ev.params.reward >= K().raid.rewardPoints[0] * mult);
      const before = state.points;
      assert.equal(resolveGodEvent(state).ok, true);
      assert.equal(before - state.points, cost, "實際扣的就是倍率後的化解費");
    }
  }
  const { state } = setup(2);
  atDay(state, 150);
  assert.equal(resolveCostOf(state, { kind: "checkup", params: {} }, "checkup"), 200);
});

test("突襲任務抗命罰金與任務獎勵也乘倍率，罰金鎖進任務", () => {
  const { state, a } = setup(3);
  state.points = 1e9;
  atDay(state, 150);
  state.samsarites.forEach((s) => (s.stats.power = 100000));
  const ev = forceEvent(state, "raid");
  assert.ok(ev);
  acceptGodEvent(state);
  const m = activeMission(state);
  assert.equal(m.penalty, K().raid.penaltyPoints * 10);
  assert.ok(m.reward >= K().raid.rewardPoints[0] * 10);
});

test("許願「想去副本」與突襲任務選副本跟著天數與戰力走：Day 150、隊伍夠強時不再出第一章副本", () => {
  const { state } = setup(4);
  atDay(state, 150);
  state.spaceLevel = 3; // 空間 Lv.3 = 前兩章尾王都打過，第 3 章解鎖（沒解鎖的副本不會被許願指定）
  state.samsarites.forEach((s) => (s.stats.power = 4000));
  const opts = targetDungeons(state, CONFIG.wish.dungeonPowerCap);
  assert.ok(opts.length > 0);
  assert.ok(opts.every((d) => d.chapter === 3), `章節 ${[...new Set(opts.map((d) => d.chapter))]}`);
  // 該章沒有打得動的就逐章往下
  state.samsarites.forEach((s) => (s.stats.power = 60));
  const lower = targetDungeons(state, CONFIG.wish.dungeonPowerCap);
  assert.ok(lower.every((d) => d.chapter < 3));
  // 全都打不動才退回固定上限（第一章）
  state.samsarites.forEach((s) => (s.stats.power = 1));
  assert.ok(targetDungeons(state, CONFIG.wish.dungeonPowerCap).every((d) => d.recommendedPower <= CONFIG.wish.dungeonPowerCap));
  // 已通關的最高章節比天數章節高時以它為準（Day 5 但已通關第 3 章）
  const st2 = setup(4).state;
  atDay(st2, 5);
  st2.spaceLevel = 3;
  st2.samsarites.forEach((s) => (s.stats.power = 5000));
  st2.dungeonStats.ch3_01 = { clears: 1 };
  assert.ok(targetDungeons(st2, 150).every((d) => d.chapter === 3));
  // 實際許願：多次許願都不是第一章
  const st3 = setup(4).state;
  atDay(st3, 150);
  st3.spaceLevel = 3;
  st3.samsarites.forEach((s) => (s.stats.power = 4000));
  const saved = JSON.stringify(CONFIG.wish);
  CONFIG.wish.chance = 1;
  for (const k of Object.keys(CONFIG.wish.kinds)) CONFIG.wish.kinds[k].weight = k === "dungeon" ? 1 : 0;
  try {
    for (let i = 0; i < 20; i++) {
      st3.wishes = [];
      maybeWish(st3, st3.samsarites[0]);
      const w = st3.wishes.find((x) => x.mode === "dungeon");
      if (w) assert.ok(DUNGEONS.find((d) => d.id === w.params.dungeonId).chapter >= 2, w.params.dungeonId);
    }
  } finally {
    Object.assign(CONFIG.wish, JSON.parse(saved));
    for (const k of Object.keys(CONFIG.wish.kinds)) Object.assign(CONFIG.wish.kinds[k], JSON.parse(saved).kinds[k]);
  }
});
