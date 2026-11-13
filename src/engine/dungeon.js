// 副本：成功率公式、逐房間檢定、傷亡、結算。
// 公式（計畫第 5.8 節）：
//   房間通過率 = (小隊總戰力 / 副本推薦戰力) × 70% + 關係加成 + 標籤與環境相性

import { CONFIG, INJURIES } from "../data/config.js";
import { getDungeon } from "../data/dungeons.js";
import { rand, pick, weighted } from "./rng.js";
import { emit, advanceTick, setInjury, killSamsarite, checkGameOver } from "./core.js";

// ── Phase 2 的掛鉤（hook）：現在一律回傳 0 / 1，之後在這裡接上關係、標籤、獎勵遞減 ──
export function relationBonus(_state, _party) {
  return 0;
}
export function tagBonus(_state, _party, _dungeon) {
  return 0;
}
export function rewardMultiplier(_state, _dungeon) {
  return 1;
}

export function partyPower(party) {
  return party.reduce((sum, s) => sum + s.stats.power, 0);
}

export function roomPassRate(state, party, dungeon) {
  if (party.length === 0) return 0;
  const raw =
    (partyPower(party) / dungeon.recommendedPower) * CONFIG.dungeon.basePassRate +
    relationBonus(state, party) +
    tagBonus(state, party, dungeon);
  return Math.min(CONFIG.dungeon.maxPassRate, Math.max(CONFIG.dungeon.minPassRate, raw));
}

/** 「n 個房間至少通過 k 個」的機率（二項分布） */
export function chanceAtLeast(n, k, p) {
  const comb = (a, b) => {
    let r = 1;
    for (let i = 1; i <= b; i++) r = (r * (a - b + i)) / i;
    return r;
  };
  let total = 0;
  for (let i = k; i <= n; i++) total += comb(n, i) * p ** i * (1 - p) ** (n - i);
  return total;
}

/** 預估通關率（不考慮中途有人死掉導致戰力下降，所以是樂觀估計） */
export function clearChance(state, party, dungeon) {
  const p = roomPassRate(state, party, dungeon);
  return chanceAtLeast(CONFIG.dungeon.rooms, CONFIG.dungeon.roomsToClear, p);
}

function partyOf(state) {
  return state.run.partyIds.map((id) => state.samsarites.find((s) => s.id === id)).filter(Boolean);
}

/** 出發。回傳 { ok, reason } */
export function startRun(state, dungeonId, partyIds) {
  const dungeon = getDungeon(dungeonId);
  if (!dungeon) return { ok: false, reason: "找不到這個副本" };
  if (state.run) return { ok: false, reason: "已經有一隊在副本裡了" };
  if (partyIds.length < 1 || partyIds.length > CONFIG.partyMax) {
    return { ok: false, reason: `一隊要 1~${CONFIG.partyMax} 人` };
  }
  const party = partyIds.map((id) => state.samsarites.find((s) => s.id === id));
  if (party.some((s) => !s || s.location !== "space")) return { ok: false, reason: "有隊員不在主神空間" };

  const enteredInjury = {};
  for (const s of party) {
    s.location = "dungeon";
    s.runs += 1;
    enteredInjury[s.id] = s.injury; // 記住「帶傷出征」的等級，用來算死亡率加成
  }
  const stats = (state.dungeonStats[dungeonId] ??= { attempts: 0, clears: 0 });
  stats.attempts += 1;

  state.run = { dungeonId, partyIds: [...partyIds], enteredInjury, roomIndex: 0, results: [], deaths: [] };
  emit(
    state,
    "runStart",
    `🚪 ${party.map((s) => s.name).join("、")} 被傳送進【${dungeon.name}】（總戰力 ${partyPower(party)} / 推薦 ${dungeon.recommendedPower}）。`
  );
  return { ok: true };
}

/** 走一個房間（= 0.2 天）。走完最後一間或全滅就自動結算。 */
export function stepRun(state) {
  const run = state.run;
  if (!run) return;
  const dungeon = getDungeon(run.dungeonId);
  const room = dungeon.rooms[run.roomIndex];
  const party = partyOf(state);
  const passed = rand(state) < roomPassRate(state, party, dungeon);
  const progress = `[${(run.roomIndex + 1) * 20}%・${room.name}]`;

  if (passed) {
    emit(state, "roomPass", `${progress} ${room.pass}`);
  } else {
    const victim = pick(state, party);
    emit(state, "roomFail", `${progress} ${room.fail.replace("{name}", victim.name)}`);
    hurt(state, run, victim, dungeon);
  }
  run.results.push(passed);
  run.roomIndex += 1;
  for (let i = 0; i < CONFIG.roomTicks; i++) advanceTick(state);

  const wiped = partyOf(state).length === 0;
  if (wiped) {
    // 全滅：剩下的房間不用走了，但時間照樣過完（一場副本固定 = 1 天）
    const remaining = (CONFIG.dungeon.rooms - run.roomIndex) * CONFIG.roomTicks;
    for (let i = 0; i < remaining; i++) advanceTick(state);
  }
  if (wiped || run.roomIndex >= CONFIG.dungeon.rooms) finishRun(state);
}

function hurt(state, run, victim, dungeon) {
  // 帶傷出征的人被打中時，先擲一次「直接死亡」（輕傷 20% / 重傷 50% / 致命傷 80%）
  const deathBonus = INJURIES[run.enteredInjury[victim.id]].deathBonus;
  const gained = weighted(state, CONFIG.dungeon.injuryRoll).levels;
  const newLevel = victim.injury + gained;

  if ((deathBonus > 0 && rand(state) < deathBonus) || newLevel >= INJURIES.length) {
    run.deaths.push(victim.name);
    killSamsarite(state, victim, `死在了【${dungeon.name}】`);
    return;
  }
  setInjury(victim, newLevel);
  emit(state, "injury", `🩸 ${victim.name} → ${INJURIES[newLevel].name}。`);
}

function finishRun(state) {
  const run = state.run;
  const dungeon = getDungeon(run.dungeonId);
  const survivors = partyOf(state);
  const passedCount = run.results.filter(Boolean).length;
  const success = survivors.length > 0 && passedCount >= CONFIG.dungeon.roomsToClear;
  let reward = 0;

  if (success) {
    reward = Math.round(dungeon.reward * rewardMultiplier(state, dungeon));
    state.points += reward;
    state.dungeonStats[run.dungeonId].clears += 1;
  } else {
    // 失敗但活著回來：一定帶傷
    for (const s of survivors) if (s.injury === 0) setInjury(s, 1);
  }
  for (const s of survivors) s.location = "space";

  state.lastRun = {
    dungeonId: run.dungeonId,
    dungeonName: dungeon.name,
    success,
    reward,
    passedCount,
    results: run.results,
    deaths: run.deaths,
    survivors: survivors.map((s) => ({ name: s.name, injury: s.injury })),
  };
  state.run = null;

  const text = success
    ? `🏆 【${dungeon.name}】通關（${passedCount}/${CONFIG.dungeon.rooms} 房間），+${reward} 分。`
    : survivors.length > 0
      ? `💀 【${dungeon.name}】失敗（只通過 ${passedCount}/${CONFIG.dungeon.rooms} 房間），倖存者全員帶傷逃回。`
      : `💀 【${dungeon.name}】全滅。沒有人回來。`;
  emit(state, "runEnd", text);
  checkGameOver(state);
}
