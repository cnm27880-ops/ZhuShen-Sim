// 輪迴者個性系統 v1a：隱藏五軸的雜湊產生、舊存檔補欄位、個性事件（獨立亂數流、效果上限、不動對隊長好感）、側寫揭露與原型
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/data/config.js";
import { LOGS } from "../src/data/logs.js";
import { TRAIT_AXES, PROFILE_LINES, ARCHETYPES, TAG_TRAIT_BIAS } from "../src/data/personality.js";
import { TRAIT_EVENTS, TRAIT_DUETS } from "../src/data/traitEvents.js";
import { createNewGame, createSamsarite, advanceTick, serialize, deserialize } from "../src/engine/core.js";
import { rawTraitScore, rollTraits, archetypeOf, traitProfile, ensureTraits } from "../src/engine/personality.js";
import { playTraitEvent, dailyTraits, playTraitDuet, dailyTraitDuets } from "../src/engine/traitEvents.js";
import { addLove, getRel, affinity } from "../src/engine/relations.js";
import { appointCaptain } from "../src/engine/squad.js";

function setup(n, seed = 5) {
  const state = createNewGame(seed);
  state.samsarites = [];
  const people = [];
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, "C");
    s.tags = [];
    state.samsarites.push(s);
    people.push(s);
  }
  return { state, people };
}
const ev = (id) => TRAIT_EVENTS.find((e) => e.id === id);

test("五條軸都在 -100～100，同種子同 id 永遠同一組（可重現）", () => {
  const a = setup(5, 11);
  const b = setup(5, 11);
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(a.people[i].traits, b.people[i].traits);
    for (const axis of TRAIT_AXES) assert.ok(Math.abs(a.people[i].traits[axis]) <= 100);
  }
  const c = setup(5, 12);
  assert.notDeepEqual(a.people.map((s) => s.traits), c.people.map((s) => s.traits));
});

test("建立輪迴者不消耗主亂數（個性只靠雜湊）", () => {
  const state = createNewGame(7);
  const before = state.rngState;
  const spare = createNewGame(7);
  spare.rngState = before;
  const x = createSamsarite(state, "C");
  const y = createSamsarite(spare, "C");
  assert.equal(state.rngState, spare.rngState);
  assert.deepEqual(x.traits, y.traits);
});

test("分佈：近似常態，至少一軸 |x|≥60 約 10～20%，單軸 |x|≥40 約 10～20%", () => {
  let n = 0, extreme = 0, mid = 0;
  for (let id = 1; id <= 4000; id++) {
    let ex = false;
    for (const axis of TRAIT_AXES) {
      const v = Math.abs(rawTraitScore(99, id, axis));
      if (v >= 60) ex = true;
      if (v >= 40) mid++;
      n++;
    }
    if (ex) extreme++;
  }
  const exRate = extreme / 4000;
  const midRate = mid / n;
  assert.ok(exRate > 0.1 && exRate < 0.22, `極端比例 ${exRate}`);
  assert.ok(midRate > 0.1 && midRate < 0.2, `特色比例 ${midRate}`);
});

test("詞條偏移：恐怖片作死專家膽識偏高、背刺成癮者利他偏低；偏移倍率 0 時等於原始分數", () => {
  const state = createNewGame(3);
  let sumFool = 0, sumBack = 0, sumPlain = 0;
  for (let id = 1; id <= 400; id++) {
    sumFool += rollTraits(state, { id, tags: ["horror_fool"] }).courage;
    sumBack += rollTraits(state, { id, tags: ["backstabber"] }).altruism;
    sumPlain += rollTraits(state, { id, tags: [] }).courage;
  }
  assert.ok(sumFool / 400 > sumPlain / 400 + 15);
  assert.ok(sumBack / 400 < -15);
  const old = CONFIG.personality.tagBias;
  CONFIG.personality.tagBias = 0;
  try {
    const plain = rollTraits(state, { id: 9, tags: [] });
    assert.deepEqual(rollTraits(state, { id: 9, tags: ["horror_fool", "backstabber"] }), plain);
  } finally {
    CONFIG.personality.tagBias = old;
  }
  for (const t of Object.keys(TAG_TRAIT_BIAS)) assert.ok(typeof t === "string");
});

