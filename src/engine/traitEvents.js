// 個性事件引擎 v1a：每日對留守者各擲一次，依隱藏維度挑單人個性事件，並揭露一條「性格側寫」。
// 用 state.trait.rngState 獨立亂數流，不動主亂數。效果刻意很小，且不動戰力、不動對隊長的好感（見 data/traitEvents.js 檔頭）。
// 數字：CONFIG.personality；事件：data/traitEvents.js；日誌句：data/logs.js（trait_*）。

import { CONFIG } from "../data/config.js";
import { rand, pick, weighted } from "./rng.js";
import { emit, currentDay } from "./core.js"; // 循環引用：只在執行時呼叫，載入時不碰
import { logText } from "./templates.js";
import { addLove, addHate, shiftAffinity } from "./relations.js";
import { captainOf } from "./squad.js";
import { addLife } from "./life.js";
import { TRAIT_EVENTS, TRAIT_DUETS } from "../data/traitEvents.js";
import { newTraitState, profileLine } from "./personality.js";

const stream = (state) => (state.trait ??= newTraitState(state.rngState));
const P = () => CONFIG.personality;

function shiftSanity(s, delta) {
  const cur = s.stats.sanity;
  let next = cur + delta;
  if (delta < 0) next = Math.max(next, Math.min(cur, P().sanityFloor)); // 不扣到暴走線
  s.stats.sanity = Math.max(0, Math.min(100, Math.round(next)));
}

/** 找事件對象；找不到回傳 null（事件就不發生）。對象一律排除本人與隊長 */
function findTarget(state, s, kind, rng) {
  if (!kind) return undefined; // 不需要對象
  const cap = captainOf(state);
  const others = state.samsarites.filter((o) => o.id !== s.id && o.location === "space" && o.id !== cap?.id);
  if (others.length === 0) return null;
  if (kind === "random") return pick(rng, others);
  if (kind === "needy") {
    const needy = others.filter((o) => o.injury > 0 || o.stats.sanity < 80);
    if (needy.length === 0) return null;
    return needy.reduce((a, b) => (b.injury - a.injury || a.stats.sanity - b.stats.sanity || a.id - b.id) > 0 ? b : a);
  }
  if (kind === "rich") {
    const rich = others.filter((o) => (o.wallet ?? 0) >= P().minWallet);
    if (rich.length === 0) return null;
    return rich.reduce((a, b) => ((b.wallet ?? 0) > (a.wallet ?? 0) ? b : a));
  }
  return null;
}

/** 事件能不能在目前狀態下發生（要擲對象時順便回傳對象） */
function canPlay(state, s, ev, rng) {
  const fx = ev.fx;
  const cap = captainOf(state);
  if (fx.targetHate && cap?.id === s.id) return { ok: false }; // 隊長當主角時不發生會結仇的事件
  if (fx.give && (s.wallet ?? 0) < P().minWallet + fx.give) return { ok: false };
  const target = findTarget(state, s, ev.target, rng);
  if (target === null) return { ok: false };
  return { ok: true, target };
}

/** 揭露一條側寫：存進 s.traitSeen、寫進一生大事記 */
function reveal(state, s, ev) {
  const n = s.traitSeen.filter((e) => e.axis === ev.axis && e.sign === ev.sign).length;
  const text = profileLine(ev.axis, ev.sign, n);
  s.traitSeen.push({ day: currentDay(state), axis: ev.axis, sign: ev.sign, text });
  if (s.traitSeen.length > P().seenCap) s.traitSeen.splice(0, s.traitSeen.length - P().seenCap);
  addLife(state, s, "trait", `性格側寫：${text}`);
}

/** 套用一個個性事件（也給測試直接呼叫）。回傳 { ok, target } */
export function playTraitEvent(state, s, ev, rng = stream(state)) {
  const can = canPlay(state, s, ev, rng);
  if (!can.ok) return { ok: false };
  const target = can.target ?? null;
  const fx = ev.fx;
  if (fx.sanity) shiftSanity(s, fx.sanity);
  if (target) {
    if (fx.targetSanity) shiftSanity(target, fx.targetSanity);
    if (fx.give) {
      s.wallet -= fx.give;
      target.wallet = (target.wallet ?? 0) + fx.give;
    }
    if (fx.take) {
      const amt = Math.min(fx.take, target.wallet ?? 0);
      target.wallet -= amt;
      s.wallet = (s.wallet ?? 0) + amt;
    }
    if (fx.targetLove) addLove(state, target, s, fx.targetLove);
    if (fx.targetHate) addHate(state, target, s, fx.targetHate);
  }
  emit(state, "trait", logText(state, `trait_${ev.id}`, { A: s, B: target ?? s }), { samsariteId: s.id });
  reveal(state, s, ev);
  s.traitEventLast._any = currentDay(state);
  s.traitEventLast[ev.id] = currentDay(state);
  return { ok: true, target };
}

/**
 * 每日結算：每個留守者擲一次（每人每天固定消耗 1 次亂數，亂數順序不受事件內容影響），
 * 擲中且不在冷卻就依隱藏維度挑一個事件。
 */
