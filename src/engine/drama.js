// 5:2:1 純血無限流人際與狗血修羅場引擎（Phase 4-E-3）。純規則，不碰畫面。
// 事件資料與文案在 src/data/dramaEvents.js；數字在 CONFIG.drama；亂數用獨立流 state.squadRngState（engine/squad.js 的 squadRng）。
//
// 觸發時機：
//   - 每天結算（advanceTick，隊長系統啟用後）：CONFIG.drama.dailyChance（25%）擲一則；
//   - 副本成功結算（存活 2 人以上）：CONFIG.drama.runChance（30%）擲一則（只有 when 不是 "day" 的事件能演，例如慶功宴）。
// 群組嚴格 5:2:1（熱血羈絆 : 派系摩擦 : 八點檔修羅場）；抽到的群組當下沒有事件能演，就退回熱血羈絆（所以修羅場只會比 1/8 更少）。

import { CONFIG } from "../data/config.js";
import { DRAMA_EVENTS, DRAMA_GROUPS } from "../data/dramaEvents.js";
import { rand, pick, weighted } from "./rng.js";
import { emit, currentDay, setInjury, getSamsarite } from "./core.js";
import { effectivePower } from "./tags.js";
import { affinity, shiftAffinity, addLove, addHate } from "./relations.js";
import { styleOf, captainOf, squadRng, squadOf, squadUnlocked, seizeCaptain } from "./squad.js";
import { addChronicle } from "./lineage.js";
import { logText } from "./templates.js";

const D = () => CONFIG.drama;
const clampSan = (v) => Math.max(0, Math.min(100, v));
const addSan = (s, d) => {
  if (s) s.stats.sanity = clampSan(s.stats.sanity + d);
};
const alive = (state, id) => getSamsarite(state, id);

// ───────── 選角：每種 cast 回傳「現在所有可能的演員組合」，空陣列 = 這則事件現在演不了 ─────────

const pairs = (pool, ok) => pool.flatMap((a) => pool.filter((b) => b.id !== a.id && ok(a, b)).map((b) => ({ A: a, B: b })));

function recentContraband(state, pool, itemTest = () => true) {
  const day = currentDay(state);
  const ids = new Set(pool.map((s) => s.id));
  return (squadOf(state).contraband ?? [])
    .filter((r) => !r.exposed && day - r.day <= D().contrabandWindowDays && r.victimId != null && ids.has(r.userId) && ids.has(r.victimId) && itemTest(r))
    .map((r) => ({ A: alive(state, r.userId), B: alive(state, r.victimId), rec: r }));
}

