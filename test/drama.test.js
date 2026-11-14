// Phase 4-E-3：5:2:1 人際事件池（熱血羈絆／派系摩擦／八點檔修羅場）
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/data/config.js";
import { DRAMA_EVENTS, eventsOfGroup } from "../src/data/dramaEvents.js";
import { renderTemplate } from "../src/engine/templates.js";
import { createNewGame, createSamsarite, setInjury } from "../src/engine/core.js";
import { pickGroup, playable, runDrama, applyEvent, dailyDrama } from "../src/engine/drama.js";
import { appointCaptain, squadRng, styleOf, noteContraband, captainOf } from "../src/engine/squad.js";
import { partyPower } from "../src/engine/dungeon.js";
import { effectivePower } from "../src/engine/tags.js";
import { affinity, shiftAffinity } from "../src/engine/relations.js";
import { getShopItem } from "../src/data/shopItems.js";

function setup(n = 4, { level = 2, seed = 31, tags = [] } = {}) {
  const state = createNewGame(seed);
  state.samsarites = [];
  state.spaceLevel = level;
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, "C");
    s.tags = i === 0 ? [...tags] : [];
    s.stats.power = 30;
    state.samsarites.push(s);
  }
  return state;
}
const ev = (id) => DRAMA_EVENTS.find((e) => e.id === id);

test("事件池：至少 24 則，bond 15 : friction 6 : melee 3，每則至少 3 個文案版本", () => {
  assert.ok(DRAMA_EVENTS.length >= 24);
  assert.deepEqual([eventsOfGroup("bond").length, eventsOfGroup("friction").length, eventsOfGroup("melee").length], [15, 6, 3]);
  assert.equal(new Set(DRAMA_EVENTS.map((e) => e.id)).size, DRAMA_EVENTS.length, "id 不重複");
  for (const e of DRAMA_EVENTS) assert.ok(e.texts.length >= 3, `${e.id} 版本太少`);
});

test("所有事件文案都能填滿：沒有殘留 {欄位}、? 或 undefined", () => {
  const vars = { A: { name: "甲" }, B: { name: "乙" }, C: { name: "丙" }, n: 3, amount: 120 };
  for (const e of DRAMA_EVENTS) {
    for (const t of e.texts) {
      const out = renderTemplate(t, vars, "seed");
      assert.ok(!/[{}?]|undefined/.test(out), `${e.id}：${out}`);
    }
  }
});

test("群組權重嚴格 5 : 2 : 1（獨立亂數流抽 16000 次）", () => {
  const state = setup(2);
  const rng = squadRng(state);
  const n = { bond: 0, friction: 0, melee: 0 };
  for (let i = 0; i < 16000; i++) n[pickGroup(rng)] += 1;
  assert.ok(Math.abs(n.bond / 16000 - 5 / 8) < 0.02, JSON.stringify(n));
  assert.ok(Math.abs(n.friction / 16000 - 2 / 8) < 0.02, JSON.stringify(n));
  assert.ok(Math.abs(n.melee / 16000 - 1 / 8) < 0.02, JSON.stringify(n));
  assert.deepEqual(CONFIG.drama.groupWeights, { bond: 5, friction: 2, melee: 1 });
});

test("生死搭檔：雙向淨好感 >= 65 才有資格；結成後同隊戰力 +4%，拆開隊就沒有", () => {
  const state = setup(3);
  const [a, b, c] = state.samsarites;
  assert.equal(playable(state, "bond", state.samsarites, "day").some((o) => o.ev.id === "life_death_pact"), false);
  shiftAffinity(state, a, b, 70);
  shiftAffinity(state, b, a, 70);
  const opt = playable(state, "bond", state.samsarites, "day").find((o) => o.ev.id === "life_death_pact");
  assert.ok(opt);
  const cast = opt.casts[0];
  applyEvent(state, ev("life_death_pact"), cast, state.samsarites);
  assert.equal(a.bondPartnerId, b.id);
  assert.equal(b.bondPartnerId, a.id);
  const single = effectivePower(a) + effectivePower(b);
  assert.ok(partyPower([a, b]) > single);
  assert.equal(partyPower([a, b]), (effectivePower(a) + effectivePower(b)) * 1.04);
  assert.equal(partyPower([a, c]), effectivePower(a) + effectivePower(c));
  assert.ok(state.chronicles.some((x) => x.kind === "drama"));
  // 已結搭檔的不會再被選去結搭檔
  assert.equal(playable(state, "bond", state.samsarites, "day").some((o) => o.ev.id === "life_death_pact"), false);
});

