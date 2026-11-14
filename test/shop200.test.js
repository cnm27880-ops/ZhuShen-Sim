// Phase 4-E-8：30 世界正式文本、200 件商店結構化效果（耗材／黑貨被動／爆發）、AI 防呆、舊存檔相容
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/data/config.js";
import { DUNGEONS } from "../src/data/dungeons.js";
import { WORLD_TEXT, worldIdOf, WORLD_IDS } from "../src/data/worlds.js";
import { SHOP_ITEMS, getShopItem } from "../src/data/shopItems.js";
import { createNewGame, createSamsarite, serialize, deserialize, killSamsarite } from "../src/engine/core.js";
import { buyItem as rawBuy, checkBuy as rawCheck, shopItemsOfTier } from "../src/engine/shop.js";
// 測試直接當作從黑市買（常駐商店只賣常駐商品）
const buyItem = (state, id, sid, o = {}) => rawBuy(state, id, sid, { source: "market", ...o });
const checkBuy = (state, item, s, o = {}) => rawCheck(state, item, s, { source: "market", ...o });
import { marketOf, intelFill } from "../src/engine/market.js";
import { effectivePower } from "../src/engine/tags.js";
import { checkBreakGene, breakGene } from "../src/engine/growth.js";
import { startRun, hurt } from "../src/engine/dungeon.js";
import { gearDaily, gearAfterRun, passiveSum } from "../src/engine/gearFx.js";
import { addHate, addLove, getRel, pairStatus, affinity, shiftAffinity } from "../src/engine/relations.js";
import { appointCaptain, dailySquad, captainOf } from "../src/engine/squad.js";
import { aiAllowed, dailyShopping } from "../src/engine/shopping.js";

function setup(n = 3, { seed = 61, level = 2, spent = 60000 } = {}) {
  const state = createNewGame(seed);
  state.samsarites = [];
  state.spaceLevel = level;
  state.points = 10000000;
  state.totalSpent = spent;
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, "C");
    s.tags = [];
    s.stats.power = 30;
    state.samsarites.push(s);
  }
  return state;
}
const love = (state, a, b, v) => {
  shiftAffinity(state, a, b, v);
  shiftAffinity(state, b, a, v);
};
const FULL4 = { weapon: "t5_01", armor: "t5_03", accessory: "t5_05", bloodline: "t5_07" };

test("30 世界：正式名稱與題材描述、名稱不重複、同章 R 與基礎獎勵嚴格升序（01<02<03<04<05<boss）", () => {
  assert.equal(Object.keys(WORLD_TEXT).length, 30);
  for (const [spec, [name, intro]] of Object.entries(WORLD_TEXT)) {
    const d = DUNGEONS.find((x) => x.id === worldIdOf(spec));
    assert.ok(d, spec);
    assert.equal(d.name, name);
    assert.equal(d.intro, intro);
  }
  assert.equal(new Set(DUNGEONS.map((d) => d.name)).size, 30);
  assert.equal(DUNGEONS.find((d) => d.id === "ch5_boss").name, "原初神座中樞");
  for (let c = 1; c <= 5; c++) {
    const list = DUNGEONS.filter((d) => d.chapter === c);
    assert.equal(list.length, 6);
    assert.equal(list.at(-1).boss, true);
    for (let i = 1; i < list.length; i++) {
      assert.ok(list[i].recommendedPower > list[i - 1].recommendedPower, `第 ${c} 章 R 升序 ${list[i].id}`);
      assert.ok(list[i].reward > list[i - 1].reward, `第 ${c} 章獎勵升序 ${list[i].id}`);
    }
  }
  assert.deepEqual(WORLD_IDS.length, 30);
});

test("常駐醫療：每階治傷藥與鎮靜劑、第 1 階急救針常駐可買（不必等黑市）", () => {
  const t1 = shopItemsOfTier(1).map((i) => i.id);
  for (const id of ["t1_27", "t1_28", "t1_29"]) assert.ok(t1.includes(id), id);
  for (const t of [2, 3, 4, 5]) assert.ok(shopItemsOfTier(t).some((i) => i.id === `t${t}_27`) && shopItemsOfTier(t).some((i) => i.id === `t${t}_28`));
});

