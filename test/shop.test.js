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
import { setSpentTier } from "./helpers/tier.js";

const ghost = getDungeon("ghost_village");

function setup(points = 100000) {
  const state = createNewGame(1);
  state.points = points;
  const s = createSamsarite(state, "C");
  s.tags = [];
  state.samsarites = [s];
  return { state, s };
}

test("商店階級改看章節尾王首通：Tier 1 開局就有，打通第 N 章尾王開 Tier N+1，Tier 6 要通第 5 章；花費不影響", () => {
  assert.deepEqual(CONFIG.shopTierBossChapter, [0, 1, 2, 3, 4, 5]);
  const { state } = setup();
  assert.equal(shopTier(state), 1);
  state.totalSpent = 9999999; // 花再多也不開階
  assert.equal(shopTier(state), 1);
  assert.deepEqual(nextTierInfo(state), { tier: 2, chapter: 1 });
  const got = [];
  for (let ch = 1; ch <= 5; ch++) {
    state.chapterClearDay[ch] = 10 + ch;
    got.push(shopTier(state));
  }
  assert.deepEqual(got, [2, 3, 4, 5, 6]);
  assert.equal(nextTierInfo(state), null);
  // 舊存檔沒有 chapterClearDay 但該尾王有通關次數，也認
  const s2 = setup().state;
  s2.dungeonStats.ch2_boss = { clears: 1 };
  assert.equal(shopTier(s2), 3);
});

test("商品資料表：id 不重複、階層 1~6、種類合法、有價格；常駐武器白值對齊各章錨點（±10%）", () => {
  const ids = new Set(SHOP_ITEMS.map((i) => i.id));
  assert.equal(ids.size, SHOP_ITEMS.length);
  for (const i of SHOP_ITEMS) {
    assert.ok([1, 2, 3, 4, 5, 6].includes(i.tier), i.id);
    assert.ok(i.kind in SHOP_KIND_LABELS, i.id);
    assert.ok(i.price > 0, i.id);
    if (i.kind === "gear") assert.ok(["weapon", "armor", "accessory", "bloodline"].includes(i.slot) && Object.keys(i.stats).length > 0, i.id);
  }
  for (const t of [1, 2, 3, 4, 5, 6]) assert.ok(SHOP_ITEMS.some((i) => i.tier === t), `Tier ${t} 沒有商品`);
  const anchors = [18, 60, 220, 900, 3500];
  anchors.forEach((want, i) => {
    for (const w of SHOP_ITEMS.filter((x) => x.tier === i + 1 && x.category === "standard" && x.slot === "weapon")) {
      assert.ok(Math.abs(w.stats.power - want) <= want * 0.1 + 1, `${w.id} 戰力 ${w.stats.power} 偏離錨點 ${want}`);
    }
  });
});

test("Tier 6 商品：每件的白值總和與價格都高於 Tier 5 同槽位同類別的最高值（效果不重複 Tier 5 的）", () => {
  const sum = (i) => Object.values(i.stats).reduce((a, b) => a + Math.max(0, b), 0);
  for (const cat of ["standard", "specialty", "contraband"]) {
    for (const slot of ["weapon", "armor", "accessory", "bloodline"]) {
      const t5 = SHOP_ITEMS.filter((i) => i.tier === 5 && i.category === cat && i.slot === slot);
      const t6 = SHOP_ITEMS.filter((i) => i.tier === 6 && i.category === cat && i.slot === slot);
      if (t5.length === 0 || t6.length === 0) continue;
      assert.ok(Math.max(...t6.map((i) => i.stats.power)) > Math.max(...t5.map((i) => i.stats.power)), `${cat}/${slot} 戰力`);
      assert.ok(Math.min(...t6.map(sum)) > Math.min(...t5.map(sum)), `${cat}/${slot} 白值總和`);
      assert.ok(Math.min(...t6.map((i) => i.price)) > Math.min(...t5.map((i) => i.price)), `${cat}/${slot} 價格`);
    }
  }
  // 耗材：同編號的效果組合不能和 Tier 5 一模一樣
  for (const n of ["27", "28", "29", "30", "31", "32", "38", "39"]) {
    const a = SHOP_ITEMS.find((i) => i.id === `t5_${n}`).effect;
    const b = SHOP_ITEMS.find((i) => i.id === `t6_${n}`).effect;
    assert.notDeepEqual(a, b, `t6_${n} 效果和 Tier 5 重複`);
  }
});

