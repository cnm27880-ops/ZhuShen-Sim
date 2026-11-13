// Phase 2-B：關係系統測試（關係矩陣、每日互動、借刀殺人、死亡連鎖、副本內互相傷害）
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/data/config.js";
import { getDungeon } from "../src/data/dungeons.js";
import { SOCIAL_EVENTS, SCHEMES } from "../src/data/relations.js";
import { createNewGame, createSamsarite, setInjury, advanceTick, recycle, serialize, deserialize } from "../src/engine/core.js";
import { roomPassRate, startRun, stepRun } from "../src/engine/dungeon.js";
import { planAutoDispatch, areEnemies, step } from "../src/engine/dispatch.js";
import {
  getRel,
  addLove,
  addHate,
  pairLevel,
  pairStatus,
  partnerOf,
  partyRelationBonus,
  moodOf,
  socialWeight,
  runSocial,
  resolveConfession,
  runScheme,
  directAttack,
  punish,
  afterDeath,
  findProtector,
  pickClash,
} from "../src/engine/relations.js";

const easy = getDungeon("ghost_village");

/** 開一局、清空名單，再加 n 個沒有標籤的輪迴者（標籤會干擾亂數，測試要穩定就拿掉） */
function setup(n, rank = "C", seed = 7) {
  const state = createNewGame(seed);
  state.samsarites = [];
  const people = [];
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, rank);
    s.tags = [];
    state.samsarites.push(s);
    people.push(s);
  }
  return { state, people };
}
const bothLove = (state, a, b, v) => {
  addLove(state, a, b, v);
  addLove(state, b, a, v);
};
const bothHate = (state, a, b, v) => {
  addHate(state, a, b, v);
  addHate(state, b, a, v);
};

test("關係等級與通過率加成：喜歡 +10%、愛慕 +20%、討厭 -10%、仇恨 -20%，有上限", () => {
  const { state, people: [a, b, c, d] } = setup(4);
  assert.equal(pairLevel(state, a, b), "neutral");
  const base = roomPassRate(state, [a, b], easy);

  bothLove(state, a, b, 60);
  assert.equal(pairLevel(state, a, b), "like");
  assert.ok(Math.abs(roomPassRate(state, [a, b], easy) - base - 0.1) < 1e-9);
  bothLove(state, a, b, 25);
  assert.equal(pairLevel(state, a, b), "adore");
  assert.ok(Math.abs(partyRelationBonus(state, [a, b]) - 0.2) < 1e-9);

  bothHate(state, a, c, 60);
  assert.equal(pairLevel(state, a, c), "dislike");
  assert.equal(areEnemies(state, a, c), false);
  assert.ok(Math.abs(partyRelationBonus(state, [a, c]) + 0.1) < 1e-9);
  bothHate(state, a, c, 25);
  assert.equal(pairLevel(state, a, c), "hate");
  assert.equal(areEnemies(state, a, c), true);
  assert.ok(Math.abs(partyRelationBonus(state, [a, c]) + 0.2) < 1e-9);

  // 四個人兩兩愛慕 = 6 對 × 20%，被上限 30% 擋住
  for (const [x, y] of [[a, d], [b, c], [b, d], [c, d]]) bothLove(state, x, y, 90);
  bothHate(state, a, c, -100);
  bothLove(state, a, c, 90);
  assert.ok(Math.abs(partyRelationBonus(state, [a, b, c, d]) - CONFIG.relations.bonusCap) < 1e-9);
});

test("仇恨滿了結成死敵；仇恨每天自然消退，死敵不會", () => {
  const { state, people: [a, b, c] } = setup(3);
  addHate(state, a, b, 100);
  assert.equal(pairStatus(state, a, b), "nemesis");
  assert.equal(pairLevel(state, b, a), "nemesis");
  assert.ok(state.log.some((e) => e.type === "relation" && e.text.includes("死敵")));

  bothHate(state, a, c, 40);
  for (let i = 0; i < 10; i++) advanceTick(state); // 過 1 天
  assert.equal(getRel(state, a, c).hate, 40 - CONFIG.relations.hateDecayPerDay);
  assert.equal(getRel(state, a, b).hate, 100);
});

