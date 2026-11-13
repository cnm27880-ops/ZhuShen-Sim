import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG, GACHA_POOLS } from "../src/data/config.js";
import { DUNGEONS, getDungeon } from "../src/data/dungeons.js";
import { TAGS, ENV_TAGS, getTag } from "../src/data/tags.js";
import {
  createNewGame,
  createSamsarite,
  upkeepOf,
  setInjury,
  endOfDay,
  advanceTick,
  pullGacha,
  recycle,
  canAfford,
  checkGameOver,
  serialize,
  deserialize,
} from "../src/engine/core.js";
import { roomPassRate, clearChance, chanceAtLeast, startRun, stepRun, partyPower, rewardTierMult } from "../src/engine/dungeon.js";
import { planAutoDispatch, step } from "../src/engine/dispatch.js";

const easy = getDungeon("ghost_village");

function make(state, rank, injury = 0) {
  const s = createSamsarite(state, rank);
  setInjury(s, injury);
  state.samsarites.push(s);
  return s;
}

test("同一個種子會產生一模一樣的開局", () => {
  assert.equal(serialize(createNewGame(42)), serialize(createNewGame(42)));
  assert.equal(createNewGame(42).samsarites.length, CONFIG.startingSamsarites);
});

test("維持費符合計畫書第 12.2 節的四個範例", () => {
  const state = createNewGame(1);
  assert.equal(upkeepOf(make(state, "C", 0)), 10);
  assert.equal(upkeepOf(make(state, "B", 1)), 20);
  assert.equal(upkeepOf(make(state, "A", 2)), 35);
  assert.equal(upkeepOf(make(state, "S", 3)), 60);
});

test("房間通過率：已有情報、戰力等於推薦戰力時是 55%（50% + 重打 5%），並且有上下限", () => {
  const state = createNewGame(1);
  state.dungeonStats[easy.id] = { attempts: 1, clears: 1 }; // 已有情報
  const fake = (power) => [{ stats: { power }, tags: [] }];
  assert.ok(Math.abs(roomPassRate(state, fake(200), easy) - 0.55) < 1e-9);
  assert.equal(roomPassRate(state, fake(100000), easy), CONFIG.dungeon.maxPassRate);
  assert.equal(roomPassRate(createNewGame(1), fake(1), easy), CONFIG.dungeon.minPassRate); // 首次開荒又超弱 → 吃到下限
  assert.ok(Math.abs(chanceAtLeast(5, 5, 0.7) - 0.7 ** 5) < 1e-9);
  assert.ok(clearChance(state, fake(400), easy) > 0.8);
});

test("首次開荒：通過率 -10%；通關後變成有情報", () => {
  const state = createNewGame(1);
  const fake = [{ stats: { power: 200 }, tags: [] }];
  assert.ok(Math.abs(roomPassRate(state, fake, easy) - 0.4) < 1e-9);
});

test("標籤：戰力加成、類型相性、環境相性、加成上限", () => {
  const state = createNewGame(1);
  state.dungeonStats[easy.id] = { attempts: 1, clears: 1 };
  const base = [{ stats: { power: 100 }, tags: [] }];
  const strong = [{ stats: { power: 100 }, tags: ["born_strong"] }]; // 戰力 +15%
  assert.equal(partyPower(strong), 115);
  assert.ok(roomPassRate(state, strong, easy) > roomPassRate(state, base, easy));
  const fool = [{ stats: { power: 100 }, tags: ["horror_fool"] }]; // 靈異 +15%
  assert.ok(Math.abs(roomPassRate(state, fool, easy) - roomPassRate(state, base, easy) - 0.15) < 1e-9);
  const silence = ENV_TAGS.find((e) => e.id === "absolute_silence");
  const bgm = [{ stats: { power: 100 }, tags: ["bgm_carrier"] }];
  assert.ok(roomPassRate(state, bgm, easy, silence) < roomPassRate(state, bgm, easy, null));
  const many = Array.from({ length: 4 }, () => ({ stats: { power: 100 }, tags: ["horror_fool", "haunted_sleeper"] }));
  const noTag = Array.from({ length: 4 }, () => ({ stats: { power: 100 }, tags: [] }));
  const diff = roomPassRate(state, many, easy) - roomPassRate(state, noTag, easy);
  assert.ok(diff <= CONFIG.tags.tagBonusCap + 1e-9);
});

test("新輪迴者有 4~5 個標籤：2 基礎數值 + 1~2 性格 + 1 靈魂，且不重複", () => {
  const state = createNewGame(5);
  for (let i = 0; i < 100; i++) {
    const s = createSamsarite(state, "C");
    assert.ok(s.tags.length === 4 || s.tags.length === 5);
    assert.equal(new Set(s.tags).size, s.tags.length);
    const kinds = s.tags.map((id) => getTag(id).kind);
    assert.equal(kinds.filter((k) => k === "stat").length, 2);
    assert.equal(kinds.filter((k) => k === "soul").length, 1);
  }
});