test("沒解鎖的階層買不了，也不會扣積分", () => {
  const { state, s } = setup();
  const before = state.points;
  const r = buyItem(state, "t2_01", s.id); // Tier 2
  assert.equal(r.ok, false);
  assert.match(r.reason, /Tier 2/);
  assert.equal(state.points, before);
  assert.equal(state.totalSpent, 0);
});

test("積分不夠（連高利貸都借不到）買不了", () => {
  const { state, s } = setup(CONFIG.space.debtLimit[0] + 10);
  assert.equal(buyItem(state, "t1_01", s.id).ok, false);
  assert.equal(state.totalSpent, 0);
});

test("買裝備：扣積分、累積花費增加、戰力上升；買新武器會換掉舊的", () => {
  const { state, s } = setup();
  const base = effectivePower(s);
  assert.equal(buyItem(state, "t1_01", s.id).ok, true);
  assert.equal(state.points, 100000 - 120);
  assert.equal(state.totalSpent, 120);
  assert.equal(effectivePower(s), base + 18);
  assert.equal(partyPower([s]), base + 18); // 隊伍戰力也跟著變
  assert.equal(checkBuy(state, getShopItem("t1_01"), s).ok, false); // 同一件不能重買
  setSpentTier(state, 600); // 開 Tier 2
  assert.equal(buyItem(state, "t2_01", s.id).ok, true);
  assert.equal(s.gear.weapon, "t2_01");
  assert.equal(effectivePower(s), base + 62); // 換掉，不是疊加
  assert.ok(state.log.some((e) => e.type === "shop" && e.text.includes("制式衝鋒槍")), "換裝日誌要提到舊裝備");
});

test("防具提供戰力與防禦白值，換防具不是疊加；飾品與血統是獨立欄位", () => {
  const { state, s } = setup();
  setSpentTier(state, 12000); // 開 Tier 4
  const base = effectivePower(s);
  buyItem(state, "t2_03", s.id);
  assert.equal(effectivePower(s), base + 54);
  assert.equal(s.gear.armor, "t2_03");
  buyItem(state, "t4_03", s.id);
  assert.equal(effectivePower(s), base + 840, "換防具不是疊加");
  buyItem(state, "t4_05", s.id);
  assert.equal(effectivePower(s), base + 840 + 790, "飾品另一個欄位");
});

test("強化會乘上標籤的戰力百分比（先加後乘）", () => {
  const { state, s } = setup();
  s.tags = ["hot_blood"];
  const pct = effectivePower(s) / s.stats.power - 1; // 這個標籤給的百分比
  buyItem(state, "t1_01", s.id);
  assert.equal(effectivePower(s), Math.round((s.stats.power + 18) * (1 + pct)));
});

test("藥水：傷藥降一級、急救針降兩級、鎮定劑加理智；不需要時不能買", () => {
  const { state, s } = setup();
  assert.equal(buyItem(state, "t1_27", s.id).ok, false); // 沒受傷
  s.stats.sanity = 100;
  assert.equal(buyItem(state, "t1_28", s.id).ok, false); // 理智已滿
  s.stats.sanity = 50;
  assert.equal(buyItem(state, "t1_28", s.id).ok, true);
  assert.equal(s.stats.sanity, 70);
  setInjury(s, 3);
  assert.equal(buyItem(state, "t1_27", s.id).ok, true);
  assert.equal(s.injury, 2);
  assert.equal(s.restDaysLeft, 3);
  assert.equal(buyItem(state, "t1_29", s.id).ok, true);
  assert.equal(s.injury, 0);
});

test("副本裡的人不能用商店", () => {
  const { state, s } = setup();
  s.location = "dungeon";
  assert.equal(buyItem(state, "t1_01", s.id).ok, false);
});

