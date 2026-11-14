// Phase 4-F-4：《主神八卦日報》資料整理（頭條挑選、愛恨關係圖、英靈碑精選、種子碼）。Canvas 繪製由 Chromium 煙霧測試驗證。
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/data/config.js";
import { createNewGame, createSamsarite, serialize, deserialize } from "../src/engine/core.js";
import { buildGossip, pickHeadline, buildGraph, pairEdge, steleDigest } from "../src/engine/gossip.js";
import { addChronicle } from "../src/engine/lineage.js";
import { addLove, addHate } from "../src/engine/relations.js";

function setup(n = 8, seed = 21) {
  const state = createNewGame(seed);
  state.samsarites = [];
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, "C");
    s.tags = [];
    state.samsarites.push(s);
  }
  return state;
}

test("種子碼：新局記下初始種子，存檔讀回不變；舊存檔顯示無種子碼", () => {
  const state = createNewGame(12345);
  for (let i = 0; i < 50; i++) state.rngState = (state.rngState * 31 + 7) | 0; // 亂數狀態會變，種子碼不能跟著變
  assert.equal(state.seed, 12345);
  assert.equal(buildGossip(state).header.seed, "12345");
  assert.equal(deserialize(serialize(state)).seed, 12345);
  const old = JSON.parse(serialize(state));
  delete old.seed;
  assert.match(buildGossip(deserialize(JSON.stringify(old))).header.seed, /舊存檔/);
});

test("頭條：沒事件顯示風平浪靜；有尾王首通顯示尾王戰報；高光事件優先於尾王，同優先取最新", () => {
  const state = setup(3);
  assert.equal(pickHeadline(state).kind, "calm");
  addChronicle(state, "boss", "第 1 章尾王首通");
  assert.equal(pickHeadline(state).kind, "boss");
  state.tick = CONFIG.ticksPerDay * 2;
  addChronicle(state, "coup", "雙強政變：甲推翻了乙");
  assert.equal(pickHeadline(state).kind, "coup");
  assert.match(pickHeadline(state).title, /政變/);
  state.tick = CONFIG.ticksPerDay * 5;
  addChronicle(state, "elope", "丙跟著敵隊私奔了");
  assert.equal(pickHeadline(state).kind, "elope", "較新的高光優先");
  state.tick = CONFIG.ticksPerDay * 6;
  addChronicle(state, "inferno", "逆襲斬殺煉獄惡魔隊");
  assert.equal(pickHeadline(state).kind, "inferno");
  state.tick = CONFIG.ticksPerDay * 7;
  addChronicle(state, "guard", "壯烈擋刀");
  assert.equal(pickHeadline(state).kind, "guard");
  assert.ok(pickHeadline(state).sub.includes("壯烈擋刀"));
});

test("頭條：單人多胎家族（3 位以上子嗣）也算高光", () => {
  const state = setup(5);
  const [p, a, b, c] = state.samsarites;
  for (const k of [a, b, c]) {
    k.parents = [p.id];
    k.joinedDay = 3;
  }
  const h = pickHeadline(state);
  assert.equal(h.kind, "family");
  assert.ok(h.title.includes(p.name));
});

test("愛恨關係圖：最多 6 個節點，粉紅＝雙向真愛／伴侶、血紅＝仇恨死敵、紫＝單箭頭修羅場或混血血緣；邊只連已選節點", () => {
  const state = setup(9);
  const [a, b, c, d, e, f, g] = state.samsarites;
  addLove(state, a, b, 90); addLove(state, b, a, 90); // 雙向真愛
  addHate(state, c, d, 70); addHate(state, d, c, 70); // 互恨
  addLove(state, e, f, 80); addHate(state, f, e, 30); // 單箭頭：e 愛 f，f 對 e 淨好感 -30
  assert.equal(pairEdge(state, a, b).kind, "love");
  assert.equal(pairEdge(state, c, d).kind, "hate");
  assert.equal(pairEdge(state, e, f).kind, "rift");
  assert.equal(pairEdge(state, a, g), null);
  const graph = buildGraph(state);
  assert.ok(graph.nodes.length <= CONFIG.gossip.nodes);
  assert.equal(graph.nodes.length, CONFIG.gossip.nodes);
  const ids = new Set(graph.nodes.map((n) => n.id));
  for (const ed of graph.edges) assert.ok(ids.has(ed.a) && ids.has(ed.b));
  assert.ok(graph.edges.some((x) => x.kind === "love") && graph.edges.some((x) => x.kind === "hate"));
  // 混血子嗣血緣＝紫線
  const baby = createSamsarite(state, "C");
  baby.hybridOrigin = "joyous";
  baby.parents = [g.id];
  state.samsarites.push(baby);
  assert.equal(pairEdge(state, baby, g).kind, "rift");
});

test("英靈碑精選：最多 3 筆，含墓誌銘摘要", () => {
  const state = setup(2);
  state.memorialStele = [1, 2, 3, 4].map((i) => ({ name: `英靈${i}`, rank: "A", geneLock: 2, runs: 10 + i, day: 20 + i, cause: "副本戰死", kind: "dungeon", bonus: 0.08 }));
  const list = steleDigest(state);
  assert.equal(list.length, CONFIG.gossip.steles);
  assert.ok(list[0].line.includes("基因鎖 2 階") && list[0].line.includes("副本戰死"));
  assert.equal(buildGossip(state).steles.length, 3);
  // 完整結構
  const g = buildGossip(state);
  for (const k of ["day", "level", "captain", "style", "facilityTotal", "maxErosion", "children", "seed"]) assert.ok(k in g.header, k);
});