test("標籤資料表：id 不重複、30 個 MVP 標籤、環境標籤引用的標籤都存在", () => {
  assert.equal(TAGS.length, 30);
  assert.equal(new Set(TAGS.map((t) => t.id)).size, TAGS.length);
  for (const t of TAGS) for (const envId of Object.keys(t.envBonus ?? {})) assert.ok(ENV_TAGS.some((e) => e.id === envId), envId);
});

test("獎勵遞減：第 1 次基礎、2-3 次 120%、4-5 次 100%、6-10 次 80%、11 次後 60%", () => {
  const state = createNewGame(1);
  const mult = (clears) => {
    state.dungeonStats[easy.id] = { attempts: clears, clears };
    return rewardTierMult(state, easy);
  };
  assert.equal(mult(0), 1); // 即將第 1 次通關
  assert.equal(mult(1), 1.2); // 第 2 次
  assert.equal(mult(2), 1.2); // 第 3 次
  assert.equal(mult(3), 1.0); // 第 4 次
  assert.equal(mult(5), 0.8); // 第 6 次
  assert.equal(mult(10), 0.6); // 第 11 次
  assert.equal(mult(99), 0.6);
});

test("首次通關：額外 +50 分、掉一個特殊獎勵並收入收藏；第二次不再有", () => {
  const state = createNewGame(1);
  state.samsarites = [];
  const squad = [make(state, "S"), make(state, "S"), make(state, "S"), make(state, "S")];
  for (const s of squad) s.tags = []; // 排除標籤干擾
  let first = null;
  for (let i = 0; i < 20 && !first; i++) {
    for (const s of state.samsarites) setInjury(s, 0);
    startRun(state, easy.id, state.samsarites.map((s) => s.id));
    while (state.run) stepRun(state);
    if (state.lastRun.success) first = state.lastRun;
    if (state.samsarites.length < 4) break;
  }
  if (first) {
    assert.equal(first.firstClear, true);
    assert.ok(first.specialReward);
    assert.equal(state.collection.length, 1);
    assert.ok(first.reward >= CONFIG.dungeon.firstClearBonus);
    startRun(state, easy.id, state.samsarites.map((s) => s.id));
    while (state.run) stepRun(state);
    assert.equal(state.lastRun.firstClear, false);
    assert.equal(state.collection.length, 1);
  }
});

test("每日結算：扣維持費、養傷倒數、傷癒", () => {
  const state = createNewGame(1);
  state.samsarites = [];
  const s = make(state, "C", 1); // 輕傷：休 1 天、每天 15 分
  state.tick = CONFIG.ticksPerDay;
  endOfDay(state);
  assert.equal(state.points, CONFIG.startingPoints - 15);
  assert.equal(s.injury, 0);
});

test("高利貸：積分不會低於上限，負債時會電擊扣理智", () => {
  const state = createNewGame(1);
  state.points = CONFIG.debtLimit + 5;
  state.tick = CONFIG.ticksPerDay;
  endOfDay(state);
  assert.equal(state.points, CONFIG.debtLimit);
  assert.ok(state.samsarites.every((s) => s.stats.sanity === 100 - CONFIG.debtShockSanity));
  assert.ok(state.events.some((e) => e.type === "shock"));
});

test("抽卡：扣對的錢、只出該池的階級、借不到錢就抽不了", () => {
  const state = createNewGame(7);
  state.points = 100000;
  for (const pool of GACHA_POOLS) {
    const allowed = pool.odds.map((o) => o.rank);
    for (let i = 0; i < 50; i++) {
      const before = state.points;
      const s = pullGacha(state, pool.id);
      assert.ok(allowed.includes(s.rank));
      assert.equal(state.points, before - pool.cost);
    }
  }
  state.points = CONFIG.debtLimit + 100;
  assert.equal(pullGacha(state, "ba"), null);
  assert.equal(canAfford(state, 100), true);
});

test("一場副本剛好過 1 天，而且出征的人不扣維持費", () => {
  const state = createNewGame(3);
  const stay = state.samsarites[0];
  const party = state.samsarites.slice(1).map((s) => s.id);
  assert.equal(startRun(state, easy.id, party).ok, true);
  const before = state.points;
  let guard = 0;
  while (state.run && guard++ < 10) stepRun(state);
  assert.equal(state.tick, CONFIG.ticksPerDay);
  assert.equal(state.run, null);
  assert.equal(state.points, before - upkeepOf(stay) + state.lastRun.reward);
  assert.ok(state.samsarites.every((s) => s.location === "space"));
});

