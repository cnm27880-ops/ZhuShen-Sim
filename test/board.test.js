// Phase 4-D-4：30 世界、3 槽動態任務榜、6 大突變詞綴、60 奇物圖鑑與貪婪探索
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/data/config.js";
import { DUNGEONS, getDungeon } from "../src/data/dungeons.js";
import { WORLD_LIST, migrateWorldId } from "../src/data/worlds.js";
import { MUTATIONS, getMutation } from "../src/data/mutations.js";
import { RELICS, firstRelicOf, hiddenRelicOf } from "../src/data/relics.js";
import { createNewGame, createSamsarite, advanceTick, serialize, deserialize } from "../src/engine/core.js";
import { boardOf, rotateBoard, boardTargets, fillBoard } from "../src/engine/board.js";
import { startRun, stepRun, dungeonOfRun, applyMutation, rewardMultiplier, roomCount } from "../src/engine/dungeon.js";
import { step } from "../src/engine/dispatch.js";
import { effectivePower } from "../src/engine/tags.js";
import { relicBonusOf, relicInfo, grantRelic } from "../src/engine/relics.js";
import { pickClash, getRel } from "../src/engine/relations.js";
import { getEnvTag } from "../src/data/tags.js";

function setup(n = 4, seed = 8, power = 99999) {
  const state = createNewGame(seed);
  state.samsarites = [];
  state.points = 1000000;
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, "C");
    s.tags = [];
    s.stats.power = power;
    state.samsarites.push(s);
  }
  return state;
}
const ids = (state) => state.samsarites.map((s) => s.id);
const finish = (state) => {
  let guard = 0;
  while (state.runs.length && guard++ < 200) step(state);
  return state.lastRun;
};
const setBoard = (state, ...pairs) => (boardOf(state).slots = pairs.map(([dungeonId, mutationId], i) => ({ id: 500 + i, dungeonId, mutationId, running: false, runId: null })));

test("30 世界：每章 5 常規 + 1 尾王，id 與清單一致，舊 id 對得上", () => {
  assert.equal(DUNGEONS.length, 30);
  assert.deepEqual(DUNGEONS.map((d) => d.id), WORLD_LIST.map((w) => w.id));
  for (let ch = 1; ch <= 5; ch++) {
    const list = DUNGEONS.filter((d) => d.chapter === ch);
    assert.equal(list.filter((d) => d.boss).length, 1);
    assert.equal(list.length, 6);
    assert.equal(list[5].boss, true);
  }
  assert.equal(migrateWorldId("ch3_4"), "ch3_boss");
  assert.equal(migrateWorldId("ch2_2"), "ch2_03");
  assert.equal(migrateWorldId("ghost_village"), "ghost_village");
  for (const old of ["ch1_4", "ch2_1", "ch2_2", "ch2_3", "ch5_4"]) assert.ok(getDungeon(migrateWorldId(old)), old);
});

test("6 大突變：權重總和 100、風平浪靜 35%，數值與規格一致", () => {
  assert.equal(MUTATIONS.length, 6);
  assert.equal(MUTATIONS.reduce((n, m) => n + m.weight, 0), 100);
  assert.equal(getMutation("calm_wind").weight, 35);
  assert.equal(getMutation("bridge_effect").loveMult, 1.5);
  assert.deepEqual([getMutation("blackout").failSanity, getMutation("blackout").rewardPct], [3, 0.15]);
  assert.deepEqual([getMutation("greed_loot").rewardPct, getMutation("greed_loot").clashMult], [0.25, 1.5]);
  assert.deepEqual([getMutation("blood_moon").rMult, getMutation("blood_moon").rewardPct], [1.15, 0.2]);
  assert.deepEqual([getMutation("thick_fog").speedSaveMod, getMutation("thick_fog").relicChanceMult], [-0.05, 2]);
});

test("任務榜：開局 3 槽、只有已解鎖章節的常規關、不重複、尾王不佔槽；獨立亂數流", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const state = createNewGame(seed);
    const slots = boardOf(state).slots;
    assert.equal(slots.length, 3);
    assert.equal(new Set(slots.map((s) => s.dungeonId)).size, 3);
    for (const s of slots) {
      const d = getDungeon(s.dungeonId);
      assert.ok(!d.boss && d.chapter === 1, s.dungeonId);
      assert.ok(getMutation(s.mutationId));
    }
  }
  const state = createNewGame(3);
  state.spaceLevel = 4;
  const main = state.rngState;
  for (let i = 0; i < 50; i++) {
    rotateBoard(state, { silent: true });
    for (const s of boardOf(state).slots) assert.ok(!getDungeon(s.dungeonId).boss && getDungeon(s.dungeonId).chapter <= 4);
  }
  assert.equal(state.rngState, main, "任務榜只用 market.rngState");
});

