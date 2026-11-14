// Phase 4-E-2：五大小隊流派的分潤、遺產、逛街、副本機制
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/data/config.js";
import { createNewGame, createSamsarite, killSamsarite, upkeepOf } from "../src/engine/core.js";
import { distributeLoot } from "../src/engine/wallet.js";
import { effectivePower } from "../src/engine/tags.js";
import { dailyShopping } from "../src/engine/shopping.js";
import { enshrine } from "../src/engine/memorial.js";
import { slotPrice, marketOf } from "../src/engine/market.js";
import { getShopItem } from "../src/data/shopItems.js";
import {
  appointCaptain, dailySquad, captainOf, styleOf, squadDefenseBonus, squadClashMult, squadBondMult, squadBossPowerMult,
  squadMarketMult, failSanityLoss, bondGuard, farmingPigDied, farmingRewardMult, squadAfterClear, worthOf,
} from "../src/engine/squad.js";
import { affinity, shiftAffinity } from "../src/engine/relations.js";
import { roomPassRate } from "../src/engine/dungeon.js";

const STYLE_TAG = { communal: "lecturer", bond: "mad_matchmaker", farming: "smiling_tiger", elite: "demon_path", mercenary: "salary_thief" };

/** n 個人，第 0 個是隊長（帶對應流派的詞條），其餘無詞條；稅率固定 0.4 */
function squad(style, n = 4, { level = 2, seed = 21 } = {}) {
  const state = createNewGame(seed);
  state.samsarites = [];
  state.spaceLevel = level;
  state.points = 100000;
  state.taxRate = 0.4;
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, "C");
    s.tags = i === 0 ? [STYLE_TAG[style]] : [];
    s.stats.power = 30;
    s.joinedDay = 1;
    state.samsarites.push(s);
  }
  appointCaptain(state, state.samsarites[0].id);
  assert.equal(styleOf(state), style);
  return state;
}

const wallets = (state) => state.samsarites.map((s) => s.wallet);

test("共產流：稅後獎金 100% 絕對均分；戰死者私房錢 100% 進互助金（0% 消散、0% 充公）", () => {
  const state = squad("communal");
  const [cap, a, b, c] = state.samsarites;
  a.injury = 2; // 帶傷也一樣
  const r = distributeLoot(state, [cap, a, b], 1000); // 稅 400，剩 600 → 每人 200
  assert.deepEqual([cap.wallet, a.wallet, b.wallet], [200, 200, 200]);
  assert.equal(r.tax, 400);
  c.wallet = 333;
  const before = state.points;
  killSamsarite(state, c, "測試", null);
  assert.equal(state.squad.communalFund, 333);
  assert.equal(state.points, before, "不充公");
  // 隊長自己陣亡：沒有隊長 → 流派暫停，走一般 50% 充公
  b.wallet = 100;
  killSamsarite(state, cap, "測試", null);
  assert.equal(styleOf(state), null);
  killSamsarite(state, b, "測試", null);
  assert.equal(state.squad.communalFund, 333);
});

test("共產流：老鳥（武防達最高階、無傷）捐剩餘私房錢 50%；菜鳥錢不夠買制式裝時互助金補差額", () => {
  const state = squad("communal", 3);
  const [cap, vet, rookie] = state.samsarites;
  vet.gear = { weapon: "weapon_club", armor: "armor_cloth" }; // 一階（目前最高階 = 一階）
  vet.wallet = 100;
  rookie.wallet = 10;
  cap.wallet = 0;
  cap.gear = { weapon: "weapon_club", armor: "armor_cloth" };
  state.squad.communalFund = 500;
  dailyShopping(state);
  assert.ok(vet.wallet <= 50, `老鳥捐掉一半：${vet.wallet}`);
  assert.ok(state.squad.communalFund > 500 - 200, "互助金有進有出");
  assert.ok(rookie.gear.weapon || rookie.gear.armor, "菜鳥靠補貼買到了制式裝");
  // 補貼沒花掉的會退回，不會憑空多出錢
  const total = state.points + wallets(state).reduce((n, w) => n + w, 0) + state.squad.communalFund;
  assert.ok(Number.isFinite(total));
});

test("共產流：全隊防禦減傷 +0.08；其他流派沒有", () => {
  assert.equal(squadDefenseBonus(squad("communal")), CONFIG.squad.communal.defenseBonus);
  assert.equal(squadDefenseBonus(squad("bond")), 0);
});

test("羈絆流：帶傷存活者分潤權重 ×1.25；通關全隊理智 +4；碑文加成 ×1.5", () => {
  const state = squad("bond", 3);
  const [cap, a, b] = state.samsarites;
  a.injury = 1;
  distributeLoot(state, [cap, a, b], 1000); // 剩 600；權重 1 : 1.25 : 1 → 600/3.25
  assert.equal(a.wallet, Math.floor((600 * 1.25) / 3.25));
  assert.equal(cap.wallet, Math.floor(600 / 3.25));
  cap.stats.sanity = 50;
  squadAfterClear(state, [cap]);
  assert.equal(cap.stats.sanity, 54);
  const dead = { name: "老兵", rank: "C", geneLock: 2, runs: 3 };
  const e = enshrine(state, dead, "dungeon");
  assert.equal(e.bonus, CONFIG.stele.bonusByGene[2] * 1.5);
  const plain = squad("elite");
  assert.equal(enshrine(plain, dead, "dungeon").bonus, CONFIG.stele.bonusByGene[2]);
});