test("告白：對方也喜歡就成為戀人，否則被拒絕（理智下降）；已有戀人不會再告白", () => {
  const { state, people: [a, b, c] } = setup(3);
  addLove(state, a, b, 70);
  addLove(state, b, a, 60);
  assert.equal(resolveConfession(state, a, b), true);
  assert.equal(pairStatus(state, a, b), "lover");
  assert.equal(partnerOf(state, a).id, b.id);
  assert.equal(moodOf(state, a), "love");

  // 已經有戀人的人，抽不到告白事件；對已有戀人的人告白會被拒絕
  const confess = SOCIAL_EVENTS.find((e) => e.id === "confess");
  addLove(state, a, c, 80);
  assert.equal(socialWeight(state, confess, a, c), 0);
  addLove(state, c, a, 80);
  addLove(state, c, b, 0);
  const sanityBefore = c.stats.sanity;
  addLove(state, c, a, 0);
  assert.equal(resolveConfession(state, c, a), false); // a 已有戀人 b
  assert.equal(c.stats.sanity, sanityBefore - CONFIG.relations.confessSanityLoss);
});

test("互動事件有 7 天冷卻：同一對人同一種事件不重複", () => {
  const { state, people: [a, b] } = setup(2);
  const meal = SOCIAL_EVENTS.find((e) => e.id === "meal");
  assert.ok(socialWeight(state, meal, a, b) > 0);
  runSocial(state, meal, a, b);
  assert.equal(getRel(state, a, b).love, meal.dLove[0]);
  assert.equal(socialWeight(state, meal, a, b), 0);
  assert.equal(socialWeight(state, meal, b, a), 0); // 反過來也算同一對
  state.tick += CONFIG.ticksPerDay * CONFIG.relations.eventCooldownDays;
  assert.ok(socialWeight(state, meal, a, b) > 0);
});

test("好感夠高才會告白、仇恨高才會吵得更凶", () => {
  const { state, people: [a, b] } = setup(2);
  const confess = SOCIAL_EVENTS.find((e) => e.id === "confess");
  const quarrel = SOCIAL_EVENTS.find((e) => e.id === "quarrel");
  assert.equal(socialWeight(state, confess, a, b), 0);
  const calm = socialWeight(state, quarrel, a, b);
  addHate(state, a, b, 50);
  assert.ok(socialWeight(state, quarrel, a, b) > calm);
  assert.equal(socialWeight(state, SOCIAL_EVENTS.find((e) => e.id === "meal"), a, b), 0); // 仇恨 50 以上不會一起吃飯
});

test("借刀殺人：陷害扣理智、破壞裝備、下毒受傷、謠言讓別人討厭他", () => {
  const { state, people: [a, b, c] } = setup(3);
  const scheme = (id) => SCHEMES.find((s) => s.id === id);

  const sanity = b.stats.sanity;
  runScheme(state, scheme("frame"), a, b);
  assert.equal(b.stats.sanity, sanity - CONFIG.relations.frameSanityLoss);

  runScheme(state, scheme("sabotage"), a, b);
  assert.equal(b.sabotaged, true);

  runScheme(state, scheme("poison"), a, b);
  assert.equal(b.injury, 1);

  runScheme(state, scheme("rumor"), a, b);
  assert.ok(getRel(state, c, b).love < 0 || getRel(state, c, b).love === 0); // 好感不會低於 0
  assert.ok(getRel(state, c, b).hate >= CONFIG.relations.rumorHate);
  assert.ok(state.log.some((e) => e.type === "scheme"));
});

test("仇恨高的人每天會搞借刀殺人；沒仇恨就不會", () => {
  let schemed = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const { state, people: [a, b] } = setup(2, "C", seed);
    bothHate(state, a, b, 70);
    state.cooldowns = {};
    for (let i = 0; i < 10 * 3; i++) advanceTick(state); // 3 天
    if (state.log.some((e) => e.type === "scheme")) schemed += 1;
  }
  assert.ok(schemed > 0, "40 局 × 3 天裡，至少要有一次借刀殺人");
  const { state } = setup(3);
  for (let i = 0; i < 10 * 5; i++) advanceTick(state);
  assert.equal(state.log.filter((e) => e.type === "scheme").length, 0);
});

test("主神空間直接殺人：不管成不成功都被主神懲罰", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const { state, people: [a, b] } = setup(2, "C", seed);
    state.points = 1000;
    const tags = ["born_strong"];
    a.tags = [...tags];
    bothHate(state, a, b, 95);
    directAttack(state, a, b);
    const bDead = !state.samsarites.includes(b);
    const bHurt = b.injury > 0;
    assert.ok(bDead || bHurt, "被害者不是死就是受傷");
    const aPunished = state.points < 1000 || a.tags.length < tags.length || !state.samsarites.includes(a);
    assert.ok(aPunished, `種子 ${seed}：動手的人要被懲罰`);
    if (bDead) assert.equal(state.graveyard.find((g) => g.name === b.name).killer, a.name);
  }
});

