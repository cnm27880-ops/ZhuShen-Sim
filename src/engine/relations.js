// 關係系統（Phase 2-B）：關係矩陣、每日互動、借刀殺人、死亡連鎖、副本內互相傷害。
// 純規則，不碰畫面。資料表在 src/data/relations.js，數字在 CONFIG.relations。
//
// 關係矩陣存在 state.relations：{ "A的id>B的id": { love, hate, status?, revenge? } }
//   love / hate：A 對 B 的好感／仇恨（0~100，有方向：A 愛 B 不代表 B 愛 A）
//   status：戀人 lover／靈魂伴侶 soulmate／死敵 nemesis（兩個方向會一起設定）
//   revenge：死者的戀人／死黨鎖定兇手；下次同隊進副本，第一個房間一定自相殘殺

import { CONFIG, INJURIES } from "../data/config.js";
import { SOCIAL_EVENTS, SCHEMES, DISCOVER_TEXTS, TAG_SPECIALS } from "../data/relations.js";
import { getTag } from "../data/tags.js";
import { rand, pick, weighted } from "./rng.js";
import { effectivePower } from "./tags.js";
import { logText } from "./templates.js";
import { maybeWish } from "./wishes.js";
import {
  emit,
  currentDay,
  setInjury,
  killSamsarite,
  checkGameOver,
  forgetRelations,
  announceDebtIfNew,
  debtLimitOf,
} from "./core.js";

const R = () => CONFIG.relations;
const clamp = (v) => Math.max(0, Math.min(100, v));
const ZERO = Object.freeze({ love: 0, hate: 0 });
const hasTag = (s, id) => (s.tags ?? []).includes(id);

// ───────── 關係矩陣：讀寫 ─────────

/** A 對 B 的關係（唯讀；沒有紀錄就是 0/0） */
export function getRel(state, a, b) {
  return state.relations?.[`${a.id}>${b.id}`] ?? ZERO;
}

function ensureRel(state, a, b) {
  state.relations ??= {};
  return (state.relations[`${a.id}>${b.id}`] ??= { love: 0, hate: 0 });
}

export function addLove(state, a, b, delta) {
  const r = ensureRel(state, a, b);
  r.love = clamp(r.love + delta);
}

/** 仇恨增加；滿了就結成死敵（兩個方向都是死敵） */
export function addHate(state, a, b, delta) {
  const r = ensureRel(state, a, b);
  r.hate = clamp(r.hate + delta);
  if (r.hate >= R().nemesisAt && pairStatus(state, a, b) !== "nemesis") {
    setPairStatus(state, a, b, "nemesis");
    emit(state, "relation", logText(state, "nemesis", { A: a, B: b }));
  }
}

/** 兩人的關係狀態（任一方向有就算） */
export function pairStatus(state, a, b) {
  return getRel(state, a, b).status ?? getRel(state, b, a).status;
}

function setPairStatus(state, a, b, status) {
  ensureRel(state, a, b).status = status;
  ensureRel(state, b, a).status = status;
}

/** 兩人的關係等級：soulmate / adore / like / neutral / dislike / hate / nemesis */
export function pairLevel(state, a, b) {
  const status = pairStatus(state, a, b);
  if (status === "soulmate" || status === "nemesis") return status;
  const love = (getRel(state, a, b).love + getRel(state, b, a).love) / 2;
  const hate = Math.max(getRel(state, a, b).hate, getRel(state, b, a).hate);
  const c = R();
  if (hate >= c.hateAt) return "hate";
  if (love >= c.adoreAt) return "adore";
  if (hate >= c.dislikeAt && hate > love) return "dislike";
  if (love >= c.likeAt) return "like";
  if (hate >= c.dislikeAt) return "dislike";
  return "neutral";
}

/** 兩人是不是仇人（仇恨 80+ 或死敵）。自動派遣的保護開關用 */
export function areEnemies(state, a, b) {
  const level = pairLevel(state, a, b);
  return level === "hate" || level === "nemesis";
}