test("舊存檔相容：穿著舊版 115 件裝備照原名稱與白值算戰力；遺物庫舊物件不報錯；黑市舊貨自動重抽、新貨不動", () => {
  const state = setup(1, { spent: 0 });
  const [s] = state.samsarites;
  const base = effectivePower(s);
  s.gear = { weapon: "weapon_club", armor: "armor_cloth" };
  assert.equal(getShopItem("weapon_club").name, "鐵管");
  assert.equal(effectivePower(s), base + 16);
  state.armoryHeirlooms.push({ id: "h", itemId: "weapon_steel", slot: "weapon", ownerName: "老王", label: "「元老・老王遺留」" });
  const m = marketOf(state);
  const keep = m.slots[1].itemId;
  m.slots[0].itemId = "spec_ghost_village_weapon"; // 舊版商品 id
  m.slots[5].itemId = "cons_tactic_t1";
  const back = deserialize(serialize(state));
  assert.equal(effectivePower(back.samsarites[0]), base + 16, "舊裝備照算");
  assert.equal(back.samsarites[0].gear.weapon, "weapon_club");
  const slots = marketOf(back).slots;
  assert.ok(slots.every((x) => x.itemId && SHOP_ITEMS.some((i) => i.id === x.itemId)), "舊貨已重抽成新版商品");
  assert.equal(slots[1].itemId, keep, "新版貨架不動");
  assert.equal(slots.length, 8);
  // 舊版商品不能再買
  assert.equal(checkBuy(state, getShopItem("weapon_club"), s).ok, false);
  assert.equal(rawCheck(state, getShopItem("t1_01"), s).ok, true, "常駐裝備走常駐商店");
  assert.equal(rawCheck(state, getShopItem("t1_09"), s).ok, false, "特產不走常駐商店");
});

test("九轉金丹：傷勢清零並永久生命 +10，單人上限 3 次；滿次後仍可回傷但不加血，AI 不再買", () => {
  const state = setup(1);
  const [s] = state.samsarites;
  const hp0 = s.stats.hp;
  for (let i = 1; i <= 3; i++) {
    s.injury = 3;
    assert.equal(buyItem(state, "t5_27", s.id).ok, true);
    assert.equal(s.injury, 0);
    assert.equal(s.stats.hp, hp0 + 10 * i);
    assert.equal(s.elixirUses, i);
  }
  s.injury = 2;
  assert.equal(aiAllowed(state, s, getShopItem("t5_27")), false, "滿 3 次 AI 不買");
  assert.equal(buyItem(state, "t5_27", s.id).ok, true, "手動賞賜仍可回傷");
  assert.equal(s.stats.hp, hp0 + 30, "不再加血");
  s.injury = 0;
  assert.equal(buyItem(state, "t5_27", s.id).ok, false, "沒受傷又滿次：沒有任何效果");
});

test("基因鎖助推：對應階級破鎖折抵花費，突破後消耗；同階不疊加、已達階不能買", () => {
  const state = setup(1, { level: 3, spent: 60000 });
  const [s] = state.samsarites;
  s.rank = "A";
  s.geneLock = 1;
  s.enhanceCount = CONFIG.gene.tiers[1].enhanceCap;
  const base = checkBreakGene(state, s.id).cost;
  assert.equal(base, CONFIG.gene.tiers[2].cost);
  assert.equal(buyItem(state, "t3_29", s.id).ok, true);
  assert.equal(s.geneBuff.target, 2);
  assert.equal(checkBreakGene(state, s.id).cost, Math.round(base * 0.75));
  assert.equal(checkBuy(state, getShopItem("t2_29"), s).ok, false, "同階不疊加");
  const pts = state.points;
  assert.equal(breakGene(state, s.id).ok, true);
  assert.equal(pts - state.points, Math.round(base * 0.75));
  assert.equal(s.geneBuff, null, "突破後消耗");
  assert.equal(checkBuy(state, getShopItem("t2_29"), s).ok, false, "已經 2 階了");
});

test("替死護符：致死判定時消耗免死（一般改落輕傷、高階傷勢清零回滿理智）；上限 1 層", () => {
  for (const [id, expectInjury] of [["t2_30", 1], ["t4_30", 0]]) {
    const state = setup(1);
    const [s] = state.samsarites;
    assert.equal(buyItem(state, id, s.id).ok, true);
    assert.equal(s.deathWard, 1);
    assert.equal(buyItem(state, "t3_30", s.id).ok, false, "已有護符不重複");
    assert.equal(aiAllowed(state, s, getShopItem("t3_30")), false);
    s.stats.sanity = 30;
    s.injury = 3;
    const run = { enteredInjury: { [s.id]: 3 }, deaths: [], firstTime: false, partyIds: [s.id] };
    const dungeon = DUNGEONS[0];
    let guard = 0;
    while (s.deathWard === 1 && guard++ < 300) {
      s.injury = 3;
      hurt(state, run, s, dungeon);
    }
    assert.equal(s.deathWard, 0, "護符被消耗");
    assert.ok(state.samsarites.includes(s), "沒有死");
    assert.equal(s.injury, expectInjury);
    if (id === "t4_30") assert.equal(s.stats.sanity, 100);
  }
});

