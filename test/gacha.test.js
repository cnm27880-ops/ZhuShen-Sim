// Phase 4-B：四階卡池（空間等級解鎖、每週漲價與重置、獨立保底、因果結晶）
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/data/config.js";
import { createNewGame, pullGacha, gachaInfo, checkGacha, checkGameOver, advanceTick, serialize, deserialize } from "../src/engine/core.js";

const pool = (id) => CONFIG.gacha.pools.find((p) => p.id === id);
const rich = (seed = 5, spaceLevel = 4) => {
  const state = createNewGame(seed);
  state.points = 10000000;
  state.spaceLevel = spaceLevel;
  state.karmaCrystals = 1000;
  return state;
};
const tickToDay = (state, day) => {
  state.tick = (day - 1) * CONFIG.ticksPerDay;
};

test("卡池數字：四池、基礎價、漲價、機率、保底都對", () => {
  const pools = CONFIG.gacha.pools;
  assert.deepEqual(pools.map((p) => p.id), ["basic", "mid", "high", "divine"]);
  assert.deepEqual(pools.map((p) => p.base), [120, 350, 1200, 4500]);
  assert.deepEqual(pools.map((p) => p.step), [20, 60, 200, 800]);
  assert.deepEqual(pools.map((p) => p.spaceLevel), [1, 2, 3, 4]);
  assert.deepEqual(pools.map((p) => p.crystal), [0, 0, 0, 1]);
  assert.deepEqual(pools.map((p) => p.pity), [null, { every: 10, minRank: "A" }, { every: 25, minRank: "S" }, { every: 12, minRank: "S" }]);
  for (const p of pools) assert.equal(Object.values(p.odds).reduce((a, b) => a + b, 0), 100, `${p.id} 機率加總 100`);
  assert.deepEqual(pool("basic").odds, { C: 75, B: 23, A: 2, S: 0 });
  assert.deepEqual(pool("divine").odds, { C: 0, B: 25, A: 65, S: 10 });
});

test("空間等級解鎖：Lv.1 只有初級池，Lv.2/3/4 各開一個；未解鎖抽不了、不扣錢", () => {
  for (const [level, unlocked] of [[1, ["basic"]], [2, ["basic", "mid"]], [3, ["basic", "mid", "high"]], [4, ["basic", "mid", "high", "divine"]]]) {
    const state = rich(5, level);
    for (const p of CONFIG.gacha.pools) {
      const before = state.points;
      const s = pullGacha(state, p.id);
      if (unlocked.includes(p.id)) assert.ok(s, `Lv.${level} 應該能抽 ${p.id}`);
      else {
        assert.equal(s, null, `Lv.${level} 不該能抽 ${p.id}`);
        assert.equal(state.points, before);
        assert.match(checkGacha(state, p.id).reason, /空間等級/);
      }
    }
  }
  assert.equal(pullGacha(rich(), "nope"), null);
});

test("每週漲價：本週每多抽 1 次加 step 分；第 8、15 天重置；保底計數跨週保留", () => {
  const state = rich(5, 2);
  const mid = pool("mid");
  assert.equal(checkGacha(state, "mid").cost, 350);
  pullGacha(state, "mid");
  assert.equal(checkGacha(state, "mid").cost, 350 + 60);
  pullGacha(state, "mid");
  assert.equal(checkGacha(state, "mid").cost, 350 + 120);
  assert.equal(checkGacha(state, "basic").cost, 120, "各池漲價獨立");
  const pityBefore = state.gacha.pools.mid.pity;

  tickToDay(state, 7); // 第 7 天還是同一週
  assert.equal(checkGacha(state, "mid").cost, 350 + 120);
  tickToDay(state, 8); // 第 8 天重置
  assert.equal(checkGacha(state, "mid").cost, mid.base);
  assert.equal(state.gacha.pools.mid.pity, pityBefore, "保底計數不因換週重置");
  pullGacha(state, "mid");
  tickToDay(state, 14);
  assert.equal(checkGacha(state, "mid").cost, 350 + 60);
  tickToDay(state, 15);
  assert.equal(checkGacha(state, "mid").cost, mid.base);
});

test("跨週後用 advanceTick 走到第 8 天，價格也會重置", () => {
  const state = rich(5, 1);
  state.points = 10000000;
  pullGacha(state, "basic");
  assert.equal(checkGacha(state, "basic").cost, 140);
  while (state.tick < 7 * CONFIG.ticksPerDay) advanceTick(state);
  assert.equal(checkGacha(state, "basic").cost, 120);
});