test("老鳥指導菜鳥：菜鳥理智回復、雙向好感上升", () => {
  const state = setup(2);
  const [vet, rookie] = state.samsarites;
  vet.stats.power = 90;
  rookie.stats.sanity = 60;
  const opt = playable(state, "bond", state.samsarites, "day").find((o) => o.ev.id === "mentor_train");
  assert.ok(opt);
  applyEvent(state, ev("mentor_train"), opt.casts[0], state.samsarites);
  assert.equal(rookie.stats.sanity, 70);
  assert.ok(affinity(state, rookie, vet) > affinity(state, vet, rookie));
});

test("共產隊批鬥大會：私藏小金庫者被充公 50% 入互助金，其餘人對他好感下降；只有共產流會發生", () => {
  const state = setup(3, { tags: ["lecturer"] });
  appointCaptain(state, state.samsarites[0].id);
  assert.equal(styleOf(state), "communal");
  const [, a, b] = state.samsarites;
  a.wallet = 500;
  const opt = playable(state, "friction", state.samsarites, "day").find((o) => o.ev.id === "struggle_session");
  assert.ok(opt);
  applyEvent(state, ev("struggle_session"), opt.casts.find((c) => c.A.id === a.id), state.samsarites);
  assert.equal(a.wallet, 250);
  assert.equal(state.squad.communalFund, 250);
  assert.equal(affinity(state, b, a), -4);
  assert.equal(a.stats.sanity, 92);
  // 其他流派：不會發生
  const other = setup(3);
  other.samsarites[1].wallet = 500;
  assert.equal(playable(other, "friction", other.samsarites, "day").some((o) => o.ev.id === "struggle_session"), false);
});

test("菁英隊強者嘲諷弱者：只在戰力差 >= 30% 時發生，弱者理智 -6、對強者仇恨 +8", () => {
  const state = setup(3, { tags: ["demon_path"] });
  state.samsarites[0].stats.power = 60;
  appointCaptain(state, state.samsarites[0].id);
  assert.equal(styleOf(state), "elite");
  assert.equal(playable(setup(3), "friction", state.samsarites, "day").some((o) => o.ev.id === "elite_taunt"), false, "別的流派不會發生");
  assert.equal(playable(state, "friction", state.samsarites, "day").some((o) => o.ev.id === "elite_taunt"), true);
  const [cap, , weak] = state.samsarites;
  const opt = playable(state, "friction", state.samsarites, "day").find((o) => o.ev.id === "elite_taunt");
  applyEvent(state, ev("elite_taunt"), opt.casts[0], state.samsarites);
  assert.equal(opt.casts[0].A.id, cap.id);
  assert.equal(opt.casts[0].B.stats.sanity, 94);
  assert.ok(affinity(state, opt.casts[0].B, cap) < 0 && weak);
});

test("黑貨事發對質：翻出 12 天內的黑貨紀錄，被害者對使用者淨好感大跌，紀錄標記已揭發", () => {
  const state = setup(3);
  const [a, b] = state.samsarites;
  noteContraband(state, a, b, getShopItem("t3_38"));
  const opt = playable(state, "friction", state.samsarites, "day").find((o) => o.ev.id === "contraband_exposed");
  assert.ok(opt);
  applyEvent(state, ev("contraband_exposed"), opt.casts[0], state.samsarites);
  assert.equal(affinity(state, b, a), -25);
  assert.equal(affinity(state, a, b), -15);
  assert.equal(state.squad.contraband[0].exposed, true);
  assert.equal(playable(state, "friction", state.samsarites, "day").some((o) => o.ev.id === "contraband_exposed"), false, "已揭發的不會再演");
  // 超過 12 天的舊紀錄不翻
  const old = setup(3);
  noteContraband(old, old.samsarites[0], old.samsarites[1], getShopItem("t3_38"));
  old.tick += CONFIG.ticksPerDay * 20;
  assert.equal(playable(old, "friction", old.samsarites, "day").some((o) => o.ev.id === "contraband_exposed"), false);
});

test("造人泥替身被本尊撞破：只有用過捏造人偶才演；使用者理智 -10、被害者對他仇恨 +20", () => {
  const state = setup(3);
  const [a, b] = state.samsarites;
  noteContraband(state, a, b, getShopItem("t3_38"));
  const opt = playable(state, "melee", state.samsarites, "day").find((o) => o.ev.id === "doll_exposed");
  assert.ok(opt);
  applyEvent(state, ev("doll_exposed"), opt.casts[0], state.samsarites);
  assert.equal(a.stats.sanity, 90);
  assert.ok(affinity(state, b, a) <= -40);
  const none = setup(3);
  noteContraband(none, none.samsarites[0], none.samsarites[1], getShopItem("drama_charm_t1") ?? { id: "other_item" });
  assert.equal(playable(none, "melee", none.samsarites, "day").some((o) => o.ev.id === "doll_exposed"), false);
});

