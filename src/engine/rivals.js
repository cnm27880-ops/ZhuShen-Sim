// 八大洲際宿敵團戰與跨隊修羅場（Phase 4-F-1／4-F-2）。純規則，不碰畫面。
// 數字：CONFIG.rival；隊伍設定：src/data/rivals.js（RivalSquadSnapshot）；日誌：src/data/logs.js（rival*）。
//
//   state.rivals = {
//     rngState   獨立亂數流（選隊伍、策反骰、春風一度、私奔、反拐）——不動主亂數
//     nextDay    下一次碰撞的天數（空間 Lv.1 時為 null，絕對不觸發）
//     pending    待派的碰撞任務 { id, squadId, createdDay, deadlineDay, warned, grace, revoltRoll } 或 null
//     nextId
//     squads     { 隊伍id: { roster: [前我方叛逃者 { name, role: "defector", snapshot }], meets, wins } }
//     stats      累計：fights／wins／losses／elopes／counters／hybrids／revolts
//   }
// 碰撞是一場「動態副本」（和強制任務同款）：開場快照存進 run.dungeonDef，結算在 dungeon.js finishRun 的 rival 分支。
// 洲際碰撞不混入日常自動輪詢；刷出當天與剩餘 1 天發 "rival" 事件（自動暫停），倒數歸零仍沒派隊就自動徵召最高戰力精銳。

import { CONFIG, RANKS } from "../data/config.js";
import { RIVAL_ID, RIVAL_SQUADS, RIVAL_ROOMS, RIVAL_TAUNTS, getRivalSquad } from "../data/rivals.js";
import { RELICS } from "../data/relics.js";
import { rand, randInt, pick } from "./rng.js";
import { emit, currentDay, createSamsarite, setInjury, forgetRelations } from "./core.js";
import { effectivePower } from "./tags.js";
import { startRun } from "./dungeon.js";
import { affinity, addLove } from "./relations.js";
import { captainOf, styleOf, bump } from "./squad.js";
import { topPowerSum, popLimit } from "./mandatory.js";
import { grantRelic } from "./relics.js";
import { addChronicle } from "./lineage.js";
import { cancelWishesOf } from "./wishes.js";
import { cancelGodOf } from "./godEvents.js";
import { enhanceGain, enhanceCapOf } from "./growth.js";
import { rivalRewardBonus, podDaysCut, talentFloor } from "./facilities.js";
import { logText } from "./templates.js";

export { RIVAL_ID };
const R = () => CONFIG.rival;

export function newRivalState(seed = 0) {
  return { rngState: (seed ^ 0x71a1) | 0, nextDay: null, pending: null, nextId: 1, squads: {}, stats: {} };
}
const riv = (state) => (state.rivals ??= newRivalState(state.rngState));
export const pendingRival = (state) => state.rivals?.pending ?? null;
const bumpR = (state, key, n = 1) => {
  const st = (riv(state).stats ??= {});
  st[key] = (st[key] ?? 0) + n;
};
const squadState = (state, id) => ((riv(state).squads ??= {})[id] ??= { roster: [], meets: 0, wins: 0 });
const defectorsOf = (state, id) => squadState(state, id).roster.filter((m) => m.role === "defector");
const activeRoster = (state) => state.samsarites.filter((s) => s.location !== "pod");

/** 一支宿敵隊的 RivalSquadSnapshot（內建 NPC 隊伍 + 我方叛逃者進 roster；Phase 5 雲端快照也走這個結構） */
export function rivalSnapshot(state, id) {
  const q = getRivalSquad(id);
  if (!q) return null;
  return { id: q.id, name: q.name, factionStyle: q.factionStyle, rMult: q.rMult, rewardMult: q.rewardMult, mortalityMod: q.mortalityMod, specialRule: q.specialRule, source: "npc", roster: [...q.roster, ...squadState(state, id).roster] };
}

/** 洲際碰撞的基準戰力：max(空間等級基準, 名冊前 4 強有效戰力 × powerMult)；再乘宿敵隊 rMult */
export function baseRivalR(state) {
  return Math.max(R().baseR[(state.spaceLevel ?? 1) - 1], Math.round(topPowerSum(state) * R().powerMult));
}

