// 核心：遊戲狀態、輪迴者、經濟（維持費／高利貸／回收爐）、抽卡、時間推進。
// 這裡完全不碰畫面（DOM），所以可以直接用 Node 跑測試。

import { CONFIG, RANKS, INJURIES, GACHA_POOLS, PAUSE_EVENTS } from "../data/config.js";
import { SURNAMES, GIVEN_NAMES } from "../data/names.js";
import { rand, randInt, pick, weighted } from "./rng.js";
import { rollTags } from "./tags.js";
import { findSpecialRewardByName, getSpecialReward } from "../data/dungeons.js";
import { logText } from "./templates.js";
import { dailyRelations } from "./relations.js"; // 注意：relations.js 也會 import 這個檔案，只要不在載入時就呼叫，循環引用沒問題

// ───────── 事件與日誌 ─────────

/** 寫一條日誌，同時丟進 state.events 讓畫面層決定要不要自動暫停 */
export function emit(state, type, text, data = {}) {
  const entry = { day: currentDay(state), type, text };
  state.log.push(entry);
  if (state.log.length > CONFIG.logMax) state.log.splice(0, state.log.length - CONFIG.logMax);
  state.events.push({ type, text, ...data });
}

export function currentDay(state) {
  return Math.floor(state.tick / CONFIG.ticksPerDay) + 1;
}

// ───────── 建立新遊戲 ─────────

export function createNewGame(seed = (Date.now() ^ 0x5eed) | 0) {
  const pauseOn = {};
  for (const [key, def] of Object.entries(PAUSE_EVENTS)) pauseOn[key] = def.default;

  const state = {
    version: 1,
    rngState: seed | 0,
    tick: 0,
    points: CONFIG.startingPoints,
    totalSpent: 0, // 累積花費（Phase 3 商店階級解鎖會用到）
    nextId: 1,
    samsarites: [],
    graveyard: [],
    relations: {}, // 關係矩陣（見 engine/relations.js）
    cooldowns: {}, // 事件冷卻：{ 事件:配對 → 第幾天後才能再發生 }
    dungeonStats: {}, // { 副本id: { attempts, clears } }；clears > 0 代表已有該副本情報
    collection: [], // 副本特殊獎勵 id（定義在 data/dungeons.js），永久生效，效果見 engine/shop.js collectionEffects
    run: null, // 進行中的副本
    lastRun: null, // 上一場副本的結算摘要
    gameOver: false,
    settings: {
      speed: 1,
      paused: false,
      autoDispatch: false,
      protect: { noInjured: true, noEnemies: true },
      pauseOn,
    },
    log: [],
    events: [], // 暫存、不進存檔
  };

  for (let i = 0; i < CONFIG.startingSamsarites; i++) {
    state.samsarites.push(createSamsarite(state, CONFIG.startingRank));
  }
  emit(state, "system", logText(state, "start", { n: CONFIG.startingSamsarites }));
  return state;
}

// ───────── 輪迴者 ─────────

export function createSamsarite(state, rank) {
  const r = RANKS[rank];
  const roll = ([min, max]) => randInt(state, min, max);
  return {
    id: state.nextId++,
    name: pick(state, SURNAMES) + pick(state, GIVEN_NAMES),
    rank,
    stats: {
      hp: roll(r.hp),
      power: roll(r.power),
      defense: roll(r.defense),
      speed: roll(r.speed),
      sanity: 100,
      luck: roll(r.luck),
    },
    injury: 0, // 0 無傷 / 1 輕傷 / 2 重傷 / 3 致命傷
    restDaysLeft: 0,
    locked: false, // 🔒 鎖定後不參與自動派遣
    location: "space", // "space" 主神空間 / "dungeon" 副本中
    tags: rollTags(state), // 標籤 id 陣列，資料在 src/data/tags.js
    upgrades: {}, // 商店強化累積的數值：{ power, dodge… }（見 data/shop.js）
    gear: {}, // 商店裝備：{ weapon: 商品id, armor: 商品id }
    bought: {}, // 每種強化買過幾次：{ 商品id: 次數 }
    joinedDay: currentDay(state),
    runs: 0,
    sabotaged: false, // 裝備被人動了手腳（借刀殺人），下次出征會倒楣
  };
}