/** 戀人／靈魂伴侶（活著的那位）。沒有就回傳 undefined */
export function partnerOf(state, s) {
  return state.samsarites.find((o) => o.id !== s.id && ["lover", "soulmate"].includes(pairStatus(state, s, o)));
}

/** 全隊關係對「單房通過率」的加成（每一對人算一次，套用上限） */
export function partyRelationBonus(state, party) {
  let sum = 0;
  for (let i = 0; i < party.length; i++) {
    for (let j = i + 1; j < party.length; j++) {
      sum += R().passBonus[pairLevel(state, party[i], party[j])] ?? 0;
    }
  }
  return Math.max(-R().bonusCap, Math.min(R().bonusCap, sum));
}

/** 給畫面用：兩人關係的整理 */
export function pairSummary(state, a, b) {
  const ab = getRel(state, a, b);
  const ba = getRel(state, b, a);
  return {
    level: pairLevel(state, a, b),
    status: pairStatus(state, a, b),
    loveAB: Math.round(ab.love),
    loveBA: Math.round(ba.love),
    hateAB: Math.round(ab.hate),
    hateBA: Math.round(ba.hate),
    revenge: Boolean(ab.revenge || ba.revenge),
  };
}

/** 小人頭上的心情：有戀人 love、在家有仇人 anger、其他 null */
export function moodOf(state, s) {
  if (partnerOf(state, s)) return "love";
  const angry = state.samsarites.some((o) => o.id !== s.id && o.location === "space" && getRel(state, s, o).hate >= R().dislikeAt);
  return angry ? "anger" : null;
}

// ───────── 每日事件（在 advanceTick 跨日時呼叫）─────────

export function dailyRelations(state) {
  if (state.gameOver) return;
  decayHate(state);
  const day = currentDay(state);
  for (const [k, until] of Object.entries(state.cooldowns ?? {})) if (until <= day) delete state.cooldowns[k];

  const roll = R().dailyRoll;
  for (const a of [...state.samsarites]) {
    if (!state.samsarites.includes(a) || a.location !== "space") continue; // 中途死了／不在家
    const r = rand(state);
    if (r < roll.work) a.stats.sanity = Math.min(100, a.stats.sanity + R().workSanity); // 日常：健身、包紮、喝咖啡
    else if (r < roll.work + roll.social) socialEvent(state, a);
    else if (!maybeWish(state, a)) specialEvent(state, a); // 特殊事件骰：先看他要不要許願（Phase 3-B）
  }
  promoteSoulmates(state);
  checkGameOver(state);
}

function decayHate(state) {
  for (const r of Object.values(state.relations ?? {})) {
    if (r.status !== "nemesis" && r.hate > 0) r.hate = Math.max(0, r.hate - R().hateDecayPerDay);
  }
}

function homeOthers(state, a) {
  return state.samsarites.filter((o) => o.id !== a.id && o.location === "space");
}

function pairKey(a, b) {
  return a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
}

/** 這個互動事件現在抽不抽得到（回傳權重，0 = 不行） */
export function socialWeight(state, ev, a, b) {
  const rel = getRel(state, a, b);
  const status = pairStatus(state, a, b);
  if ((state.cooldowns?.[`${ev.id}:${pairKey(a, b)}`] ?? 0) > currentDay(state)) return 0;
  if (ev.needStatus === "lover" && status !== "lover" && status !== "soulmate") return 0;
  if (ev.noStatus && (status || partnerOf(state, a))) return 0;
  if (ev.minLove !== undefined && rel.love < ev.minLove) return 0;
  if (ev.minHate !== undefined && rel.hate < ev.minHate) return 0;
  if (ev.maxHate !== undefined && rel.hate > ev.maxHate) return 0;
  let w = ev.weight;
  for (const [tag, mult] of Object.entries(ev.tagWeight ?? {})) if (hasTag(a, tag)) w *= mult;
  if (ev.hateWeight) w *= 1 + ev.hateWeight * Math.floor(rel.hate / 10);
  return w;
}