test("世界情報道具：未滿的已解鎖世界填情報；補滿與多目標；全滿時不能買", () => {
  const state = setup(1, { level: 2 });
  const [s] = state.samsarites;
  const unlocked = DUNGEONS.filter((d) => d.chapter <= 2);
  buyItem(state, "t3_31", s.id); // +35%（單一世界）
  const touched = unlocked.filter((d) => intelFill(state, d.id) > 0);
  assert.equal(touched.length, 1);
  assert.ok(Math.abs(intelFill(state, touched[0].id) - 0.35) < 1e-6);
  buyItem(state, "t4_31", s.id); // 補滿 1 個
  assert.ok(unlocked.filter((d) => intelFill(state, d.id) >= 1 - 1e-9).length >= 1);
  buyItem(state, "t5_31", s.id); // 補滿最多 3 個
  assert.ok(unlocked.filter((d) => intelFill(state, d.id) >= 1 - 1e-9).length >= 3);
  assert.equal(DUNGEONS.filter((d) => d.chapter > 2).every((d) => intelFill(state, d.id) === 0), true, "只動已解鎖章節");
  for (const d of unlocked) state.dungeonStats[d.id] = { attempts: 1, clears: 1, intel: CONFIG.dungeon.intel.max };
  assert.equal(checkBuy(state, getShopItem("t3_31"), s).ok, false, "全滿不能買");
});

test("好感與消仇耗材：全隊互加好感、仇恨減免／清零（死敵狀態解除）", () => {
  const state = setup(3);
  const [a, b, c] = state.samsarites;
  addHate(state, a, b, 60);
  addHate(state, c, a, 40);
  buyItem(state, "t1_40", a.id);
  assert.equal(getRel(state, a, b).hate, 45);
  assert.equal(getRel(state, c, a).hate, 25);
  addHate(state, a, b, 100);
  assert.equal(pairStatus(state, a, b), "nemesis");
  buyItem(state, "t5_32", a.id);
  assert.equal(getRel(state, a, b).hate, 0);
  assert.equal(pairStatus(state, a, b) ?? null, null, "死敵狀態解除");
  assert.equal(getRel(state, b, c).love, 20);
  assert.equal(getRel(state, c, a).love, 20);
});

test("奪舍禁符：抹除自己的入魔、回理智，把理智與仇恨轉嫁給隨機隊友", () => {
  const state = setup(3);
  const [a] = state.samsarites;
  a.tags = ["demon_path"];
  a.stats.sanity = 20;
  assert.equal(buyItem(state, "t4_40", a.id).ok, true);
  assert.equal(a.tags.includes("demon_path"), false);
  assert.equal(a.stats.sanity, 55);
  const victims = state.samsarites.filter((s) => s.id !== a.id);
  const hit = victims.filter((v) => v.stats.sanity === 75);
  assert.equal(hit.length, 1);
  assert.equal(getRel(state, hit[0], a).hate, 25);
  assert.ok(state.squad.contraband.some((r) => r.itemId === "t4_40" && r.victimId === hit[0].id));
});

test("爆發耗材：個人與全隊爆發同場只取最高 1 件，嚴禁連乘；全隊爆發戰後全員理智 -15、燃血類戰後傷勢 +1", () => {
  const state = setup(3, { level: 2 });
  const [a, b, c] = state.samsarites;
  for (const s of state.samsarites) s.stats.power = 5000;
  a.consumables = ["t1_37"]; // 15%
  b.consumables = ["t2_38", "t1_37"]; // 20%，兩件只取最高 1 件
  c.consumables = ["t5_38"]; // 全隊 30%
  assert.equal(startRun(state, "ghost_village", [a.id, b.id, c.id]).ok, true);
  assert.equal(b.runBuff.powerPct, 0.3, "全隊爆發（30%）高於個人 20%，取最高不連乘");
  for (const s of [a, b, c]) {
    assert.equal(s.runBuff.powerPct, 0.3);
    assert.equal(effectivePower(s), Math.round(5000 * 1.3));
  }
  const run = state.runs[0];
  assert.equal(run.partyPostRunSanity, -15);
});