test("主神懲罰：扣 500 分（不低於高利貸上限）／洗標籤／抹殺", () => {
  const { state, people: [a] } = setup(1);
  a.tags = ["born_strong", "nimble"];
  state.points = 100;
  punish(state, a, "points");
  assert.equal(state.points, Math.max(CONFIG.debtLimit, 100 - 500));
  punish(state, a, "tag");
  assert.equal(a.tags.length, 1);
  punish(state, a, "erase");
  assert.equal(state.samsarites.length, 0);
  assert.equal(state.graveyard.length, 1);
});

test("死亡連鎖：戀人／死黨有三種反應、其他人害怕、關係紀錄被清掉", () => {
  const seen = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const { state, people: [dead, lover, friend, stranger] } = setup(4, "C", seed);
    bothLove(state, dead, lover, 90);
    runSocial(state, { ...SOCIAL_EVENTS[0], special: "confess" }, lover, dead); // 成為戀人
    bothLove(state, dead, friend, 65);
    const power = { lover: lover.stats.power, friend: friend.stats.power };
    const sanity = stranger.stats.sanity;
    state.samsarites = state.samsarites.filter((s) => s !== dead);
    afterDeath(state, dead, null);

    for (const [who, before] of [[lover, power.lover], [friend, power.friend]]) {
      if (who.stats.power > before) seen.add("breakthrough");
      else if (who.tags.includes("broken_heart")) seen.add("broken");
      else if (who.tags.includes("demon_path")) seen.add("demon");
    }
    assert.equal(stranger.stats.sanity, sanity - CONFIG.relations.deathFearSanity);
    assert.equal(stranger.stats.power, stranger.stats.power);
    assert.equal(Object.keys(state.relations).filter((k) => k.includes(`${dead.id}>`) || k.endsWith(`>${dead.id}`)).length, 0);
  }
  assert.deepEqual([...seen].sort(), ["breakthrough", "broken", "demon"]);
});

test("靈魂伴侶死了：另一半只會崩潰或黑化，不會頓悟", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { state, people: [dead, mate] } = setup(2, "C", seed);
    bothLove(state, dead, mate, 100);
    resolveConfession(state, mate, dead);
    for (let i = 0; i < 1; i++) state.relations[`${mate.id}>${dead.id}`].status = state.relations[`${dead.id}>${mate.id}`].status = "soulmate";
    const before = mate.stats.power;
    state.samsarites = state.samsarites.filter((s) => s !== dead);
    afterDeath(state, dead, null);
    assert.ok(mate.stats.power <= before);
    assert.ok(mate.tags.includes("broken_heart") || mate.tags.includes("demon_path"));
  }
});

test("功德無量笑面虎偷遺產：全屬性永久 +10%，所有人對他好感 -5", () => {
  const { state, people: [dead, tiger, other] } = setup(3);
  tiger.tags = ["smiling_tiger"];
  addLove(state, other, tiger, 20);
  const power = tiger.stats.power;
  state.samsarites = state.samsarites.filter((s) => s !== dead);
  afterDeath(state, dead, null);
  assert.equal(tiger.stats.power, Math.round(power * CONFIG.relations.inheritMult));
  assert.equal(getRel(state, other, tiger).love, 15);
});

test("被同伴害死：死者的戀人鎖定兇手（死敵＋復仇旗標）", () => {
  const { state, people: [dead, lover, killer] } = setup(3);
  bothLove(state, dead, lover, 80);
  resolveConfession(state, lover, dead);
  state.samsarites = state.samsarites.filter((s) => s !== dead);
  afterDeath(state, dead, killer);
  assert.equal(pairStatus(state, lover, killer), "nemesis");
  assert.equal(getRel(state, lover, killer).revenge, true);
  assert.equal(areEnemies(state, lover, killer), true);
});

test("副本：復仇鎖定的兩人同隊，第一個房間一定自相殘殺（算失敗、有人受傷、旗標清除）", () => {
  const { state, people: [m, killer] } = setup(2);
  state.points = 1000;
  addHate(state, m, killer, 100);
  state.relations[`${m.id}>${killer.id}`].revenge = true;
  assert.equal(startRun(state, easy.id, [m.id, killer.id]).ok, true);
  stepRun(state);
  assert.equal(state.run.results[0], false);
  assert.ok(killer.injury > 0, "被攻擊的兇手受傷了");
  assert.equal(getRel(state, m, killer).revenge, false);
  assert.ok(state.log.some((e) => e.type === "clash"));
});