test("任務榜：章節權重偏向最高章；突變抽樣風平浪靜約 35%", () => {
  const state = createNewGame(5);
  state.spaceLevel = 3;
  const chapters = { 1: 0, 2: 0, 3: 0 };
  let calm = 0;
  const N = 1500;
  for (let i = 0; i < N; i++) {
    rotateBoard(state, { silent: true });
    for (const s of boardOf(state).slots) {
      chapters[getDungeon(s.dungeonId).chapter]++;
      if (s.mutationId === "calm_wind") calm++;
    }
  }
  const total = N * 3;
  assert.ok(chapters[3] / total > 0.45 && chapters[3] / total < 0.65, `第 3 章約 5/9（實際 ${(chapters[3] / total).toFixed(2)}）`);
  assert.ok(chapters[1] < chapters[2] && chapters[2] < chapters[3]);
  assert.ok(Math.abs(calm / total - 0.35) < 0.04, `風平浪靜約 35%（實際 ${(calm / total).toFixed(3)}）`);
});

test("任務榜：每 2 天輪換、派隊的槽不被輪換；結算後移除並立即補新槽", () => {
  const state = setup(2);
  const [a, b] = state.samsarites;
  setBoard(state, ["ghost_village", "calm_wind"], ["ch1_02", "calm_wind"], ["silent_ark", "calm_wind"]);
  boardOf(state).nextRotateDay = 3;
  const r = startRun(state, "ghost_village", [a.id], { slotId: 500 });
  assert.equal(r.ok, true);
  assert.equal(boardOf(state).slots[0].running, true);
  assert.equal(startRun(state, "ghost_village", [b.id], { slotId: 500 }).ok, false, "出發中的槽不能再接");
  assert.equal(startRun(state, "ch1_02", [b.id], { slotId: 500 }).ok, false, "槽與副本不符");
  for (let i = 0; i < CONFIG.ticksPerDay * 2; i++) advanceTick(state); // 跨到第 3 天 → 輪換
  const slots = boardOf(state).slots;
  assert.equal(slots.length, 3);
  assert.ok(slots.some((s) => s.id === 500), "派隊中的槽留著");
  assert.equal(boardOf(state).nextRotateDay, 5);
  const rep = finish(state);
  assert.ok(rep);
  assert.ok(!boardOf(state).slots.some((s) => s.id === 500), "結算後那一槽被移除");
  assert.equal(boardOf(state).slots.length, 3, "立即補新槽");
});

test("突變：血月狂躁 R ×1.15 + 積分 +20%；分贓誘惑 +25%；斷電 +15%；風平浪靜無修正", () => {
  const rewards = {};
  for (const mut of ["calm_wind", "blood_moon", "greed_loot", "blackout"]) {
    const state = setup(4, 12);
    setBoard(state, ["ghost_village", mut]);
    const party = state.samsarites;
    const r = startRun(state, "ghost_village", ids(state), { slotId: 500 });
    const run = r.run;
    const dungeon = getDungeon("ghost_village");
    assert.equal(dungeonOfRun(run).recommendedPower, mut === "blood_moon" ? Math.round(90 * 1.15) : 90);
    const env = getEnvTag(run.envId);
    const pct = getMutation(mut).rewardPct ?? 0;
    const expected = Math.round(dungeon.reward * rewardMultiplier(state, dungeon, party, env) * (1 + pct)) + Math.round(dungeon.reward * 0.5);
    const rep = finish(state);
    assert.equal(rep.success && rep.firstClear, true);
    assert.equal(rep.reward, expected, mut);
    assert.equal(rep.mutation.id, mut);
    rewards[mut] = rep.reward;
  }
  assert.ok(rewards.greed_loot > rewards.blood_moon && rewards.blood_moon > rewards.blackout && rewards.blackout > rewards.calm_wind);
});

test("突變：血月狂躁的 R 倍率只影響這一場，資料表不動", () => {
  const d = getDungeon("ch2_03");
  const eff = applyMutation(d, "blood_moon");
  assert.equal(eff.recommendedPower, Math.round(d.recommendedPower * 1.15));
  assert.equal(d.recommendedPower, 591);
  assert.equal(applyMutation(d, "calm_wind"), d);
  assert.equal(boardTargets(createNewGame(1)).length, 3);
});

