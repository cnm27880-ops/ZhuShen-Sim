// 副本：成功率公式、逐房間檢定、傷亡、結算。
// 公式（計畫第 5.8 節）：
//   房間通過率 = (小隊總戰力 / 副本推薦戰力) × 50% + 關係加成 + 標籤與環境相性
//   （另外：首次開荒 -10%、重打有情報 +5%；賭徒型標籤每房間再隨機浮動）

import { CONFIG, INJURIES } from "../data/config.js";
import { getDungeon } from "../data/dungeons.js";
import { ENV_TAGS, getEnvTag } from "../data/tags.js";
import { rand, pick, weighted } from "./rng.js";
import { effectivePower, tagPassBonus, tagSwing, tagRewardPct, injuryShieldOf, dodgeOf } from "./tags.js";
import { partyRelationBonus, pickClash, clashText, afterClash, afterDeath, findProtector } from "./relations.js";
import { logText } from "./templates.js";
import { emit, advanceTick, setInjury, killSamsarite, checkGameOver } from "./core.js";

/** 關係加成（喜歡 +10%、愛慕 +20%、討厭 -10%、仇恨 -20%…，見 engine/relations.js） */
export function relationBonus(state, party) {
  return partyRelationBonus(state, party);
}

/** 標籤與環境相性：標籤加成（含類型、環境相性）+ 環境本身的修正 */
export function tagBonus(_state, party, dungeon, env = null) {
  return tagPassBonus(party, dungeon, env) + (env?.passMod ?? 0);
}

/** 副本情報：通關過一次就有情報（重打 +5%）；沒通關過就是首次開荒（-10%） */
export function hasIntel(state, dungeon) {
  return (state.dungeonStats[dungeon.id]?.clears ?? 0) > 0;
}
export function intelBonus(state, dungeon) {
  return hasIntel(state, dungeon) ? CONFIG.dungeon.replayBonus : -CONFIG.dungeon.firstClearPenalty;
}

/** 這一次通關的獎勵倍率（獎勵遞減 × 標籤加成 × 環境倍率）。不含首次開荒的固定加分 */
export function rewardTierMult(state, dungeon) {
  const nth = (state.dungeonStats[dungeon.id]?.clears ?? 0) + 1; // 這是第幾次通關
  return CONFIG.dungeon.rewardTiers.find((t) => nth <= t.upTo).mult;
}
export function rewardMultiplier(state, dungeon, party = [], env = null) {
  return rewardTierMult(state, dungeon) * (1 + tagRewardPct(party)) * (env?.rewardMult ?? 1);
}

export function partyPower(party) {
  return party.reduce((sum, s) => sum + effectivePower(s), 0);
}