test("保底：中級池第 10 抽必出 A 以上；抽中 A 以上計數歸零，沒抽中就 +1", () => {
  const state = rich(5, 2);
  state.gacha.pools.mid.pity = 9; // 下一抽是第 10 抽
  const s = pullGacha(state, "mid");
  assert.ok(["A", "S"].includes(s.rank), `保底抽到 ${s.rank}`);
  assert.equal(state.gacha.pools.mid.pity, 0);
  assert.ok(state.events.some((e) => e.type === "gachaPity"));

  // 一般抽：階級 >= A 就歸零，否則 +1
  for (let i = 0; i < 40; i++) {
    state.gacha.pools.mid.pity = 0;
    const r = pullGacha(state, "mid");
    assert.equal(state.gacha.pools.mid.pity, ["A", "S"].includes(r.rank) ? 0 : 1);
  }
});

test("保底：連續抽 10 次中級池（保底從 0 開始）至少出 1 個 A 以上", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const state = rich(seed, 2);
    let got = 0;
    for (let i = 0; i < 10; i++) if (["A", "S"].includes(pullGacha(state, "mid").rank)) got++;
    assert.ok(got >= 1, `seed ${seed}`);
  }
});

test("保底：高級池 25 抽必出 S；神級池 12 抽必出 S", () => {
  const state = rich(5, 4);
  state.gacha.pools.high.pity = 24;
  assert.equal(pullGacha(state, "high").rank, "S");
  assert.equal(state.gacha.pools.high.pity, 0);
  state.gacha.pools.divine.pity = 11;
  assert.equal(pullGacha(state, "divine").rank, "S");
  assert.equal(state.gacha.pools.divine.pity, 0);
  for (let seed = 1; seed <= 20; seed++) {
    const s2 = rich(seed, 4);
    let got = 0;
    for (let i = 0; i < 12; i++) if (pullGacha(s2, "divine").rank === "S") got++;
    assert.ok(got >= 1, `神級池 seed ${seed}`);
  }
});

test("初級池沒有保底、也不會抽到 S", () => {
  const state = rich(9, 1);
  state.gacha.pools.basic.pity = 999;
  for (let i = 0; i < 300; i++) assert.notEqual(pullGacha(state, "basic").rank, "S");
});

test("神級池：每抽固定消耗 1 顆因果結晶（不隨漲價增加），結晶不夠不能抽", () => {
  const state = rich(5, 4);
  state.karmaCrystals = 3;
  for (let i = 0; i < 3; i++) {
    const before = state.points;
    assert.equal(checkGacha(state, "divine").crystal, 1, "結晶每抽固定 1 顆");
    assert.ok(pullGacha(state, "divine"));
    assert.equal(state.points, before - (4500 + 800 * i));
    assert.equal(state.karmaCrystals, 3 - (i + 1));
  }
  const before = state.points;
  assert.equal(pullGacha(state, "divine"), null);
  assert.match(checkGacha(state, "divine").reason, /因果結晶/);
  assert.equal(state.points, before, "抽不了不扣錢");
  assert.equal(state.karmaCrystals, 0);
});

test("抽卡的花費算進累積花費；錢不夠（超過高利貸上限）抽不了且不扣", () => {
  const state = createNewGame(3);
  state.totalSpent = 0;
  pullGacha(state, "basic");
  assert.equal(state.totalSpent, 120);
  state.points = CONFIG.space.debtLimit[0] + 100;
  const before = state.totalSpent;
  assert.equal(pullGacha(state, "basic"), null);
  assert.equal(state.totalSpent, before);
});

test("gachaInfo：四池都有資料，並帶解鎖／不能抽的原因", () => {
  const state = createNewGame(3);
  const info = gachaInfo(state);
  assert.equal(info.length, 4);
  assert.equal(info[0].ok, true);
  assert.equal(info[1].ok, false);
  assert.match(info[1].reason, /Lv\.2/);
  assert.equal(info[3].crystal, 1);
});

test("遊戲結束判定用基礎價：沒人且連初級池基礎價都付不起才結束", () => {
  CONFIG.airdrop.rescue = false; // 這個測試看的是舊規則的判定線；空投救援開著就不會結束（見 engine.test）
  const state = createNewGame(3);
  state.samsarites = [];
  state.points = CONFIG.space.debtLimit[0] + 119;
  assert.equal(checkGameOver(state), true);
  const s2 = createNewGame(3);
  s2.samsarites = [];
  s2.points = CONFIG.space.debtLimit[0] + 120;
  assert.equal(checkGameOver(s2), false);
  // 本週漲價後（實際價 > 可用積分）但基礎價付得起：還不算結束（下週價格就回來了）
  s2.gacha.pools.basic.pulls = 5;
  assert.equal(checkGameOver(s2), false);
  CONFIG.airdrop.rescue = true;
});

test("存檔：卡池狀態與因果結晶會保存", () => {
  const state = rich(5, 4);
  pullGacha(state, "mid");
  pullGacha(state, "divine");
  const loaded = deserialize(serialize(state));
  assert.equal(loaded.karmaCrystals, state.karmaCrystals);
  assert.deepEqual(loaded.gacha, state.gacha);
});