export function dailyTraits(state) {
  if (!P().enabled) return;
  const rng = stream(state);
  const day = currentDay(state);
  for (const s of state.samsarites) {
    if (s.location !== "space" || !s.traits) continue;
    if (rand(rng) >= P().eventChance) continue;
    const last = s.traitEventLast ?? {};
    if (day - (last._any ?? -999) < P().personCooldown) continue;
    const cands = TRAIT_EVENTS.filter((ev) => {
      const v = s.traits[ev.axis];
      return Math.sign(v) === ev.sign && Math.abs(v) >= P().eventMin && day - (last[ev.id] ?? -999) >= P().eventCooldown;
    }).map((ev) => ({ ev, weight: ev.weight * Math.abs(s.traits[ev.axis]) }));
    if (cands.length === 0) continue;
    playTraitEvent(state, s, weighted(rng, cands).ev, rng);
  }
  dailyTraitDuets(state); // 雙人事件放在最後：單人事件當天的抽樣完全不受影響
}

// ───────── 雙人碰撞事件（v1b ③）─────────

/** 雙人事件專用亂數流（state.trait.duetRngState；舊存檔缺欄位就用本局種子補）。只動這條流，不動主亂數與單人事件的流 */
function duetRng(state) {
  const t = stream(state);
  t.duetRngState ??= ((state.seed ?? 0) ^ 0xd0e7) | 0;
  return {
    get rngState() {
      return t.duetRngState;
    },
    set rngState(v) {
      t.duetRngState = v;
    },
  };
}

const sideOk = (s, side) => {
  const v = s.traits?.[side.axis] ?? 0;
  return Math.sign(v) === side.sign && Math.abs(v) >= P().eventMin;
};

/** 這個人現在能不能參與這個雙人事件（個人冷卻與同事件冷卻，沿用單人事件的機制） */
function duetCooling(state, s, id) {
  const last = s.traitEventLast ?? {};
  const day = currentDay(state);
  return day - (last._any ?? -999) < P().personCooldown || day - (last[id] ?? -999) < P().eventCooldown;
}

/** 套用一個雙人事件（也給測試直接呼叫）。條件不符回傳 { ok: false } */
export function playTraitDuet(state, a, b, ev) {
  const cap = captainOf(state);
  if (a.id === b.id || a.id === cap?.id || b.id === cap?.id) return { ok: false }; // 隊長不當事件的任何一方
  if (a.location !== "space" || b.location !== "space") return { ok: false };
  if (!sideOk(a, ev.a) || !sideOk(b, ev.b)) return { ok: false };
  const fx = ev.fx;
  if (fx.take && (b.wallet ?? 0) < P().minWallet) return { ok: false };
  if (fx.sanityA) shiftSanity(a, fx.sanityA);
  if (fx.sanityB) shiftSanity(b, fx.sanityB);
  if (fx.take) {
    const amt = Math.min(fx.take, b.wallet ?? 0);
    b.wallet -= amt;
    a.wallet = (a.wallet ?? 0) + amt;
  }
  if (fx.hateBA) addHate(state, b, a, fx.hateBA);
  if (fx.loveAB) addLove(state, a, b, fx.loveAB);
  if (fx.loveBA) addLove(state, b, a, fx.loveBA);
  if (fx.dropAB) shiftAffinity(state, a, b, -fx.dropAB);
  if (fx.dropBA) shiftAffinity(state, b, a, -fx.dropBA);
  emit(state, "trait", logText(state, `trait_duet_${ev.id}`, { A: a, B: b }), { samsariteId: a.id });
  reveal(state, a, ev.a);
  reveal(state, b, ev.b);
  const day = currentDay(state);
  for (const s of [a, b]) {
    s.traitEventLast._any = day;
    s.traitEventLast[ev.id] = day;
  }
  return { ok: true };
}

/** 每日結算：每個留守者（非隊長）固定擲 1 次，擲中就依雙方分數權重挑一個「事件 × 對象」 */
export function dailyTraitDuets(state) {
  const D = P().duet;
  if (!P().enabled || !D?.enabled) return;
  const rng = duetRng(state);
  const cap = captainOf(state);
  const pool = state.samsarites.filter((s) => s.location === "space" && s.traits && s.id !== cap?.id);
  for (const a of pool) {
    if (rand(rng) >= D.chance) continue;
    const cands = [];
    for (const ev of TRAIT_DUETS) {
      if (!sideOk(a, ev.a) || duetCooling(state, a, ev.id)) continue;
      for (const b of pool) {
        if (b.id === a.id || !sideOk(b, ev.b) || duetCooling(state, b, ev.id)) continue;
        if (ev.fx.take && (b.wallet ?? 0) < P().minWallet) continue;
        cands.push({ ev, b, weight: ev.weight * (Math.abs(a.traits[ev.a.axis]) + Math.abs(b.traits[ev.b.axis])) });
      }
    }
    if (cands.length === 0) continue;
    const hit = weighted(rng, cands);
    playTraitDuet(state, a, hit.b, hit.ev);
  }
}