export function getSamsarite(state, id) {
  return state.samsarites.find((s) => s.id === id);
}

/** 每日維持費 = 基礎 + 階級加成 + 傷勢加成 */
export function upkeepOf(s) {
  return CONFIG.upkeepBase + RANKS[s.rank].upkeep + INJURIES[s.injury].upkeep;
}

export function setInjury(s, level) {
  s.injury = level;
  s.restDaysLeft = INJURIES[level].restDays;
}

/** killer：被同伴害死時的兇手（怪物殺的就不傳）。連鎖反應在 relations.js 的 afterDeath，由呼叫端接著呼叫 */
export function killSamsarite(state, s, cause, killer = null) {
  state.samsarites = state.samsarites.filter((x) => x.id !== s.id);
  state.graveyard.push({ name: s.name, rank: s.rank, day: currentDay(state), cause, killer: killer?.name ?? null });
  emit(state, "death", logText(state, "death", { A: s, rank: s.rank, cause }), { samsariteId: s.id, killerId: killer?.id ?? null });
}

/** 把某人從關係矩陣裡清掉（死亡或被回收之後） */
export function forgetRelations(state, id) {
  for (const key of Object.keys(state.relations ?? {})) {
    const [a, b] = key.split(">").map(Number);
    if (a === id || b === id) delete state.relations[key];
  }
}

function loseSanity(s, amount) {
  s.stats.sanity = Math.max(0, s.stats.sanity - amount);
}

// ───────── 經濟 ─────────

/** 積分可以花到負的（主神高利貸），但不能低於上限 */
export function canAfford(state, cost) {
  return state.points - cost >= CONFIG.debtLimit;
}

/** 商店目前開到第幾階（1~4），依累積花費 totalSpent 和 CONFIG.shopTierUnlock 決定 */
export function shopTier(state) {
  let tier = 1;
  CONFIG.shopTierUnlock.forEach((need, i) => {
    if (state.totalSpent >= need) tier = i + 1;
  });
  return tier;
}

export function spend(state, cost) {
  if (!canAfford(state, cost)) return false;
  const wasInDebt = state.points < 0;
  const tierBefore = shopTier(state);
  state.points -= cost;
  state.totalSpent += cost;
  announceDebtIfNew(state, wasInDebt);
  const tierAfter = shopTier(state);
  if (tierAfter > tierBefore) {
    emit(state, "shopTier", logText(state, "shopTier", { tier: tierAfter, spent: state.totalSpent }), { tier: tierAfter });
  }
  return true;
}

export function announceDebtIfNew(state, wasInDebt) {
  if (!wasInDebt && state.points < 0) {
    emit(state, "debt", logText(state, "debt", { limit: CONFIG.debtLimit }));
  }
}

/** 一天結束：留守人員扣維持費、休息養傷；負債就電擊 */
export function endOfDay(state) {
  const day = state.tick / CONFIG.ticksPerDay; // 剛結束的那一天
  const atHome = state.samsarites.filter((s) => s.location === "space");

  let cost = 0;
  for (const s of atHome) {
    cost += upkeepOf(s); // 先用「今天的傷勢」算錢，再結算休息
    if (s.injury > 0) {
      s.restDaysLeft -= 1;
      if (s.restDaysLeft <= 0) {
        setInjury(s, 0);
        emit(state, "healed", logText(state, "healed", { A: s }), { samsariteId: s.id });
      }
    }
  }

  const wasInDebt = state.points < 0;
  state.points -= cost;
  const hitLimit = state.points < CONFIG.debtLimit;
  if (hitLimit) state.points = CONFIG.debtLimit;

  emit(state, "dayEnd", logText(state, "dayEnd", { day, home: atHome.length, cost }));
  announceDebtIfNew(state, wasInDebt);

  if (state.points < 0 && state.samsarites.length > 0) {
    if (hitLimit) {
      // 債務頂到上限還付不出來：主神暴怒，全員電擊（計畫未定的暫定處理）
      for (const s of state.samsarites) loseSanity(s, CONFIG.debtShockSanity);
      emit(state, "shock", logText(state, "shockAll", { san: CONFIG.debtShockSanity }));
    } else {
      const victim = pick(state, state.samsarites);
      loseSanity(victim, CONFIG.debtShockSanity);
      emit(state, "shock", logText(state, "shockOne", { A: victim, san: CONFIG.debtShockSanity }));
    }
  }
}