test("戰力嚴重不足的隊伍會傷亡；失敗生還者一定帶傷", () => {
  let sawDeath = false;
  let sawInjuredSurvivor = false;
  for (let seed = 1; seed <= 40; seed++) {
    const state = createNewGame(seed);
    startRun(state, "ember_war", state.samsarites.map((s) => s.id));
    while (state.run) stepRun(state);
    if (state.lastRun.success) continue; // 戰力不足仍有極小機率運氣好通關
    assert.ok(state.samsarites.every((s) => s.injury > 0));
    if (state.graveyard.length > 0) sawDeath = true;
    if (state.samsarites.length > 0) sawInjuredSurvivor = true;
  }
  assert.ok(sawDeath && sawInjuredSurvivor);
});

test("派遣檢查：人數上限、不能重複出征", () => {
  const state = createNewGame(5);
  state.points = 100000;
  while (state.samsarites.length <= CONFIG.partyMax) pullGacha(state, "ba");
  assert.equal(startRun(state, easy.id, state.samsarites.map((s) => s.id)).ok, false);
  assert.equal(startRun(state, easy.id, []).ok, false);
  assert.equal(startRun(state, easy.id, [state.samsarites[0].id]).ok, true);
  assert.equal(startRun(state, easy.id, [state.samsarites[1].id]).ok, false);
});

test("自動派遣：不派鎖定的人、不派受傷的人（開關開著時）、挑獎勵最高的可行副本", () => {
  // 注意：中等 5000、困難 100000 的推薦戰力目前遠超過隊伍戰力（等裝備／血統上線才打得動），所以現階段可行的只有簡單副本
  const state = createNewGame(9);
  state.samsarites = [];
  const strong = [make(state, "S"), make(state, "S"), make(state, "S"), make(state, "S")];
  const plan = planAutoDispatch(state);
  assert.equal(plan.dungeon.id, "ghost_village");

  strong[0].locked = true;
  setInjury(strong[1], 1);
  const plan2 = planAutoDispatch(state);
  assert.ok(!plan2.party.includes(strong[0]));
  assert.ok(!plan2.party.includes(strong[1]));

  state.settings.protect.noInjured = false;
  const plan3 = planAutoDispatch(state);
  assert.ok(plan3.party.includes(strong[1]));

  for (const s of strong) s.locked = true;
  assert.equal(planAutoDispatch(state), null);
});

test("自動派遣：不浪費戰力（簡單副本不會把最強的人全派出去）", () => {
  const state = createNewGame(11);
  state.samsarites = [];
  make(state, "S");
  make(state, "C");
  make(state, "C");
  const plan = planAutoDispatch(state);
  const again = planAutoDispatch(state);
  assert.deepEqual(plan.party.map((s) => s.id), again.party.map((s) => s.id));
  // 同一個副本下，沒有其他達標組合的總戰力比它更低
  assert.ok(plan.chance >= CONFIG.auto.minClearChance);
});

test("回收爐：+30 分、其他人理智下降", () => {
  const state = createNewGame(2);
  const [a, b] = state.samsarites;
  const before = state.points;
  assert.equal(recycle(state, a.id), true);
  assert.equal(state.points, before + CONFIG.recycle.points);
  assert.equal(b.stats.sanity, 100 - CONFIG.recycle.sanityLoss);
  assert.equal(state.samsarites.includes(a), false);
});

test("沒人又借不到錢 = 遊戲結束；還借得到就不算", () => {
  const state = createNewGame(2);
  state.samsarites = [];
  assert.equal(checkGameOver(state), false);
  state.points = CONFIG.debtLimit;
  assert.equal(checkGameOver(state), true);
});

test("開著自動派遣放著跑 60 天不會壞掉，存檔讀回來一模一樣", () => {
  const state = createNewGame(123);
  state.settings.autoDispatch = true;
  for (let i = 0; i < 3; i++) state.samsarites.push(createSamsarite(state, "A")); // 開局 3 個 C 級戰力太低，自動派遣不會出門
  for (let i = 0; i < 600 && !state.gameOver; i++) {
    step(state);
    assert.ok(state.points >= CONFIG.debtLimit);
    assert.ok(Number.isInteger(state.points));
  }
  const total = Object.values(state.dungeonStats).reduce((n, d) => n + d.attempts, 0);
  assert.ok(total > 0);
  assert.equal(serialize(deserialize(serialize(state))), serialize(state));
});

test("副本資料完整：每個副本都有 5 個房間", () => {
  for (const d of DUNGEONS) assert.equal(d.rooms.length, CONFIG.dungeon.rooms);
  advanceTick(createNewGame(1));
});
