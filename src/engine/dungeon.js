// 副本：成功率公式、逐房間檢定、傷亡、結算。
// 公式（Phase 4-A 飽和公式）：
//   房間通過率 = 0.85 × P ÷ (P + R × 0.55) + 情報條 + 關係加成 + 標籤與環境相性 + 心情
//   P = 小隊總戰力、R = 推薦戰力；情報條每個副本獨立（-3% 起，每結算一場 +1.5%，上限 +9%）
//   房數與過關門檻依章節（CONFIG.dungeon.chapters）；賭徒型標籤每房間再隨機浮動

import { CONFIG, INJURIES } from "../data/config.js";
import { DUNGEONS, getDungeon } from "../data/dungeons.js";
import { ENV_TAGS, getEnvTag } from "../data/tags.js";
import { rand, pick, weighted } from "./rng.js";
import { wishesAfterRun } from "./wishes.js";
import { godAfterRun } from "./godEvents.js";
import { rollInsights, rollKarmaDrop } from "./growth.js";
import { effectivePower, moodPassBonus, tagPassBonus, tagSwing, tagRewardPct, injuryShieldOf, dodgeOf, defenseChance, speedSaveChance, luckRewardPct } from "./tags.js";
import { partyRelationBonus, pickClash, clashText, afterClash, afterDeath, findProtector } from "./relations.js";
import { logText } from "./templates.js";
import { emit, setInjury, killSamsarite, checkGameOver, currentDay } from "./core.js";
import { collectionEffects, collectionPassBonus } from "./shop.js";

/** 關係加成（喜歡 +10%、愛慕 +20%、討厭 -10%、仇恨 -20%…，見 engine/relations.js） */
export function relationBonus(state, party) {
  return partyRelationBonus(state, party);
}

/** 標籤與環境相性：標籤加成（含類型、環境相性）+ 環境本身的修正 + 副本特殊獎勵（收藏）的加成 */
export function tagBonus(state, party, dungeon, env = null) {
  return tagPassBonus(party, dungeon, env) + (env?.passMod ?? 0) + collectionPassBonus(state, dungeon);
}

/** 這個副本有沒有通關過（沒通關過 = 首次開荒：傷勢表較重；首通在結算時判定） */
export function hasIntel(state, dungeon) {
  return (state.dungeonStats[dungeon.id]?.clears ?? 0) > 0;
}
/** 情報條：每個副本獨立，沒打過是 CONFIG.dungeon.intel.start */
export function intelBonus(state, dungeon) {
  return state.dungeonStats[dungeon.id]?.intel ?? CONFIG.dungeon.intel.start;
}

/** 副本所屬章節的設定 { rooms, toClear } */
export function chapterOf(dungeon) {
  return CONFIG.dungeon.chapters[dungeon.chapter - 1];
}
export function roomCount(dungeon) {
  return dungeon.rooms.length;
}
export function roomsToClear(dungeon) {
  return chapterOf(dungeon).toClear;
}
/** 這個副本是全域第幾關（1~20；DUNGEONS 陣列順序就是關卡編號） */
export function dungeonNumber(dungeon) {
  return DUNGEONS.indexOf(dungeon) + 1;
}

/**
 * 尾王守門（Phase 4-B）：各章尾王要「該章前 3 關合計成功結算滿 CONFIG.bossGate.requiredClears 次」才開放。
 * 已經首通過（或該章尾王首通天數有紀錄）的不再受鎖。回傳 { applies: 是不是尾王, have, need, open }
 */
export function bossGateInfo(state, dungeon) {
  const need = CONFIG.bossGate.requiredClears;
  const have = state.chapterClears?.[dungeon.chapter] ?? 0;
  const cleared = !!state.chapterClearDay?.[dungeon.chapter] || (state.dungeonStats?.[dungeon.id]?.clears ?? 0) > 0;
  return { applies: !!dungeon.boss, have, need, open: !dungeon.boss || cleared || have >= need };
}

/** 空間等級 ≥ 章節，而且（尾王的話）守門條件達成才解鎖 */
export function isUnlocked(state, dungeon) {
  return dungeon.chapter <= (state.spaceLevel ?? 1) && bossGateInfo(state, dungeon).open;
}
export function unlockedDungeons(state) {
  return DUNGEONS.filter((d) => isUnlocked(state, d));
}