test("舊存檔讀檔：補上個性欄位、同一套雜湊、不壞檔；有的人不被覆蓋", () => {
  const { state, people } = setup(3, 21);
  const keep = JSON.stringify(people[1].traits);
  const old = JSON.parse(serialize(state));
  delete old.trait;
  for (const s of old.samsarites) {
    delete s.traits;
    delete s.traitSeen;
    delete s.traitEventLast;
  }
  const loaded = deserialize(JSON.stringify(old));
  assert.ok(loaded.trait && Number.isInteger(loaded.trait.rngState));
  assert.deepEqual(loaded.samsarites[1].traits, people[1].traits); // 同種子＋id → 補出來和原本一樣
  assert.equal(JSON.stringify(loaded.samsarites[1].traits), keep);
  assert.deepEqual(loaded.samsarites[0].traitSeen, []);
  // 沒有種子碼的舊存檔也能補（用固定字串）
  const legacy = JSON.parse(serialize(state));
  legacy.seed = null;
  for (const s of legacy.samsarites) delete s.traits;
  const l2 = deserialize(JSON.stringify(legacy));
  for (const s of l2.samsarites) assert.ok(TRAIT_AXES.every((a) => Math.abs(s.traits[a]) <= 100));
});

test("個性事件：揭露側寫、寫進大事記、不動主亂數與數字", () => {
  const { state, people: [a, b] } = setup(2, 31);
  a.traits.altruism = 80;
  a.wallet = 200;
  b.wallet = 0;
  b.stats.sanity = 40;
  const main = state.rngState;
  const r = playTraitEvent(state, a, ev("shareMed"));
  assert.ok(r.ok);
  assert.equal(state.rngState, main);
  assert.equal(a.wallet, 190);
  assert.equal(b.wallet, 10);
  assert.equal(b.stats.sanity, 42);
  assert.ok(getRel(state, b, a).love >= 3);
  assert.equal(a.traitSeen.length, 1);
  assert.equal(a.traitSeen[0].axis, "altruism");
  assert.ok(a.life.at(-1).text.startsWith("性格側寫："));
  assert.ok(state.log.some((l) => l.type === "trait"));
  assert.ok(!/\?/.test(state.log.at(-1).text), "日誌欄位都有填");
});

test("條件不符不發生：沒錢給、沒有對象、隊長當主角不會結仇", () => {
  const { state, people: [a, b] } = setup(2, 33);
  a.wallet = 5;
  assert.equal(playTraitEvent(state, a, ev("shareMed")).ok, false); // 錢不夠
  b.stats.sanity = 100;
  a.wallet = 200;
  assert.equal(playTraitEvent(state, a, ev("shareMed")).ok, false); // 沒有需要幫助的人
  assert.equal(playTraitEvent(state, a, ev("fee")).ok, false); // 對象私房錢不到門檻
  b.wallet = 100;
  assert.equal(playTraitEvent(state, a, ev("fee")).ok, true);
  assert.equal(a.wallet, 208);
  // 隊長當主角：有 targetHate 的事件不發生；對象排除隊長
  state.spaceLevel = 2;
  appointCaptain(state, a.id, true);
  b.wallet = 100;
  assert.equal(playTraitEvent(state, a, ev("fee")).ok, false);
  assert.equal(playTraitEvent(state, b, ev("scheme")).ok, false); // 唯一的其他人是隊長，被排除
});

test("對隊長的好感永遠不受個性事件影響", () => {
  const { state, people: [a, b, c] } = setup(3, 35);
  state.spaceLevel = 2;
  appointCaptain(state, c.id, true);
  for (const s of [a, b]) {
    s.wallet = 500;
    s.traits.ambition = 90;
    s.traits.social = 90;
    s.traits.courage = 90;
  }
  const before = [getRel(state, a, c).love, getRel(state, a, c).hate, getRel(state, b, c).love, getRel(state, b, c).hate];
  for (const id of ["scheme", "dare", "invite", "fee"]) {
    playTraitEvent(state, a, ev(id));
    playTraitEvent(state, b, ev(id));
  }
  assert.deepEqual([getRel(state, a, c).love, getRel(state, a, c).hate, getRel(state, b, c).love, getRel(state, b, c).hate], before);
});