test("噬主夜襲：>= 2 名淨好感 <= -40 的成員才會合謀；成功重創隊長並奪權，失敗反遭重傷", () => {
  const state = setup(4, { tags: ["smiling_tiger"] });
  appointCaptain(state, state.samsarites[0].id);
  const [cap, x, y, z] = state.samsarites;
  assert.equal(playable(state, "melee", state.samsarites, "day").some((o) => o.ev.id === "coup_night"), false);
  shiftAffinity(state, x, cap, -45);
  assert.equal(playable(state, "melee", state.samsarites, "day").some((o) => o.ev.id === "coup_night"), false, "只有 1 人不夠");
  shiftAffinity(state, y, cap, -45);
  const opt = playable(state, "melee", state.samsarites, "day").find((o) => o.ev.id === "coup_night");
  assert.ok(opt);
  assert.deepEqual(opt.casts[0].list.map((s) => s.id).sort(), [x.id, y.id].sort());

  // 成功：陰謀者戰力壓倒性強
  x.stats.power = 5000;
  y.stats.power = 5000;
  applyEvent(state, ev("coup_night"), opt.casts[0], state.samsarites);
  assert.ok(cap.injury >= 2);
  assert.equal(captainOf(state).id, x.id, "領頭者奪權");
  assert.ok(state.chronicles.some((c) => c.kind === "coup"));

  // 失敗：陰謀者極弱
  const f = setup(4, { tags: ["smiling_tiger"] });
  appointCaptain(f, f.samsarites[0].id);
  const [c2, p, q] = f.samsarites;
  c2.stats.power = 100000;
  shiftAffinity(f, p, c2, -50);
  shiftAffinity(f, q, c2, -50);
  const opt2 = playable(f, "melee", f.samsarites, "day").find((o) => o.ev.id === "coup_night");
  applyEvent(f, ev("coup_night"), opt2.casts[0], f.samsarites);
  assert.ok(p.injury >= 2 && q.injury >= 2);
  assert.equal(captainOf(f).id, c2.id);
});

test("三角暗戀修羅場：兩人都愛第三人（淨好感 >= 45）才演，雙方互生仇恨", () => {
  const state = setup(3);
  const [a, b, c] = state.samsarites;
  assert.equal(playable(state, "melee", state.samsarites, "day").some((o) => o.ev.id === "love_triangle"), false);
  shiftAffinity(state, a, b, 60);
  shiftAffinity(state, c, b, 60);
  const opt = playable(state, "melee", state.samsarites, "day").find((o) => o.ev.id === "love_triangle");
  assert.ok(opt);
  applyEvent(state, ev("love_triangle"), opt.casts[0], state.samsarites);
  assert.ok(affinity(state, opt.casts[0].A, opt.casts[0].C) < 0);
});

test("抽到修羅場但現在演不了 → 退回熱血羈絆（不會空轉）；事件不動主亂數，冷卻中的組合不重演", () => {
  const state = setup(3);
  const main = state.rngState;
  const r = runDrama(state, state.samsarites, "day", "melee");
  assert.ok(r && r.ev.group === "bond");
  assert.equal(state.rngState, main, "只用獨立亂數流");
  const cd = Object.keys(state.cooldowns).filter((k) => k.startsWith("drama:"));
  assert.equal(cd.length, 1);
  // 兩人池、同一對連演：冷卻擋住
  const two = setup(2);
  const first = runDrama(two, two.samsarites, "day", "bond");
  assert.ok(first);
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    const x = runDrama(two, two.samsarites, "day", "bond");
    if (x) seen.add(`${x.ev.id}:${x.cast.A.id}`);
  }
  assert.ok(seen.size < 60);
});

test("每日人際事件：隊長系統沒啟用（空間 Lv.1）不演；啟用後約 25% 機率", () => {
  const lv1 = setup(3, { level: 1 });
  for (let i = 0; i < 40; i++) assert.equal(dailyDrama(lv1), null);
  const state = setup(4);
  let n = 0;
  for (let i = 0; i < 400; i++) {
    state.cooldowns = {};
    if (dailyDrama(state)) n += 1;
  }
  assert.ok(n > 400 * 0.18 && n < 400 * 0.32, `觸發 ${n}/400`);
  // 慶功宴只在副本結算穿插
  assert.equal(playable(state, "bond", state.samsarites, "day").some((o) => o.ev.id === "victory_feast"), false);
  assert.equal(playable(state, "bond", state.samsarites, "run").some((o) => o.ev.id === "victory_feast"), true);
  setInjury(state.samsarites[0], 0);
});
