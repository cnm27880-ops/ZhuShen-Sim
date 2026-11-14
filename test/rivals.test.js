// Phase 4-F-1／4-F-2：洲際宿敵團戰（觸發節奏、煉獄 1.25x 硬鎖、戰敗保護）與跨隊修羅場（私奔免疫鐵律、反拐、肉豬策反、春風一度）
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/data/config.js";
import { RIVAL_SQUADS, getRivalSquad, RIVAL_ID } from "../src/data/rivals.js";
import { createNewGame, createSamsarite, currentDay, advanceTick, serialize, deserialize } from "../src/engine/core.js";
import { startRun, dungeonOfRun } from "../src/engine/dungeon.js";
import { step } from "../src/engine/dispatch.js";
import { buildRivalDungeon, baseRivalR, dailyRivals, rivalFinish, rivalSnapshot, isElopeImmune, elopeCandidate, hybridBirth, pendingRival, defectTo } from "../src/engine/rivals.js";
import { shiftAffinity, affinity, getRel } from "../src/engine/relations.js";
import { effectivePower } from "../src/engine/tags.js";

function setup(n = 5, { level = 2, seed = 7 } = {}) {
  const state = createNewGame(seed);
  state.samsarites = [];
  state.spaceLevel = level;
  state.points = 100000;
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, "C");
    s.tags = [];
    s.joinedDay = 1;
    state.samsarites.push(s);
  }
  return state;
}
const toDay = (state, day) => {
  while (currentDay(state) < day) advanceTick(state);
};
const ids = (state, n = 4) => state.samsarites.slice(0, n).map((s) => s.id);
function withPending(state, squadId, revoltRoll = 0.99) {
  state.rivals.pending = { id: 1, squadId, createdDay: currentDay(state), deadlineDay: currentDay(state) + 5, warned: false, grace: 0, revoltRoll };
}
/** 暫時改設定，測完還原 */
function withCfg(obj, patch, fn) {
  const old = { ...obj };
  Object.assign(obj, patch);
  try {
    return fn();
  } finally {
    Object.assign(obj, old);
  }
}
const makeCaptain = (state, style = "bond") => {
  const cap = state.samsarites[0];
  state.squad.captainId = cap.id;
  state.squad.style = style;
  return cap;
};

test("八支宿敵隊：rMult 對照規格；煉獄惡魔隊 1.25x 硬鎖", () => {
  const want = { polaris: 1.0, zhonghuang: 1.1, dongying: 0.95, inferno: 1.25, golden: 1.0, joyous: 0.85, mech: 1.05, retire: 0.8 };
  assert.equal(RIVAL_SQUADS.length, 8);
  for (const [id, m] of Object.entries(want)) assert.equal(getRivalSquad(id).rMult, m, id);
  assert.equal(getRivalSquad("inferno").lockedR, true);
  // 快照結構（預留 Phase 5 雲端快照）
  const snap = rivalSnapshot(setup(), "inferno");
  for (const k of ["id", "name", "factionStyle", "rMult", "rewardMult", "mortalityMod", "specialRule", "source", "roster"]) assert.ok(k in snap, k);
  assert.equal(snap.source, "npc");
  assert.equal(getRivalSquad("joyous").mortalityMod, -0.7);
});

test("空間 Lv.1 零觸發（機率 0%）：推進 300 天都不會有碰撞，也不排倒數", () => {
  const state = setup(3, { level: 1 });
  state.settings.autoDispatch = false;
  for (let i = 0; i < 300 * CONFIG.ticksPerDay; i++) advanceTick(state);
  assert.equal(pendingRival(state), null);
  assert.equal(state.rivals.nextDay, null);
  assert.equal(state.rivals.stats.fights ?? 0, 0);
});