function socialEvent(state, a) {
  const others = homeOthers(state, a);
  if (others.length === 0) return;
  // 找人互動：已經有交情（或恩怨）的人比較容易被抓到，所以愛恨情仇會越滾越大
  const b = weighted(
    state,
    others.map((o) => ({ o, weight: 1 + (getRel(state, a, o).love + getRel(state, a, o).hate) / 20 }))
  ).o;
  const options = SOCIAL_EVENTS.map((ev) => ({ ev, weight: socialWeight(state, ev, a, b) })).filter((o) => o.weight > 0);
  if (options.length === 0) return;
  runSocial(state, weighted(state, options).ev, a, b);
}

/** 執行一個互動事件（測試可以直接指定事件） */
export function runSocial(state, ev, a, b) {
  state.cooldowns ??= {};
  state.cooldowns[`${ev.id}:${pairKey(a, b)}`] = currentDay(state) + R().eventCooldownDays;
  if (ev.special === "confess") return resolveConfession(state, a, b);
  addLove(state, a, b, ev.dLove[0]);
  addLove(state, b, a, ev.dLove[1]);
  if (ev.dHate[0]) addHate(state, a, b, ev.dHate[0]);
  if (ev.dHate[1]) addHate(state, b, a, ev.dHate[1]);
  emit(state, "social", logText(state, ev.texts, { A: a, B: b }));
}

/** 告白：對方也喜歡你（好感夠、沒仇、沒有別的戀人）就成為戀人，否則被拒絕 */
export function resolveConfession(state, a, b) {
  const back = getRel(state, b, a);
  const ok = back.love >= R().confessLove && back.hate < R().dislikeAt && !partnerOf(state, b);
  if (ok) {
    setPairStatus(state, a, b, "lover");
    addLove(state, a, b, 15);
    addLove(state, b, a, 15);
    emit(state, "relation", logText(state, "confessOk", { A: a, B: b }));
  } else {
    addLove(state, a, b, -15);
    a.stats.sanity = Math.max(0, a.stats.sanity - R().confessSanityLoss);
    emit(state, "relation", logText(state, "confessFail", { A: a, B: b, san: R().confessSanityLoss }));
  }
  return ok;
}

/** 戀人雙方好感都達標 = 靈魂伴侶 */
function promoteSoulmates(state) {
  const list = state.samsarites;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const [a, b] = [list[i], list[j]];
      if (pairStatus(state, a, b) !== "lover") continue;
      if (getRel(state, a, b).love >= R().soulmateAt && getRel(state, b, a).love >= R().soulmateAt) {
        setPairStatus(state, a, b, "soulmate");
        emit(state, "relation", logText(state, "soulmate", { A: a, B: b }));
      }
    }
  }
}

// ───────── 特殊事件：借刀殺人、直接動手、標籤事件 ─────────

function specialEvent(state, a) {
  const others = homeOthers(state, a);
  if (others.length === 0) return;
  const targets = others.filter((b) => getRel(state, a, b).hate >= R().schemeHate);
  if (targets.length > 0) {
    const b = targets.reduce((best, o) => (getRel(state, a, o).hate > getRel(state, a, best).hate ? o : best));
    if (getRel(state, a, b).hate >= R().directKillHate && rand(state) < R().directKillChance) return directAttack(state, a, b);
    const options = SCHEMES.map((s) => ({ s, weight: s.weight * Object.entries(s.tagWeight ?? {}).reduce((m, [t, x]) => (hasTag(a, t) ? m * x : m), 1) }));
    return runScheme(state, weighted(state, options).s, a, b);
  }
  const specials = TAG_SPECIALS.filter((t) => hasTag(a, t.tag));
  if (specials.length > 0 && others.length >= 2) {
    const sp = pick(state, specials);
    const b = pick(state, others);
    const c = pick(state, others.filter((o) => o.id !== b.id));
    addLove(state, b, c, sp.dLove);
    addLove(state, c, b, sp.dLove);
    if (sp.dHate) {
      addHate(state, b, c, sp.dHate);
      addHate(state, c, b, sp.dHate);
    }
    emit(state, "social", logText(state, sp.texts, { A: a, B: b, C: c }));
  }
}

