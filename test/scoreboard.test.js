import { test } from "node:test";
import assert from "node:assert/strict";
import { createNewGame, currentDay } from "../src/engine/core.js";
import { buildScorePayload } from "../src/engine/scoreboard.js";
import { effectivePower } from "../src/engine/tags.js";
import { planSync } from "../src/engine/cloudSync.js";
import { DUNGEONS } from "../src/data/dungeons.js";

test("成績：新局的各項數字", () => {
  const state = createNewGame(5);
  const p = buildScorePayload(state);
  assert.equal(p.level, 1);
  assert.equal(p.roster, 3);
  assert.equal(p.clears, 0);
  assert.equal(p.life, 0);
  const strongest = [...state.samsarites].sort((a, b) => effectivePower(b) - effectivePower(a))[0];
  assert.equal(p.power, effectivePower(strongest));
  assert.equal(p.powerName, strongest.name);
});

test("成績：副本通關數＝通關過幾個不同副本（重打與非世界副本不算）；墓園的人也算進最強與最長壽", () => {
  const state = createNewGame(5);
  state.dungeonStats = {
    [DUNGEONS[0].id]: { attempts: 5, clears: 3 }, // 通關 3 次只算 1 個副本
    [DUNGEONS[1].id]: { attempts: 2, clears: 1 },
    [DUNGEONS[2].id]: { attempts: 4, clears: 0 }, // 只挑戰過沒通關：不算
    rival_clash: { attempts: 9, clears: 9 }, // 洲際碰撞不是世界：不算
  };
  state.tick = 40 * 5 * 10; // 往後走一段時間
  const today = currentDay(state);
  for (const s of state.samsarites) s.joinedDay = today; // 活著的人都剛加入，壽命 0
  state.graveyard.push({ name: "老將", rank: "S", day: today - 1, cause: "測試", bio: { power: 99999, joinedDay: 1, deathDay: today - 1 } });
  const p = buildScorePayload(state);
  assert.equal(p.clears, 2);
  assert.equal(p.power, 99999);
  assert.equal(p.powerName, "老將");
  assert.equal(p.life, today - 2);
  assert.equal(p.lifeName, "老將");
  // 活著的人活得更久時，長壽榜用活著的那位
  state.samsarites[0].joinedDay = 1;
  state.graveyard[0].bio.joinedDay = today - 5; // 墓園那位只活了 4 天
  assert.equal(buildScorePayload(state).lifeName, state.samsarites[0].name);
});

test("成績：不會超過後端上限", () => {
  const state = createNewGame(5);
  state.samsarites[0].stats.power = 5e9;
  state.spaceLevel = 9;
  const p = buildScorePayload(state);
  assert.equal(p.power, 1_000_000_000);
  assert.equal(p.level, 5);
});

test("同步決策：各種情況都不會在沒問玩家的情況下覆蓋", () => {
  const u = "u1";
  const fresh = { exists: true, hasProgress: false };
  const played = { exists: true, hasProgress: true };
  // 雲端沒有
  assert.equal(planSync({ userId: u, local: played, cloud: null, meta: null }).action, "offer-upload");
  assert.equal(planSync({ userId: u, local: fresh, cloud: null, meta: null }).action, "none");
  assert.equal(planSync({ userId: u, local: { exists: false, hasProgress: false }, cloud: null, meta: null }).action, "none");
  // 雲端有、已同步
  assert.equal(planSync({ userId: u, local: played, cloud: { updatedAt: 5 }, meta: { uid: u, base: 5 } }).action, "none");
  // 雲端有、本機沒進度 → 直接載入
  assert.equal(planSync({ userId: u, local: fresh, cloud: { updatedAt: 5 }, meta: null }).action, "adopt-cloud");
  // 雲端有、本機有進度、第一次 → 衝突
  assert.deepEqual(planSync({ userId: u, local: played, cloud: { updatedAt: 5 }, meta: null }), { action: "conflict", reason: "first" });
  // 雲端被別台更新過
  assert.deepEqual(planSync({ userId: u, local: played, cloud: { updatedAt: 9 }, meta: { uid: u, base: 5 } }), { action: "conflict", reason: "cloud-newer" });
  // 紀錄是別的帳號留下的，不能當作已同步
  assert.deepEqual(planSync({ userId: u, local: played, cloud: { updatedAt: 5 }, meta: { uid: "other", base: 5 } }), { action: "conflict", reason: "first" });
});