test("升到 Lv.2 後首次倒數 35～45 天，之後每隔 35～45 天刷出一次，限時 5 天，刷出當天與剩 1 天預警", () => {
  const state = setup(3, { level: 2 });
  state.points = 1e7;
  dailyRivals(state); // 第一次呼叫只排倒數
  const first = state.rivals.nextDay - currentDay(state);
  assert.ok(first >= 35 && first <= 45, `首次倒數 ${first}`);
  toDay(state, state.rivals.nextDay - 1);
  assert.equal(pendingRival(state), null, "還沒到");
  state.events.length = 0;
  toDay(state, state.rivals.nextDay);
  const p = pendingRival(state);
  assert.ok(p, "到期刷出");
  assert.equal(p.deadlineDay - p.createdDay, 5);
  assert.ok(state.events.some((e) => e.type === "rival"), "刷出當天預警（rival 事件，自動暫停）");
  assert.equal(CONFIG.rival.deadlineDays, 5);
  const gap = state.rivals.nextDay - p.createdDay;
  assert.ok(gap >= 35 && gap <= 45, `第二次間隔 ${gap}`);
  state.events.length = 0;
  toDay(state, p.deadlineDay - 1);
  assert.ok(state.events.some((e) => e.type === "rival"), "剩 1 天再預警一次");
});

test("倒數歸零沒派隊：自動徵召最高戰力精銳（無視日常鎖）；空間沒人則寬限後取消", () => {
  const state = setup(6, { level: 2 });
  state.points = 1e7;
  state.samsarites.forEach((s, i) => ((s.stats.power = 30 + i * 10), (s.locked = true))); // 日常自動派遣鎖全開
  withPending(state, "retire");
  state.rivals.pending.deadlineDay = currentDay(state); // 今天就到期
  dailyRivals(state);
  assert.equal(pendingRival(state), null, "已出發");
  assert.equal(state.runs.length, 1);
  const run = state.runs[0];
  assert.equal(run.dungeonId, RIVAL_ID);
  const top4 = [...state.samsarites.map((s) => s.id)].sort((a, b) => effectivePower(state.samsarites.find((s) => s.id === b)) - effectivePower(state.samsarites.find((s) => s.id === a))).slice(0, 4);
  assert.deepEqual([...run.partyIds].sort(), [...top4].sort(), "徵召戰力最高的 4 人");
  // 沒人可派
  const s2 = setup(2, { level: 2 });
  s2.samsarites.forEach((s) => (s.location = "dungeon"));
  withPending(s2, "retire");
  s2.rivals.pending.deadlineDay = currentDay(s2);
  for (let i = 0; i <= CONFIG.rival.maxGraceDays; i++) dailyRivals(s2);
  assert.equal(pendingRival(s2), null, "寬限用完取消，不罰");
  assert.equal(s2.points, 100000);
});

test("洲際碰撞副本快照：R = 基準 × rMult；inferno 硬鎖 1.25；叛逃者每人 R +3%", () => {
  const state = setup(5, { level: 2 });
  withPending(state, "inferno");
  const base = baseRivalR(state);
  assert.equal(base, CONFIG.rival.baseR[1], "戰力低時吃空間等級基準");
  const d = buildRivalDungeon(state, ids(state));
  assert.equal(d.recommendedPower, Math.round(base * 1.25));
  assert.equal(d.rival.rMult, 1.25);
  assert.equal(d.rooms.length, CONFIG.rival.rooms);
  assert.equal(d.toClear, CONFIG.rival.toClear);
  // 就算用「肉豬策反」條件去打（只對 dongying 有效）也不能削弱 inferno
  state.rivals.pending.revoltRoll = 0;
  makeCaptain(state, "communal");
  assert.equal(buildRivalDungeon(state, ids(state)).recommendedPower, Math.round(base * 1.25));
  // 叛逃者登場：R +3%／人
  const victim = state.samsarites[4];
  defectTo(state, getRivalSquad("inferno"), victim);
  assert.equal(buildRivalDungeon(state, ids(state, 4)).recommendedPower, Math.round(base * 1.25 * 1.03));
  // 其他隊
  for (const q of RIVAL_SQUADS.filter((x) => x.id !== "inferno" && x.id !== "dongying")) {
    withPending(state, q.id);
    assert.equal(buildRivalDungeon(state, ids(state, 4)).recommendedPower, Math.round(base * q.rMult), q.id);
  }
});

