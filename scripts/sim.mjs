// 平衡模擬器（Phase 4-A 建立、4-B 升級）：用多組種子讓「模擬玩家」自己玩，統計各章尾王首通天數、死亡數、破產率。
// 用法：
//   npm run sim                         （預設 100 組種子、每局 120 天）
//   npm run sim -- --seeds=100 --days=450
//   可選：--roster=6（名冊上限）、--reserve=5（買東西後至少留幾天維持費）、--growReserve=8（養成後至少留幾天）、--trace=3（印出第 3 組種子每 10 天的狀況，除錯用；加 --events=1 連每場副本與死亡都印）
// 只讀引擎（src/engine），不碰畫面；改 src/data/config.js 的數字後再跑一次就能看到差別。
//
// 模擬玩家的決策（每天一次，在自動派遣之前）：
//   1. 補人：不在催熟艙的人數少於 TEAM_TARGET 時，抽「目前買得起、也解鎖了的最高階卡池」（遵守空間等級與結晶限制）
//   2. 裝備：核心 4 人（階級高的優先、同階級看戰力），依序換上已解鎖的最好武器、防具
//   3. 養成：核心 4 人的「強化／突破基因鎖」，每次挑全隊最便宜、買得起的那一步（所以會點滿當階強化再突破）
//   4. 剩錢：名冊還沒滿時，用買得起的最高階卡池多抽幾次（滿了就不抽、也不回收）
//   5. 其他（許願、主神搞事）不理會：許願會超時、主神搞事視同照辦
//   派遣交給引擎的自動派遣（通關率 ≥ CONFIG.auto.minClearChance 才出門；尾王守門由引擎處理）

import { CONFIG } from "../src/data/config.js";
import { DUNGEONS } from "../src/data/dungeons.js";
import { SHOP_ITEMS } from "../src/data/shop.js";
import { createNewGame, currentDay, canAfford, pullGacha, checkGacha, upkeepOf } from "../src/engine/core.js";
import { step } from "../src/engine/dispatch.js";
import { effectivePower } from "../src/engine/tags.js";
import { buyItem, checkBuy } from "../src/engine/shop.js";
import { enhance, checkEnhance, breakGene, checkBreakGene } from "../src/engine/growth.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, Number(v)];
  })
);
// 校正用的「執行時覆寫」（只改這個模擬行程裡的數字，不會動資料檔；試出好數字後再手動寫回 dungeons.js／config.js）：
//   --rmult=1,1,0.8,0.8,0.7   各章「一般關」推薦戰力 R 的倍率   --bossr=1,1,1,1,1   各章「尾王」R 的倍率
//   --reward=1,1,1.2,1.2,1.2  各章通關基礎獎勵的倍率（含尾王）
//   --minClear=0.6            自動派遣的最低預估通關率  --growReserve=8   養成（強化／突破）後至少留幾天維持費
const listArg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1]?.split(",").map(Number);
const rmult = listArg("rmult");
const bossr = listArg("bossr");
const rewardMult = listArg("reward");
for (const d of DUNGEONS) {
  const rm = d.boss ? bossr : rmult;
  if (rm) d.recommendedPower = Math.round(d.recommendedPower * (rm[d.chapter - 1] ?? 1));
  if (rewardMult) d.reward = Math.round(d.reward * (rewardMult[d.chapter - 1] ?? 1));
}
if (args.minClear) CONFIG.auto.minClearChance = args.minClear;
const GROW_RESERVE_DAYS = args.growReserve ?? 8;
const SEEDS = args.seeds || 100;
const DAYS = args.days || 120;
const TEAM_TARGET = 5; // 想維持的人數（一隊 4 人 + 1 個替補）
const ROSTER_MAX = args.roster || 6; // 名冊上限（滿了就不再多抽）
const RESERVE_DAYS = args.reserve ?? 5; // 買東西後至少留幾天的維持費
const SURPLUS_RESERVE_DAYS = 10; // 「剩錢多抽」要留更多緩衝
const TRACE = args.trace || 0; // 除錯：指定一組種子，每 10 天印一次狀況
const RANK_VAL = { C: 0, B: 1, A: 2, S: 3 };

function dailyUpkeep(state) {
  return state.samsarites.filter((s) => s.location !== "dungeon").reduce((n, s) => n + upkeepOf(s, state), 0);
}

/** 花完還留得住 days 天維持費、而且不進負債才買 */
function canSpare(state, cost, days = RESERVE_DAYS) {
  return state.points - cost >= dailyUpkeep(state) * days && canAfford(state, cost);
}

function gearPower(id) {
  return SHOP_ITEMS.find((i) => i.id === id)?.effect?.power ?? 0;
}

const alive = (state) => state.samsarites.filter((s) => s.location !== "pod");

/** 核心 4 人：階級高的優先，同階級看有效戰力（會把錢投在最有成長空間的人身上） */
function core4(state) {
  return [...alive(state)].sort((a, b) => RANK_VAL[b.rank] - RANK_VAL[a.rank] || effectivePower(b) - effectivePower(a)).slice(0, CONFIG.partyMax);
}