/** 執行一個陰謀（借刀殺人）。主神空間裡只能耍陰招，不能直接動手 */
export function runScheme(state, scheme, a, b) {
  if (scheme.id === "frame") b.stats.sanity = Math.max(0, b.stats.sanity - R().frameSanityLoss);
  else if (scheme.id === "sabotage") b.sabotaged = true;
  else if (scheme.id === "poison") {
    if (b.injury < INJURIES.length - 1) setInjury(b, b.injury + 1);
  } else if (scheme.id === "rumor") {
    for (const c of state.samsarites) {
      if (c.id === a.id || c.id === b.id || c.location !== "space") continue;
      addLove(state, c, b, R().rumorLove);
      addHate(state, c, b, R().rumorHate);
    }
  }
  emit(state, "scheme", logText(state, scheme.texts, { A: a, B: b }));
  if (rand(state) < R().discoverChance) {
    addHate(state, b, a, R().discoverHate);
    addLove(state, b, a, -10);
    emit(state, "scheme", logText(state, DISCOVER_TEXTS, { A: a, B: b }));
  }
}

/** 直接動手殺人：不管有沒有殺成，主神都會懲罰動手的人 */
export function directAttack(state, a, b) {
  emit(state, "relation", logText(state, "attack", { A: a, B: b }));
  const pa = effectivePower(a);
  const pb = effectivePower(b);
  if (rand(state) < pa / (pa + pb)) {
    killSamsarite(state, b, `在主神空間被 ${a.name} 當場殺害`, a);
    afterDeath(state, b, a);
  } else {
    setInjury(b, Math.min(INJURIES.length - 1, b.injury + R().directInjury));
    addHate(state, b, a, R().attackHate);
    emit(state, "relation", logText(state, "attackSurvive", { A: a, B: b }));
  }
  punish(state, a);
}

/** 主神的懲罰：扣積分／洗掉一個標籤／直接抹殺 */
export function punish(state, a, type = weighted(state, R().punish.weights).type) {
  if (type === "tag" && (a.tags ?? []).length === 0) type = "points";
  if (type === "points") {
    const wasInDebt = state.points < 0;
    state.points = Math.max(debtLimitOf(state), state.points - R().punish.points);
    emit(state, "relation", logText(state, "punishPoints", { A: a, points: R().punish.points }));
    announceDebtIfNew(state, wasInDebt);
  } else if (type === "tag") {
    const id = pick(state, a.tags);
    a.tags = a.tags.filter((t) => t !== id);
    emit(state, "relation", logText(state, "punishTag", { A: a, tag: getTag(id)?.name ?? id }));
  } else {
    emit(state, "relation", logText(state, "punishErase", { A: a }));
    killSamsarite(state, a, "因為在主神空間動手殺人，被主神抹殺");
    afterDeath(state, a, null);
  }
  return type;
}

// ───────── 死亡連鎖（計畫 6.4）─────────

const MOURN_KEYS = { breakthrough: "mournBreakthrough", broken: "mournBroken", demon: "mournDemon" };

function scaleStats(s, mult) {
  for (const k of ["hp", "power", "defense", "speed", "luck"]) s.stats[k] = Math.max(1, Math.round(s.stats[k] * mult));
}

function gainTag(s, id) {
  s.tags ??= [];
  if (!s.tags.includes(id)) s.tags.push(id);
}

/**
 * 有人死了之後的連鎖反應。dead 已經從名單移除；killer 是被隊友／同伴害死時的兇手（怪物殺的就是 null）。
 *  - 死者的戀人／死黨：頓悟突破／道心破碎／走火入魔（靈魂伴侶只會崩潰或黑化）
 *  - 兇手是同伴：死者的戀人／死黨鎖定兇手（變死敵，下次同隊第一個房間自相殘殺）
 *  - 功德無量笑面虎：偷遺產，全屬性永久 +10%，沒人喜歡他
 *  - 其他人：害怕下一個死的是自己
 */