test("突變：斷電黑夜——單房失敗受害者理智多扣 3（-5 變 -8）", () => {
  for (const [mut, loss] of [["calm_wind", 5], ["blackout", 8]]) {
    let seen = false;
    for (let seed = 1; seed <= 200 && !seen; seed++) {
      const state = setup(1, seed, 1);
      state.samsarites[0].stats.hp = 1000; // 傷勢不致命，只看理智
      setBoard(state, ["ch1_boss", mut]);
      state.board.slots[0].dungeonId = "ghost_village";
      const r = startRun(state, "ghost_village", ids(state), { slotId: 500 });
      const s = state.samsarites[0];
      s.stats.sanity = 100;
      stepRun(state, r.run);
      if (r.run.results[0] === false) {
        seen = true;
        assert.equal(s.stats.sanity, 100 - loss, mut);
      }
    }
    assert.ok(seen, `${mut} 要能遇到失敗的房間`);
  }
});

test("突變：吊橋效應——通關後存活隊員同行好感 ×1.5（2 → 3）；其他詞綴維持 2", () => {
  for (const [mut, want] of [["calm_wind", 2], ["bridge_effect", 3]]) {
    const state = setup(2, 21);
    setBoard(state, ["ghost_village", mut]);
    const [a, b] = state.samsarites;
    startRun(state, "ghost_village", ids(state), { slotId: 500 });
    const rep = finish(state);
    assert.equal(rep.success, true);
    assert.equal(getRel(state, a, b).love, want, mut);
    assert.equal(getRel(state, b, a).love, want, mut);
  }
});

test("突變：分贓誘惑——內鬥機率 ×1.5（30% → 45%）", () => {
  const rate = (mult) => {
    const state = setup(2, 31);
    const [a, b] = state.samsarites;
    state.relations[`${a.id}>${b.id}`] = { love: 0, hate: 85 }; // 仇恨
    let hit = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) if (pickClash(state, [a, b], 1, mult)) hit++;
    return hit / N;
  };
  assert.ok(Math.abs(rate(1) - 0.3) < 0.03);
  assert.ok(Math.abs(rate(1.5) - 0.45) < 0.03);
});

test("奇物資料：60 件、每張副本 2 件（首通 + 隱藏）、原始加成 30%", () => {
  assert.equal(RELICS.length, 60);
  assert.equal(new Set(RELICS.map((r) => r.id)).size, 60);
  for (const w of WORLD_LIST) {
    assert.equal(RELICS.filter((r) => r.worldId === w.id).length, 2, w.id);
    assert.ok(firstRelicOf(w.id) && hiddenRelicOf(w.id));
  }
  const raw = RELICS.reduce((n, r) => n + r.powerPct, 0);
  assert.ok(Math.abs(raw - 0.3) < 1e-6, `原始總和 ${raw}`);
  for (const r of RELICS) assert.ok(r.name.length >= 2 && r.name.length <= 7, r.id);
});

test("奇物：首通必得一次；全部收集的加成硬封頂 +25%；新人入隊也帶加成", () => {
  const state = setup(4, 14);
  setBoard(state, ["ghost_village", "calm_wind"]);
  startRun(state, "ghost_village", ids(state), { slotId: 500 });
  const rep = finish(state);
  assert.equal(rep.firstClear, true);
  assert.deepEqual(rep.relics.map((r) => [r.kind, r.dup]), [["first", false]]);
  assert.deepEqual(state.relicCodex, ["relic_ghost_village_first"]);
  assert.ok(relicBonusOf(state) > 0);
  assert.ok(state.samsarites.every((s) => s.relicBonus === relicBonusOf(state)));
  startRun(state, "ghost_village", ids(state));
  assert.equal(finish(state).relics.length, 0, "重打不再掉首通奇物");
  const before = effectivePower(state.samsarites[0]);
  for (const r of RELICS) grantRelic(state, r);
  assert.equal(state.relicCodex.length, 60);
  assert.equal(relicBonusOf(state), 0.25, "封頂 +25%");
  assert.equal(relicInfo(state).owned, 60);
  assert.ok(relicInfo(state).raw > 0.25);
  assert.ok(effectivePower(state.samsarites[0]) > before);
  const fresh = createSamsarite(state, "C");
  assert.equal(fresh.relicBonus, 0.25);
  assert.equal(grantRelic(state, RELICS[0]).dup, true);
});