/** 目前買得起、也解鎖的最高階卡池（回傳 checkGacha 的結果），沒有就 null */
function bestPool(state, days = RESERVE_DAYS) {
  for (let i = CONFIG.gacha.pools.length - 1; i >= 0; i--) {
    const c = checkGacha(state, CONFIG.gacha.pools[i].id);
    if (c.ok && canSpare(state, c.cost, days)) return c;
  }
  return null;
}

function botDay(state) {
  // 1. 補人
  for (let guard = 0; alive(state).length < TEAM_TARGET && guard < 10; guard++) {
    const c = bestPool(state);
    if (!c || !pullGacha(state, c.pool.id)) break;
  }
  // 2. 裝備（只幫在家的核心 4 人買）
  const home = core4(state).filter((s) => s.location === "space");
  const gear = SHOP_ITEMS.filter((i) => i.kind === "gear").sort((a, b) => (b.effect.power ?? 0) - (a.effect.power ?? 0));
  for (const s of home) {
    for (const slot of ["weapon", "armor"]) {
      const best = gear.find((i) => i.slot === slot && checkBuy(state, i, s).ok && canSpare(state, i.price));
      if (best && gearPower(best.id) > gearPower(s.gear?.[slot])) buyItem(state, best.id, s.id);
    }
  }
  // 3. 養成：每次挑「最便宜、買得起」的一步（強化或突破基因鎖），直到沒有為止
  for (let guard = 0; guard < 200; guard++) {
    let pick = null;
    for (const s of core4(state).filter((x) => x.location === "space")) {
      for (const [kind, check] of [["enhance", checkEnhance(state, s.id)], ["breakGene", checkBreakGene(state, s.id)]]) {
        if (check.ok && canSpare(state, check.cost, GROW_RESERVE_DAYS) && (!pick || check.cost < pick.cost)) pick = { kind, id: s.id, cost: check.cost };
      }
    }
    if (!pick) break;
    (pick.kind === "enhance" ? enhance : breakGene)(state, pick.id);
  }
  // 4. 剩錢：名冊還沒滿時，用「買得起的最高階卡池」多抽（不再抽了就回收，避免無謂的抽卡損耗）
  for (let guard = 0; alive(state).length < ROSTER_MAX && guard < 10; guard++) {
    const c = bestPool(state, SURPLUS_RESERVE_DAYS);
    if (!c || !pullGacha(state, c.pool.id)) break;
  }
}

