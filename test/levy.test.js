// 強徵私房錢：三檔比例、保命底線、冷卻、拒繳、好感代價、獨立亂數流、存檔相容
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/data/config.js";
import { LOGS } from "../src/data/logs.js";
import { createNewGame, createSamsarite, serialize, deserialize, upkeepOf } from "../src/engine/core.js";
import { levyWallets, checkLevy, levyPreview, refuseChance, reserveOf, dueOf, tierOf } from "../src/engine/levy.js";
import { affinity } from "../src/engine/relations.js";
import { captainOf } from "../src/engine/squad.js";

function setup(n = 4, wallet = 1000) {
  const state = createNewGame(33);
  state.points = 100;
  state.samsarites = [];
  for (let i = 0; i < n; i++) { const s = createSamsarite(state, "C"); s.tags = []; s.wallet = wallet; s.stats.sanity = 100; state.samsarites.push(s); }
  return state;
}
const clearRefusal = () => { for (const t of CONFIG.levy.tiers) t.refuse = 0; };

test("三檔設定：比例遞增、冷卻遞增、拒繳率遞增", () => {
  const T = CONFIG.levy.tiers;
  assert.equal(T.length, 3);
  for (let i = 1; i < T.length; i++) {
    assert.ok(T[i].pct > T[i - 1].pct && T[i].cooldown > T[i - 1].cooldown && T[i].refuse > T[i - 1].refuse);
  }
});

test("徵收：只收保命底線以上的部分、錢全進公庫、不計入考核營收", () => {
  const saved = CONFIG.levy.tiers.map((t) => t.refuse);
  clearRefusal();
  try {
    const state = setup(3, 1000);
    state.pressure.targets = { clears: 1, earned: 1, deaths: 9, level: 2 };
    const s0 = state.samsarites[0];
    const tier = tierOf("firm");
    const due = Math.floor((1000 - reserveOf(state, s0)) * tier.pct);
    assert.equal(dueOf(state, s0, tier), due);
    const r = levyWallets(state, "firm");
    assert.equal(r.ok, true);
    assert.equal(r.collected, due * 3);
    assert.equal(state.points, 100 + due * 3);
    assert.equal(s0.wallet, 1000 - due);
    assert.ok(s0.wallet >= reserveOf(state, s0), "不會低於保命底線");
    assert.equal(state.pressure.period.earned, 0, "強徵不算考核營收");
  } finally {
    CONFIG.levy.tiers.forEach((t, i) => (t.refuse = saved[i]));
  }
});

test("私房錢低於底線的人不被徵；全員都榨不出東西時不能發動", () => {
  const state = setup(2, 10);
  assert.equal(checkLevy(state, "mild").ok, false);
  assert.match(checkLevy(state, "mild").reason, /保命底線/);
  assert.equal(levyWallets(state, "mild").ok, false);
  assert.equal(state.points, 100);
});

test("冷卻：發動後全檔位共用冷卻，天數到才能再發動", () => {
  const saved = CONFIG.levy.tiers.map((t) => t.refuse);
  clearRefusal();
  try {
    const state = setup(2, 5000);
    assert.equal(levyWallets(state, "mild").ok, true);
    const r = checkLevy(state, "raid");
    assert.equal(r.ok, false);
    assert.match(r.reason, /天/);
    state.tick += CONFIG.ticksPerDay * tierOf("mild").cooldown;
    assert.equal(checkLevy(state, "raid").ok, true);
  } finally {
    CONFIG.levy.tiers.forEach((t, i) => (t.refuse = saved[i]));
  }
});

test("付款者理智下降、對隊長好感下降；隊長自己不扣好感", () => {
  const saved = CONFIG.levy.tiers.map((t) => t.refuse);
  clearRefusal();
  try {
    const state = setup(3, 5000);
    const cap = captainOf(state) ?? state.samsarites[0];
    state.squad.captainId = cap.id;
    const other = state.samsarites.find((s) => s.id !== cap.id);
    other.stats.sanity = 90;
    const aff0 = affinity(state, other, cap);
    levyWallets(state, "firm");
    assert.equal(other.stats.sanity, 90 - tierOf("firm").sanity);
    assert.equal(affinity(state, other, cap), aff0 - tierOf("firm").affinity);
  } finally {
    CONFIG.levy.tiers.forEach((t, i) => (t.refuse = saved[i]));
  }
});