test("黑貨裝備被動：每日理智、出戰理智、隨機扣隊友理智、入魔傾向（t5_36 必定、其他機率）", () => {
  const state = setup(3);
  const [a, b] = state.samsarites;
  a.gear = { accessory: "t1_39" }; // 每日 -1
  gearDaily(state, a);
  assert.equal(a.stats.sanity, 99);
  a.gear = { bloodline: "t4_37" }; // 每日 -2
  gearDaily(state, a);
  assert.equal(a.stats.sanity, 97);
  a.stats.sanity = 100;
  a.gear = { accessory: "t4_38" }; // 出戰 -5
  gearAfterRun(state, [a, b]);
  assert.equal(a.stats.sanity, 95);
  a.stats.sanity = 100;
  a.gear = { accessory: "t5_35" }; // 隨機扣隊友 3
  gearAfterRun(state, [a, b]);
  assert.equal(b.stats.sanity, 97);
  assert.equal(a.stats.sanity, 100);
  assert.equal(buyItem(state, "t5_36", a.id).ok, true);
  assert.ok(a.tags.includes("demon_path"), "必帶入魔傾向");
  b.gear = { bloodline: "t2_36" };
  const keep = CONFIG.shop.demonTendencyChance;
  CONFIG.shop.demonTendencyChance = 1;
  try {
    gearDaily(state, b);
  } finally {
    CONFIG.shop.demonTendencyChance = keep;
  }
  assert.ok(b.tags.includes("demon_path"));
});

test("對隊長的被動倍率：仇恨增長 ×0.5、好感獲取 ×0.7，只對隊長生效；篡權神格 +20% 政變戰力", () => {
  const state = setup(3);
  const [cap, w, o] = state.samsarites;
  appointCaptain(state, cap.id);
  addHate(state, w, cap, 10);
  assert.equal(getRel(state, w, cap).hate, 10);
  w.gear = { accessory: "t3_39" };
  addHate(state, w, cap, 10);
  assert.equal(getRel(state, w, cap).hate, 15, "第二次 10 × 0.5 = 5");
  addHate(state, w, o, 10);
  assert.equal(getRel(state, w, o).hate, 10, "對非隊長不打折");
  w.gear = { accessory: "t5_37" };
  addLove(state, w, cap, 10);
  assert.equal(getRel(state, w, cap).love, 7);
  addLove(state, w, o, 10);
  assert.equal(getRel(state, w, o).love, 10);
  w.gear = { accessory: "t5_40" };
  assert.equal(passiveSum(w, "coupPowerBonus"), 0.2);
  assert.equal(passiveSum(o, "coupPowerBonus"), 0);
});

test("篡權神格：雙強奪權時戰力檢定 +20%（統計）", () => {
  let wins = 0;
  const trials = 1500;
  for (let i = 0; i < trials; i++) {
    const state = setup(4, { seed: 100 + i });
    const [cap, a, b] = state.samsarites;
    a.stats.power = 100;
    b.stats.power = 100;
    a.tags = ["demon_path"];
    b.tags = ["demon_path"]; // 同戰力；流派相同就不爭奪，所以讓 b 是傭兵流
    b.tags = ["salary_thief"];
    b.stats.power = Math.round(100 * (1.08 / 0.9)); // 抵銷標籤差異，兩人有效戰力約略相等
    a.gear = { accessory: "t5_40" };
    appointCaptain(state, cap.id);
    killSamsarite(state, cap, "測試", null);
    dailySquad(state);
    if (captainOf(state)?.id === a.id) wins++;
  }
  assert.ok(wins / trials > 0.53, `篡權神格方勝率 ${(wins / trials).toFixed(3)}`);
});