test("扣理智不會低於安全線（不會誘發暴走），也不會超過 100", () => {
  const { state, people: [a] } = setup(1, 37);
  a.stats.sanity = 2;
  playTraitEvent(state, a, ev("overtime"));
  assert.equal(a.stats.sanity, CONFIG.personality.sanityFloor);
  a.stats.sanity = 99;
  playTraitEvent(state, a, ev("slack"));
  assert.equal(a.stats.sanity, 100);
});

test("每日結算：只在符合維度時發生；事件對應該軸正負；冷卻生效；個性亂數流獨立", () => {
  const { state, people: [a, b] } = setup(2, 41);
  state.settings.autoDispatch = false;
  CONFIG.personality.eventChance = 1; // 測試用：必定擲中
  try {
    for (const axis of TRAIT_AXES) { a.traits[axis] = 0; b.traits[axis] = 0; }
    const main = state.rngState;
    dailyTraits(state);
    assert.equal(state.traitEventCount ?? 0, 0);
    assert.equal(a.traitSeen.length + b.traitSeen.length, 0); // 沒有特色就沒有事件
    a.traits.social = -90; // 孤僻 → hermit
    dailyTraits(state);
    assert.equal(a.traitSeen.length, 1);
    assert.equal(a.traitSeen[0].axis, "social");
    assert.equal(a.traitSeen[0].sign, -1);
    assert.equal(state.rngState, main); // 主亂數沒動
    dailyTraits(state);
    assert.equal(a.traitSeen.length, 1); // 個人冷卻
  } finally {
    CONFIG.personality.eventChance = 0.03;
  }
});

test("原型：揭露不夠不顯示；夠了依最大軸；最大軸沒特色是普通人；畫面資料沒有數字", () => {
  const { state, people: [a] } = setup(1, 45);
  a.traits = { altruism: 10, ambition: -85, courage: 20, social: 0, obedience: -5 };
  assert.equal(archetypeOf(a), null);
  for (let i = 0; i < CONFIG.personality.archetypeAfter; i++) a.traitSeen.push({ day: i + 1, axis: "ambition", sign: -1, text: `句${i}` });
  assert.equal(archetypeOf(a), ARCHETYPES.ambition[-1]);
  a.traits = { altruism: 10, ambition: -20, courage: 20, social: 0, obedience: -5 };
  assert.equal(archetypeOf(a), "普通人");
  const p = traitProfile(a);
  assert.equal(p.seen.length, CONFIG.personality.archetypeAfter);
  assert.ok(!/\d{2,}/.test(JSON.stringify(p.seen.map((e) => e.text)))); // 側寫句不含數字
  assert.ok(!("traits" in p));
});

test("資料表完整：每個事件有日誌句、每個軸每端有 3 句側寫、原型齊全", () => {
  for (const e of TRAIT_EVENTS) {
    assert.ok(LOGS[`trait_${e.id}`]?.length >= 2, e.id);
    assert.ok(TRAIT_AXES.includes(e.axis) && (e.sign === 1 || e.sign === -1));
  }
  for (const axis of TRAIT_AXES) {
    for (const sign of [1, -1]) {
      assert.ok(PROFILE_LINES[axis][sign].length >= 3);
      assert.ok(ARCHETYPES[axis][sign]);
      assert.ok(TRAIT_EVENTS.some((e) => e.axis === axis && e.sign === sign), `${axis}${sign} 沒有事件`);
    }
  }
  const state = createNewGame(1);
  assert.equal(state.samsarites.length, CONFIG.startingSamsarites);
  for (const s of state.samsarites) ensureTraits(state, s);
});

test("跑多天不會壞：個性事件有發生、理智與私房錢不出現 NaN／負數", () => {
  const state = createNewGame(51);
  for (const s of state.samsarites) s.wallet = 300;
  CONFIG.personality.eventChance = 0.5;
  try {
    for (let i = 0; i < CONFIG.ticksPerDay * 40; i++) advanceTick(state);
  } finally {
    CONFIG.personality.eventChance = 0.03;
  }
  for (const s of state.samsarites) {
    assert.ok(Number.isFinite(s.stats.sanity) && s.stats.sanity >= 0 && s.stats.sanity <= 100);
    assert.ok(s.wallet >= 0);
  }
  assert.ok(state.samsarites.some((s) => s.traitSeen.length > 0) || state.log.some((l) => l.type === "trait"));
});