/** 這一次通關的獎勵倍率（獎勵遞減 × 標籤加成 × 環境倍率）。不含首次開荒的固定加分 */
export function rewardTierMult(state, dungeon) {
  const nth = (state.dungeonStats[dungeon.id]?.clears ?? 0) + 1; // 這是第幾次通關
  return CONFIG.dungeon.rewardTiers.find((t) => nth <= t.upTo).mult;
}
export function rewardMultiplier(state, dungeon, party = [], env = null) {
  return rewardTierMult(state, dungeon) * (1 + tagRewardPct(party) + collectionEffects(state).rewardPct) * (1 + luckRewardPct(party)) * (env?.rewardMult ?? 1);
}

export function partyPower(party) {
  return party.reduce((sum, s) => sum + effectivePower(s), 0);
}

/** 飽和公式的戰力基礎率：scale × P ÷ (P + R × k) */
export function powerRate(power, recommendedPower) {
  const { scale, k } = CONFIG.dungeon.saturation;
  return power <= 0 ? 0 : (scale * power) / (power + recommendedPower * k);
}

/** env：本次副本的環境標籤（規劃自動派遣時還沒抽，傳 null）；swing：標籤的隨機浮動 */
export function roomPassRate(state, party, dungeon, env = null, swing = 0, intelLocked = null) {
  if (party.length === 0) return 0;
  // intelLocked：並行副本在「開場那一刻」就鎖定情報條（null = 看目前的情報條）
  const intel = intelLocked ?? intelBonus(state, dungeon);
  const raw =
    powerRate(partyPower(party), dungeon.recommendedPower) +
    relationBonus(state, party) +
    tagBonus(state, party, dungeon, env) +
    moodPassBonus(party) +
    intel +
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
  return chanceAtLeast(roomCount(dungeon), roomsToClear(dungeon), p);
}

function partyOf(state, run) {
  return run.partyIds.map((id) => state.samsarites.find((s) => s.id === id)).filter(Boolean);
}

/** 出發。回傳 { ok, reason } */
export function startRun(state, dungeonId, partyIds) {
  const dungeon = getDungeon(dungeonId);
  if (!dungeon) return { ok: false, reason: "找不到這個副本" };
  if (dungeon.chapter > (state.spaceLevel ?? 1)) return { ok: false, reason: `第 ${dungeon.chapter} 章還沒解鎖（空間 Lv.${dungeon.chapter} 才能進）` };
  const gate = bossGateInfo(state, dungeon);
  if (!gate.open) {
    return { ok: false, reason: `尾王還沒開放：要先在第 ${dungeon.chapter} 章前 3 關合計通關滿 ${gate.need} 次（目前 ${gate.have}/${gate.need}）` };
  }
  if (partyIds.length < 1 || partyIds.length > CONFIG.partyMax) {
    return { ok: false, reason: `一隊要 1~${CONFIG.partyMax} 人` };
  }
  const party = partyIds.map((id) => state.samsarites.find((s) => s.id === id));
  if (party.some((s) => !s || s.location !== "space")) return { ok: false, reason: "有隊員不在主神空間" };
  const resting = party.find((s) => (s.vacationDays ?? 0) > 0);
  if (resting) return { ok: false, reason: `${resting.name} 正在放假（還要 ${resting.vacationDays} 天）` };

  const enteredInjury = {};
  for (const s of party) {
    s.location = "dungeon";
    s.runs += 1;
    enteredInjury[s.id] = s.injury; // 記住「帶傷出征」的等級，用來算死亡率加成
  }
  const intel = intelBonus(state, dungeon); // 開場鎖定，結算才加情報
  const stats = (state.dungeonStats[dungeonId] ??= { attempts: 0, clears: 0, intel });
  stats.attempts += 1;

  const env = pick(state, ENV_TAGS); // 每次進副本隨機抽一個環境標籤
  const firstTime = !hasIntel(state, dungeon);
  const run = { id: state.nextRunId++, startTick: state.tick, dungeonId, envId: env.id, firstTime, intel, partyIds: [...partyIds], enteredInjury, roomIndex: 0, results: [], deaths: [] };
  state.runs.push(run);
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
  if (state.runs.length > 1) emit(state, "runParallel", logText(state, "runParallel", { n: state.runs.length, dungeon: dungeon.name }));
  return { ok: true, run };
}

/** 這場副本此刻該不該走下一個房間（每 roomTicks 個時段走一間，所有副本共用同一個時間） */
export function roomDue(state, run) {
  return run.roomIndex < roomCount(getDungeon(run.dungeonId)) && state.tick >= run.startTick + run.roomIndex * CONFIG.roomTicks;
}