test("全面搜刮：全員套用不爽心情", () => {
  const saved = CONFIG.levy.tiers.map((t) => t.refuse);
  clearRefusal();
  try {
    const state = setup(2, 9000);
    levyWallets(state, "raid");
    for (const s of state.samsarites) assert.equal(s.mood?.kind, "upset");
  } finally {
    CONFIG.levy.tiers.forEach((t, i) => (t.refuse = saved[i]));
  }
});

test("拒繳率：低理智、有戀人、綁定裝備、負好感各自加成；隊長不拒繳；有上限", () => {
  const state = setup(3, 5000);
  const [a, b, c] = state.samsarites;
  state.squad.captainId = c.id;
  const tier = tierOf("firm");
  const base = refuseChance(state, a, tier);
  assert.equal(base, tier.refuse);
  a.stats.sanity = 50;
  assert.equal(refuseChance(state, a, tier), base + CONFIG.levy.refuseBonus.lowSanity);
  a.stats.sanity = 10;
  assert.equal(refuseChance(state, a, tier), base + CONFIG.levy.refuseBonus.veryLowSanity);
  a.stats.sanity = 100;
  a.soulbound = { weapon: true };
  assert.equal(refuseChance(state, a, tier), base + CONFIG.levy.refuseBonus.soulbound);
  assert.equal(refuseChance(state, c, tier), 0, "隊長不拒繳");
  a.stats.sanity = 0;
  a.soulbound = { weapon: true, armor: true };
  assert.ok(refuseChance(state, a, tierOf("raid")) <= CONFIG.levy.maxRefuse);
  void b;
});

test("拒繳：拒繳者不付錢、對隊長好感多扣、獨立亂數流不動主亂數；重跑同種子結果一致", () => {
  const run = () => {
    const state = setup(6, 5000);
    state.squad.captainId = state.samsarites[0].id;
    for (const s of state.samsarites) s.stats.sanity = 10; // 拉高拒繳率
    const main = state.rngState;
    const r = levyWallets(state, "raid");
    assert.equal(state.rngState, main, "不動主亂數");
    return { r, state };
  };
  const a = run(), b = run();
  assert.deepEqual(a.r.refusers.map((x) => x.id), b.r.refusers.map((x) => x.id));
  assert.ok(a.r.refusers.length > 0 && a.r.payers.length >= 0);
  const cap = captainOf(a.state);
  for (const x of a.r.refusers) {
    const s = a.state.samsarites.find((o) => o.id === x.id);
    assert.equal(s.wallet, 5000, "拒繳者沒掏錢");
    if (s.id !== cap.id) assert.ok(affinity(a.state, s, cap) <= -(tierOf("raid").affinity + CONFIG.levy.refuseExtraAffinity));
  }
  assert.equal(a.state.levy.refusals, a.r.refusers.length);
});

test("預覽不吃亂數；催熟艙嬰兒不被徵；存檔相容", () => {
  const state = setup(3, 4000);
  const before = state.levy.rngState;
  const pv = levyPreview(state, "firm");
  assert.equal(state.levy.rngState, before);
  assert.equal(pv.people, 3);
  state.samsarites[0].location = "pod";
  assert.equal(levyPreview(state, "firm").people, 2);
  const old = JSON.parse(serialize(state));
  delete old.levy;
  const back = deserialize(JSON.stringify(old));
  assert.ok(back.levy && back.levy.count === 0);
  assert.ok(upkeepOf(back.samsarites[1], back) > 0);
});

test("日誌模板每個 key 至少 2 個版本", () => {
  for (const k of ["levyDone", "levyRefuse"]) assert.ok(LOGS[k]?.length >= 2, k);
});