test("貪婪探索：情報沒滿格不能勾；滿格後通關追加隱藏房（延長 1 個房間時間），通過掉隱藏奇物", () => {
  const saved = CONFIG.relic.greedyChance;
  CONFIG.relic.greedyChance = 1;
  try {
    const state = setup(4, 16);
    assert.equal(startRun(state, "ghost_village", ids(state), { greedy: true }).ok, false, "情報未滿");
    state.dungeonStats.ghost_village = { attempts: 8, clears: 8, intel: CONFIG.dungeon.intel.max };
    const r = startRun(state, "ghost_village", ids(state), { greedy: true });
    assert.equal(r.ok, true);
    const t0 = state.tick;
    const rep = finish(state);
    assert.equal(rep.hidden, "passed");
    assert.equal(state.tick - t0, (roomCount(getDungeon("ghost_village")) + 1) * CONFIG.roomTicks, "多走一個隱藏房");
    assert.deepEqual(rep.relics.map((x) => [x.kind, x.dup]), [["hidden", false]]);
    assert.ok(state.relicCodex.includes("relic_ghost_village_hidden"));
    // 再來一次：已擁有 → 轉為額外積分
    state.dungeonStats.ghost_village.intel = CONFIG.dungeon.intel.max;
    startRun(state, "ghost_village", ids(state), { greedy: true });
    const rep2 = finish(state);
    assert.deepEqual(rep2.relics.map((x) => [x.kind, x.dup]), [["hidden", true]]);
    const base = Math.round(getDungeon("ghost_village").reward * CONFIG.relic.dupRewardPct);
    assert.ok(rep2.reward >= base, "額外積分包含在總結算裡");
  } finally {
    CONFIG.relic.greedyChance = saved;
  }
});

test("貪婪探索：沒達通關門檻不開隱藏房；機率 20%（濃霧走散 40%）", () => {
  const trial = (mut, N) => {
    let open = 0;
    for (let seed = 1; seed <= N; seed++) {
      const state = setup(4, seed);
      state.dungeonStats.ghost_village = { attempts: 8, clears: 8, intel: CONFIG.dungeon.intel.max };
      setBoard(state, ["ghost_village", mut]);
      startRun(state, "ghost_village", ids(state), { slotId: 500, greedy: true });
      if (finish(state).hidden) open++;
    }
    return open / N;
  };
  const calm = trial("calm_wind", 500);
  const fog = trial("thick_fog", 500);
  assert.ok(Math.abs(calm - 0.2) < 0.05, `風平浪靜約 20%（實際 ${calm}）`);
  assert.ok(Math.abs(fog - 0.4) < 0.06, `濃霧走散約 40%（實際 ${fog}）`);
  // 弱隊打不過 → 沒通關 → 不開隱藏房
  const weak = setup(1, 3, 1);
  weak.dungeonStats.ghost_village = { attempts: 8, clears: 8, intel: CONFIG.dungeon.intel.max };
  const saved = CONFIG.relic.greedyChance;
  CONFIG.relic.greedyChance = 1;
  try {
    startRun(weak, "ghost_village", ids(weak), { greedy: true });
    assert.equal(finish(weak).hidden, null);
  } finally {
    CONFIG.relic.greedyChance = saved;
  }
});

test("存檔：舊 id 遷移（統計、進行中的副本、任務榜）；任務榜／奇物圖鑑往返", () => {
  const state = setup(2, 40);
  state.relicCodex = ["relic_ghost_village_first"];
  const back = deserialize(serialize(state));
  assert.deepEqual(back.board, state.board);
  assert.deepEqual(back.relicCodex, state.relicCodex);
  const old = JSON.parse(serialize(state));
  delete old.board;
  delete old.relicCodex;
  old.dungeonStats = { ch2_1: { attempts: 3, clears: 1, intel: 0 }, ch3_4: { attempts: 1, clears: 0, intel: -0.03 } };
  old.runReports = [{ dungeonId: "ch2_3" }];
  const loaded = deserialize(JSON.stringify(old));
  assert.deepEqual(Object.keys(loaded.dungeonStats).sort(), ["ch2_01", "ch3_boss"]);
  assert.equal(loaded.runReports[0].dungeonId, "ch2_05");
  assert.equal(loaded.board.slots.length, 3);
  assert.deepEqual(loaded.relicCodex, []);
  assert.ok(loaded.samsarites.every((s) => s.relicBonus === 0));
  fillBoard(loaded);
});
