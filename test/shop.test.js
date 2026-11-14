// Phase 3-A：商店 4 階、強化／裝備／藥水、副本特殊獎勵生效
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/data/config.js";
import { DUNGEONS, getDungeon, getSpecialReward } from "../src/data/dungeons.js";
import { SHOP_ITEMS, SHOP_KIND_LABELS, getShopItem } from "../src/data/shop.js";
import { LOGS } from "../src/data/logs.js";
import { createNewGame, createSamsarite, setInjury, serialize, deserialize, pullGacha } from "../src/engine/core.js";
import { shopTier, nextTierInfo, buyItem, checkBuy, collectionEffects } from "../src/engine/shop.js";
import { effectivePower, injuryShieldOf, dodgeOf } from "../src/engine/tags.js";
import { roomPassRate, rewardMultiplier, partyPower, startRun } from "../src/engine/dungeon.js";
import { step } from "../src/engine/dispatch.js";

const ghost = getDungeon("ghost_village");

function setup(points = 100000) {
  const state = createNewGame(1);
  state.points = points;
  const s = createSamsarite(state, "C");
  s.tags = [];
  state.samsarites = [s];
  return { state, s };
}

test("商店門檻讀 config：0 / 600 / 3000 / 12000 / 45000，依累積花費開階", () => {
  assert.deepEqual(CONFIG.shopTierUnlock, [0, 600, 3000, 12000, 45000]);
  const { state } = setup();
  const at = (n) => {
    state.totalSpent = n;
    return shopTier(state);
  };
  assert.deepEqual([0, 599, 600, 2999, 3000, 11999, 12000, 44999, 45000, 999999].map(at), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  state.totalSpent = 1200;
  assert.deepEqual(nextTierInfo(state), { tier: 3, need: 3000, remaining: 1800 });
  state.totalSpent = 45000;
  assert.equal(nextTierInfo(state), null);
});

test("商品資料表：id 不重複、階層 1~5、種類合法、有價格與效果；武器＋防具白值對齊各章錨點", () => {
  const ids = new Set(SHOP_ITEMS.map((i) => i.id));
  assert.equal(ids.size, SHOP_ITEMS.length);
  for (const i of SHOP_ITEMS) {
    assert.ok([1, 2, 3, 4, 5].includes(i.tier), i.id);
    assert.ok(i.kind in SHOP_KIND_LABELS, i.id);
    assert.ok(i.price > 0 && Object.keys(i.effect).length > 0, i.id);
    if (i.kind === "gear") assert.ok(["weapon", "armor", "bloodline"].includes(i.slot), i.id);
  }
  assert.ok(SHOP_ITEMS.every((i) => i.kind !== "enhance"), "Phase 4-B 起商店不再賣強化");
  for (const t of [1, 2, 3, 4, 5]) assert.ok(SHOP_ITEMS.some((i) => i.tier === t), `Tier ${t} 沒有商品`);
  const anchors = [16, 60, 220, 900, 3500];
  anchors.forEach((want, i) => {
    const gearPower = SHOP_ITEMS.filter((x) => x.tier === i + 1 && x.kind === "gear" && x.category === "standard").reduce((n, x) => n + (x.effect.power ?? 0), 0);
    assert.equal(gearPower, want, `Tier ${i + 1} 武器＋防具白值`);
  });
});

test("沒解鎖的階層買不了，也不會扣積分", () => {
  const { state, s } = setup();
  const before = state.points;
  const r = buyItem(state, "weapon_steel", s.id); // Tier 2
  assert.equal(r.ok, false);
  assert.match(r.reason, /Tier 2/);
  assert.equal(state.points, before);
  assert.equal(state.totalSpent, 0);
});

test("積分不夠（連高利貸都借不到）買不了", () => {
  const { state, s } = setup(CONFIG.space.debtLimit[0] + 10);
  assert.equal(buyItem(state, "weapon_club", s.id).ok, false);
  assert.equal(state.totalSpent, 0);
});

test("買裝備：扣積分、累積花費增加、戰力上升；買新武器會換掉舊的", () => {
  const { state, s } = setup();
  const base = effectivePower(s);
  assert.equal(buyItem(state, "weapon_club", s.id).ok, true);
  assert.equal(state.points, 100000 - 80);
  assert.equal(state.totalSpent, 80);
  assert.equal(effectivePower(s), base + 10);
  assert.equal(partyPower([s]), base + 10); // 隊伍戰力也跟著變
  assert.equal(checkBuy(state, getShopItem("weapon_club"), s).ok, false); // 同一件不能重買
  state.totalSpent = 600; // 開 Tier 2
  assert.equal(buyItem(state, "weapon_steel", s.id).ok, true);
  assert.equal(s.gear.weapon, "weapon_steel");
  assert.equal(effectivePower(s), base + 38); // 換掉，不是疊加
  assert.ok(state.log.some((e) => e.type === "shop" && e.text.includes("鐵管")), "換裝日誌要提到舊裝備");
});

test("防具提高傷勢減免與戰力白值，高階防具另有閃避", () => {
  const { state, s } = setup();
  state.totalSpent = 12000; // 開 Tier 4
  const base = effectivePower(s);
  buyItem(state, "armor_chain", s.id);
  assert.ok(Math.abs(injuryShieldOf(s) - 0.1) < 1e-9);
  assert.equal(effectivePower(s), base + 22); // Phase 4-A 起防具也有戰力白值
  assert.equal(dodgeOf(s), 0);
  buyItem(state, "armor_legend", s.id);
  assert.ok(Math.abs(dodgeOf(s) - 0.05) < 1e-9);
  assert.equal(effectivePower(s), base + 340, "換防具不是疊加");
});

test("強化會乘上標籤的戰力百分比（先加後乘）", () => {
  const { state, s } = setup();
  s.tags = ["hot_blood"];
  const pct = effectivePower(s) / s.stats.power - 1; // 這個標籤給的百分比
  buyItem(state, "weapon_club", s.id);
  assert.equal(effectivePower(s), Math.round((s.stats.power + 10) * (1 + pct)));
});

test("藥水：傷藥降一級、急救針全癒、鎮定劑加理智；不需要時不能買", () => {
  const { state, s } = setup();
  assert.equal(buyItem(state, "potion_heal", s.id).ok, false); // 沒受傷
  s.stats.sanity = 100;
  assert.equal(buyItem(state, "potion_calm", s.id).ok, false); // 理智已滿
  s.stats.sanity = 50;
  assert.equal(buyItem(state, "potion_calm", s.id).ok, true);
  assert.equal(s.stats.sanity, 75);
  setInjury(s, 3);
  assert.equal(buyItem(state, "potion_heal", s.id).ok, true);
  assert.equal(s.injury, 2);
  assert.equal(s.restDaysLeft, 3);
  state.totalSpent = 600;
  assert.equal(buyItem(state, "potion_revive", s.id).ok, true);
  assert.equal(s.injury, 0);
});

test("副本裡的人不能用商店", () => {
  const { state, s } = setup();
  s.location = "dungeon";
  assert.equal(buyItem(state, "weapon_club", s.id).ok, false);
});

test("花費跨過門檻時主神會宣布解鎖（抽卡的花費也算）", () => {
  const { state } = setup(100000);
  state.totalSpent = 500;
  pullGacha(state, "basic"); // 120 → 620
  assert.equal(shopTier(state), 2);
  assert.ok(state.log.some((e) => e.type === "shopTier" && e.text.includes("Tier 2")));
  pullGacha(state, "basic"); // 還是 Tier 2，不再宣布
  assert.equal(state.log.filter((e) => e.type === "shopTier").length, 1);
});

test("商店日誌模板每個 key 至少 2 個版本", () => {
  for (const k of ["shopTier", "shopGear", "shopGearSwap", "shopHeal", "shopCalm"]) assert.ok(LOGS[k]?.length >= 2, k);
  assert.equal(LOGS.shopEnhance, undefined, "舊商店強化日誌已移除");
});

test("特殊獎勵資料表：有填的副本各 3 個（佔位副本先留空），id 唯一、都有效果，類型對得上副本", () => {
  const ids = new Set();
  for (const d of DUNGEONS) {
    assert.ok([0, 3].includes(d.specialRewards.length), d.id);
    if (["ghost_village", "silent_ark", "ember_war"].includes(d.id)) assert.equal(d.specialRewards.length, 3, d.id);
    for (const r of d.specialRewards) {
      assert.ok(!ids.has(r.id), `${r.id} 重複`);
      ids.add(r.id);
      assert.ok(r.name && r.desc && r.effect, r.id);
      for (const genre of Object.keys(r.effect.genreBonus ?? {})) assert.ok(DUNGEONS.some((x) => x.genre === genre), `${r.id} 的類型 ${genre} 不存在`);
    }
  }
});

test("特殊獎勵生效：全域通過率、類型通過率、通關積分、傷勢減免", () => {
  const { state, s } = setup();
  state.dungeonStats[ghost.id] = { attempts: 1, clears: 1 };
  const base = roomPassRate(state, [s], ghost);
  const baseReward = rewardMultiplier(state, ghost, [s]);
  const none = collectionEffects(state);
  assert.equal(none.passBonus + none.rewardPct + none.injuryShield, 0);

  state.collection = ["yin_yang_eye"]; // 全域 +3%
  assert.ok(Math.abs(roomPassRate(state, [s], ghost) - (base + 0.03)) < 1e-9);
  state.collection = ["ghost_talisman"]; // 靈異 +8%
  assert.ok(Math.abs(roomPassRate(state, [s], ghost) - (base + 0.08)) < 1e-9);
  state.collection = ["ember_firebolt"]; // 奇幻 +10%：打靈異副本沒用
  assert.ok(Math.abs(roomPassRate(state, [s], ghost) - base) < 1e-9);
  state.collection = ["ember_staff"]; // 通關積分 +10%
  assert.ok(Math.abs(rewardMultiplier(state, ghost, [s]) - baseReward * 1.1) < 1e-9);
  state.collection = ["ghost_seal", "ark_prosthetic"]; // 傷勢減免相加
  assert.ok(Math.abs(collectionEffects(state).injuryShield - 0.25) < 1e-9);
});

test("傷勢減免的收藏真的進入副本結算：同一個種子下，有減免的人撐得比較久", () => {
  const roomsSurvived = (collection) => {
    const state = createNewGame(5);
    state.collection = collection;
    let total = 0;
    for (let i = 0; i < 200; i++) {
      const s = createSamsarite(state, "S");
      s.tags = [];
      s.stats.power = 1; // 一定打不過，一定被打
      state.samsarites = [s];
      startRun(state, ghost.id, [s.id]);
      const run = state.runs[0];
      while (state.runs.length) step(state);
      total += run.results.length; // 走完幾個房間 = 還活著撐過幾個房間（全滅時副本會提前結束）
    }
    return total;
  };
  const shielded = Array.from({ length: 4 }, () => "ghost_seal"); // 灌到 injuryShieldMax 上限
  assert.ok(roomsSurvived(shielded) > roomsSurvived([]));
});

test("首通掉落記錄的是獎勵 id，而且有對應資料", () => {
  const state = createNewGame(3);
  state.samsarites = [];
  for (let i = 0; i < 4; i++) {
    const s = createSamsarite(state, "S");
    s.tags = [];
    state.samsarites.push(s);
  }
  for (let i = 0; i < 30 && state.collection.length === 0; i++) {
    for (const s of state.samsarites) setInjury(s, 0);
    if (state.samsarites.length === 0) break;
    startRun(state, ghost.id, state.samsarites.map((s) => s.id));
    while (state.runs.length) step(state);
  }
  if (state.collection.length > 0) {
    assert.ok(getSpecialReward(state.collection[0]));
    assert.ok(state.log.some((e) => e.type === "runEnd" && e.text.includes("永久生效")));
  }
});

test("存檔：裝備、強化、收藏讀回來還在；舊存檔的收藏名字會轉成 id", () => {
  const { state, s } = setup();
  buyItem(state, "weapon_club", s.id);
  state.collection = ["ember_staff"];
  const back = deserialize(serialize(state));
  assert.equal(back.samsarites[0].gear.weapon, "weapon_club");
  assert.equal(effectivePower(back.samsarites[0]), effectivePower(s));
  assert.deepEqual(back.collection, ["ember_staff"]);

  const old = JSON.parse(serialize(state));
  old.collection = ["鬼道術法・引魂符", "不存在的東西"];
  delete old.samsarites[0].gear;
  old.samsarites[0].upgrades = { power: 12, dodge: 0.04 }; // 舊商店強化：Phase 4-B 起歸零、不退費
  old.samsarites[0].bought = { enh_power1: 3 };
  const migrated = deserialize(JSON.stringify(old));
  assert.deepEqual(migrated.collection, ["ghost_talisman"]);
  assert.deepEqual(migrated.samsarites[0].gear, {});
  assert.equal(migrated.samsarites[0].upgrades, undefined);
  assert.equal(migrated.samsarites[0].bought, undefined);
  assert.equal(effectivePower(migrated.samsarites[0]), effectivePower({ ...migrated.samsarites[0], gear: {} }), "舊強化不再加戰力");
});