test("催生黑貨：普通／高標／頂滿三檔天賦；要有雙向淨好感 >= 60 的對象；子嗣仍受 +25% 封頂", () => {
  const state = setup(3);
  const [a, b, c] = state.samsarites;
  assert.equal(buyItem(state, "t3_38", a.id).ok, false, "沒有對象");
  love(state, a, b, 62);
  const keep = state.points;
  const kid = (() => {
    assert.equal(buyItem(state, "t3_38", a.id).ok, true);
    return state.samsarites.find((s) => s.location === "pod");
  })();
  assert.ok(kid && kid.generation === 2);
  assert.equal(kid.talentPct, 0, "normal：父母無基因鎖 → 沒有天賦");
  assert.ok(state.points < keep);
  for (const [id, want] of [["t4_39", 0.15], ["t5_39", 0.25]]) {
    const s2 = setup(3, { seed: 62 });
    const [x, y] = s2.samsarites;
    love(s2, x, y, 65);
    assert.equal(buyItem(s2, id, x.id).ok, true);
    const baby = s2.samsarites.find((s) => s.location === "pod");
    assert.ok(baby.talentPct >= want - 1e-9 && baby.talentPct <= CONFIG.lineage.talentCap + 1e-9, `${id}：${baby.talentPct}`);
    if (id === "t5_39") assert.equal(baby.talentPct, 0.25);
    assert.equal(baby.inheritPower, Math.round(baby.stats.power * baby.talentPct));
  }
  void c;
});

test("AI 防呆：理智 < 50 不買會害理智的黑貨、重傷不買燃血類、有替死符不重複買", () => {
  const state = setup(2);
  const [s] = state.samsarites;
  s.stats.sanity = 40;
  for (const id of ["t1_33", "t1_35", "t5_35", "t5_38"]) assert.equal(aiAllowed(state, s, getShopItem(id)), false, id);
  assert.equal(aiAllowed(state, s, getShopItem("t5_01")), true);
  s.stats.sanity = 60;
  assert.equal(aiAllowed(state, s, getShopItem("t1_33")), true);
  s.injury = 2;
  for (const id of ["t1_37", "t2_38", "t3_40"]) assert.equal(aiAllowed(state, s, getShopItem(id)), false, id);
});

test("AI 催生黑貨：只有愛搞事、有雙向淨好感 >= 60 的對象時才偷買；沒有對象不買", () => {
  const keep = CONFIG.shopping.dramaChance;
  CONFIG.shopping.dramaChance = 1;
  try {
    for (const hasPartner of [false, true]) {
      const state = setup(2, { seed: 63, spent: 4000 });
      const [a, b] = state.samsarites;
      a.tags = ["green_tea"];
      a.gear = { ...FULL4 };
      a.geneLock = 1; // C 級上限 1 階：不會再強化／突破，輪到搞事骰
      a.enhanceCount = CONFIG.gene.tiers[1].enhanceCap;
      a.wallet = 1e7;
      if (hasPartner) love(state, a, b, 70);
      Object.assign(marketOf(state).slots[7], { itemId: "t3_38", sold: false });
      dailyShopping(state);
      assert.equal(marketOf(state).slots[7].sold, hasPartner, hasPartner ? "有對象：買了" : "沒有對象：不買");
      assert.equal(state.samsarites.some((s) => s.location === "pod"), hasPartner);
    }
  } finally {
    CONFIG.shopping.dramaChance = keep;
  }
  assert.ok(affinity);
});

// ───────── 4-E-8 收尾：孕育 1%/天＋助孕、破鎖耗材去誤導化、前 3 世界房間文字 ─────────
import { birthChanceOf, isCozy, dailyLineage } from "../src/engine/lineage.js";
import { currentDay as dayOf } from "../src/engine/core.js";

test("自然孕育：基礎 1.0%/天；bond 流派 +0.5%；雙方留守、沒重傷且社交助興再 +1.5%（可疊加）", () => {
  assert.equal(CONFIG.lineage.birthChance, 0.01);
  const state = setup(4);
  const [cap, a, b] = state.samsarites;
  love(state, a, b, 80);
  assert.ok(Math.abs(birthChanceOf(state, a, b) - 0.01) < 1e-9, "沒有隊長／流派：只有基礎");
  // bond 流派
  cap.tags = ["mad_matchmaker"];
  appointCaptain(state, cap.id);
  assert.equal(state.squad.style, "bond");
  assert.ok(Math.abs(birthChanceOf(state, a, b) - 0.015) < 1e-9, "bond +0.5%");
  // 社交助興之一：帶著沒用掉的同行好感耗材（同心香囊）
  a.consumables = ["t3_32"];
  assert.equal(isCozy(state, a, b), true);
  assert.ok(Math.abs(birthChanceOf(state, a, b) - 0.03) < 1e-9, "bond 0.5% + 助興 1.5% + 基礎 1%");
  a.consumables = [];
  assert.equal(isCozy(state, a, b), false);
  // 之二：雙向淨好感 >= 85 且私房錢充裕
  love(state, a, b, 10);
  a.wallet = 600;
  b.wallet = 600;
  assert.equal(isCozy(state, a, b), true);
  b.wallet = 100;
  assert.equal(isCozy(state, a, b), false, "私房錢不夠");
  // 重傷或不在空間：不加成
  b.wallet = 600;
  b.injury = 2;
  assert.ok(Math.abs(birthChanceOf(state, a, b) - 0.015) < 1e-9, "重傷：沒有助興加成");
  b.injury = 0;
  b.location = "dungeon";
  assert.ok(Math.abs(birthChanceOf(state, a, b) - 0.015) < 1e-9);
});

