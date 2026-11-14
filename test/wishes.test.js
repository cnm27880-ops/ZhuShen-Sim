// Phase 3-B：許願系統（許願產生、答應／拒絕／超時、4 種完成條件、心情效果、存檔）
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG, PAUSE_EVENTS } from "../src/data/config.js";
import { WISHES } from "../src/data/wishes.js";
import { LOGS } from "../src/data/logs.js";
import { getDungeon } from "../src/data/dungeons.js";
import { createNewGame, createSamsarite, advanceTick, killSamsarite, serialize, deserialize } from "../src/engine/core.js";
import {
  maybeWish,
  acceptWish,
  refuseWish,
  checkAccept,
  dailyWishes,
  wishesAfterRun,
  pendingWishes,
  wishesOf,
  isOnVacation,
} from "../src/engine/wishes.js";
import { buyItem } from "../src/engine/shop.js";
import { getShopItem } from "../src/data/shopItems.js";
import { effectivePower, moodPassBonus } from "../src/engine/tags.js";
import { roomPassRate, startRun } from "../src/engine/dungeon.js";
import { autoCandidates } from "../src/engine/dispatch.js";

const ghost = getDungeon("ghost_village");

function setup(n = 1) {
  const state = createNewGame(7);
  state.points = 100000;
  state.samsarites = [];
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, "C");
    s.tags = [];
    state.samsarites.push(s);
  }
  return { state, s: state.samsarites[0] };
}

/** 強制讓 s 許某一種願（暫時把機率設成 100%、其他種類權重設成 0，用完還原） */
function forceWish(state, s, kind) {
  const saved = JSON.stringify(CONFIG.wish);
  CONFIG.wish.chance = 1;
  for (const k of Object.keys(CONFIG.wish.kinds)) CONFIG.wish.kinds[k].weight = k === kind ? 1 : 0;
  try {
    assert.equal(maybeWish(state, s), true);
  } finally {
    Object.assign(CONFIG.wish, JSON.parse(saved));
    for (const k of Object.keys(CONFIG.wish.kinds)) Object.assign(CONFIG.wish.kinds[k], JSON.parse(saved).kinds[k]);
  }
  return wishesOf(state, s.id)[0];
}

/** 過 n 天（只跑許願的每日結算，不走其他事件） */
function passDays(state, n) {
  for (let i = 0; i < n; i++) {
    state.tick += CONFIG.ticksPerDay;
    dailyWishes(state);
  }
}

test("許願資料表：每種都有 config 數字與日誌模板；wish 是暫停事件、預設開", () => {
  assert.equal(PAUSE_EVENTS.wish.default, true);
  for (const w of WISHES) {
    assert.ok(CONFIG.wish.kinds[w.id], `${w.id} 缺 CONFIG.wish.kinds`);
    assert.ok(LOGS[`wishAsk_${w.id}`]?.length >= 2, `${w.id} 缺 wishAsk 模板`);
    assert.ok(LOGS[`wishDone_${w.id}`]?.length >= 2, `${w.id} 缺 wishDone 模板`);
    assert.ok(["pay", "rest", "dungeon", "gear"].includes(w.mode));
  }
});

test("許願：產生 pending 許願、發出 wish 事件；每人同時最多 1 個；在副本中不許願", () => {
  const { state, s } = setup(2);
  const w = forceWish(state, s, "eat");
  assert.equal(w.status, "pending");
  assert.equal(w.deadlineDay, w.createdDay + CONFIG.wish.kinds.eat.days);
  assert.ok(w.params.cost >= CONFIG.wish.kinds.eat.cost[0] && w.params.cost <= CONFIG.wish.kinds.eat.cost[1]);
  assert.ok(state.events.some((e) => e.type === "wish" && e.wishId === w.id));
  assert.ok(!w.text.includes("?"), "日誌不該有沒填到的欄位");
  assert.equal(pendingWishes(state).length, 1);
  CONFIG.wish.chance = 1;
  assert.equal(maybeWish(state, s), false, "已經有許願就不再許");
  const other = state.samsarites[1];
  other.location = "dungeon";
  assert.equal(maybeWish(state, other), false, "副本中不許願");
  CONFIG.wish.chance = 0.4;
});