/** 東櫻「肉豬策反」條件：我方隊長是 communal／bond 流派，或隊員對隊長的平均淨好感 >= 40 */
function revoltEligible(state, partyIds) {
  const cap = captainOf(state);
  if (!cap) return false;
  if (["communal", "bond"].includes(styleOf(state))) return true;
  const others = (partyIds ?? []).map((id) => state.samsarites.find((s) => s.id === id)).filter((s) => s && s.id !== cap.id);
  if (others.length === 0) return false;
  return others.reduce((n, s) => n + affinity(state, s, cap), 0) / others.length >= R().pigRevolt.minAvgAffinity;
}

/**
 * 動態副本快照（開場時依名冊與空間等級算 R）。不消耗亂數：策反骰在任務刷出時就擲好存在 pending.revoltRoll。
 * partyIds 沒給 = UI 預覽（不判策反條件）
 */
export function buildRivalDungeon(state, partyIds = null) {
  const pend = pendingRival(state);
  if (!pend) return null; // #37：沒有待派的洲際任務就回 null，不拋 TypeError
  const q = getRivalSquad(pend.squadId);
  const lv = state.spaceLevel ?? 1;
  const cfg = R();
  let rMult = q.rMult;
  const revolt = q.specialRule === "pigRevolt" && !!partyIds && pend.revoltRoll < cfg.pigRevolt.chance && revoltEligible(state, partyIds);
  if (revolt) rMult *= 1 - cfg.pigRevolt.rReduce;
  if (q.lockedR) rMult = Math.max(rMult, q.rMult); // 煉獄惡魔隊 1.25x 硬鎖：任何削弱都不能讓它低於 1.25
  const defectors = defectorsOf(state, q.id).length;
  const recommendedPower = Math.round(baseRivalR(state) * rMult * (1 + cfg.defectorRPct * defectors));
  return {
    id: RIVAL_ID,
    name: `洲際碰撞：${q.name}`,
    icon: q.icon,
    chapter: lv,
    boss: false,
    genre: "",
    mandatory: true,
    intro: q.intro,
    recommendedPower,
    reward: cfg.reward[lv - 1],
    toClear: cfg.toClear,
    passCap: cfg.passCap,
    mentalImmune: q.specialRule === "mental",
    shieldPenalty: q.specialRule === "shield" ? cfg.shieldPassPenalty : 0,
    rooms: RIVAL_ROOMS.map((r) => ({ name: r.name, pass: r.pass.replaceAll("{rival}", q.name), fail: r.fail.replaceAll("{rival}", q.name) })),
    rival: { squadId: q.id, rewardMult: q.rewardMult, mortalityMod: q.mortalityMod, rMult, revolt, defectors },
  };
}

// ───────── 每日排程 ─────────

/** 每日結算掛鉤：空間 Lv.1 絕對不觸發；升到 Lv.2 才開始 35～45 天倒數；刷出後限時 5 天，逾時自動徵召精銳 */
export function dailyRivals(state) {
  if (state.gameOver) return;
  const rv = riv(state);
  if ((state.spaceLevel ?? 1) < R().unlockSpaceLevel) return;
  const day = currentDay(state);
  if (rv.nextDay == null && !rv.pending) {
    rv.nextDay = day + randInt(rv, R().firstMin, R().firstMax);
    return;
  }
  const p = rv.pending;
  if (p) {
    if (day >= p.deadlineDay) draftAndGo(state);
    else if (day >= p.deadlineDay - 1 && !p.warned) {
      p.warned = true;
      emit(state, "rival", logText(state, "rivalLast", { squad: getRivalSquad(p.squadId).name }));
    }
    return;
  }
  if (day < rv.nextDay) return;
  if (!state.samsarites.some((s) => s.location === "space")) return; // 沒人能派，等有人回家
  const squadId = pickSquad(state, rv);
  rv.pending = { id: rv.nextId++, squadId, createdDay: day, deadlineDay: day + R().deadlineDays, warned: false, grace: 0, revoltRoll: rand(rv) };
  rv.nextDay = day + randInt(rv, R().intervalMin, R().intervalMax);
  const q = getRivalSquad(squadId);
  squadState(state, squadId).meets += 1;
  const defs = defectorsOf(state, squadId);
  emit(state, "rival", logText(state, "rivalAsk", { squad: q.name, icon: q.icon, days: R().deadlineDays, desc: q.desc, R: buildRivalDungeon(state).recommendedPower }));
  if (defs.length > 0) emit(state, "social", logText(state, "rivalDefectorsIn", { squad: q.name, n: defs.length, names: defs.map((d) => d.name).join("、") }));
}