test("合道仙露：全隊進入 3 天社交助興狀態，孕育檢定 +1.5%", () => {
  const state = setup(3);
  const [a, b] = state.samsarites;
  love(state, a, b, 80);
  assert.equal(isCozy(state, a, b), false);
  assert.equal(buyItem(state, "t5_32", a.id).ok, true);
  assert.equal(a.cozyUntilDay, dayOf(state) + CONFIG.lineage.cozyDays);
  assert.equal(isCozy(state, a, b), true);
  state.tick += CONFIG.ticksPerDay * (CONFIG.lineage.cozyDays + 1);
  assert.equal(isCozy(state, a, b), false, "過期");
});

test("自然孕育實測：符合條件的一對每天約 1%（統計），冷卻與雙向淨好感 >= 75 照舊", () => {
  let births = 0;
  const trials = 4000;
  for (let i = 0; i < trials; i++) {
    const state = setup(2, { seed: 300 + i });
    const [a, b] = state.samsarites;
    love(state, a, b, 80);
    state.squad.captainId = null;
    dailyLineage(state);
    if (state.samsarites.some((s) => s.location === "pod")) births++;
  }
  assert.ok(births / trials > 0.005 && births / trials < 0.02, `孕育比例 ${(births / trials).toFixed(4)}`);
});

test("破鎖耗材去誤導化：只有花費折扣（T1～2 20%／T3～4 25%／T5 30%），結構與描述都沒有成功率", () => {
  const want = { t1_30: 0.2, t2_29: 0.2, t3_29: 0.25, t4_29: 0.25, t5_29: 0.3 };
  for (const [id, disc] of Object.entries(want)) {
    const item = getShopItem(id);
    assert.equal(item.effect.costDiscount, disc, id);
    assert.equal("rateBonus" in item.effect, false, `${id} 不該有 rateBonus`);
    assert.ok(!item.desc.includes("成功率"), `${id} 描述不該提成功率`);
    assert.ok(item.desc.includes(`-${Math.round(disc * 100)}%`), `${id} 描述要寫折扣`);
  }
  const state = setup(1, { level: 3 });
  const [s] = state.samsarites;
  s.rank = "A";
  s.geneLock = 1;
  buyItem(state, "t3_29", s.id);
  assert.deepEqual(Object.keys(s.geneBuff).sort(), ["costDiscount", "target"]);
});

test("前 3 個世界（密室殺陣、喪屍危城、猛鬼宿舍）：房間文字與首通獎勵名稱對齊新世界觀，不再是舊題材或佔位字", () => {
  for (const id of ["ghost_village", "ch1_02", "silent_ark"]) {
    const d = DUNGEONS.find((x) => x.id === id);
    assert.equal(d.rooms.length, CONFIG.dungeon.chapters[0].rooms);
    for (const r of d.rooms) {
      assert.ok(!/待命名|佔位/.test(r.name + r.pass + r.fail), `${id} 還有佔位字`);
      assert.ok(r.fail.includes("{name}"), `${id}／${r.name} 的失敗句要有 {name}`);
    }
  }
  const old = /紙紮|祠堂|餓鬼宴席|氣閘艙|冷凍艙|反應爐|艦橋|殖民船/;
  for (const id of ["ghost_village", "silent_ark"]) {
    const d = DUNGEONS.find((x) => x.id === id);
    assert.ok(!old.test(d.rooms.map((r) => r.name + r.pass + r.fail).join("")), `${id} 還有舊題材房間文字`);
    assert.ok(!/鬼道|陰陽眼|神經加速器|義體|脈衝切割/.test(d.specialRewards.map((r) => r.name).join("")), `${id} 首通獎勵名稱還是舊的`);
    assert.equal(d.specialRewards.length, 3);
  }
  assert.equal(DUNGEONS.find((x) => x.id === "ghost_village").specialRewards[0].name, "破局者手札");
  assert.equal(DUNGEONS.find((x) => x.id === "silent_ark").specialRewards[2].name, "桃木驅鬼釘");
});
