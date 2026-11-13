// 核心：遊戲狀態、輪迴者、經濟（維持費／高利貸／回收爐）、抽卡、時間推進。
// 這裡完全不碰畫面（DOM），所以可以直接用 Node 跑測試。

import { CONFIG, RANKS, INJURIES, GACHA_POOLS, PAUSE_EVENTS } from "../data/config.js";
import { SURNAMES, GIVEN_NAMES } from "../data/names.js";
import { rand, randInt, pick, weighted } from "./rng.js";

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
    dungeonStats: {}, // { 副本id: { attempts, clears } }
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
  emit(state, "system", `主神：「新來的主管，這 ${CONFIG.startingSamsarites} 個人歸你了。別讓我無聊。」`);
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
    tags: [], // Phase 2 才會填
    joinedDay: currentDay(state),
    runs: 0,
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

export function killSamsarite(state, s, cause) {
  state.samsarites = state.samsarites.filter((x) => x.id !== s.id);
  state.graveyard.push({ name: s.name, rank: s.rank, day: currentDay(state), cause });
  emit(state, "death", `☠️ ${s.name}（${s.rank} 級）${cause}。永久死亡。`, { samsariteId: s.id });
}

function loseSanity(s, amount) {
  s.stats.sanity = Math.max(0, s.stats.sanity - amount);
}

// ───────── 經濟 ─────────

/** 積分可以花到負的（主神高利貸），但不能低於上限 */
export function canAfford(state, cost) {
  return state.points - cost >= CONFIG.debtLimit;
}

export function spend(state, cost) {
  if (!canAfford(state, cost)) return false;
  const wasInDebt = state.points < 0;
  state.points -= cost;
  state.totalSpent += cost;
  announceDebtIfNew(state, wasInDebt);
  return true;
}

function announceDebtIfNew(state, wasInDebt) {
  if (!wasInDebt && state.points < 0) {
    emit(state, "debt", `💸 積分變成負數了。主神：「借你。利息嘛……每天電一個人。」（上限 ${CONFIG.debtLimit} 分）`);
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
        emit(state, "healed", `🩹 ${s.name} 傷好了，可以繼續被壓榨了。`, { samsariteId: s.id });
      }
    }
  }

  const wasInDebt = state.points < 0;
  state.points -= cost;
  const hitLimit = state.points < CONFIG.debtLimit;
  if (hitLimit) state.points = CONFIG.debtLimit;

  emit(state, "dayEnd", `📅 第 ${day} 天結算：留守 ${atHome.length} 人，維持費 -${cost} 分。`);
  announceDebtIfNew(state, wasInDebt);

  if (state.points < 0 && state.samsarites.length > 0) {
    if (hitLimit) {
      // 債務頂到上限還付不出來：主神暴怒，全員電擊（計畫未定的暫定處理）
      for (const s of state.samsarites) loseSanity(s, CONFIG.debtShockSanity);
      emit(state, "shock", `⚡ 債務已達上限。主神暴怒，電擊了所有人（理智 -${CONFIG.debtShockSanity}）。`);
    } else {
      const victim = pick(state, state.samsarites);
      loseSanity(victim, CONFIG.debtShockSanity);
      emit(state, "shock", `⚡ 負債中。主神隨手電了 ${victim.name} 一下（理智 -${CONFIG.debtShockSanity}）。`);
    }
  }
}

/** 主神回收爐：把人做成營養液，換一點積分，其他人理智下降 */
export function recycle(state, id) {
  const s = getSamsarite(state, id);
  if (!s || s.location !== "space") return false;
  state.samsarites = state.samsarites.filter((x) => x.id !== id);
  state.graveyard.push({ name: s.name, rank: s.rank, day: currentDay(state), cause: "被主管推進回收爐" });
  state.points += CONFIG.recycle.points;
  for (const other of state.samsarites) loseSanity(other, CONFIG.recycle.sanityLoss);
  emit(
    state,
    "recycle",
    `♻️ ${s.name} 被推進了主神回收爐（+${CONFIG.recycle.points} 分）。其他人看著你的眼神變了（全員理智 -${CONFIG.recycle.sanityLoss}）。`
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
  emit(state, "gacha", `🎴 【${pool.name}】-${pool.cost} 分 → ${rank} 級輪迴者 ${s.name}（戰力 ${s.stats.power}）報到。`, {
    samsariteId: s.id,
  });
  return s;
}

// ───────── 時間 ─────────

/** 時間前進一個時段；跨日就做每日結算 */
export function advanceTick(state) {
  state.tick += 1;
  if (state.tick % CONFIG.ticksPerDay === 0) endOfDay(state);
}

/** 沒人可用、又抽不起最便宜的卡池 = 遊戲結束 */
export function checkGameOver(state) {
  if (state.gameOver) return true;
  const cheapest = Math.min(...GACHA_POOLS.map((p) => p.cost));
  if (state.samsarites.length === 0 && !canAfford(state, cheapest)) {
    state.gameOver = true;
    emit(state, "gameOver", "🕳️ 你手下沒有任何輪迴者，也借不到積分了。主神：「下一位主管。」");
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
  // 之後新增的暫停事件種類，舊存檔沒有就補上預設值
  for (const [key, def] of Object.entries(PAUSE_EVENTS)) {
    if (!(key in state.settings.pauseOn)) state.settings.pauseOn[key] = def.default;
  }
  return state;
}

export { rand };
