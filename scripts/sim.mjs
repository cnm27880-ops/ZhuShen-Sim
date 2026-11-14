// 平衡模擬器（Phase 4-A）：用多組種子讓「模擬玩家」自己玩，統計各章尾王首通天數、死亡數、破產率。
// 用法：
//   npm run sim                         （預設 100 組種子、每局 120 天）
//   npm run sim -- --seeds=200 --days=450
// 只讀引擎（src/engine），不碰畫面；改 src/data/config.js 的數字後再跑一次就能看到差別。
//
// 模擬玩家的決策（每天一次，在自動派遣之前）：
//   1. 補人：主神空間 + 副本中的人數少於 TEAM_TARGET 時，抽最便宜的卡池（要留 RESERVE_DAYS 天維持費）
//   2. 裝備：戰力前 4 名，依序換上已解鎖的最好武器、防具（買得起、而且比身上的好才買）
//   3. 強化：再有閒錢就買戰力強化
//   4. 其他（許願、主神搞事）不理會：許願會超時、主神搞事視同照辦
//   派遣交給引擎的自動派遣（通關率 ≥ CONFIG.auto.minClearChance 才出門）
// 注意：基因鎖、四卡池、新強化系統在 Phase 4-B 才做，所以現在第 2 章以後的天數還不準。

import { CONFIG, GACHA_POOLS } from "../src/data/config.js";
import { SHOP_ITEMS } from "../src/data/shop.js";
import { createNewGame, currentDay, canAfford, pullGacha, upkeepOf } from "../src/engine/core.js";
import { step } from "../src/engine/dispatch.js";
import { effectivePower } from "../src/engine/tags.js";
import { buyItem, checkBuy } from "../src/engine/shop.js";

const TEAM_TARGET = 5; // 想維持的人數（一隊 4 人 + 1 個替補）
const RESERVE_DAYS = 3; // 買東西後至少留幾天的維持費

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, Number(v)];
  })
);
const SEEDS = args.seeds || 100;
const DAYS = args.days || 120;

function dailyUpkeep(state) {
  return state.samsarites.filter((s) => s.location !== "dungeon").reduce((n, s) => n + upkeepOf(s, state), 0);
}

/** 花完還留得住 RESERVE_DAYS 天維持費、而且不進負債才買 */
function canSpare(state, cost) {
  return state.points - cost >= dailyUpkeep(state) * RESERVE_DAYS && canAfford(state, cost);
}

function gearPower(id) {
  return SHOP_ITEMS.find((i) => i.id === id)?.effect?.power ?? 0;
}

function botDay(state) {
  // 1. 補人
  const cheapest = [...GACHA_POOLS].sort((a, b) => a.cost - b.cost)[0];
  while (state.samsarites.filter((s) => s.location !== "pod").length < TEAM_TARGET && canSpare(state, cheapest.cost)) {
    if (!pullGacha(state, cheapest.id)) break;
  }
  // 2. 裝備（只幫在家的戰力前 4 名買）
  const top = state.samsarites
    .filter((s) => s.location === "space")
    .sort((a, b) => effectivePower(b) - effectivePower(a))
    .slice(0, CONFIG.partyMax);
  const gear = SHOP_ITEMS.filter((i) => i.kind === "gear").sort((a, b) => (b.effect.power ?? 0) - (a.effect.power ?? 0));
  for (const s of top) {
    for (const slot of ["weapon", "armor"]) {
      const best = gear.find((i) => i.slot === slot && checkBuy(state, i, s).ok && canSpare(state, i.price));
      if (best && gearPower(best.id) > gearPower(s.gear?.[slot])) buyItem(state, best.id, s.id);
    }
  }
  // 3. 強化
  const enh = SHOP_ITEMS.filter((i) => i.kind === "enhance" && i.effect.power).sort((a, b) => b.effect.power - a.effect.power);
  for (const s of top) {
    for (const item of enh) while (checkBuy(state, item, s).ok && canSpare(state, item.price)) buyItem(state, item.id, s.id);
  }
}

function playOne(seed) {
  const state = createNewGame(seed);
  state.settings.autoDispatch = true;
  const botTick = CONFIG.auto.dispatchAtTick - 1; // 自動派遣前一個時段做決策
  let bankruptDay = null;
  let lowestPoints = state.points;
  while (currentDay(state) <= DAYS && !state.gameOver) {
    if (state.tick % CONFIG.ticksPerDay === botTick) botDay(state);
    step(state);
    lowestPoints = Math.min(lowestPoints, state.points);
  }
  if (state.gameOver) bankruptDay = currentDay(state);
  const stats = Object.values(state.dungeonStats);
  return {
    clearDay: state.chapterClearDay,
    bankruptDay,
    deaths: state.graveyard.filter((g) => !g.cause.includes("回收爐")).length,
    alive: state.samsarites.length,
    points: state.points,
    lowestPoints,
    level: state.spaceLevel,
    attempts: stats.reduce((n, d) => n + d.attempts, 0),
    clears: stats.reduce((n, d) => n + d.clears, 0),
    totalSpent: state.totalSpent,
  };
}

const pctl = (arr, p) => {
  if (!arr.length) return "-";
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
};
const avg = (arr) => (arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : "-");

const t0 = Date.now();
const results = [];
for (let seed = 1; seed <= SEEDS; seed++) results.push(playOne(seed));

const TARGET = { 1: 30, 2: 80, 3: 165, 4: 300, 5: 450 }; // 露葵 2026-11-14 定的錨點
console.log(`\n主神空間平衡模擬：${SEEDS} 組種子 × 最多 ${DAYS} 天（${((Date.now() - t0) / 1000).toFixed(1)} 秒）\n`);
console.log("章節 | 首通尾王比例 | 天數 P25 / 中位數 / P75 | 目標天數 | 中位數偏差");
for (let ch = 1; ch <= 5; ch++) {
  const days = results.map((r) => r.clearDay[ch]).filter(Boolean);
  const med = pctl(days, 0.5);
  const diff = typeof med === "number" ? `${med > TARGET[ch] ? "+" : ""}${Math.round(((med - TARGET[ch]) / TARGET[ch]) * 100)}%` : "-";
  console.log(`第 ${ch} 章 | ${String(Math.round((days.length / SEEDS) * 100)).padStart(3)}% | ${pctl(days, 0.25)} / ${med} / ${pctl(days, 0.75)} | Day ${TARGET[ch]} | ${diff}`);
}
const bankrupt = results.filter((r) => r.bankruptDay);
console.log(`\n遊戲結束（沒人又借不到錢）：${bankrupt.length}/${SEEDS} 局${bankrupt.length ? `，中位數第 ${pctl(bankrupt.map((r) => r.bankruptDay), 0.5)} 天` : ""}`);
console.log(`曾經負債的局：${results.filter((r) => r.lowestPoints < 0).length}/${SEEDS}`);
console.log(`平均死亡人數：${avg(results.map((r) => r.deaths))}　平均存活：${avg(results.map((r) => r.alive))}　平均最終積分：${avg(results.map((r) => r.points))}`);
console.log(`平均出征場數：${avg(results.map((r) => r.attempts))}　平均通關場數：${avg(results.map((r) => r.clears))}　平均累積花費：${avg(results.map((r) => r.totalSpent))}`);
console.log(`最終空間等級分布：${[1, 2, 3, 4, 5].map((lv) => `Lv.${lv}×${results.filter((r) => r.level === lv).length}`).join("　")}`);
console.log("\n註：基因鎖、四卡池、新強化系統在 Phase 4-B 才做，第 2 章以後的數字目前只供參考。\n");