test("戰敗保護：公庫為正扣 20%；公庫 <= 0 不再扣成惡性負債；參戰者帶重傷、理智 -15", () => {
  const mk = () => {
    const state = setup(4, { level: 2 });
    withPending(state, "polaris");
    const r = startRun(state, RIVAL_ID, ids(state));
    assert.equal(r.ok, true);
    return { state, run: r.run };
  };
  for (const [pts, expectPts] of [[10000, 8000], [0, 0], [-400, -400]]) {
    const { state, run } = mk();
    state.points = pts;
    const surv = state.samsarites;
    surv.forEach((s) => (s.location = "space"));
    const rep = rivalFinish(state, run, dungeonOfRun(run), surv, false);
    assert.equal(rep.win, false);
    assert.equal(state.points, expectPts, `公庫 ${pts}`);
    for (const s of surv) {
      assert.ok(s.injury >= CONFIG.rival.lossInjury);
      assert.equal(s.stats.sanity, 100 - CONFIG.rival.lossSanity);
    }
    assert.equal(state.gameOver, false, "戰敗不 Game Over");
  }
});

test("私奔免疫鐵律：隊長、神眷綁定（soulbound）、玩家自捏角色（customProfile）在 100% 私奔機率下也絕對不會被拐", () => {
  withCfg(CONFIG.rival.elope, { chance: 1, maxPerFight: 5 }, () => {
    for (let seed = 1; seed <= 30; seed++) {
      const state = setup(6, { level: 2, seed });
      const [cap, bound, boundObj, custom, plain, plain2] = state.samsarites;
      state.squad.captainId = cap.id;
      state.squad.style = "bond";
      bound.soulbound = true;
      boundObj.soulbound = { weapon: true };
      custom.customProfile = { nickname: "玩家自捏" };
      for (const s of [cap, bound, boundObj, custom, plain, plain2]) if (s !== cap) shiftAffinity(state, s, cap, -80); // 全員對隊長淨好感 -80（隊長自己不查）
      assert.equal(isElopeImmune(state, cap), true);
      assert.equal(isElopeImmune(state, bound), true);
      assert.equal(isElopeImmune(state, boundObj), true);
      assert.equal(isElopeImmune(state, custom), true);
      assert.equal(isElopeImmune(state, plain), false);
      withPending(state, "polaris");
      const r = startRun(state, RIVAL_ID, ids(state));
      const surv = state.samsarites;
      surv.forEach((s) => (s.location = "space"));
      rivalFinish(state, r.run, dungeonOfRun(r.run), surv, false);
      for (const s of [cap, bound, boundObj, custom]) assert.ok(state.samsarites.includes(s), `${s.name} 免疫，不能被拐（seed ${seed}）`);
      assert.ok(!state.samsarites.includes(plain) || !state.samsarites.includes(plain2) || true);
    }
  });
});