export function afterDeath(state, dead, killer = null) {
  const living = state.samsarites;
  for (const m of living) {
    if (killer && m.id === killer.id) continue;
    const status = pairStatus(state, m, dead);
    const isLover = status === "lover" || status === "soulmate";
    if (!isLover && getRel(state, m, dead).love < R().mournLove) continue;

    const type = weighted(state, status === "soulmate" ? R().soulmateRoll : R().mournerRoll).type;
    if (type === "breakthrough") scaleStats(m, R().breakthroughMult);
    else if (type === "broken") {
      scaleStats(m, R().brokenMult);
      gainTag(m, "broken_heart");
      m.stats.sanity = Math.max(0, m.stats.sanity - R().brokenSanityLoss);
    } else {
      gainTag(m, "demon_path");
      m.stats.sanity = Math.max(0, m.stats.sanity - R().demonSanityLoss);
    }
    emit(state, "relation", logText(state, MOURN_KEYS[type], { D: dead, B: m }));

    if (killer) {
      const r = ensureRel(state, m, killer);
      r.hate = 100;
      r.revenge = true;
      setPairStatus(state, m, killer, "nemesis");
      emit(state, "relation", logText(state, "revengeLock", { A: killer, B: m }));
    }
  }

  for (const t of living) {
    if (!hasTag(t, "smiling_tiger")) continue;
    scaleStats(t, R().inheritMult);
    for (const o of living) if (o.id !== t.id) addLove(state, o, t, R().inheritLove);
    emit(state, "relation", logText(state, "inherit", { A: t, D: dead }));
  }

  for (const o of living) o.stats.sanity = Math.max(0, o.stats.sanity - R().deathFearSanity);
  forgetRelations(state, dead.id);
}

// ───────── 副本內：互相傷害、擋刀 ─────────

/**
 * 這個房間有沒有人內鬥？回傳 { attacker, victim, kind } 或 null。
 *  revenge：死者的戀人鎖定兇手，第一個房間一定動手
 *  enemy：隊裡有仇人／死敵，每個房間有機率互相攻擊
 *  backstab：背刺成癮者
 * 沒有仇人、沒有背刺標籤時完全不消耗亂數。
 */
export function pickClash(state, party, roomIndex) {
  for (let i = 0; i < party.length; i++) {
    for (let j = 0; j < party.length; j++) {
      if (i !== j && roomIndex === 0 && getRel(state, party[i], party[j]).revenge) {
        return { attacker: party[i], victim: party[j], kind: "revenge" };
      }
    }
  }
  for (let i = 0; i < party.length; i++) {
    for (let j = i + 1; j < party.length; j++) {
      const level = pairLevel(state, party[i], party[j]);
      const chance = R().infightChance[level];
      if (chance && rand(state) < chance) {
        const iHates = getRel(state, party[i], party[j]).hate >= getRel(state, party[j], party[i]).hate;
        return { attacker: iHates ? party[i] : party[j], victim: iHates ? party[j] : party[i], kind: "enemy" };
      }
    }
  }
  if (party.length > 1) {
    for (const s of party) {
      if (hasTag(s, "backstabber") && rand(state) < R().backstabChance) {
        return { attacker: s, victim: pick(state, party.filter((o) => o.id !== s.id)), kind: "backstab" };
      }
    }
  }
  return null;
}

export function clashText(state, clash) {
  const { attacker: a, victim: v, kind } = clash;
  const key = kind === "revenge" ? "clashRevenge" : kind === "backstab" ? "clashBackstab" : "clashEnemy";
  return logText(state, key, { A: a, B: v });
}

/** 內鬥發生後的關係變化：被打的人對兇手仇恨上升，復仇完成 */
export function afterClash(state, clash) {
  const { attacker: a, victim: v } = clash;
  const r = state.relations?.[`${a.id}>${v.id}`];
  if (r) r.revenge = false;
  addHate(state, v, a, R().attackHate);
}

/** 愛慕／靈魂伴侶的隊友有機會替被點名的人擋下一擊。沒有這種隊友時不消耗亂數 */
export function findProtector(state, party, victim) {
  const guards = party.filter((o) => o.id !== victim.id && ["adore", "soulmate"].includes(pairLevel(state, o, victim)));
  if (guards.length === 0) return null;
  const guard = guards[0];
  return rand(state) < R().protectChance ? guard : null;
}