const CASTS = {
  pair: (state, pool) => pairs(pool, () => true),
  friends: (state, pool) => pairs(pool, (a, b) => affinity(state, a, b) >= 20 && affinity(state, b, a) >= 10),
  bestFriends: (state, pool) =>
    pairs(pool, (a, b) => a.id < b.id && affinity(state, a, b) >= D().partnerAt && affinity(state, b, a) >= D().partnerAt && !alive(state, a.bondPartnerId) && !alive(state, b.bondPartnerId)),
  mentor: (state, pool) => pairs(pool, (a, b) => (b.geneLock ?? 0) <= 1 && effectivePower(a) >= effectivePower(b) * 1.3),
  wounded: (state, pool) => pairs(pool, (a, b) => a.injury === 0 && b.injury >= 1),
  lowSanity: (state, pool) => pairs(pool, (a, b) => a.stats.sanity >= 50 && b.stats.sanity < 50),
  all: (state, pool) => (pool.length >= 3 ? pool.map((a) => ({ A: a, list: pool })) : []),
  memorial: (state, pool) => ((state.armoryHeirlooms?.length ?? 0) > 0 || (state.memorialStele?.length ?? 0) > 0 ? pool.map((a) => ({ A: a })) : []),
  memorialAll: (state, pool) => ((state.memorialStele?.length ?? 0) > 0 || (state.graveyard?.length ?? 0) > 0 ? pool.map((a) => ({ A: a, list: pool })) : []),
  captainAndOne: (state, pool) => {
    const cap = captainOf(state);
    return cap && pool.includes(cap) ? pool.filter((s) => s.id !== cap.id).map((b) => ({ A: cap, B: b })) : [];
  },
  hoarder: (state, pool) => (styleOf(state) === "communal" ? pool.filter((s) => (s.wallet ?? 0) >= D().struggleWalletMin).map((a) => ({ A: a, list: pool })) : []),
  taunt: (state, pool) => {
    if (styleOf(state) !== "elite" || pool.length < 2) return [];
    const sorted = [...pool].sort((a, b) => effectivePower(b) - effectivePower(a) || a.id - b.id);
    const [a, b] = [sorted[0], sorted[sorted.length - 1]];
    return effectivePower(a) >= effectivePower(b) * 1.3 ? [{ A: a, B: b }] : [];
  },
  contraband: (state, pool) => recentContraband(state, pool),
  captainBias: (state, pool) => {
    const cap = captainOf(state);
    return cap && pool.includes(cap) ? pool.filter((s) => s.id !== cap.id).map((b) => ({ A: cap, B: b })) : [];
  },
  quarrel: (state, pool) => pairs(pool, (a, b) => (a.wallet ?? 0) - (b.wallet ?? 0) >= 100),
  pigGrumble: (state, pool) => {
    const cap = captainOf(state);
    return cap && styleOf(state) === "farming" && pool.includes(cap) ? pool.filter((s) => s.id !== cap.id).map((a) => ({ A: a, B: cap })) : [];
  },
  conspire: (state, pool) => {
    const cap = captainOf(state);
    if (!cap || !pool.includes(cap)) return [];
    const list = pool.filter((s) => s.id !== cap.id && affinity(state, s, cap) <= D().coupTrigger.affinity).sort((a, b) => effectivePower(b) - effectivePower(a) || a.id - b.id);
    return list.length >= D().coupTrigger.minConspirators ? [{ A: list[0], B: cap, list }] : [];
  },
  triangle: (state, pool) =>
    pool.flatMap((b) => {
      const fans = pool.filter((s) => s.id !== b.id && affinity(state, s, b) >= 45);
      return fans.flatMap((a) => fans.filter((c) => a.id < c.id).map((c) => ({ A: a, B: b, C: c })));
    }),
  doll: (state, pool) => recentContraband(state, pool, (r) => r.itemId.startsWith("drama_custom_doll")),
};

// ───────── 抽群組、抽事件 ─────────

/** 依 5:2:1 權重抽群組（測試可直接餵亂數驗證比例） */
export function pickGroup(rng) {
  const w = D().groupWeights;
  return weighted(rng, DRAMA_GROUPS.map((g) => ({ g, weight: w[g] }))).g;
}

const castKey = (ev, c) => `drama:${ev.id}:${c.A?.id ?? 0}:${c.B?.id ?? 0}:${c.C?.id ?? 0}`;

/** 現在這個群組裡能演的事件：[{ ev, casts }]（冷卻中的組合已排除） */
export function playable(state, group, pool, when) {
  const day = currentDay(state);
  const out = [];
  for (const ev of DRAMA_EVENTS) {
    if (ev.group !== group) continue;
    if (ev.when && ev.when !== when) continue;
    if (ev.style && styleOf(state) !== ev.style) continue;
    const casts = (CASTS[ev.cast]?.(state, pool) ?? []).filter((c) => c.A && (state.cooldowns?.[castKey(ev, c)] ?? 0) <= day);
    if (casts.length > 0) out.push({ ev, casts });
  }
  return out;
}

/** 擲一則人際事件。pool = 可以演的人（每日 = 在空間的人、副本結算 = 存活隊員）。回傳 { ev, cast } 或 null */
export function runDrama(state, pool, when = "day", forceGroup = null) {
  if (pool.length < 2) return null;
  const rng = squadRng(state);
  const group = forceGroup ?? pickGroup(rng);
  for (const g of group === "bond" ? ["bond"] : [group, "bond"]) {
    const options = playable(state, g, pool, when);
    if (options.length === 0) continue;
    const { ev, casts } = pick(rng, options);
    const cast = pick(rng, casts);
    applyEvent(state, ev, cast, pool);
    return { ev, cast };
  }
  return null;
}

// ───────── 套用效果 ─────────