test("副本：隊內有死敵時，內鬥機率照設定；沒有仇人也沒有背刺標籤就不內鬥", () => {
  let fights = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { state, people } = setup(2, "C", seed);
    addHate(state, people[0], people[1], 100);
    if (pickClash(state, people, 1)) fights += 1;
  }
  assert.ok(fights > 10 && fights < 50, `死敵 50% 內鬥，60 次裡出現 ${fights} 次`);

  const { state, people } = setup(3);
  assert.equal(pickClash(state, people, 0), null);
  assert.equal(pickClash(state, people, 3), null);
});

test("背刺成癮者：同隊時有機會背刺隊友", () => {
  let stabs = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const { state, people } = setup(3, "C", seed);
    people[0].tags = ["backstabber"];
    const clash = pickClash(state, people, 2);
    if (clash) {
      assert.equal(clash.kind, "backstab");
      assert.equal(clash.attacker.id, people[0].id);
      stabs += 1;
    }
  }
  assert.ok(stabs > 0 && stabs < 40);
  const { state, people: [solo] } = setup(1);
  solo.tags = ["backstabber"];
  assert.equal(pickClash(state, [solo], 0), null); // 一個人沒人可以背刺
});

test("愛慕的隊友有機會替你擋刀；沒有就不會", () => {
  const { state, people: [a, b, c] } = setup(3);
  assert.equal(findProtector(state, [a, b, c], a), null);
  bothLove(state, a, b, 90);
  let blocked = 0;
  for (let i = 0; i < 100; i++) if (findProtector(state, [a, b, c], a)?.id === b.id) blocked += 1;
  assert.ok(blocked > 5 && blocked < 60);
});

test("借刀殺人的破壞裝備：下次出征被打中更容易重傷、出征後旗標清除", () => {
  const { state, people: [a] } = setup(1);
  a.sabotaged = true;
  state.points = 1000;
  startRun(state, getDungeon("ghost_village").id, [a.id]);
  while (state.run) stepRun(state);
  assert.equal(a.sabotaged, false);
});

test("自動派遣：開著「禁止仇恨／死敵同隊」就不會把仇人編在一起", () => {
  const { state, people } = setup(5, "A");
  bothHate(state, people[0], people[1], 85);
  bothHate(state, people[2], people[3], 85);
  state.settings.protect.noEnemies = true;
  const plan = planAutoDispatch(state);
  assert.ok(plan);
  assert.ok(plan.party.length >= 2);
  for (let i = 0; i < plan.party.length; i++) {
    for (let j = i + 1; j < plan.party.length; j++) assert.equal(areEnemies(state, plan.party[i], plan.party[j]), false);
  }
});

test("回收爐會一併清掉那個人的關係紀錄", () => {
  const { state, people: [a, b] } = setup(2);
  bothLove(state, a, b, 50);
  recycle(state, a.id);
  assert.equal(Object.keys(state.relations).length, 0);
});

test("存檔：關係與冷卻讀得回來；舊存檔（沒有 relations）也能讀", () => {
  const { state, people: [a, b] } = setup(2);
  bothLove(state, a, b, 60);
  runSocial(state, SOCIAL_EVENTS[0], a, b);
  const copy = deserialize(serialize(state));
  assert.deepEqual(copy.relations, state.relations);
  assert.deepEqual(copy.cooldowns, state.cooldowns);

  const old = JSON.parse(serialize(state));
  delete old.relations;
  delete old.cooldowns;
  const loaded = deserialize(JSON.stringify(old));
  assert.deepEqual(loaded.relations, {});
  assert.deepEqual(loaded.cooldowns, {});
  assert.ok(loaded.settings.pauseOn.relation !== undefined);
});

test("放著跑 60 天：留守的人會自己產生關係與事件，而且不會壞掉；同種子結果一樣", () => {
  const run = (seed) => {
    const state = createNewGame(seed);
    state.points = 100000;
    for (let i = 0; i < 5; i++) state.samsarites.push(createSamsarite(state, "C"));
    for (let i = 0; i < 60 * CONFIG.ticksPerDay; i++) step(state);
    return state;
  };
  let loved = 0;
  for (let seed = 1; seed <= 5; seed++) {
    const state = run(seed);
    if (Object.keys(state.relations).length > 0) loved += 1;
    assert.ok(state.samsarites.every((s) => s.stats.sanity >= 0 && s.stats.sanity <= 100));
  }
  assert.equal(loved, 5, "每一局都該有關係紀錄");
  assert.equal(serialize(run(3)), serialize(run(3)));
  const state = run(2);
  const types = new Set(state.log.map((e) => e.type));
  assert.ok(types.has("social"), "要有日常互動的日誌");
});