/** 挑隊伍：不連續遇到同一隊；其餘均勻隨機 */
function pickSquad(state, rv) {
  const pool = RIVAL_SQUADS.filter((q) => q.id !== rv.lastSquadId);
  const q = pick(rv, pool);
  rv.lastSquadId = q.id;
  return q.id;
}

/** 倒數歸零仍沒派：無視日常鎖，徵召健康優先、戰力最高的精銳；空間沒人可派則寬限，仍不行就取消（不罰） */
function draftAndGo(state) {
  const rv = riv(state);
  const p = rv.pending;
  const pool = state.samsarites.filter((s) => s.location === "space" && !(s.vacationDays > 0) && !(s.podLockDays > 0));
  const party = [...pool].sort((a, b) => (a.injury > 0) - (b.injury > 0) || effectivePower(b) - effectivePower(a)).slice(0, R().draftSize);
  if (party.length > 0) {
    emit(state, "social", logText(state, "rivalDraft", { squad: getRivalSquad(p.squadId).name }));
    return startRivalRun(state, party.map((s) => s.id));
  }
  p.grace += 1;
  if (p.grace > R().maxGraceDays) {
    rv.pending = null;
    emit(state, "social", logText(state, "rivalNobody", { squad: getRivalSquad(p.squadId).name }));
  }
  return { ok: false };
}
function startRivalRun(state, ids) {
  return startRun(state, RIVAL_ID, ids, { ignoreLock: true }); // 循環引用只在執行時呼叫，沒問題（同 core.js 的作法）
}

// ───────── 出發／結算掛鉤（由 dungeon.js 呼叫）─────────

/** 出發時：任務已派出，清掉待派；記下策反成功與叛逃者互嗆（只寫日誌） */
export function rivalOnStart(state, run, dungeon, party) {
  const rv = riv(state);
  const q = getRivalSquad(dungeon.rival.squadId);
  rv.pending = null;
  if (dungeon.rival.revolt) {
    run.rival.revolt = true;
    bumpR(state, "revolts");
    emit(state, "social", logText(state, "rivalRevolt", { squad: q.name, pct: Math.round(R().pigRevolt.rReduce * 100) }));
  }
  const cap = captainOf(state) ?? party[0];
  for (const d of defectorsOf(state, q.id).slice(0, 2)) {
    emit(state, "social", logText(state, RIVAL_TAUNTS, { A: { name: d.name }, B: cap, squad: q.name }));
  }
}

/** 合歡／養老隊低殺意：致死判定通過時，有 |mortalityMod| 的機率「免死」（改落致命傷） */
export function rivalSpare(state, run) {
  const m = run.rival?.mortalityMod ?? 0;
  return m < 0 && rand(riv(state)) < -m;
}

const bestOf = (list) => [...list].sort((a, b) => effectivePower(b) - effectivePower(a))[0];
const giveItem = (s, itemId) => {
  if ((s.consumables?.length ?? 0) >= CONFIG.shop.consumableCap) return false;
  (s.consumables ??= []).push(itemId);
  return true;
};
const radarN = (state, n) => Math.max(1, Math.round(n * (1 + rivalRewardBonus(state))));