/** env：本次副本的環境標籤（規劃自動派遣時還沒抽，傳 null）；swing：標籤的隨機浮動 */
export function roomPassRate(state, party, dungeon, env = null, swing = 0) {
  if (party.length === 0) return 0;
  const raw =
    (partyPower(party) / dungeon.recommendedPower) * CONFIG.dungeon.basePassRate +
    relationBonus(state, party) +
    tagBonus(state, party, dungeon, env) +
    intelBonus(state, dungeon) +
    swing;
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
export function clearChance(state, party, dungeon, env = null) {
  const p = roomPassRate(state, party, dungeon, env);
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

  const env = pick(state, ENV_TAGS); // 每次進副本隨機抽一個環境標籤
  const firstTime = !hasIntel(state, dungeon);
  state.run = { dungeonId, envId: env.id, firstTime, partyIds: [...partyIds], enteredInjury, roomIndex: 0, results: [], deaths: [] };
  emit(
    state,
    "runStart",
    logText(state, "runStart", {
      names: party.map((s) => s.name).join("、"),
      dungeon: dungeon.name,
      power: partyPower(party),
      rec: dungeon.recommendedPower,
    })
  );
  emit(state, "env", logText(state, "env", { env: env.name, desc: env.desc }));
  if (firstTime) emit(state, "intel", logText(state, "intel"));
  return { ok: true };
}

/** 走一個房間（= 0.2 天）。走完最後一間或全滅就自動結算。 */
export function stepRun(state) {
  const run = state.run;
  if (!run) return;
  const dungeon = getDungeon(run.dungeonId);
  const room = dungeon.rooms[run.roomIndex];
  const party = partyOf(state);
  const env = getEnvTag(run.envId) ?? null;
  const progress = `[${(run.roomIndex + 1) * 20}%・${room.name}]`;
  const clash = pickClash(state, party, run.roomIndex); // 仇人／背刺者：先打自己人，這個房間算失敗
  const passed = clash ? false : rand(state) < roomPassRate(state, party, dungeon, env, tagSwing(state, party));

  if (clash) {
    emit(state, "clash", `${progress} ${clashText(state, clash)}`);
    afterClash(state, clash);
    hurt(state, run, clash.victim, dungeon, clash.attacker);
  } else if (passed) {
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

function hurt(state, run, victim, dungeon, attacker = null) {
  if (!attacker) {
    // 愛慕／靈魂伴侶的隊友有機會替他擋下這一下
    const guard = findProtector(state, partyOf(state), victim);
    if (guard) {
      emit(state, "social", logText(state, "guard", { A: guard, B: victim }));
      victim = guard;
    }
  }
  // 帶傷出征的人被打中時，先擲一次「直接死亡」（輕傷 20% / 重傷 50% / 致命傷 80%）
  let deathBonus = INJURIES[run.enteredInjury[victim.id]].deathBonus;
  const sabotaged = victim.sabotaged; // 裝備被動過手腳（借刀殺人）：更容易傷重、更容易死
  if (sabotaged) {
    victim.sabotaged = false;
    deathBonus += CONFIG.relations.sabotageDeathBonus;
    emit(state, "scheme", logText(state, "sabotageHit", { A: victim }));
  }
  if (rand(state) < dodgeOf(victim)) {
    emit(state, "dodge", logText(state, "dodge", { A: victim }));
    return;
  }
  const table = run.firstTime ? CONFIG.dungeon.firstClearInjuryRoll : CONFIG.dungeon.injuryRoll;
  let gained = weighted(state, table).levels;
  const shield = injuryShieldOf(victim);
  if (shield > 0 && rand(state) < shield) gained = Math.max(1, gained - 1);
  else if (shield < 0 && rand(state) < -shield) gained += 1;
  const newLevel = victim.injury + gained + (sabotaged ? 1 : 0);

  if ((deathBonus > 0 && rand(state) < deathBonus) || newLevel >= INJURIES.length) {
    run.deaths.push(victim.name);
    killSamsarite(state, victim, attacker ? `死在了隊友 ${attacker.name} 手上（【${dungeon.name}】）` : `死在了【${dungeon.name}】`, attacker);
    afterDeath(state, victim, attacker);
    return;
  }
  setInjury(victim, newLevel);
  emit(state, "injury", logText(state, "injury", { A: victim, injury: INJURIES[newLevel].name }));
}

function finishRun(state) {
  const run = state.run;
  const dungeon = getDungeon(run.dungeonId);
  const survivors = partyOf(state);
  const passedCount = run.results.filter(Boolean).length;
  const success = survivors.length > 0 && passedCount >= CONFIG.dungeon.roomsToClear;
  let reward = 0;
  let specialReward = null;

  if (success) {
    const env = getEnvTag(run.envId) ?? null;
    reward = Math.round(dungeon.reward * rewardMultiplier(state, dungeon, survivors, env));
    if (run.firstTime) {
      reward += CONFIG.dungeon.firstClearBonus;
      specialReward = pick(state, dungeon.specialRewards ?? ["神秘戰利品"]);
      state.collection.push(specialReward);
    }
    state.points += reward;
    state.dungeonStats[run.dungeonId].clears += 1;
  } else {
    // 失敗但活著回來：一定帶傷
    for (const s of survivors) if (s.injury === 0) setInjury(s, 1);
  }
  for (const s of survivors) {
    s.location = "space";
    s.sabotaged = false; // 沒被打中就沒用到，動過手腳的裝備回家後已被檢查
  }

  state.lastRun = {
    dungeonId: run.dungeonId,
    dungeonName: dungeon.name,
    success,
    reward,
    firstClear: success && run.firstTime,
    specialReward,
    envName: getEnvTag(run.envId)?.name ?? null,
    passedCount,
    results: run.results,
    deaths: run.deaths,
    survivors: survivors.map((s) => ({ name: s.name, injury: s.injury })),
  };
  state.run = null;

  const vars = { dungeon: dungeon.name, passed: passedCount, rooms: CONFIG.dungeon.rooms, reward };
  let text;
  if (success) {
    text = logText(state, run.firstTime ? "runFirstClear" : "runClear", vars);
    if (specialReward) text += "\n" + logText(state, "runSpecial", { item: specialReward });
  } else {
    text = logText(state, survivors.length > 0 ? "runFail" : "runWipe", vars);
  }
  emit(state, "runEnd", text);
  checkGameOver(state);
}