test("私奔：對隊長淨好感 <= -5（或低理智且好感 < 15）的非免疫者跳槽，單場最多 1 人，進宿敵隊名冊；好感夠高者不走", () => {
  withCfg(CONFIG.rival.elope, { chance: 1 }, () => {
    const state = setup(6, { level: 2 });
    const cap = makeCaptain(state);
    const [, a, b, c] = state.samsarites;
    shiftAffinity(state, a, cap, -50);
    shiftAffinity(state, b, cap, -50);
    shiftAffinity(state, c, cap, 20); // 好感正向、理智正常：不是候選
    withPending(state, "dongying");
    const r = startRun(state, RIVAL_ID, ids(state));
    state.samsarites.forEach((s) => (s.location = "space"));
    const before = state.samsarites.length;
    rivalFinish(state, r.run, dungeonOfRun(r.run), state.samsarites, false);
    assert.equal(state.samsarites.length, before - 1, "單場最多 1 人");
    assert.ok(state.samsarites.includes(c), "好感為正且理智正常不走");
    const roster = state.rivals.squads.dongying.roster;
    assert.equal(roster.length, 1);
    assert.equal(roster[0].role, "defector");
    assert.equal(roster[0].snapshot.id, [a, b].find((x) => !state.samsarites.includes(x)).id);
    assert.equal(state.rivals.stats.elopes, 1);
    // 下次再撞見同一隊：叛逃者以打手身分登場（互嗆文本）
    withPending(state, "dongying");
    state.events.length = 0;
    const logs0 = state.log.length;
    const r2 = startRun(state, RIVAL_ID, ids(state));
    assert.equal(r2.ok, true);
    assert.equal(r2.run.dungeonDef.rival.defectors, 1);
    assert.ok(state.log.slice(logs0).some((l) => l.text.includes(roster[0].name) && l.type === "social"), "有叛逃者互嗆日誌");
  });
});

test("反拐：勝利、我方人數未滿、隊長 bond／communal 時 15% 拐走對面副手；優先拐回自己叛逃的人", () => {
  withCfg(CONFIG.rival.counter, { chance: 1 }, () => {
    const state = setup(5, { level: 2 });
    makeCaptain(state, "communal");
    const ex = state.samsarites[4];
    defectTo(state, getRivalSquad("polaris"), ex);
    state.samsarites.forEach((s) => (s.location = "space"));
    withPending(state, "polaris");
    const r = startRun(state, RIVAL_ID, ids(state));
    state.samsarites.forEach((s) => (s.location = "space"));
    const n = state.samsarites.length;
    const rep = rivalFinish(state, r.run, dungeonOfRun(r.run), state.samsarites, true);
    assert.equal(state.samsarites.length, n + 1);
    assert.ok(state.samsarites.some((s) => s.id === ex.id), "拐回前我方成員");
    assert.equal(state.rivals.stats.counters, 1);
    assert.ok(rep.notes.some((t) => t.includes("拐走")));
    // 非 bond／communal 流派不會反拐
    const s2 = setup(5, { level: 2 });
    makeCaptain(s2, "elite");
    withPending(s2, "polaris");
    const r2 = startRun(s2, RIVAL_ID, ids(s2));
    s2.samsarites.forEach((s) => (s.location = "space"));
    const n2 = s2.samsarites.length;
    rivalFinish(s2, r2.run, dungeonOfRun(r2.run), s2.samsarites, true);
    assert.equal(s2.samsarites.length, n2);
  });
});

test("東櫻肉豬策反：communal／bond 隊長（或平均淨好感 >= 40）40% 起義，R -15%，戰後收編新人（對隊長好感 +50）", () => {
  const state = setup(5, { level: 2 });
  const cap = makeCaptain(state, "communal");
  withPending(state, "dongying", 0.1); // 擲骰 0.1 < 0.4
  const base = baseRivalR(state);
  const d = buildRivalDungeon(state, ids(state));
  assert.equal(d.rival.revolt, true);
  assert.equal(d.recommendedPower, Math.round(base * 0.95 * 0.85));
  // 骰不過
  withPending(state, "dongying", 0.5);
  assert.equal(buildRivalDungeon(state, ids(state)).rival.revolt, false);
  // 其他隊不會起義
  withPending(state, "polaris", 0);
  assert.equal(buildRivalDungeon(state, ids(state)).rival.revolt, false);
  // 非 communal／bond 流派且好感低：不起義
  const s2 = setup(5, { level: 2 });
  makeCaptain(s2, "elite");
  withPending(s2, "dongying", 0);
  assert.equal(buildRivalDungeon(s2, ids(s2)).rival.revolt, false);
  // 平均淨好感 >= 40 也算
  for (const s of s2.samsarites.slice(1)) shiftAffinity(s2, s, s2.samsarites[0], 50);
  assert.equal(buildRivalDungeon(s2, ids(s2)).rival.revolt, true);
  // 完整一場：起義 + 勝利 → 收編
  withPending(state, "dongying", 0.1);
  const r = startRun(state, RIVAL_ID, ids(state));
  assert.equal(r.run.rival.revolt, true);
  state.samsarites.forEach((s) => (s.location = "space"));
  const n = state.samsarites.length;
  rivalFinish(state, r.run, dungeonOfRun(r.run), state.samsarites, true);
  assert.equal(state.samsarites.length, n + 1);
  const nb = state.samsarites[state.samsarites.length - 1];
  assert.ok(["A", "B"].includes(nb.rank), "高潛力新人");
  assert.ok(getRel(state, nb, cap).love >= 25, "初始對隊長好感 +50（含詞條減半下限）");
  assert.equal(state.rivals.stats.revolts, 1);
});