test("想吃好的：答應當下扣積分並完成 → 高興；積分不夠不能答應", () => {
  const { state, s } = setup();
  const w = forceWish(state, s, "eat");
  const before = state.points;
  assert.deepEqual(acceptWish(state, w.id), { ok: true });
  assert.equal(state.points, before - w.params.cost);
  assert.equal(state.wishes.length, 0);
  assert.equal(s.mood.kind, "happy");
  assert.equal(s.mood.daysLeft, CONFIG.wish.moods.happy.days);

  const t = setup();
  const w2 = forceWish(t.state, t.s, "eat");
  t.state.points = CONFIG.space.debtLimit[0] + 1;
  assert.equal(checkAccept(t.state, w2).ok, false);
  assert.equal(acceptWish(t.state, w2.id).ok, false);
  assert.equal(t.state.wishes.length, 1, "沒答應成功，許願還在");
});

test("拒絕：不爽（理智 -N、戰力 -10%），許願移除", () => {
  const { state, s } = setup();
  const base = effectivePower(s);
  const w = forceWish(state, s, "eat");
  const pts = state.points;
  refuseWish(state, w.id);
  assert.equal(state.points, pts, "拒絕不花錢");
  assert.equal(s.mood.kind, "upset");
  assert.equal(s.stats.sanity, 100 - CONFIG.wish.moods.upset.sanityLoss);
  assert.equal(effectivePower(s), Math.round(s.stats.power * (1 + CONFIG.wish.moods.upset.powerPct)));
  assert.ok(effectivePower(s) < base);
  assert.equal(state.wishes.length, 0);
  assert.equal(refuseWish(state, w.id).ok, false, "不能重複處理");
});

test("超時：沒回覆的許願到期算失敗 → 不爽；期限內不會失敗", () => {
  const { state, s } = setup();
  const w = forceWish(state, s, "eat");
  passDays(state, CONFIG.wish.kinds.eat.days - 1);
  assert.equal(state.wishes.length, 1, "還沒到期");
  passDays(state, 1);
  assert.equal(state.wishes.length, 0);
  assert.equal(s.mood.kind, "upset");
  assert.ok(state.log.some((l) => l.type === "wishFail"));
  assert.ok(w);
});

test("想放假：答應後不能派遣（手動／自動）、休完算完成 → 高興", () => {
  const { state, s } = setup(2);
  const w = forceWish(state, s, "vacation");
  const rest = w.params.rest;
  assert.ok(rest >= CONFIG.wish.kinds.vacation.restDays[0] && rest <= CONFIG.wish.kinds.vacation.restDays[1]);
  acceptWish(state, w.id);
  assert.equal(isOnVacation(s), true);
  assert.equal(startRun(state, "ghost_village", [s.id]).ok, false);
  assert.ok(!autoCandidates(state).includes(s));
  assert.ok(autoCandidates(state).includes(state.samsarites[1]));
  passDays(state, rest - 1);
  assert.equal(isOnVacation(s), true);
  assert.equal(s.mood, null);
  passDays(state, 1);
  assert.equal(isOnVacation(s), false);
  assert.equal(s.mood.kind, "happy");
  assert.equal(state.wishes.length, 0);
  assert.equal(startRun(state, "ghost_village", [s.id]).ok, true);
});