/** 走一個房間（= 0.2 天）。只結算房間，不推進時間；時間由 dispatch.js 的 step() 統一推進。 */
export function stepRun(state, run = state.runs[0]) {
  if (!run) return;
  const dungeon = getDungeon(run.dungeonId);
  const room = dungeon.rooms[run.roomIndex];
  const party = partyOf(state, run);
  const env = getEnvTag(run.envId) ?? null;
  const progress = `[${dungeon.name}・${Math.round(((run.roomIndex + 1) / roomCount(dungeon)) * 100)}%・${room.name}]`;
  const clash = pickClash(state, party, run.roomIndex); // 仇人／背刺者：先打自己人，這個房間算失敗
  const passed = clash ? false : rand(state) < roomPassRate(state, party, dungeon, env, tagSwing(state, party), run.intel);

  if (clash) {
    emit(state, "clash", `${progress} ${clashText(state, clash)}`);
    afterClash(state, clash);
    loseSanityOf(clash.victim, CONFIG.sanity.roomFailLoss);
    hurt(state, run, clash.victim, dungeon, clash.attacker);
  } else if (passed) {
    emit(state, "roomPass", `${progress} ${room.pass}`);
  } else {
    const victim = pick(state, party);
    emit(state, "roomFail", `${progress} ${room.fail.replace("{name}", victim.name)}`);
    loseSanityOf(victim, CONFIG.sanity.roomFailLoss); // 單房失敗：受害者理智 -5（4-C-2）
    hurt(state, run, victim, dungeon);
  }
  run.results.push(passed);
  run.roomIndex += 1;
}

function loseSanityOf(s, amount) {
  s.stats.sanity = Math.max(0, s.stats.sanity - amount);
}

/** 這場副本是否結束：時間到（房數 × roomTicks；全滅的也要等時間過完才結算，剩下的房間不用走） */
export function runIsOver(state, run) {
  return state.tick >= run.startTick + roomCount(getDungeon(run.dungeonId)) * CONFIG.roomTicks;
}

/** 依開場順序，讓所有「該走房間」的副本各走一間（順序固定，亂數才可重現） */
export function stepDueRooms(state) {
  for (const run of [...state.runs]) if (roomDue(state, run) && partyOf(state, run).length > 0) stepRun(state, run);
}

/** 依開場順序結算所有已結束的副本（先開的先結算：先吃首通，後面的視為重打） */
export function settleRuns(state) {
  for (const run of [...state.runs]) if (runIsOver(state, run)) finishRun(state, run);
}