function playOne(seed) {
  const state = createNewGame(seed);
  state.settings.autoDispatch = true;
  const botTick = CONFIG.auto.dispatchAtTick - 1; // 自動派遣前一個時段做決策
  let bankruptDay = null;
  let lowestPoints = state.points;
  let income = 0;
  let seenReport = null;
  const byChapter = {}; // { 章: { runs, wins, deaths } }
  while (currentDay(state) <= DAYS && !state.gameOver) {
    if (state.tick % CONFIG.ticksPerDay === botTick) botDay(state);
    step(state);
    lowestPoints = Math.min(lowestPoints, state.points);
    if (seed === TRACE && args.events) {
      for (const ev of state.events) if (["runStart", "runEnd", "death", "gacha"].includes(ev.type)) console.log(`  [D${currentDay(state)}] ${ev.text.split("\n")[0].slice(0, 110)}`);
    }
    if (state.lastRun && state.lastRun !== seenReport) {
      // 同一個 step 可能結算好幾場，lastRun 只留最後一場；所以改看 runReports 佇列（上限 runReportMax，這裡每步清空）
    }
    for (const r of state.runReports.splice(0)) {
      const ch = DUNGEONS.find((d) => d.id === r.dungeonId)?.chapter ?? 0;
      const c = (byChapter[ch] ??= { runs: 0, wins: 0, deaths: 0 });
      c.runs += 1;
      if (r.success) c.wins += 1;
      c.deaths += r.deaths.length;
      income += r.reward;
    }
    seenReport = state.lastRun;
    state.events.length = 0; // 模擬不看畫面事件，順手清掉避免越積越多
    if (seed === TRACE && state.tick % (CONFIG.ticksPerDay * 10) === 0) {
      const who = alive(state).map((s) => `${s.rank}${s.geneLock}g${s.enhanceCount}e${s.insightCount}i/${effectivePower(s)}${s.location === "dungeon" ? "⚔" : s.injury ? "🩹" : ""}`).join(" ");
      console.log(`Day ${String(currentDay(state)).padStart(3)} Lv.${state.spaceLevel} 積分 ${String(state.points).padStart(7)} 結晶 ${state.karmaCrystals} 守門 ${JSON.stringify(state.chapterClears)} 死亡 ${state.graveyard.length} | ${who}`);
    }
  }
  if (state.gameOver) bankruptDay = currentDay(state);
  const stats = Object.values(state.dungeonStats);
  const people = alive(state);
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
    crystals: state.karmaCrystals,
    income,
    byChapter,
    topPower: Math.max(0, ...people.map(effectivePower)),
    maxGene: Math.max(0, ...people.map((s) => s.geneLock ?? 0)),
    ranks: people.reduce((m, s) => ((m[s.rank] = (m[s.rank] ?? 0) + 1), m), {}),
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

const TARGET = { 1: 30, 2: 80, 3: 165, 4: 300, 5: 450 }; // 露葵 2026-11-14 定的錨點（誤差 ±20% 內算達標）
if (args.perseed) {
  // 除錯：每組種子的各章首通天數、最終狀態
  results.forEach((r, i) => console.log(`seed ${i + 1}: 首通 ${JSON.stringify(r.clearDay)} Lv.${r.level} 存活 ${r.alive} 最強 ${r.topPower} 基因 ${r.maxGene} 積分 ${r.points} 死亡 ${r.deaths}`));
}
if (args.json) {
  // 機器可讀輸出（給自動校正腳本用）：各章尾王首通比例與中位數、整體統計
  const chapters = [1, 2, 3, 4, 5].map((ch) => {
    const days = results.map((r) => r.clearDay[ch]).filter(Boolean);
    return { ch, frac: days.length / SEEDS, median: days.length ? pctl(days, 0.5) : null, p25: days.length ? pctl(days, 0.25) : null, p75: days.length ? pctl(days, 0.75) : null };
  });
  console.log(JSON.stringify({ chapters, deaths: avg(results.map((r) => r.deaths)), income: avg(results.map((r) => r.income / DAYS)), bankrupt: results.filter((r) => r.bankruptDay).length / SEEDS }));
  process.exit(0);
}
console.log(`\n主神空間平衡模擬：${SEEDS} 組種子 × 最多 ${DAYS} 天（${((Date.now() - t0) / 1000).toFixed(1)} 秒）\n`);
console.log("章節 | 首通尾王比例 | 天數 P25 / 中位數 / P75 | 目標天數 | 中位數偏差");
for (let ch = 1; ch <= 5; ch++) {
  const days = results.map((r) => r.clearDay[ch]).filter(Boolean);
  const med = pctl(days, 0.5);
  const diffPct = typeof med === "number" ? Math.round(((med - TARGET[ch]) / TARGET[ch]) * 100) : null;
  const diff = diffPct === null ? "-" : `${diffPct > 0 ? "+" : ""}${diffPct}%${Math.abs(diffPct) <= 20 ? " ✅" : ""}`;
  console.log(`第 ${ch} 章 | ${String(Math.round((days.length / SEEDS) * 100)).padStart(3)}% | ${pctl(days, 0.25)} / ${med} / ${pctl(days, 0.75)} | Day ${TARGET[ch]} | ${diff}`);
}
const bankrupt = results.filter((r) => r.bankruptDay);
console.log(`\n遊戲結束（沒人又借不到錢）：${bankrupt.length}/${SEEDS} 局${bankrupt.length ? `，中位數第 ${pctl(bankrupt.map((r) => r.bankruptDay), 0.5)} 天` : ""}`);
console.log(`曾經負債的局：${results.filter((r) => r.lowestPoints < 0).length}/${SEEDS}`);
console.log(`平均死亡人數：${avg(results.map((r) => r.deaths))}　平均存活：${avg(results.map((r) => r.alive))}　平均最終積分：${avg(results.map((r) => r.points))}`);
console.log(`平均出征場數：${avg(results.map((r) => r.attempts))}　平均通關場數：${avg(results.map((r) => r.clears))}　平均累積花費：${avg(results.map((r) => r.totalSpent))}`);
console.log(`最終空間等級分布：${[1, 2, 3, 4, 5].map((lv) => `Lv.${lv}×${results.filter((r) => r.level === lv).length}`).join("　")}`);
console.log(`最終最高基因鎖分布：${[0, 1, 2, 3, 4].map((g) => `${g}階×${results.filter((r) => r.maxGene === g).length}`).join("　")}`);
console.log(`平均最強戰力：${avg(results.map((r) => r.topPower))}　平均剩餘因果結晶：${avg(results.map((r) => r.crystals))}`);
console.log(`平均總收入（副本獎勵）：${avg(results.map((r) => r.income))}　每天約 ${avg(results.map((r) => r.income / DAYS))}`);
console.log("各章（每局平均）：出征場數 / 通關率 / 死亡人數");
for (let ch = 1; ch <= 5; ch++) {
  const rows = results.map((r) => r.byChapter[ch] ?? { runs: 0, wins: 0, deaths: 0 });
  const runs = rows.reduce((n, r) => n + r.runs, 0);
  const wins = rows.reduce((n, r) => n + r.wins, 0);
  console.log(`  第 ${ch} 章：${(runs / SEEDS).toFixed(1)} 場 / ${runs ? Math.round((wins / runs) * 100) : 0}% / ${(rows.reduce((n, r) => n + r.deaths, 0) / SEEDS).toFixed(1)} 人`);
}
console.log(`平均名冊階級：${["C", "B", "A", "S"].map((k) => `${k}×${avg(results.map((r) => r.ranks[k] ?? 0))}`).join("　")}\n`);