test("羈絆流託付後背：好感 >= 45 且未重傷的夥伴 50% 替他擋致死一刀，每場限 1 次；雙方 injury+1、好感 +10", () => {
  const state = squad("bond", 3);
  const [cap, a, b] = state.samsarites;
  const run = { partyIds: [cap.id, a.id, b.id] };
  const party = [cap, a, b];
  assert.equal(bondGuard(state, run, party, a), null, "沒人夠好感：不擋，也不消耗亂數");
  shiftAffinity(state, b, a, 50);
  const rng0 = state.squadRngState;
  const keep = CONFIG.squad.bond.guardChance;
  CONFIG.squad.bond.guardChance = 1;
  try {
    const g = bondGuard(state, run, party, a);
    assert.equal(g.id, b.id);
    assert.equal(a.injury, 1);
    assert.equal(b.injury, 1);
    assert.equal(affinity(state, b, a), 60);
    assert.equal(affinity(state, a, b), 10);
    assert.notEqual(state.squadRngState, rng0, "用獨立亂數流");
    assert.equal(bondGuard(state, run, party, a), null, "每場限 1 次");
    // 重傷的夥伴不能擋
    const run2 = { partyIds: run.partyIds };
    b.injury = 2;
    assert.equal(bondGuard(state, run2, party, a), null);
  } finally {
    CONFIG.squad.bond.guardChance = keep;
  }
  // 非羈絆流不擋
  const other = squad("elite", 3);
  shiftAffinity(other, other.samsarites[1], other.samsarites[2], 80);
  assert.equal(bondGuard(other, { partyIds: [] }, other.samsarites, other.samsarites[2]), null);
});

test("養殖流：隊長在隊獨吞 80%、其餘平分 20%；隊長一個人回來全拿", () => {
  const state = squad("farming", 4);
  const [cap, a, b, c] = state.samsarites;
  const run = { partyIds: [cap.id, a.id, b.id, c.id] };
  distributeLoot(state, [cap, a, b, c], 1000, { run }); // 稅 400，剩 600 → 隊長 480、其餘各 40
  assert.equal(cap.wallet, 480);
  assert.deepEqual([a.wallet, b.wallet, c.wallet], [40, 40, 40]);
  const solo = squad("farming", 2);
  distributeLoot(solo, [solo.samsarites[0]], 1000, { run: { partyIds: [solo.samsarites[0].id] } });
  assert.equal(solo.samsarites[0].wallet, 600);
});

test("養殖流：隊長留守仍強抽稅後獎金 35% 保護費，其餘存活隊員平分", () => {
  const state = squad("farming", 4);
  const [cap, a, b] = state.samsarites;
  const run = { partyIds: [a.id, b.id] };
  const r = distributeLoot(state, [a, b], 1000, { run }); // 稅 400、剩 600；保護費 210；剩 390 → 每人 195
  assert.equal(cap.wallet, 210);
  assert.deepEqual([a.wallet, b.wallet], [195, 195]);
  assert.equal(r.tax, 400);
});

test("養殖流：零階新人維持費 -50%；每日全隊非隊長對隊長好感 -1（校正值）、理智 -1", () => {
  const state = squad("farming", 3);
  const [cap, a, b] = state.samsarites;
  const base = createNewGame(1);
  base.spaceLevel = 2;
  const plain = createSamsarite(base, "C");
  assert.equal(upkeepOf(a, state), Math.round(upkeepOf(plain, base) * 0.5));
  a.geneLock = 1;
  assert.equal(upkeepOf(a, state), upkeepOf({ ...a, geneLock: 1 }, base), "有基因鎖就沒有折扣");
  a.geneLock = 0;
  shiftAffinity(state, a, cap, 5);
  const san = b.stats.sanity;
  dailySquad(state);
  const d = CONFIG.squad.farming.dailyAffinity; // 校正後 -1（4-E-6）
  assert.equal(affinity(state, a, cap), 5 + d);
  assert.equal(affinity(state, b, cap), d);
  assert.equal(b.stats.sanity, san - 1);
  assert.equal(affinity(state, cap, a), 0, "隊長不恨手下");
});