/** 洲際碰撞結算（finishRun 在存活者回家之後呼叫）。回傳摘要 { squadId, name, win, notes: [...] } */
export function rivalFinish(state, run, dungeon, survivors, success) {
  const rv = riv(state);
  const q = getRivalSquad(run.rival.squadId);
  const sq = squadState(state, q.id);
  const notes = [];
  const fightGone = { n: 0 }; // #21：本場已私奔人數，落敗檢定與挖角檢定共用，才守得住 maxPerFight
  bumpR(state, "fights");
  if (success) {
    bumpR(state, "wins");
    sq.wins += 1;
    winExtras(state, q, dungeon, survivors, run, notes);
    counterKidnap(state, q, notes);
    if (q.id === "inferno") addChronicle(state, "inferno", logText(state, "chronInferno", { squad: q.name }));
    else addChronicle(state, "rival", logText(state, "chronRivalWin", { squad: q.name }));
  } else {
    bumpR(state, "losses");
    const lost = state.points > 0 ? Math.round(state.points * R().lossPointsPct) : 0; // 戰敗只扣正數公庫的 20%，不扣成惡性負債
    if (lost > 0) { // #36：公庫只剩 1 分時 20% 四捨五入是 0，不寫「公庫 -0」
      state.points -= lost;
      notes.push(`公庫 -${lost}`);
      emit(state, "social", logText(state, "rivalLoss", { squad: q.name, lost }));
    } else emit(state, "social", logText(state, "rivalLossBroke", { squad: q.name }));
    for (const s of survivors) {
      if (s.injury < R().lossInjury) setInjury(s, R().lossInjury);
      s.stats.sanity = Math.max(0, s.stats.sanity - R().lossSanity);
    }
    if (survivors.length > 0) emit(state, "social", logText(state, "rivalShame", { squad: q.name, san: R().lossSanity }));
    elope(state, q, survivors, notes, R().elope.chance, fightGone);
    addChronicle(state, "rival", logText(state, "chronRivalLoss", { squad: q.name }));
  }
  if (q.id === "golden" || q.id === "joyous") elope(state, q, survivors, notes, R().elope.lureChance, fightGone); // 重金挖角／魅惑拐人：不論勝負再檢定一次
  hybridEncounter(state, q, survivors, notes);
  return { squadId: q.id, name: q.name, icon: q.icon, win: success, notes, revolt: !!run.rival.revolt };
}

// ───────── 勝利：各隊特色獎勵 ─────────

function winExtras(state, q, dungeon, survivors, run, notes) {
  const rv = riv(state);
  const cfg = R();
  const base = dungeon.reward;
  switch (q.specialRule) {
    case "relic": {
      const pool = RELICS.filter((r) => !(state.relicCodex ?? []).includes(r.id));
      if (pool.length > 0) {
        const r = pick(rv, pool);
        grantRelic(state, r);
        notes.push(`奇物「${r.name}」`);
      } else {
        const pts = Math.round(base * cfg.relicFullPct);
        state.points += pts;
        notes.push(`奇物已集滿，轉積分 +${pts}`);
      }
      break;
    }
    case "shield": {
      const n = radarN(state, cfg.zhonghuangCrystals);
      state.erosionCrystals = (state.erosionCrystals ?? 0) + n;
      notes.push(`侵蝕結晶 +${n}`);
      break;
    }
    case "pigRevolt": {
      if (run.rival.revolt) recruitRookie(state, q, notes);
      break;
    }
    case "loot": {
      if (rand(rv) < 0.5 && survivors.length > 0 && giveItem(bestOf(survivors), "t5_38")) notes.push("T5 黑貨「抹殺奇點」");
      else {
        const n = radarN(state, cfg.infernoCrystals);
        state.erosionCrystals = (state.erosionCrystals ?? 0) + n;
        notes.push(`侵蝕結晶 +${n}`);
      }
      break;
    }
    case "wallet": {
      const pts = Math.round(base * cfg.goldenWalletPct * (1 + rivalRewardBonus(state)));
      if (survivors.length > 0) {
        const share = Math.floor(pts / survivors.length);
        let got = 0;
        for (const s of survivors) {
          s.wallet = (s.wallet ?? 0) + share;
          if (giveItem(s, "t3_32")) got += 1; // #20：耗材滿格的人拿不到，不能照寫「發了」
        }
        notes.push(`每人私房錢 +${share}、高階耗材 ${got}/${survivors.length} 人（耗材已滿者未發放）`);
      }
      break;
    }
    case "mental": {
      let n = 0;
      for (const s of survivors) {
        if ((s.enhanceCount ?? 0) >= enhanceCapOf(s)) continue;
        for (const [k, v] of Object.entries(enhanceGain(s))) s.stats[k] += v;
        s.enhanceCount = (s.enhanceCount ?? 0) + cfg.mechEnhance;
        n += 1;
      }
      const pts = Math.round(base * 0.5);
      state.points += pts;
      notes.push(`${n} 人免費強化、公庫 +${pts}`);
      break;
    }
    case "welfare": {
      for (const s of survivors) if (s.injury > 0) setInjury(s, Math.max(0, s.injury - cfg.retireHeal));
      const pts = Math.round(base * 0.3);
      state.points += pts;
      notes.push(`買路財公庫 +${pts}、全體療傷`);
      break;
    }
    default:
      break;
  }
  if (notes.length > 0) emit(state, "social", logText(state, "rivalWinLoot", { squad: q.name, loot: notes.join("、") }));
}

