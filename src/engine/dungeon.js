// 副本：成功率公式、逐房間檢定、傷亡、結算。
// 公式（Phase 4-A 飽和公式）：
//   房間通過率 = 0.85 × P ÷ (P + R × 0.55) + 情報條 + 關係加成 + 標籤與環境相性 + 心情
//   P = 小隊總戰力、R = 推薦戰力；情報條每個副本獨立（-3% 起，每結算一場 +1.5%，上限 +9%）
//   房數與過關門檻依章節（CONFIG.dungeon.chapters）；賭徒型標籤每房間再隨機浮動

import { CONFIG, INJURIES } from "../data/config.js";
import { DUNGEONS, getDungeon } from "../data/dungeons.js";
import { getMutation } from "../data/mutations.js";
import { firstRelicOf, hiddenRelicOf } from "../data/relics.js";
import { ENV_TAGS, getEnvTag } from "../data/tags.js";
import { rand, pick, weighted } from "./rng.js";
import { wishesAfterRun } from "./wishes.js";
import { godAfterRun } from "./godEvents.js";
import { rollInsights, rollKarmaDrop } from "./growth.js";
import { effectivePower, worldPassBonus, moodPassBonus, tagPassBonus, tagSwing, tagRewardPct, injuryShieldOf, dodgeOf, defenseChance, speedSaveChance, luckRewardPct } from "./tags.js";
import { partyRelationBonus, pickClash, clashText, afterClash, afterDeath, findProtector } from "./relations.js";
import { logText } from "./templates.js";
import { emit, setInjury, killSamsarite, checkGameOver, currentDay } from "./core.js";
import { collectionEffects, collectionPassBonus, consumeRunBuffs } from "./shop.js";
import { MANDATORY_ID, buildMandatoryDungeon } from "./mandatory.js";
import { distributeLoot } from "./wallet.js";
import { grantRelic } from "./relics.js";
import { afterRunBoard, boardOf } from "./board.js";
import { intelFull, marketOf } from "./market.js";
import { addLove } from "./relations.js";
import { failSanityLoss, squadBossPowerMult, squadClashMult, squadBondMult, squadDefenseBonus, squadAfterClear, bondGuard, farmingPigDied, farmingRewardMult } from "./squad.js";
import { addChronicle } from "./lineage.js";
import { dramaAfterRun } from "./drama.js";
import { rollRogueEncounter, rogueBossOf, rogueDungeon, resolveRogueFight } from "./lineage.js";
import { squadRng } from "./squad.js";
import { gearAfterRun } from "./gearFx.js";
import { erosionBlock, applyErosion, erosionRewardMult } from "./erosion.js";
import { RIVAL_ID, buildRivalDungeon, rivalOnStart, rivalFinish, rivalSpare } from "./rivals.js";
import { intelGainBonus, rivalRewardBonus } from "./facilities.js";

/** 關係加成（喜歡 +10%、愛慕 +20%、討厭 -10%、仇恨 -20%…，見 engine/relations.js） */
export function relationBonus(state, party) {
  return partyRelationBonus(state, party);
}

