// Phase 4-C-1：戰鬥副屬性（防禦減傷／速度鎖血／健康免猝死／hp 休養與懲罰減半／氣運加成）
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/data/config.js";
import { DUNGEONS } from "../src/data/dungeons.js";
import { createNewGame, createSamsarite, endOfDay, setInjury } from "../src/engine/core.js";
import { effectivePower, subStat, defenseChance, speedSaveChance, hpRestBonus, injuryPowerPct, luckRewardPct } from "../src/engine/tags.js";
import { hurt, rewardMultiplier } from "../src/engine/dungeon.js";
import { buyItem } from "../src/engine/shop.js";

const dungeon = DUNGEONS[0];

/** 一個乾淨的遊戲 + 一個無標籤的 C 級（標籤會干擾戰力與減免，測試先清掉） */
function setup(seed = 1) {
  const state = createNewGame(seed);
  state.samsarites = [];
  state.points = 1000000;
  const s = createSamsarite(state, "C");
  s.tags = [];
  state.samsarites.push(s);
  return { state, s };
}
const fakeRun = (s) => ({ enteredInjury: { [s.id]: s.injury }, deaths: [], firstTime: false, partyIds: [s.id] });

test("subStat：初始 + 強化累計 + 裝備白值，且不吃基因鎖乘區", () => {
  const { state, s } = setup();
  s.stats.defense = 10;
  s.geneLock = 3; // 戰力乘區 ×4.8，副屬性不受影響
  assert.equal(subStat(s, "defense"), 10);
  assert.equal(buyItem(state, "armor_cloth", s.id).ok, true); // 防禦 +4、生命 +10
  assert.equal(subStat(s, "defense"), 14);
  assert.equal(subStat(s, "hp"), s.stats.hp + 10);
});

test("防禦與速度機率公式與上限", () => {
  const { s } = setup();
  s.stats.defense = 60;
  s.stats.speed = 80;
  assert.equal(defenseChance(s), 0.5);
  assert.equal(speedSaveChance(s), 0.5);
  s.stats.defense = 100000;
  s.stats.speed = 100000;
  assert.equal(defenseChance(s), 0.65, "防禦上限 65%");
  assert.equal(speedSaveChance(s), 0.5, "速度上限 50%");
});

test("hp 休養加成：超過 100 每滿 40 點 +25%，可超過 100%", () => {
  const { s } = setup();
  s.stats.hp = 100;
  assert.deepEqual(hpRestBonus(s), { sure: 0, chance: 0 });
  s.stats.hp = 140;
  assert.deepEqual(hpRestBonus(s), { sure: 0, chance: 0.25 });
  s.stats.hp = 260; // 4 階 = +100%
  assert.deepEqual(hpRestBonus(s), { sure: 1, chance: 0 });
  s.stats.hp = 300; // 5 階 = +125%
  const r = hpRestBonus(s);
  assert.equal(r.sure, 1);
  assert.ok(Math.abs(r.chance - 0.25) < 1e-9);
});

test("每日休養：hp 夠高時必多恢復 1 級（致命傷 → 重傷）", () => {
  const { state, s } = setup();
  s.stats.hp = 260;
  setInjury(s, 3);
  endOfDay(state);
  assert.equal(s.injury, 2);
  assert.equal(s.restDaysLeft, 3, "休養天數改依新等級重算");
});

test("傷勢戰力懲罰：重傷 -20%、致命傷 -40%；總 hp ≥ 180 時減半", () => {
  const { s } = setup();
  s.stats.hp = 100;
  const base = effectivePower(s);
  setInjury(s, 2);
  assert.equal(injuryPowerPct(s), -0.2);
  assert.equal(effectivePower(s), Math.round(base * 0.8));
  setInjury(s, 3);
  assert.equal(injuryPowerPct(s), -0.4);
  s.stats.hp = 180;
  assert.equal(injuryPowerPct(s), -0.2, "hp 180 懲罰減半");
  setInjury(s, 1);
  assert.equal(injuryPowerPct(s), 0, "輕傷沒有戰力懲罰");
});

test("氣運：存活隊員平均 luck 每 1 點 +0.5% 結算積分，上限 +50%", () => {
  const { state, s } = setup();
  s.stats.luck = 20;
  assert.ok(Math.abs(luckRewardPct([s]) - 0.1) < 1e-9);
  const noLuck = rewardMultiplier(state, dungeon, []);
  assert.ok(Math.abs(rewardMultiplier(state, dungeon, [s]) / noLuck - 1.1) < 1e-9);
  s.stats.luck = 100000;
  assert.equal(luckRewardPct([s]), CONFIG.combat.luckReward.max);
  assert.equal(luckRewardPct([]), 0);
});

test("健康免猝死：進房前無傷的人，被打到最重也只會落入致命傷，不會直接戰死", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const { state, s } = setup(seed);
    s.stats.defense = 0;
    s.stats.speed = 0;
    s.sabotaged = true; // 動過手腳：死亡率加成 + 額外 +1 級，最壞情況
    hurt(state, fakeRun(s), s, dungeon);
    assert.ok(state.samsarites.includes(s), `種子 ${seed} 健康的人不該戰死`);
    assert.ok(s.injury <= 3);
  }
});

test("帶傷的人仍然會死；速度鎖血會讓部分人免死並落入致命傷", () => {
  let died = 0;
  let saved = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const { state, s } = setup(seed);
    s.stats.defense = 0;
    s.stats.speed = 100000; // 鎖血機率 50%
    setInjury(s, 3);
    const run = fakeRun(s);
    hurt(state, run, s, dungeon);
    if (state.samsarites.includes(s)) {
      saved += 1;
      assert.equal(s.injury, 3, "鎖血後是致命傷");
    } else died += 1;
  }
  assert.ok(died > 60 && saved > 60, `死 ${died}／鎖血 ${saved}：兩種結果都要出現`);
});

test("防禦減傷：原判輕傷則免傷（健康的人完全沒事）", () => {
  let untouched = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const { state, s } = setup(seed);
    s.stats.defense = 100000; // 減傷機率 65%
    hurt(state, fakeRun(s), s, dungeon);
    if (s.injury === 0) untouched += 1;
  }
  assert.ok(untouched > 20, `免傷 ${untouched} 次，應該會出現`);
});