// ───────── 東櫻肉豬策反：收編 1 名高潛力新人 ─────────

function recruitRookie(state, q, notes) {
  const rv = riv(state);
  const rank = rand(rv) < 0.3 ? "A" : "B";
  const nb = createSamsarite(state, rank, rv);
  nb.location = "space";
  state.samsarites.push(nb);
  const cap = captainOf(state);
  if (cap) addLove(state, nb, cap, R().pigRevolt.recruitLove); // 初始對我方隊長好感 +50
  notes.push(`收編東櫻新人 ${nb.name}（${rank} 級）`);
  emit(state, "social", logText(state, "rivalRecruit", { A: nb, squad: q.name, rank }));
  addChronicle(state, "counter", logText(state, "rivalRecruit", { A: nb, squad: q.name, rank }));
}

// ───────── 跨隊私奔（落敗）與反拐（勝利）─────────

/** 100% 免疫被拐：當前隊長、神眷綁定（身上有綁定裝備）、玩家自捏角色（customProfile） */
export function isElopeImmune(state, s) {
  const cap = captainOf(state);
  if (cap && cap.id === s.id) return true;
  if (s.soulbound === true || Object.values(s.soulbound ?? {}).some(Boolean)) return true;
  return !!s.customProfile;
}

/** 私奔候選：對隊長淨好感 <= -5，或（理智 < 45 且淨好感 < 15） */
export function elopeCandidate(state, s, cap) {
  const a = affinity(state, s, cap);
  const c = R().elope;
  return a <= c.affinity || ((s.stats?.sanity ?? 100) < c.lowSanity && a < c.lowSanityAffinity);
}

function elope(state, q, survivors, notes, chance, fightGone = { n: 0 }) {
  const rv = riv(state);
  const cap = captainOf(state);
  if (!cap) return;
  const pool = new Map();
  for (const s of [...survivors, ...state.samsarites.filter((x) => x.location === "space")]) pool.set(s.id, s); // 參戰者與隊內留守者
  const cands = [...pool.values()].filter((s) => state.samsarites.includes(s) && s.location !== "pod" && !isElopeImmune(state, s) && elopeCandidate(state, s, cap)).sort((a, b) => a.id - b.id);
  for (const s of cands) {
    if (fightGone.n >= R().elope.maxPerFight) break;
    if (rand(rv) < chance) {
      defectTo(state, q, s);
      fightGone.n += 1;
      notes.push(`${s.name} 私奔投靠`);
    }
  }
}

/** 把我方成員送進宿敵隊名冊（整份快照，之後有機會被拐回來） */
export function defectTo(state, q, s) {
  state.samsarites = state.samsarites.filter((x) => x.id !== s.id);
  cancelWishesOf(state, s.id);
  cancelGodOf(state, s.id);
  forgetRelations(state, s.id);
  squadState(state, q.id).roster.push({ name: s.name, role: "defector", day: currentDay(state), snapshot: JSON.parse(JSON.stringify({ ...s, location: "space" })) });
  bumpR(state, "elopes");
  bump(state, "defect");
  const text = logText(state, "rivalElope", { A: s, squad: q.name });
  emit(state, "relation", text, { samsariteId: s.id });
  addChronicle(state, "elope", text);
}

function counterKidnap(state, q, notes) {
  const rv = riv(state);
  const cfg = R().counter;
  if (!["communal", "bond"].includes(styleOf(state))) return; // 高魅力／bond 或 communal 流派隊長才拐得動人
  if (activeRoster(state).length >= Math.min(cfg.rosterCap, popLimit(state))) return;
  if (rand(rv) >= cfg.chance) return;
  const sq = squadState(state, q.id);
  const at = sq.roster.findIndex((m) => m.role === "defector");
  let who;
  if (at >= 0) {
    // 拐回自己人：整份快照還原（私房錢帶回來，關係矩陣已清空，從對隊長 +30 重新開始）
    who = sq.roster.splice(at, 1)[0].snapshot;
    who.location = "space";
    who.injury = 0;
    who.restDaysLeft = 0;
    state.samsarites.push(who);
  } else {
    const rank = rand(rv) < 0.3 ? "A" : "B";
    who = createSamsarite(state, rank, rv);
    who.location = "space";
    state.samsarites.push(who);
  }
  const cap = captainOf(state);
  if (cap) addLove(state, who, cap, 30);
  bumpR(state, "counters");
  notes.push(`拐走對面副手 ${who.name}`);
  const text = logText(state, "rivalCounter", { A: who, squad: q.name });
  emit(state, "relation", text, { samsariteId: who.id });
  addChronicle(state, "counter", text);
}