/** 標籤與環境相性：標籤加成（含類型、環境相性）+ 環境本身的修正 + 副本特殊獎勵（收藏）的加成 */
export function tagBonus(state, party, dungeon, env = null) {
  return tagPassBonus(party, dungeon, env) + (env?.passMod ?? 0) + collectionPassBonus(state, dungeon) + worldPassBonus(party, dungeon);
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
  return dungeon.toClear ?? chapterOf(dungeon).toClear; // 強制任務等動態副本自帶 toClear
}
/** 這場副本的定義：強制任務是開場快照（run.dungeonDef），一般副本查資料表 */
export function dungeonOfRun(run) {
  return run.dungeonDef ?? applyErosion(applyMutation(getDungeon(run.dungeonId), run.mutationId), run.erosion ?? 0);
}
/** 套上突變詞綴對副本本身的修正（目前只有血月狂躁的 R 倍率）；回傳新物件，不動資料表 */
export function applyMutation(dungeon, mutationId) {
  const m = getMutation(mutationId);
  return m?.rMult ? { ...dungeon, recommendedPower: Math.round(dungeon.recommendedPower * m.rMult) } : dungeon;
}
/** 這場副本要走幾個房間：一般房間數 + 貪婪探索追加的隱藏房（4-D-4） */
export function runRoomTotal(run) {
  return roomCount(dungeonOfRun(run)) + (run.hidden ? 1 : 0);
}
/** 這個副本是全域第幾關（1~30；DUNGEONS 陣列順序就是關卡編號；用 id 找，所以套了突變的副本副本也能查） */
export function dungeonNumber(dungeon) {
  return DUNGEONS.findIndex((d) => d.id === dungeon.id) + 1;
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

/** 小隊總戰力：生死搭檔（4-E-3）兩人都在隊上時，雙方有效戰力各 +CONFIG.drama.pairPowerPct */
export function partyPower(party) {
  const ids = new Set(party.map((s) => s.id));
  return party.reduce((sum, s) => sum + effectivePower(s) * (s.bondPartnerId && ids.has(s.bondPartnerId) ? 1 + CONFIG.drama.pairPowerPct : 1), 0);
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
  // 洲際宿敵特色：機械飛昇隊免疫精神類（我方關係／心情的正向加成失效）、中皇天命隊護體（我方每房通過率下修）
  const rel = relationBonus(state, party);
  const mood = moodPassBonus(party);
  const raw =
    powerRate(partyPower(party) * squadBossPowerMult(state, !!dungeon.boss), dungeon.recommendedPower) + // 菁英流打尾王戰力 ×1.15（4-E-2）
    (dungeon.mentalImmune ? Math.min(0, rel) : rel) +
    tagBonus(state, party, dungeon, env) +
    (dungeon.mentalImmune ? Math.min(0, mood) : mood) +
    intel +
    swing -
    (dungeon.shieldPenalty ?? 0);
  return Math.min(dungeon.passCap ?? CONFIG.dungeon.maxPassRate, Math.max(CONFIG.dungeon.minPassRate, raw));
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
export function startRun(state, dungeonId, partyIds, opts = {}) {
  const rival = dungeonId === RIVAL_ID; // 洲際碰撞（4-F-1）：動態副本，和強制任務同樣不看章節解鎖、守門、情報條
  const mandatory = dungeonId === MANDATORY_ID || rival; // 主神強制任務（4-C-4）與洲際碰撞：動態副本，不看章節解鎖、守門、情報條
  if (dungeonId === MANDATORY_ID && !state.mandatory?.pending) return { ok: false, reason: "目前沒有主神強制任務" };
  if (rival && !state.rivals?.pending) return { ok: false, reason: "目前沒有洲際碰撞任務" };
  const dungeon = rival ? buildRivalDungeon(state, partyIds) : dungeonId === MANDATORY_ID ? buildMandatoryDungeon(state) : getDungeon(dungeonId); // 要在隊員離開主神空間前算（R 看名冊戰力）
  if (!dungeon) return { ok: false, reason: "找不到這個副本" };
  const erosion = mandatory ? 0 : opts.erosion ?? 0; // 位面侵蝕星級（4-F-3）
  const eBlock = erosionBlock(state, dungeon, erosion);
  if (eBlock) return { ok: false, reason: eBlock };
  if (!mandatory) {
    if (dungeon.chapter > (state.spaceLevel ?? 1)) return { ok: false, reason: `第 ${dungeon.chapter} 章還沒解鎖（空間 Lv.${dungeon.chapter} 才能進）` };
    const gate = bossGateInfo(state, dungeon);
    if (!gate.open) {
      return { ok: false, reason: `尾王還沒開放：要先在第 ${dungeon.chapter} 章前 3 關合計通關滿 ${gate.need} 次（目前 ${gate.have}/${gate.need}）` };
    }
  }
  // 動態任務榜（4-D-4）：帶 slotId 出發 = 接榜上那一槽（附帶突變詞綴）；沒帶 = 照舊直接指定副本（主神突襲任務、許願、測試）
  let slot = null;
  if (opts.slotId != null && !mandatory) {
    slot = boardOf(state).slots.find((s) => s.id === opts.slotId);
    if (!slot) return { ok: false, reason: "這個任務已經不在榜上了" };
    if (slot.dungeonId !== dungeonId) return { ok: false, reason: "任務榜資料不符" };
    if (slot.running) return { ok: false, reason: "這個任務已經有隊伍出發了" };
  }
  if (opts.greedy && (mandatory || !intelFull(state, dungeonId))) return { ok: false, reason: "要情報滿格才能貪婪探索" };
  if (partyIds.length < 1 || partyIds.length > CONFIG.partyMax) {
    return { ok: false, reason: `一隊要 1~${CONFIG.partyMax} 人` };
  }
  if (new Set(partyIds).size !== partyIds.length) return { ok: false, reason: "同一個人不能在隊伍裡出現兩次" }; // 嚴重 Bug 1：重複成員
  const party = partyIds.map((id) => state.samsarites.find((s) => s.id === id));
  if (party.some((s) => !s || s.location !== "space")) return { ok: false, reason: "有隊員不在主神空間" };
  const locked = opts.ignoreLock ? null : party.find((s) => s.locked); // 嚴重 Bug 2：🔒 鎖定的人不能派（只有引擎的強制徵召可帶 ignoreLock，之後第二部分問題 3 會再收緊）
  if (locked) return { ok: false, reason: `${locked.name} 已鎖定（🔒），不能派遣` };
  const resting = party.find((s) => (s.vacationDays ?? 0) > 0);
  if (resting) return { ok: false, reason: `${resting.name} 正在放假（還要 ${resting.vacationDays} 天）` };
  const lockedIn = party.find((s) => (s.podLockDays ?? 0) > 0);
  if (lockedIn) return { ok: false, reason: `${lockedIn.name} 被鎖在私人休眠艙裡（還要 ${lockedIn.podLockDays} 天）` };

  const enteredInjury = {};
  for (const s of party) {
    consumeRunBuffs(s); // 出征耗材套用成單場 buff（4-D-2）
    s.location = "dungeon";
    s.runs += 1;
    enteredInjury[s.id] = s.injury; // 記住「帶傷出征」的等級，用來算死亡率加成
  }
  // 爆發耗材（4-E-8）：全隊爆發（partyNextRunPowerMult）與個人爆發同場只取最高 1 件，不連乘；全隊戰後理智代價記在 run 上
  const partyPct = Math.max(0, ...party.map((s) => s.runBuff?.partyPowerPct ?? 0));
  const partySan = Math.min(0, ...party.map((s) => s.runBuff?.partyPostRunSanity ?? 0));
  if (partyPct > 0) for (const s of party) (s.runBuff ??= {}).powerPct = Math.max(s.runBuff.powerPct ?? 0, partyPct);
  const intel = mandatory ? 0 : intelBonus(state, dungeon); // 開場鎖定，結算才加情報
  if (!mandatory) {
    const stats = (state.dungeonStats[dungeonId] ??= { attempts: 0, clears: 0, intel });
    stats.attempts += 1;
  }

  const env = mandatory ? null : pick(state, ENV_TAGS); // 每次進副本隨機抽一個環境標籤（強制任務沒有）
  const firstTime = mandatory ? false : !hasIntel(state, dungeon);
  const mutationId = slot?.mutationId ?? null;
  const run = { partyPostRunSanity: partySan, id: state.nextRunId++, startTick: state.tick, dungeonId, mutationId, slotId: slot?.id ?? null, greedy: !!opts.greedy, erosion, envId: env?.id ?? null, firstTime, intel, partyIds: [...partyIds], enteredInjury, roomIndex: 0, results: [], deaths: [] };
  if (!mandatory) run.rogueId = rollRogueEncounter(state); // 常規副本 10% 遭遇叛逃野生 Boss 亂入最後一房（4-E-4）
  if (mandatory) {
    run.mandatory = true;
    run.dungeonDef = dungeon; // 開場快照：R 與獎勵不隨之後名冊變動
    run.extraInjury = dungeon.failInjuryExtra;
    if (rival) {
      run.rival = { squadId: dungeon.rival.squadId, mortalityMod: dungeon.rival.mortalityMod ?? 0 };
      rivalOnStart(state, run, dungeon, party);
    } else state.mandatory.pending = null; // 派出去了，任務不再逾時
  }
  if (slot) {
    slot.running = true;
    slot.runId = run.id;
  }
  state.runs.push(run);
  const shown = applyErosion(applyMutation(dungeon, mutationId), erosion); // 血月狂躁、位面侵蝕：顯示加成後的 R
  if (erosion > 0) emit(state, "erosion", logText(state, "erosionStart", { star: erosion, dungeon: dungeon.name }));
  emit(
    state,
    "runStart",
    logText(state, "runStart", {
      names: party.map((s) => s.name).join("、"),
      dungeon: dungeon.name,
      power: partyPower(party),
      rec: shown.recommendedPower,
    })
  );
  if (mutationId) emit(state, "mutation", logText(state, "runMutation", { mutation: getMutation(mutationId).name, desc: getMutation(mutationId).desc }));
  if (run.greedy) emit(state, "greedy", logText(state, "runGreedy"));
  if (env) emit(state, "env", logText(state, "env", { env: env.name, desc: env.desc }));
  if (firstTime) emit(state, "intel", logText(state, "intel"));
  if (state.runs.length > 1) emit(state, "runParallel", logText(state, "runParallel", { n: state.runs.length, dungeon: dungeon.name }));
  return { ok: true, run };
}

/** 這場副本此刻該不該走下一個房間（每 roomTicks 個時段走一間，所有副本共用同一個時間） */
export function roomDue(state, run) {
  return run.roomIndex < runRoomTotal(run) && state.tick >= run.startTick + run.roomIndex * CONFIG.roomTicks;
}

/** 走一個房間（= 0.2 天）。只結算房間，不推進時間；時間由 dispatch.js 的 step() 統一推進。 */
export function stepRun(state, run = state.runs[0]) {
  if (!run) return;
  const dungeon = dungeonOfRun(run);
  if (run.roomIndex >= roomCount(dungeon)) return stepHiddenRoom(state, run, dungeon); // 貪婪探索追加的隱藏房
  const mut = getMutation(run.mutationId);
  const room = dungeon.rooms[run.roomIndex];
  const party = partyOf(state, run);
  const env = getEnvTag(run.envId) ?? null;
  const progress = `[${dungeon.name}・${Math.round(((run.roomIndex + 1) / roomCount(dungeon)) * 100)}%・${room.name}]`;
  const clash = pickClash(state, party, run.roomIndex, (mut?.clashMult ?? 1) * squadClashMult(state)); // 仇人／背刺者：先打自己人，這個房間算失敗
  const passed = clash ? false : rand(state) < roomPassRate(state, party, dungeon, env, tagSwing(state, party), run.intel);

  if (clash) {
    emit(state, "clash", `${progress} ${clashText(state, clash)}`);
    afterClash(state, clash);
    loseSanityOf(clash.victim, failSanityLoss(state, party, CONFIG.sanity.roomFailLoss + (mut?.failSanity ?? 0)));
    hurt(state, run, clash.victim, dungeon, clash.attacker);
  } else if (passed) {
    emit(state, "roomPass", `${progress} ${room.pass}`);
  } else {
    const victim = pick(state, party);
    emit(state, "roomFail", `${progress} ${room.fail.replace("{name}", victim.name)}`);
    loseSanityOf(victim, failSanityLoss(state, party, CONFIG.sanity.roomFailLoss + (mut?.failSanity ?? 0))); // 單房失敗：受害者理智 -5（4-C-2）；斷電黑夜再 -3
    hurt(state, run, victim, dungeon);
  }
  run.results.push(passed);
  run.roomIndex += 1;
  maybeOpenHiddenRoom(state, run, dungeon, mut, party);
}

/** 貪婪探索：通關門檻已達、走完最後一個一般房間後，有機率（20%，濃霧走散 ×2）追加 1 間 R×1.35 的隱藏房。用獨立亂數流 market.rngState */
function maybeOpenHiddenRoom(state, run, dungeon, mut, party) {
  if (!run.greedy || run.hidden || run.roomIndex !== roomCount(dungeon) || party.length === 0) return;
  if (run.results.filter(Boolean).length < roomsToClear(dungeon)) return;
  const chance = Math.min(1, CONFIG.relic.greedyChance * (mut?.relicChanceMult ?? 1));
  if (rand(marketOf(state)) < chance) {
    run.hidden = { passed: null };
    emit(state, "greedy", logText(state, "hiddenOpen", { dungeon: dungeon.name }));
  }
}

/** 隱藏房：只看這一間的過關（不計入通關門檻）；通過掉隱藏奇物，失敗照樣受傷、可能戰死 */
function stepHiddenRoom(state, run, dungeon) {
  const party = partyOf(state, run);
  const env = getEnvTag(run.envId) ?? null;
  const hardR = { ...dungeon, recommendedPower: Math.round(dungeon.recommendedPower * CONFIG.relic.hiddenRMult) };
  const passed = rand(state) < roomPassRate(state, party, hardR, env, tagSwing(state, party), run.intel);
  const progress = `[${dungeon.name}・隱藏房]`;
  if (passed) {
    emit(state, "roomPass", `${progress} ${logText(state, "hiddenPass")}`);
  } else {
    const victim = pick(state, party);
    emit(state, "roomFail", `${progress} ${logText(state, "hiddenFail", { A: victim })}`);
    loseSanityOf(victim, failSanityLoss(state, party, CONFIG.sanity.roomFailLoss + (getMutation(run.mutationId)?.failSanity ?? 0)));
    hurt(state, run, victim, dungeon);
  }
  run.hidden.passed = passed;
  run.roomIndex += 1;
}

function loseSanityOf(s, amount) {
  s.stats.sanity = Math.max(0, s.stats.sanity - amount);
}

/** 這場副本是否結束：時間到（房數 × roomTicks；全滅的也要等時間過完才結算，剩下的房間不用走） */
export function runIsOver(state, run) {
  return state.tick >= run.startTick + runRoomTotal(run) * CONFIG.roomTicks;
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
  let guarded = null; // 被擋刀救下的人（擋刀者若因此戰死，寫進編年史「壯烈擋刀犧牲」，4-F-4 八卦日報頭條用）
  if (!attacker) {
    // 愛慕／靈魂伴侶的隊友有機會替他擋下這一下
    const guard = findProtector(state, partyOf(state, run), victim);
    if (guard) {
      emit(state, "social", logText(state, "guard", { A: guard, B: victim }));
      guarded = victim;
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
  let gained = weighted(state, table).levels + (run.extraInjury ?? 0); // 強制任務：單房失敗傷勢額外 +1
  const cap = CONFIG.tags.injuryShieldMax;
  const shield = Math.min(cap, injuryShieldOf(victim) + collectionEffects(state).injuryShield); // 個人（標籤＋裝備）＋收藏的全員減免
  if (shield > 0 && rand(state) < shield) gained = Math.max(1, gained - 1);
  else if (shield < 0 && rand(state) < -shield) gained += 1;
  // 防禦（Phase 4-C-1）：有機率讓這次傷勢少 1 級，原判輕傷則免傷（和上面的標籤／裝備減免獨立疊加）
  const healthy = victim.injury === 0; // 進這個房間前是健康無傷：這次絕不直接戰死
  if (gained > 0 && rand(state) < Math.min(CONFIG.combat.defense.max, defenseChance(victim) + squadDefenseBonus(state))) { // 共產流防禦 +0.08，仍守總上限（4-E-2）
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
  if (dies && rivalSpare(state, run)) { // 洲際團戰：合歡粉紅／萬年養老隊低殺意，致死率打折，免死者改落致命傷（4-F-1）
    dies = false;
    newLevel = Math.min(newLevel, INJURIES.length - 1);
  }
  if (dies && (victim.deathWard ?? 0) >= 1) {
    // 替死護符（4-E-8）：消耗護符免死；一般護符改落輕傷，高階護符（fullRecover）傷勢清零並回滿理智
    victim.deathWard = 0;
    if (victim.deathWardFull) {
      setInjury(victim, 0);
      victim.stats.sanity = 100;
    } else setInjury(victim, 1);
    victim.deathWardFull = false;
    emit(state, "injury", logText(state, "deathWard", { A: victim }));
    return;
  }
  if (dies && bondGuard(state, run, partyOf(state, run), victim)) return; // 羈絆流託付後背：夥伴替他擋下致死一刀（4-E-2）
  if (dies && rand(state) < Math.max(0, speedSaveChance(victim) + (getMutation(run.mutationId)?.speedSaveMod ?? 0))) { // 濃霧走散：鎖血率 -5%
    // 速度：極限閃避鎖血，免於死亡，改落致命傷
    setInjury(victim, INJURIES.length - 1);
    emit(state, "injury", logText(state, "speedSave", { A: victim }));
    return;
  }
  if (dies) {
    if (guarded) addChronicle(state, "guard", logText(state, "chronGuard", { A: victim, B: guarded, dungeon: dungeon.name }));
    run.deaths.push(victim.name);
    killSamsarite(state, victim, attacker ? `死在了隊友 ${attacker.name} 手上（【${dungeon.name}】）` : `死在了【${dungeon.name}】`, attacker, "dungeon"); // 副本戰死：夠格的人入英靈碑
    afterDeath(state, victim, attacker, partyOf(state, run)); // 同隊其他隊員理智 -10（4-C-2）
    farmingPigDied(state, run, victim); // 養殖流：肉豬陣亡，隊長暴衝（4-E-2）
    return;
  }
  setInjury(victim, newLevel);
  emit(state, "injury", logText(state, "injury", { A: victim, injury: INJURIES[newLevel].name }));
}

function finishRun(state, run) {
  const dungeon = dungeonOfRun(run);
  const survivors = partyOf(state, run);
  const passedCount = run.results.filter(Boolean).length;
  let success = survivors.length > 0 && passedCount >= roomsToClear(dungeon);
  // 叛逃野生 Boss 亂入最後一房（4-E-4）：擊敗追回賞金；不敵則全員帶傷撤退（這場算失敗）
  let rogue = null;
  const rogueBoss = run.rogueId && survivors.length > 0 ? rogueBossOf(state, run.rogueId) : null;
  if (rogueBoss) {
    const win = rand(squadRng(state)) < roomPassRate(state, survivors, rogueDungeon(state), null, 0, 0);
    rogue = resolveRogueFight(state, rogueBoss, survivors, win);
    if (!win) success = false;
  }
  let reward = 0;
  let specialReward = null;
  let dropDesc = "";
  let levelUp = null;
  const mut = getMutation(run.mutationId);
  const relics = []; // 這場取得的奇物 [{ name, kind, dup }]（4-D-4）
  let loot = { tax: 0, share: 0, members: 0 }; // 結算分潤：入公庫多少、每人私房錢分到多少（4-D-1）
  // 情報條：不論成敗，每結算一場就累積（同副本多場依結算順序各加一次）
  const stats = run.mandatory ? null : state.dungeonStats[run.dungeonId]; // 強制任務沒有情報條與通關統計
  const ic = CONFIG.dungeon.intel;
  if (stats) stats.intel = Math.min(ic.max, (stats.intel ?? ic.start) + ic.perRun * (1 + intelGainBonus(state))); // 星界觀測樞加成情報獲取（4-F-3）

  // 首通在「結算時」才判定：同副本同時開多場，先結算的吃首通，後結算的視為重打
  const firstClear = success && !run.mandatory && !hasIntel(state, dungeon);
  if (success) {
    const env = getEnvTag(run.envId) ?? null;
    if (run.rival) reward = Math.round(dungeon.reward * (dungeon.rival.rewardMult ?? 1) * (1 + rivalRewardBonus(state))); // 洲際團戰：宿敵隊獎勵倍率 × 星界觀測樞加成（4-F-1）
    else if (run.mandatory) {
      // 血腥撫卹：每戰死 1 名隊友，存活者總積分 +25%（加算）；標籤／收藏／氣運加成照常，沒有獎勵遞減
      const bonus = 1 + run.deaths.length * CONFIG.forcedMission.deathRewardPct;
      reward = Math.round(dungeon.reward * bonus * (1 + tagRewardPct(survivors) + collectionEffects(state).rewardPct) * (1 + luckRewardPct(survivors)));
    } else reward = Math.round(dungeon.reward * rewardMultiplier(state, dungeon, survivors, env) * (1 + (mut?.rewardPct ?? 0)) * erosionRewardMult(run.erosion ?? 0)); // 突變詞綴的結算積分加成（4-D-4）、位面侵蝕積分倍率（4-F-3）
    if (firstClear) {
      reward += Math.round(dungeon.reward * CONFIG.dungeon.firstClearBonusPct);
      const first = firstRelicOf(run.dungeonId); // 首通奇物（4-D-4）：首次通關必得
      if (first) relics.push({ name: first.name, kind: "first", dup: grantRelic(state, first)?.dup ?? false });
      if (dungeon.specialRewards?.length) {
        const drop = pick(state, dungeon.specialRewards);
        specialReward = drop.name;
        dropDesc = drop.desc;
        state.collection.push(drop.id);
      }
      // 首通本章尾王：空間升 1 級（解鎖下一章），記下是第幾天
      if (dungeon.boss) {
        // 編年史：尾王首通（4-E-5）；等級在下面升，所以先記「升級後」的等級
        const lv = dungeon.chapter >= state.spaceLevel ? Math.min(CONFIG.space.maxLevel, state.spaceLevel + 1) : state.spaceLevel;
        addChronicle(state, "boss", logText(state, "chronBoss", { chapter: dungeon.chapter, boss: dungeon.name, level: lv }));
      }
      if (dungeon.boss && dungeon.chapter >= state.spaceLevel) {
        state.chapterClearDay[dungeon.chapter] = currentDay(state);
        if (state.spaceLevel < CONFIG.space.maxLevel) {
          state.spaceLevel += 1;
          levelUp = state.spaceLevel;
        }
      }
    }
    if (run.hidden?.passed) {
      // 貪婪探索成功：掉該關隱藏奇物；已擁有則轉成額外積分
      const hid = hiddenRelicOf(run.dungeonId);
      const got = grantRelic(state, hid);
      if (got) {
        relics.push({ name: hid.name, kind: "hidden", dup: got.dup });
        if (got.dup) reward += Math.round(dungeon.reward * CONFIG.relic.dupRewardPct);
      }
    }
    reward = Math.round(reward * farmingRewardMult(state, run)); // 養殖流：肉豬陣亡每層 +20%（4-E-2）
    if (survivors.length >= 2) {
      // 同行情誼：存活隊員兩兩好感 +bondLove（吊橋效應 ×1.5；傭兵流減半），不消耗亂數
      const loveBonus = Math.max(0, ...survivors.map((s) => s.runBuff?.loveBonus ?? 0)); // 合群清茶等：同行好感額外加成，取最高 1 件（4-E-8）
      const bond = Math.round(CONFIG.dungeon.bondLove * (mut?.loveMult ?? 1) * squadBondMult(state)) + loveBonus;
      for (const a of survivors) for (const b of survivors) if (a.id !== b.id) addLove(state, a, b, bond);
    }
    loot = distributeLoot(state, survivors, reward, { run, dungeon }); // 先抽稅入公庫（流派覆寫分潤見 4-E-2），其餘由存活隊員平分進私房錢（4-D-1）
    if (stats) stats.clears += 1;
    squadAfterClear(state, survivors); // 羈絆流：存活通關全隊理智 +4（4-E-2）
    if (dungeon.boss && !run.mandatory) for (const s of survivors) s.maxBossChapter = Math.max(s.maxBossChapter ?? 0, dungeon.chapter); // 遺物履歷（4-E-4）
    // 尾王守門：只算該章前 3 關（常規副本）的成功結算次數，含首通與重打
    if (!dungeon.boss && !run.mandatory && !run.erosion) {
      state.chapterClears ??= {};
      state.chapterClears[dungeon.chapter] = (state.chapterClears[dungeon.chapter] ?? 0) + 1;
    }
  } else {
    // 失敗但活著回來：一定帶傷
    for (const s of survivors) if (s.injury === 0) setInjury(s, 1);
  }
  let erosionCrystals = 0;
  if (success && run.erosion > 0) { // 位面侵蝕：成功通關 k★ 固定掉 k 顆侵蝕結晶（4-F-3）
    erosionCrystals = run.erosion * CONFIG.erosion.crystalPerStar;
    state.erosionCrystals = (state.erosionCrystals ?? 0) + erosionCrystals;
    state.maxErosion = Math.max(state.maxErosion ?? 0, run.erosion);
    emit(state, "erosion", logText(state, "erosionClear", { star: run.erosion, dungeon: dungeon.name, n: erosionCrystals, total: state.erosionCrystals }));
  }
  if (rogue?.win) loot.rogueBounty = distributeLoot(state, survivors, rogue.bounty, { run, dungeon }).tax; // 賞金也走流派分潤（4-E-4）
  gearAfterRun(state, survivors); // 裝備被動：出戰扣理智、隨機扣隊友理智（4-E-8）
  for (const s of survivors) {
    if (s.runBuff?.postRunInjury) setInjury(s, Math.min(INJURIES.length - 1, s.injury + s.runBuff.postRunInjury)); // 燃血類耗材：戰後傷勢 +1
    if (run.partyPostRunSanity) s.stats.sanity = Math.max(0, s.stats.sanity + run.partyPostRunSanity); // 全隊爆發耗材：戰後全員理智代價
  }
  for (const s of survivors) {
    s.location = "space";
    s.runBuff = null; // 單場 buff 用完即止（4-D-2）
    s.tempPowerPct = 0; // 養殖流的臨時戰力隨副本結束清掉（4-E-2）
    s.sabotaged = false; // 沒被打中就沒用到，動過手腳的裝備回家後已被檢查
  }

  const rivalReport = run.rival ? rivalFinish(state, run, dungeon, survivors, success) : null; // 洲際團戰結算：勝利特色獎勵／落敗懲罰、私奔、春風一度（存活者回家後才處理，4-F-1／2）
  const report = {
    runId: run.id,
    mandatory: !!run.mandatory && !run.rival,
    dungeonId: run.dungeonId,
    dungeonName: dungeon.name,
    success,
    reward,
    mutation: mut ? { id: mut.id, name: mut.name, icon: mut.icon } : null,
    greedy: !!run.greedy,
    hidden: run.hidden ? (run.hidden.passed ? "passed" : "failed") : null, // 貪婪探索：沒開隱藏房 = null
    relics,
    erosion: run.erosion ?? 0,
    erosionCrystals,
    rival: rivalReport, // 洲際團戰摘要（4-F-1）或 null
    rogue, // 叛逃 Boss 對決結果 { name, win, bounty, crystal } 或 null（4-E-4）
    tax: loot.tax,
    share: loot.share,
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
    survivors: survivors.filter((s) => state.samsarites.includes(s)).map((s) => ({ name: s.name, injury: s.injury })), // 私奔者已不在名冊
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
    if (!run.mandatory) report.karma = rollKarmaDrop(state, dungeon, dungeonNumber(dungeon), firstClear); // 因果結晶（獨立亂數流；強制任務不掉）
    report.insights = rollInsights(state, survivors); // 存活隊員各自擲頓悟（獨立亂數流）
  }
  afterRunBoard(state, run); // 任務榜：出發的那一槽移除並立即補新槽（4-D-4）
  wishesAfterRun(state, run.dungeonId, success, partyIds, survivors.map((s) => s.id)); // 想去這個副本的許願結算
  godAfterRun(state, run.dungeonId, success, partyIds, survivors.map((s) => s.id)); // 主神突襲任務結算
  if (success) dramaAfterRun(state, survivors); // 副本結算穿插人際事件（4-E-3，獨立亂數流）
  checkGameOver(state);
}