// ───────── 個性系統 v1b ③：雙人碰撞事件 ─────────
const duet = (id) => TRAIT_DUETS.find((e) => e.id === id);
const flat = (...ps) => ps.forEach((s) => TRAIT_AXES.forEach((ax) => (s.traits[ax] = 0)));
const setTraits = (s, o) => Object.assign(s.traits, o);

test("雙人事件資料表完整：6 個、每個有 3 句日誌、軸與正負合法、涵蓋五條軸", () => {
  assert.equal(TRAIT_DUETS.length, 6);
  const axes = new Set();
  for (const e of TRAIT_DUETS) {
    assert.ok(LOGS[`trait_duet_${e.id}`]?.length >= 3, e.id);
    for (const side of [e.a, e.b]) {
      assert.ok(TRAIT_AXES.includes(side.axis) && (side.sign === 1 || side.sign === -1));
      axes.add(side.axis);
    }
  }
  assert.equal(axes.size, 5);
});

test("6 個雙人事件：條件符合時各自發生，效果與雙方揭露都正確", () => {
  const cases = [
    ["exploit", { altruism: -80 }, { altruism: 80 }],
    ["rivalry", { ambition: 80 }, { ambition: 80 }],
    ["routeClash", { courage: 80 }, { courage: -80 }],
    ["humility", { altruism: 80 }, { altruism: 80 }],
    ["dragOut", { social: 80 }, { social: -80 }],
    ["lecture", { obedience: 80 }, { obedience: -80 }],
  ];
  for (const [id, ta, tb] of cases) {
    const { state, people: [a, b] } = setup(2, 61);
    flat(a, b);
    setTraits(a, ta);
    setTraits(b, tb);
    a.wallet = 100;
    b.wallet = 100;
    a.stats.sanity = b.stats.sanity = 80;
    const e = duet(id);
    const affAB = affinity(state, a, b);
    const affBA = affinity(state, b, a);
    assert.equal(playTraitDuet(state, a, b, e).ok, true, id);
    assert.equal(a.stats.sanity, 80 + (e.fx.sanityA ?? 0), `${id} A 理智`);
    assert.equal(b.stats.sanity, 80 + (e.fx.sanityB ?? 0), `${id} B 理智`);
    assert.equal(a.wallet, 100 + (e.fx.take ?? 0));
    assert.equal(b.wallet, 100 - (e.fx.take ?? 0));
    assert.equal(affinity(state, a, b), affAB + (e.fx.loveAB ?? 0) - (e.fx.dropAB ?? 0), `${id} A→B`);
    assert.equal(affinity(state, b, a), affBA + (e.fx.loveBA ?? 0) - (e.fx.dropBA ?? 0) - (e.fx.hateBA ?? 0), `${id} B→A`);
    assert.equal(a.traitSeen.length, 1, `${id} A 揭露`);
    assert.equal(b.traitSeen.length, 1, `${id} B 揭露`);
    assert.equal(a.traitSeen[0].axis, e.a.axis);
    assert.equal(b.traitSeen[0].sign, e.b.sign);
    assert.ok(state.log.some((l) => l.type === "trait" && l.text.includes(a.name) && l.text.includes(b.name)), `${id} 日誌`);
  }
});

test("雙人事件不發生：條件不符、對象沒錢、同一人、不在空間", () => {
  const { state, people: [a, b] } = setup(2, 62);
  flat(a, b);
  setTraits(a, { altruism: -80 });
  setTraits(b, { altruism: 20 }); // 不夠利他
  a.wallet = b.wallet = 100;
  assert.equal(playTraitDuet(state, a, b, duet("exploit")).ok, false);
  setTraits(b, { altruism: 80 });
  b.wallet = 10; // 低於 minWallet
  assert.equal(playTraitDuet(state, a, b, duet("exploit")).ok, false);
  b.wallet = 100;
  assert.equal(playTraitDuet(state, a, a, duet("rivalry")).ok, false);
  b.location = "dungeon";
  assert.equal(playTraitDuet(state, a, b, duet("exploit")).ok, false);
});