// ───────── 戰場停火・春風一度（跨洲混血子嗣）─────────

function hybridEligible(state, s) {
  const day = currentDay(state);
  if (s.location === "pod" || s.injury >= 2) return false;
  if ((state.cooldowns?.[`hybrid:${s.id}`] ?? 0) > day) return false;
  return !state.samsarites.some((b) => b.location === "pod" && (b.parents ?? []).includes(s.id)); // 非孕期（沒有嬰兒還在催熟艙）
}

function hybridEncounter(state, q, survivors, notes) {
  const rv = riv(state);
  const cfg = R().hybrid;
  const chance = q.specialRule === "romance" ? cfg.joyousChance : cfg.otherChance;
  const pool = new Map();
  for (const s of [...survivors, ...state.samsarites.filter((x) => x.location === "space")]) pool.set(s.id, s);
  const eligible = [...pool.values()].filter((s) => state.samsarites.includes(s) && hybridEligible(state, s)).sort((a, b) => a.id - b.id);
  if (eligible.length === 0) return;
  if (state.samsarites.filter((s) => s.location === "pod").length >= CONFIG.child.maxInPod) return;
  if (activeRoster(state).length >= popLimit(state)) return;
  if (rand(rv) >= chance) return;
  const parent = pick(rv, eligible);
  const child = hybridBirth(state, q, parent);
  notes.push(`${parent.name} 與${q.name}春風一度，誕下混血子嗣 ${child.name}`);
}

/** 單親＋宿敵血脈的混血子嗣：直接進催熟艙，天生資質 +15%（仍受 +25% 硬封頂），標記 hybridOrigin */
export function hybridBirth(state, q, parent) {
  const rv = riv(state);
  state.cooldowns ??= {};
  state.cooldowns[`hybrid:${parent.id}`] = currentDay(state) + R().hybrid.cooldownDays;
  const ranks = Object.keys(RANKS);
  let at = ranks.indexOf(parent.rank);
  if (rand(rv) < CONFIG.child.rankUpChance) at = Math.min(ranks.length - 1, at + 1);
  const child = createSamsarite(state, ranks[at], rv);
  child.location = "pod";
  child.podDaysLeft = Math.max(1, Math.round(CONFIG.lineage.podDays * (1 - podDaysCut(state))));
  child.parents = [parent.id];
  child.joinedDay = currentDay(state);
  child.generation = (parent.generation ?? 1) + 1;
  child.hybridOrigin = q.id;
  const L = CONFIG.lineage;
  const baseTalent = Math.max(talentFloor(state), (parent.geneLock ?? 0) * L.talentPerGene + (parent.talentPct ?? 0) * L.talentFromParent);
  child.talentPct = Math.round(Math.min(L.talentCap, baseTalent + R().hybrid.talentBonus) * 10000) / 10000;
  child.inheritPower = Math.round(child.stats.power * child.talentPct);
  state.samsarites.push(child);
  addLove(state, parent, child, CONFIG.child.familyLove);
  addLove(state, child, parent, CONFIG.child.familyLove);
  bumpR(state, "hybrids");
  bump(state, "birth");
  const text = logText(state, "rivalHybrid", { A: parent, C: child, squad: q.name, rank: child.rank });
  emit(state, "birth", text, { samsariteId: child.id });
  addChronicle(state, "hybrid", text);
  return child;
}

/** 畫面用：目前碰撞任務的資訊 */
export function rivalInfo(state) {
  const p = pendingRival(state);
  if (!p) return null;
  const q = getRivalSquad(p.squadId);
  const d = buildRivalDungeon(state);
  return { pending: p, squad: q, dungeon: d, defectors: defectorsOf(state, q.id) };
}