export function hurt(state, run, victim, dungeon, attacker = null) {
  if (!attacker) {
    // 愛慕／靈魂伴侶的隊友有機會替他擋下這一下
    const guard = findProtector(state, partyOf(state, run), victim);
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
  const cap = CONFIG.tags.injuryShieldMax;
  const shield = Math.min(cap, injuryShieldOf(victim) + collectionEffects(state).injuryShield); // 個人（標籤＋裝備）＋收藏的全員減免
  if (shield > 0 && rand(state) < shield) gained = Math.max(1, gained - 1);
  else if (shield < 0 && rand(state) < -shield) gained += 1;
  // 防禦（Phase 4-C-1）：有機率讓這次傷勢少 1 級，原判輕傷則免傷（和上面的標籤／裝備減免獨立疊加）
  const healthy = victim.injury === 0; // 進這個房間前是健康無傷：這次絕不直接戰死
  if (gained > 0 && rand(state) < defenseChance(victim)) {
    gained -= 1;
    if (gained === 0 && !sabotaged) {
      emit(state, "dodge", logText(state, "defenseBlock", { A: victim }));
      return;
    }
  }
  let newLevel = victim.injury + gained + (sabotaged ? 1 : 0);

  let dies = (deathBonus > 0 && rand(state) < deathBonus) || newLevel >= INJURIES.length;
  if (healthy) {
    dies = false; // 健康免猝死鐵律：最重只會落入致命傷
    newLevel = Math.min(newLevel, INJURIES.length - 1);
  }
  if (dies && rand(state) < speedSaveChance(victim)) {
    // 速度：極限閃避鎖血，免於死亡，改落致命傷
    setInjury(victim, INJURIES.length - 1);
    emit(state, "injury", logText(state, "speedSave", { A: victim }));
    return;
  }
  if (dies) {
    run.deaths.push(victim.name);
    killSamsarite(state, victim, attacker ? `死在了隊友 ${attacker.name} 手上（【${dungeon.name}】）` : `死在了【${dungeon.name}】`, attacker);
    afterDeath(state, victim, attacker, partyOf(state, run)); // 同隊其他隊員理智 -10（4-C-2）
    return;
  }
  setInjury(victim, newLevel);
  emit(state, "injury", logText(state, "injury", { A: victim, injury: INJURIES[newLevel].name }));
}

function finishRun(state, run) {
  const dungeon = getDungeon(run.dungeonId);
  const survivors = partyOf(state, run);
  const passedCount = run.results.filter(Boolean).length;
  const success = survivors.length > 0 && passedCount >= roomsToClear(dungeon);
  let reward = 0;
  let specialReward = null;
  let dropDesc = "";
  let levelUp = null;
  // 情報條：不論成敗，每結算一場就累積（同副本多場依結算順序各加一次）
  const stats = state.dungeonStats[run.dungeonId];
  const ic = CONFIG.dungeon.intel;
  stats.intel = Math.min(ic.max, (stats.intel ?? ic.start) + ic.perRun);

  // 首通在「結算時」才判定：同副本同時開多場，先結算的吃首通，後結算的視為重打
  const firstClear = success && !hasIntel(state, dungeon);
  if (success) {
    const env = getEnvTag(run.envId) ?? null;
    reward = Math.round(dungeon.reward * rewardMultiplier(state, dungeon, survivors, env));
    if (firstClear) {
      reward += Math.round(dungeon.reward * CONFIG.dungeon.firstClearBonusPct);
      if (dungeon.specialRewards?.length) {
        const drop = pick(state, dungeon.specialRewards);
        specialReward = drop.name;
        dropDesc = drop.desc;
        state.collection.push(drop.id);
      }
      // 首通本章尾王：空間升 1 級（解鎖下一章），記下是第幾天
      if (dungeon.boss && dungeon.chapter >= state.spaceLevel) {
        state.chapterClearDay[dungeon.chapter] = currentDay(state);
        if (state.spaceLevel < CONFIG.space.maxLevel) {
          state.spaceLevel += 1;
          levelUp = state.spaceLevel;
        }
      }
    }
    state.points += reward;
    stats.clears += 1;
    // 尾王守門：只算該章前 3 關（常規副本）的成功結算次數，含首通與重打
    if (!dungeon.boss) {
      state.chapterClears ??= {};
      state.chapterClears[dungeon.chapter] = (state.chapterClears[dungeon.chapter] ?? 0) + 1;
    }
  } else {
    // 失敗但活著回來：一定帶傷
    for (const s of survivors) if (s.injury === 0) setInjury(s, 1);
  }
  for (const s of survivors) {
    s.location = "space";
    s.sabotaged = false; // 沒被打中就沒用到，動過手腳的裝備回家後已被檢查
  }

  const report = {
    runId: run.id,
    dungeonId: run.dungeonId,
    dungeonName: dungeon.name,
    success,
    reward,
    firstClear,
    specialReward,
    envName: getEnvTag(run.envId)?.name ?? null,
    passedCount,
    rooms: roomCount(dungeon),
    levelUp,
    karma: 0, // 這場掉了幾顆因果結晶
    insights: [], // 這場頓悟的人：[{ name, power, subStat, subGain, n }]
    results: run.results,
    deaths: run.deaths,
    survivors: survivors.map((s) => ({ name: s.name, injury: s.injury })),
  };
  state.lastRun = report;
  state.runReports.push(report); // 結算視窗排隊（畫面層依序顯示）
  if (state.runReports.length > CONFIG.runReportMax) state.runReports.shift();
  const partyIds = run.partyIds;
  state.runs = state.runs.filter((r) => r.id !== run.id);

  const vars = { dungeon: dungeon.name, passed: passedCount, rooms: roomCount(dungeon), reward };
  let text;
  if (success) {
    text = logText(state, firstClear ? "runFirstClear" : "runClear", vars);
    if (specialReward) text += "\n" + logText(state, "runSpecial", { item: specialReward, desc: dropDesc });
    if (firstClear && dungeon.boss && dungeon.chapter === CONFIG.space.maxLevel) text += "\n" + logText(state, "mainClear", { day: currentDay(state) });
    else if (levelUp) text += "\n" + logText(state, "spaceLevelUp", { level: levelUp, chapter: levelUp });
  } else {
    text = logText(state, survivors.length > 0 ? "runFail" : "runWipe", vars);
  }
  emit(state, "runEnd", text);
  if (success) {
    report.karma = rollKarmaDrop(state, dungeon, dungeonNumber(dungeon), firstClear); // 因果結晶（獨立亂數流）
    report.insights = rollInsights(state, survivors); // 存活隊員各自擲頓悟（獨立亂數流）
  }
  wishesAfterRun(state, run.dungeonId, success, partyIds, survivors.map((s) => s.id)); // 想去這個副本的許願結算
  godAfterRun(state, run.dungeonId, success, partyIds, survivors.map((s) => s.id)); // 主神突襲任務結算
  checkGameOver(state);
}