test("雙人事件：隊長不當任何一方，隊長對所有人的好感與戰力都不變", () => {
  const { state, people: [a, b, c] } = setup(3, 63);
  state.spaceLevel = 2;
  appointCaptain(state, c.id, true);
  flat(a, b, c);
  for (const s of [a, b, c]) {
    s.wallet = 200;
    setTraits(s, { ambition: 90, altruism: 90, courage: 90, social: 90, obedience: 90 });
  }
  setTraits(b, { courage: -90, social: -90, obedience: -90, altruism: -90 });
  assert.equal(playTraitDuet(state, a, c, duet("rivalry")).ok, false);
  assert.equal(playTraitDuet(state, c, a, duet("rivalry")).ok, false);
  const snap = () => [a, b].flatMap((x) => [getRel(state, x, c), getRel(state, c, x)].map((r) => [r.love, r.hate]));
  const before = snap();
  const sanC = c.stats.sanity;
  for (const e of TRAIT_DUETS) {
    playTraitDuet(state, a, b, e);
    playTraitDuet(state, b, a, e);
  }
  assert.deepEqual(snap(), before, "和隊長的好感不變");
  assert.equal(c.stats.sanity, sanC);
  // 每日結算也不會讓隊長進場
  CONFIG.personality.duet.chance = 1;
  try {
    for (let d = 0; d < 20; d++) {
      state.tick += CONFIG.ticksPerDay;
      dailyTraitDuets(state);
    }
  } finally {
    CONFIG.personality.duet.chance = 0.02;
  }
  assert.deepEqual(snap(), before);
  assert.equal(c.traitSeen.length, 0);
});

test("雙人事件：沿用冷卻（個人 10 天、同事件 20 天），冷卻中不發生", () => {
  const { state, people: [a, b] } = setup(2, 64);
  state.settings.autoDispatch = false;
  flat(a, b);
  setTraits(a, { ambition: 90 });
  setTraits(b, { ambition: 90 });
  CONFIG.personality.duet.chance = 1;
  try {
    dailyTraitDuets(state);
    assert.equal(a.traitSeen.length + b.traitSeen.length, 2, "第一次發生，雙方各揭露一條");
    dailyTraitDuets(state);
    assert.equal(a.traitSeen.length + b.traitSeen.length, 2, "冷卻中不再發生");
    state.tick += CONFIG.ticksPerDay * (CONFIG.personality.eventCooldown + 1);
    dailyTraitDuets(state);
    assert.equal(a.traitSeen.length + b.traitSeen.length, 4, "冷卻過後恢復");
  } finally {
    CONFIG.personality.duet.chance = 0.02;
  }
});

test("雙人事件：不動主亂數與單人事件的亂數流，只動自己的 duetRngState", () => {
  const { state, people: [a, b] } = setup(2, 65);
  state.settings.autoDispatch = false;
  flat(a, b);
  setTraits(a, { ambition: 90 });
  setTraits(b, { ambition: 90 });
  const main = state.rngState;
  CONFIG.personality.duet.chance = 1;
  try {
    const single = state.trait?.rngState;
    dailyTraitDuets(state);
    assert.equal(state.rngState, main, "主亂數沒動");
    assert.equal(state.trait.rngState, single, "單人事件的亂數流沒動");
    assert.notEqual(state.trait.duetRngState, undefined);
  } finally {
    CONFIG.personality.duet.chance = 0.02;
  }
});

test("關閉雙人事件：跑 40 天完全不碰雙人事件的亂數流與日誌；開啟時狀態合法", () => {
  const run = (enabled) => {
    const state = createNewGame(66);
    for (const s of state.samsarites) s.wallet = 300;
    CONFIG.personality.eventChance = 0.5;
    CONFIG.personality.duet.enabled = enabled;
    try {
      for (let i = 0; i < CONFIG.ticksPerDay * 40; i++) advanceTick(state);
    } finally {
      CONFIG.personality.eventChance = 0.03;
      CONFIG.personality.duet.enabled = true;
    }
    return state;
  };
  const off = run(false);
  assert.equal(off.trait.duetRngState, undefined, "關閉時完全不碰雙人事件的亂數流");
  assert.ok(!off.log.some((l) => l.type === "trait" && /trait_duet/.test(l.text)));
  const on = run(true);
  for (const s of [...on.samsarites, ...off.samsarites]) {
    assert.ok(Number.isFinite(s.stats.sanity) && s.stats.sanity >= 0 && s.stats.sanity <= 100);
    assert.ok(s.wallet >= 0);
  }
});