/** 主神回收爐：把人做成營養液，換一點積分，其他人理智下降 */
export function recycle(state, id) {
  const s = getSamsarite(state, id);
  if (!s || s.location !== "space") return false;
  state.samsarites = state.samsarites.filter((x) => x.id !== id);
  state.graveyard.push({ name: s.name, rank: s.rank, day: currentDay(state), cause: "被主管推進回收爐" });
  forgetRelations(state, id);
  state.points += CONFIG.recycle.points;
  for (const other of state.samsarites) loseSanity(other, CONFIG.recycle.sanityLoss);
  emit(
    state,
    "recycle",
    logText(state, "recycle", { A: s, points: CONFIG.recycle.points, san: CONFIG.recycle.sanityLoss })
  );
  checkGameOver(state);
  return true;
}

// ───────── 抽卡 ─────────

export function pullGacha(state, poolId) {
  const pool = GACHA_POOLS.find((p) => p.id === poolId);
  if (!pool || !spend(state, pool.cost)) return null;
  const rank = weighted(state, pool.odds).rank;
  const s = createSamsarite(state, rank);
  state.samsarites.push(s);
  emit(state, "gacha", logText(state, "gacha", { pool: pool.name, cost: pool.cost, rank, A: s, power: s.stats.power }), {
    samsariteId: s.id,
  });
  return s;
}

// ───────── 時間 ─────────

/** 時間前進一個時段；跨日就做每日結算 */
export function advanceTick(state) {
  state.tick += 1;
  if (state.tick % CONFIG.ticksPerDay === 0) {
    endOfDay(state);
    dailyRelations(state); // 留守的人互動、搞事（Phase 2-B）
  }
}

/** 沒人可用、又抽不起最便宜的卡池 = 遊戲結束 */
export function checkGameOver(state) {
  if (state.gameOver) return true;
  const cheapest = Math.min(...GACHA_POOLS.map((p) => p.cost));
  if (state.samsarites.length === 0 && !canAfford(state, cheapest)) {
    state.gameOver = true;
    emit(state, "gameOver", logText(state, "gameOver"));
  }
  return state.gameOver;
}

// ───────── 存檔 ─────────

export function serialize(state) {
  return JSON.stringify({ ...state, events: [] });
}

export function deserialize(json) {
  const state = JSON.parse(json);
  if (state.version !== 1) throw new Error("存檔版本不符");
  state.events = [];
  state.collection ??= []; // 舊存檔沒有這個欄位
  // Phase 3-A 之前收藏存的是名字，現在存 id；對不上的丟掉
  state.collection = state.collection
    .map((x) => (getSpecialReward(x) ? x : findSpecialRewardByName(x)?.id))
    .filter(Boolean);
  for (const s of state.samsarites) {
    s.upgrades ??= {};
    s.gear ??= {};
    s.bought ??= {};
  }
  state.relations ??= {};
  state.cooldowns ??= {};
  // 之後新增的暫停事件種類，舊存檔沒有就補上預設值
  for (const [key, def] of Object.entries(PAUSE_EVENTS)) {
    if (!(key in state.settings.pauseOn)) state.settings.pauseOn[key] = def.default;
  }
  return state;
}

export { rand };