export function applyEvent(state, ev, cast, pool = []) {
  state.cooldowns ??= {};
  state.cooldowns[castKey(ev, cast)] = currentDay(state) + D().cooldownDays;
  const { A, B, C } = cast;
  const vars = { A, B: B ?? A, C: C ?? A, n: cast.list?.length ?? 0, amount: 0 };
  const fx = ev.fx ?? {};
  const list = cast.list ?? pool;

  if (fx.love && B) {
    if (fx.love[0]) addLove(state, A, B, fx.love[0]);
    if (fx.love[1]) addLove(state, B, A, fx.love[1]);
  }
  if (fx.aff && B) {
    if (fx.aff[0]) shiftAffinity(state, A, B, fx.aff[0]);
    if (fx.aff[1]) shiftAffinity(state, B, A, fx.aff[1]);
  }
  if (fx.hate && B) {
    if (fx.hate[0]) addHate(state, A, B, fx.hate[0]);
    if (fx.hate[1]) addHate(state, B, A, fx.hate[1]);
  }
  if (fx.hateAC && C) {
    addHate(state, A, C, fx.hateAC);
    addHate(state, C, A, fx.hateAC);
  }
  if (fx.loveAll) for (const x of list) for (const y of list) if (x.id !== y.id) addLove(state, x, y, fx.loveAll);
  if (fx.affAll) for (const m of list) if (m.id !== A.id) shiftAffinity(state, m, A, fx.affAll[0]);
  if (fx.sanityA) addSan(A, fx.sanityA);
  if (fx.sanityB) addSan(B, fx.sanityB);
  if (fx.sanityC) addSan(C, fx.sanityC);
  if (fx.sanityAll) for (const m of list) addSan(m, fx.sanityAll);
  if (fx.healB && B && B.injury > 0) setInjury(B, Math.max(0, B.injury - fx.healB));
  if (fx.partner && B) {
    A.bondPartnerId = B.id;
    B.bondPartnerId = A.id;
  }
  if (fx.fund) {
    const take = Math.floor((A.wallet ?? 0) * fx.fund);
    A.wallet -= take;
    squadOf(state).communalFund += take;
    vars.amount = take;
  }
  if (fx.exposed && cast.rec) cast.rec.exposed = true;

  const text = logText(state, ev.texts, vars);
  emit(state, "drama", text, { samsariteId: A.id });
  if (ev.chronicle) addChronicle(state, "drama", text);
  if (fx.special === "coupNight") resolveCoupNight(state, cast);
  return text;
}

/** 噬主夜襲：陰謀者合力 vs 隊長 ×1.2。成功 = 隊長重傷、理智大跌、領頭者奪權；失敗 = 陰謀者全員重傷，被隊長鎮壓 */
function resolveCoupNight(state, cast) {
  const { A, B: cap, list } = cast;
  const T = D().coupTrigger;
  const ps = list.reduce((n, s) => n + effectivePower(s), 0);
  const pc = effectivePower(cap) * T.win;
  if (rand(squadRng(state)) < ps / (ps + pc)) {
    setInjury(cap, Math.max(cap.injury, 2));
    addSan(cap, -15);
    const text = logText(state, "dramaCoupWin", { A, B: cap });
    emit(state, "drama", text);
    addChronicle(state, "drama", text);
    seizeCaptain(state, A);
  } else {
    for (const s of list) {
      setInjury(s, Math.max(s.injury, 2));
      addSan(s, -10);
      addHate(state, s, cap, 5);
    }
    const text = logText(state, "dramaCoupFail", { A, B: cap });
    emit(state, "drama", text);
    addChronicle(state, "drama", text);
  }
}

// ───────── 掛鉤 ─────────

/** 每日結算掛鉤：隊長系統啟用後，有 25% 機率在空間裡演一則 */
export function dailyDrama(state) {
  if (state.gameOver || !squadUnlocked(state)) return null;
  const pool = state.samsarites.filter((s) => s.location === "space");
  if (pool.length < 2 || rand(squadRng(state)) >= D().dailyChance) return null;
  return runDrama(state, pool, "day");
}

/** 副本成功結算掛鉤（存活 2 人以上）：30% 機率穿插一則 */
export function dramaAfterRun(state, survivors) {
  if (state.gameOver || !squadUnlocked(state) || survivors.length < 2) return null;
  if (rand(squadRng(state)) >= D().runChance) return null;
  return runDrama(state, survivors, "run");
}