test("抽卡與花費不再開商店階級，只有尾王首通才開，並且主神會宣布", () => {
  const { state } = setup(100000);
  state.totalSpent = 500;
  pullGacha(state, "basic"); // 120 → 620：舊制會開 Tier 2，新制不會
  assert.equal(state.totalSpent, 620, "totalSpent 照算（只當統計）");
  assert.equal(shopTier(state), 1);
  assert.equal(state.events.filter((e) => e.type === "shopTier").length, 0);
});

test("商店日誌模板每個 key 至少 2 個版本", () => {
  for (const k of ["shopTier", "shopGear", "shopGearSwap", "shopHeal", "shopCalm"]) assert.ok(LOGS[k]?.length >= 2, k);
  assert.equal(LOGS.shopEnhance, undefined, "舊商店強化日誌已移除");
});

test("特殊獎勵資料表：30 個世界各 3 個（Phase 3-1 補齊），id 唯一、都有效果，類型對得上副本", () => {
  const ids = new Set();
  for (const d of DUNGEONS) {
    assert.equal(d.specialRewards.length, 3, d.id);
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
  buyItem(state, "t1_01", s.id);
  state.collection = ["ember_staff"];
  const back = deserialize(serialize(state));
  assert.equal(back.samsarites[0].gear.weapon, "t1_01");
  assert.equal(effectivePower(back.samsarites[0]), effectivePower(s));
  assert.deepEqual(back.collection, ["ember_staff"]);

  const old = JSON.parse(serialize(state));
  old.collection = ["破局者手札", "不存在的東西"]; // 4-E-8 收尾：獎勵改名（id 不變）
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

test("30 世界首通獎勵：效果不重複、尾王比普通關強，收藏總量有上限（避免 30 個世界收完通過率爆表）", () => {
  const seen = new Set();
  for (const d of DUNGEONS) {
    const kinds = d.specialRewards.map((r) => Object.keys(r.effect)[0]);
    assert.ok(new Set(d.specialRewards.map((r) => r.name)).size === 3, `${d.id} 名稱重複`);
    assert.ok(new Set(d.specialRewards.map((r) => r.id)).size === 3);
    for (const r of d.specialRewards) {
      assert.ok(!seen.has(r.name), `名稱重複：${r.name}`);
      seen.add(r.name);
    }
    if (d.id.startsWith("ch1_") || d.id.startsWith("ch2_") || d.id.startsWith("ch3_") || d.id.startsWith("ch4_") || d.id.startsWith("ch5_")) assert.ok(new Set(kinds).size >= 2, `${d.id} 效果種類太單調`);
  }
  const boss = DUNGEONS.find((d) => d.id === "ch2_boss").specialRewards.find((r) => r.effect.injuryShield);
  const norm = DUNGEONS.find((d) => d.id === "ch2_04").specialRewards.find((r) => r.effect.injuryShield);
  assert.ok(boss.effect.injuryShield > norm.effect.injuryShield);
  // 全部收進來：被上限擋住
  const state = createNewGame(1);
  state.collection = DUNGEONS.flatMap((d) => d.specialRewards.map((r) => r.id));
  const fx = collectionEffects(state);
  assert.ok(fx.passBonus <= CONFIG.collection.passCap + 1e-9);
  assert.ok(fx.rewardPct <= CONFIG.collection.rewardCap + 1e-9);
  for (const v of Object.values(fx.genreBonus)) assert.ok(v <= CONFIG.collection.genreCap + 1e-9);
});

test("收藏的「少受一級」機率有上限 50%（第三批決策 5），不是減傷幅度", () => {
  assert.equal(CONFIG.collection.injuryShieldCap, 0.5);
  const state = createNewGame(1);
  state.collection = DUNGEONS.flatMap((d) => d.specialRewards.filter((r) => r.effect.injuryShield).map((r) => r.id));
  const raw = state.collection.reduce((n, id) => n + getSpecialReward(id).effect.injuryShield, 0);
  assert.ok(raw > 0.5, `全收原始值 ${raw} 要超過上限才測得到`);
  assert.ok(collectionEffects(state).injuryShield <= 0.5 + 1e-9);
  assert.ok(DUNGEONS.flatMap((d) => d.specialRewards).filter((r) => r.effect.injuryShield).every((r) => r.desc.includes("少受一級")));
});