test("想去副本：只會選推薦戰力不超過上限的副本；通關完成、沒通關失敗、死了取消", () => {
  const { state, s } = setup(3);
  const w = forceWish(state, s, "dungeon");
  const did = w.params.dungeonId; // Phase 4-A 起上限內有霧隱荒村（R 90）與沉默方舟號（R 130）
  assert.ok(["ghost_village", "silent_ark"].includes(did), did);
  assert.ok(getDungeon(did).recommendedPower <= CONFIG.wish.dungeonPowerCap);
  acceptWish(state, w.id);
  assert.equal(w.status, "active");
  // 他沒出征 → 不結算
  wishesAfterRun(state, did, true, [state.samsarites[1].id], [state.samsarites[1].id]);
  assert.equal(state.wishes.length, 1);
  wishesAfterRun(state, did, true, [s.id], [s.id]);
  assert.equal(state.wishes.length, 0);
  assert.equal(s.mood.kind, "happy");

  const b = state.samsarites[1];
  const w2 = forceWish(state, b, "dungeon");
  acceptWish(state, w2.id);
  wishesAfterRun(state, w2.params.dungeonId, false, [b.id], [b.id]);
  assert.equal(b.mood.kind, "upset");

  const c = state.samsarites[2];
  const w3 = forceWish(state, c, "dungeon");
  acceptWish(state, w3.id);
  killSamsarite(state, c, "測試");
  assert.equal(state.wishes.length, 0, "死了就取消許願");
});

test("想要裝備：只許已解鎖階層、沒穿著的裝備；幫他買下才算完成，買別的不算", () => {
  const { state, s } = setup();
  const w = forceWish(state, s, "gear");
  const item = w.params.itemId;
  assert.ok(item);
  acceptWish(state, w.id);
  buyItem(state, "t1_28", s.id);
  assert.equal(state.wishes.length, 1);
  assert.equal(buyItem(state, item, s.id).ok, true);
  assert.equal(state.wishes.length, 0);
  assert.equal(s.mood.kind, "happy");
  // 已穿著的不會再許
  for (let i = 0; i < 20; i++) {
    const t = setup();
    t.s.gear = { weapon: "t1_01" };
    const made = forceWish(t.state, t.s, "gear");
    assert.notEqual(made.params.itemId, "t1_01", "已穿著的不會再許");
    assert.equal(getShopItem(made.params.itemId).tier, 1, "Tier 2 以上還沒解鎖");
  }
});

test("心情效果：高興加通過率（有上限）、不爽減戰力；到期自動消失", () => {
  const { state } = setup(4);
  const party = state.samsarites;
  const base = roomPassRate(state, party, ghost);
  party[0].mood = { kind: "happy", daysLeft: 2 };
  assert.ok(Math.abs(moodPassBonus(party) - CONFIG.wish.moods.happy.passBonus) < 1e-9);
  assert.ok(roomPassRate(state, party, ghost) > base);
  for (const s of party) s.mood = { kind: "happy", daysLeft: 2 };
  assert.ok(moodPassBonus(party) <= CONFIG.wish.moodPassCap + 1e-9);
  passDays(state, 1);
  assert.equal(party[0].mood.daysLeft, 1);
  passDays(state, 1);
  assert.equal(party[0].mood, null);
  assert.equal(moodPassBonus(party), 0);
});

test("整合：每日行動骰會產生許願（機率拉高時）；存檔讀檔保留許願，舊存檔補預設值", () => {
  const { state } = setup(3);
  CONFIG.wish.chance = 1;
  CONFIG.relations.dailyRoll.work = 0;
  CONFIG.relations.dailyRoll.social = 0; // 每天都是特殊事件
  try {
    state.tick = CONFIG.ticksPerDay * 1 - 1;
    advanceTick(state);
  } finally {
    CONFIG.wish.chance = 0.4;
    CONFIG.relations.dailyRoll.work = 0.5;
    CONFIG.relations.dailyRoll.social = 0.3;
  }
  assert.ok(state.wishes.length >= 1, "至少有人許願");
  const loaded = deserialize(serialize(state));
  assert.deepEqual(loaded.wishes, state.wishes);

  const old = JSON.parse(serialize(state));
  delete old.wishes;
  delete old.nextWishId;
  for (const x of old.samsarites) {
    delete x.mood;
    delete x.vacationDays;
  }
  delete old.settings.pauseOn.wish;
  const migrated = deserialize(JSON.stringify(old));
  assert.deepEqual(migrated.wishes, []);
  assert.equal(migrated.nextWishId, 1);
  assert.equal(migrated.samsarites[0].mood, null);
  assert.equal(migrated.samsarites[0].vacationDays, 0);
  assert.equal(migrated.settings.pauseOn.wish, true);
});