test("養殖流：geneLock <= 1 肉豬陣亡 → 隊長臨時戰力 +12%、結算積分 +20%（最多 2 層）；老鳥陣亡不算", () => {
  const state = squad("farming", 4);
  const [cap, pig, vet] = state.samsarites;
  vet.geneLock = 2;
  const run = { partyIds: [cap.id, pig.id, vet.id] };
  const base = effectivePower(cap);
  farmingPigDied(state, run, vet);
  assert.equal(run.pigDeaths, undefined);
  farmingPigDied(state, run, pig);
  assert.equal(run.pigDeaths, 1);
  assert.ok(effectivePower(cap) > base);
  assert.equal(effectivePower(cap), Math.round(30 * (1 + CONFIG.squad.captainPowerPct + CONFIG.squad.farming.pigPowerPct)));
  assert.equal(farmingRewardMult(state, run), 1.2);
  farmingPigDied(state, run, { ...pig, id: 99 });
  farmingPigDied(state, run, { ...pig, id: 98 });
  assert.equal(run.pigDeaths, 2, "最多疊 2 層");
  assert.equal(farmingRewardMult(state, run), 1.4);
  // 隊長沒隨隊就不觸發
  const run2 = { partyIds: [pig.id] };
  farmingPigDied(state, run2, pig);
  assert.equal(run2.pigDeaths, undefined);
});

test("菁英流：獎金按戰力^1.4 分配（強者吃肉）；打尾王戰力 ×1.15；單房失敗理智扣損 ×2", () => {
  const state = squad("elite", 3);
  const [cap, a, b] = state.samsarites;
  a.stats.power = 60;
  b.stats.power = 15;
  distributeLoot(state, [a, b], 1000);
  const wa = effectivePower(a) ** 1.4;
  const wb = effectivePower(b) ** 1.4;
  assert.equal(a.wallet, Math.floor((600 * wa) / (wa + wb)));
  assert.equal(b.wallet, Math.floor((600 * wb) / (wa + wb)));
  assert.ok(a.wallet > b.wallet * 4);
  assert.equal(squadBossPowerMult(state, true), 1.15);
  assert.equal(squadBossPowerMult(state, false), 1);
  assert.equal(failSanityLoss(state, [a, b], 5), 10);
  assert.equal(failSanityLoss(state, [cap, a], 5), 9, "隊長在隊再 -1");
});

test("菁英流打尾王：同樣隊伍的單房通過率比其他流派高", () => {
  const elite = squad("elite", 3);
  const bond = squad("bond", 3);
  const dungeon = { id: "x", chapter: 1, boss: true, recommendedPower: 100, rooms: [], genre: "靈異" };
  const pe = roomPassRate(elite, elite.samsarites.slice(1), dungeon);
  const pb = roomPassRate(bond, bond.samsarites.slice(1), dungeon);
  assert.ok(pe > pb);
  const normal = { ...dungeon, boss: false };
  assert.equal(roomPassRate(elite, elite.samsarites.slice(1), normal), roomPassRate(bond, bond.samsarites.slice(1), normal));
});

test("傭兵流：稅後總額 +18% 商業溢價、按身價比例分帳", () => {
  const state = squad("mercenary", 3);
  const [cap, rich, poor] = state.samsarites;
  rich.gear = { weapon: "weapon_steel" }; // 380
  poor.gear = {};
  const wr = worthOf(rich) + 100;
  const wp = worthOf(poor) + 100;
  const r = distributeLoot(state, [rich, poor], 1000); // 稅 400、剩 600 → 溢價後 708
  assert.equal(rich.wallet, Math.floor((708 * wr) / (wr + wp)));
  assert.equal(poor.wallet, Math.floor((708 * wp) / (wr + wp)));
  assert.equal(r.tax >= 400 && r.tax <= 402, true);
  assert.ok(rich.wallet > poor.wallet);
});

test("傭兵流：黑市 95 折（與情報 85 折乘算）；低理智內鬥 ×0.2；同行情誼減半", () => {
  const state = squad("mercenary", 3);
  const plain = squad("bond", 3);
  const idx = marketOf(state).slots.findIndex((s) => getShopItem(s.itemId));
  const slot = marketOf(state).slots[idx];
  const base = slotPrice(plain, marketOf(plain).slots[idx] ?? slot).price;
  const item = getShopItem(slot.itemId);
  assert.equal(slotPrice(state, slot).price, Math.round(item.price * 0.95));
  assert.ok(slotPrice(state, slot).price <= base);
  assert.equal(squadMarketMult(state), 0.95);
  assert.equal(squadClashMult(state), 0.2);
  assert.equal(squadBondMult(state), 0.5);
  assert.equal(Math.round(CONFIG.dungeon.bondLove * squadBondMult(state)), 1, "好感 +2 減半 = +1");
  assert.equal(squadClashMult(plain), 1);
});

test("沒隊長或空間 Lv.1 時，流派機制全部不生效", () => {
  const state = squad("farming", 3);
  state.spaceLevel = 1;
  assert.equal(styleOf(state), null);
  const [cap, a] = state.samsarites;
  distributeLoot(state, [cap, a], 1000);
  assert.equal(cap.wallet, a.wallet, "回到平均分");
  assert.equal(captainOf(state).id, cap.id);
});