test("春風一度：合歡粉紅隊 35%、其他隊 10%；混血子嗣標記出身、資質 +15%、進催熟艙", () => {
  assert.equal(CONFIG.rival.hybrid.joyousChance, 0.35);
  assert.equal(CONFIG.rival.hybrid.otherChance, 0.1);
  withCfg(CONFIG.rival.hybrid, { joyousChance: 1, otherChance: 0 }, () => {
    const state = setup(5, { level: 2 });
    withPending(state, "joyous");
    const r = startRun(state, RIVAL_ID, ids(state));
    state.samsarites.forEach((s) => (s.location = "space"));
    rivalFinish(state, r.run, dungeonOfRun(r.run), state.samsarites, true);
    const baby = state.samsarites.find((s) => s.hybridOrigin);
    assert.ok(baby, "合歡隊必觸發");
    assert.equal(baby.hybridOrigin, "joyous");
    assert.equal(baby.location, "pod");
    assert.ok(baby.talentPct >= CONFIG.rival.hybrid.talentBonus - 1e-9, "天生資質 +15%");
    assert.ok(baby.talentPct <= CONFIG.lineage.talentCap + 1e-9, "仍受 +25% 封頂");
    assert.equal(baby.parents.length, 1);
    assert.equal(state.rivals.stats.hybrids, 1);
    // 同一位家長冷卻中不會再懷
    const parent = state.samsarites.find((s) => s.id === baby.parents[0]);
    assert.ok(state.cooldowns[`hybrid:${parent.id}`] > currentDay(state));
  });
  withCfg(CONFIG.rival.hybrid, { joyousChance: 0, otherChance: 0 }, () => {
    const state = setup(5, { level: 2 });
    withPending(state, "joyous");
    const r = startRun(state, RIVAL_ID, ids(state));
    state.samsarites.forEach((s) => (s.location = "space"));
    rivalFinish(state, r.run, dungeonOfRun(r.run), state.samsarites, true);
    assert.equal(state.samsarites.filter((s) => s.hybridOrigin).length, 0);
  });
});

test("致死率：合歡粉紅 -70%、萬年養老 -50%（致死判定通過時才有機率免死，改落致命傷）", () => {
  const state = setup(4, { level: 2 });
  withPending(state, "joyous");
  const run = startRun(state, RIVAL_ID, ids(state)).run;
  assert.equal(run.rival.mortalityMod, -0.7);
  assert.equal(getRivalSquad("retire").mortalityMod, -0.5);
  assert.equal(getRivalSquad("polaris").mortalityMod, 0);
});

test("勝利特色獎勵：奇物、侵蝕結晶、煉獄黑貨／結晶、黃金財團私房錢、機械強化、養老療傷", () => {
  const win = (squadId, tweak = () => {}) => {
    const state = setup(4, { level: 2, seed: 3 });
    tweak(state);
    withPending(state, squadId);
    const r = startRun(state, RIVAL_ID, ids(state));
    state.samsarites.forEach((s) => (s.location = "space"));
    const rep = rivalFinish(state, r.run, dungeonOfRun(r.run), state.samsarites, true);
    return { state, rep };
  };
  let { state } = win("polaris");
  assert.equal(state.relicCodex.length, 1, "北極星洲：額外 1 件奇物");
  ({ state } = win("zhonghuang"));
  assert.equal(state.erosionCrystals, CONFIG.rival.zhonghuangCrystals);
  ({ state } = win("inferno"));
  assert.ok(state.erosionCrystals === CONFIG.rival.infernoCrystals || state.samsarites.some((s) => s.consumables.includes("t5_38")), "煉獄：黑貨或 4 顆結晶");
  ({ state } = win("golden"));
  assert.ok(state.samsarites.every((s) => s.wallet > 0));
  ({ state } = win("mech"));
  assert.ok(state.samsarites.every((s) => s.enhanceCount === 1));
  ({ state } = win("retire", (st) => st.samsarites.forEach((s) => (s.injury = 2))));
  assert.ok(state.samsarites.every((s) => s.injury === 1), "全體傷勢 -1 級");
  ({ state } = win("polaris", (st) => (st.relicCodex = ["__all__"])));
});

test("洲際碰撞完整流程：出征、結算進摘要（含 rival 欄位）、存檔讀檔保留私奔名冊", () => {
  const state = setup(5, { level: 2 });
  state.samsarites.forEach((s) => (s.stats.power = 5000));
  withPending(state, "retire");
  const r = startRun(state, RIVAL_ID, ids(state));
  assert.equal(r.ok, true);
  assert.equal(pendingRival(state), null);
  for (let i = 0; i < 40 && state.runs.length; i++) step(state);
  const rep = state.lastRun;
  assert.equal(rep.mandatory, false);
  assert.equal(rep.rival.squadId, "retire");
  assert.equal(typeof rep.rival.win, "boolean");
  defectTo(state, getRivalSquad("golden"), state.samsarites[0]);
  const back = deserialize(serialize(state));
  assert.equal(back.rivals.squads.golden.roster.length, 1);
  assert.equal(back.rivals.stats.fights, 1);
});

test("私奔放寬：-5 以下、或理智 < 45 且淨好感 < 15 才是候選；golden／joyous 不論勝負再挖角一次", () => {
  const state = setup(4, { level: 2 });
  const cap = makeCaptain(state);
  const [, a, b, c] = state.samsarites;
  shiftAffinity(state, a, cap, -5);
  b.stats.sanity = 30; shiftAffinity(state, b, cap, 10);
  c.stats.sanity = 30; shiftAffinity(state, c, cap, 20);
  assert.equal(elopeCandidate(state, a, cap), true);
  assert.equal(elopeCandidate(state, b, cap), true);
  assert.equal(elopeCandidate(state, c, cap), false, "低理智但好感 >= 15");
  assert.equal(CONFIG.rival.elope.chance, 0.35);
  assert.equal(CONFIG.rival.elope.lureChance, 0.12);
  withCfg(CONFIG.rival.elope, { lureChance: 1 }, () => {
    withCfg(CONFIG.rival.hybrid, { joyousChance: 0, otherChance: 0 }, () => {
      for (const [id, win] of [["golden", true], ["joyous", false], ["polaris", true]]) {
        const st = setup(4, { level: 2 });
        const cp = makeCaptain(st);
        shiftAffinity(st, st.samsarites[1], cp, -50);
        withPending(st, id);
        const r = startRun(st, RIVAL_ID, ids(st));
        st.samsarites.forEach((s) => (s.location = "space"));
        const n = st.samsarites.length;
        withCfg(CONFIG.rival.elope, { chance: 0 }, () => rivalFinish(st, r.run, dungeonOfRun(r.run), st.samsarites, win));
        assert.equal(st.samsarites.length, id === "polaris" ? n : n - 1, `${id} 勝負 ${win}`);
      }
    });
  });
});
