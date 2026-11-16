// 壓力系統（A-2）：主神抽成（每日累進稅）＋主神考核（KPI，每期 30 天）。純規則，不碰畫面。
// 數字：CONFIG.pressure；日誌句：src/data/logs.js（tithe／kpi*）。
// 設計原則：壓力錨定在「公庫存量」，不看天數或戰力；空間 Lv.1 完全零觸發；獎勵不加戰力；
//          用獨立亂數流 state.pressure.rngState（只用在考核目標浮動），不動主亂數。
//
// state.pressure：
//   rngState      獨立亂數流
//   count         已開始過幾期考核
//   periodStart   本期開始的那一天（剛結束的第幾天）；0 = 尚未啟動
//   period        本期累計 { clears, earned, deaths }（副本成功結算場數／稅入公庫積分／副本戰死與被抹殺人數）
//   targets       本期目標 { clears, earned, deaths } 或 null（尚未啟動）
//   streak        連續未達標次數
//   taxCutUntil／taxSurgeUntil  抽成減半／加課生效到「剛結束的第幾天」為止
//   freeRefresh   免費黑市手動刷新次數（3 項全過的獎勵）
//   weekTithe     尚未彙總進日誌的抽成
//   titheTotal／fineTotal  累計抽成／罰金（給 sim 與面板看）
//   history       最近幾期的考核結果
//   warned        本期是否已預警過

import { CONFIG } from "../data/config.js";
import { rand } from "./rng.js";
import { emit, currentDay } from "./core.js";
import { logText } from "./templates.js";

const P = () => CONFIG.pressure;

export function newPressureState(seed = 0) {
  return {
    rngState: (seed ^ 0x7a55) | 0,
    count: 0,
    periodStart: 0,
    period: { clears: 0, earned: 0, deaths: 0 },
    targets: null,
    streak: 0,
    taxCutUntil: 0,
    taxSurgeUntil: 0,
    freeRefresh: 0,
    weekTithe: 0,
    titheTotal: 0,
    fineTotal: 0,
    history: [],
    warned: false,
  };
}

const ps = (state) => (state.pressure ??= newPressureState(state.rngState));
const lvIdx = (state) => Math.min(CONFIG.space.maxLevel, Math.max(1, state.spaceLevel ?? 1)) - 1;
const endedDay = (state) => Math.floor(state.tick / CONFIG.ticksPerDay);

/** 這個空間等級是否啟動壓力系統 */
export const pressureActive = (state) => (state.spaceLevel ?? 1) >= P().startLevel;
export const exemptOf = (state) => P().exempt[lvIdx(state)] ?? 0;

/** 其他系統回報本期業績（kind：clears／earned／deaths）；考核尚未啟動時忽略 */
export function pressureRecord(state, kind, amount = 1) {
  const p = state.pressure;
  if (!p?.targets || !(amount > 0)) return;
  p.period[kind] = (p.period[kind] ?? 0) + amount;
}

/** 目前抽成倍率：達標減半、未達標加課（兩者不會同時生效，每次考核都重設） */
export function titheMultOf(state, day = endedDay(state)) {
  const p = ps(state);
  let m = 1;
  if (day <= p.taxCutUntil) m *= 1 - P().passTaxCutPct;
  if (day <= p.taxSurgeUntil) m *= 1 + P().failTaxSurge;
  return m;
}

/** 邊際級距計稅：公庫 points 在免稅額 L 之上的部分，各級距各算各的（純函式，給測試與面板用） */
export function titheOf(points, exempt, mult = 1) {
  if (!(exempt > 0) || points <= exempt) return 0;
  let tax = 0;
  let lower = exempt;
  for (const b of P().brackets) {
    const upper = b.upTo === Infinity ? Infinity : exempt * b.upTo;
    if (points <= lower) break;
    tax += (Math.min(points, upper) - lower) * b.rate;
    lower = upper;
  }
  tax *= mult;
  tax = Math.min(tax, points * P().dailyCapPct, points - exempt); // 單日上限；抽完不低於 L
  return Math.max(0, Math.floor(tax));
}

function startPeriod(state, ended) {
  const p = ps(state);
  const idx = lvIdx(state);
  const relief = p.streak >= P().reliefAfter ? Math.min(P().reliefMax, P().reliefStep * (p.streak - P().reliefAfter + 1)) : 0;
  const jit = () => 1 + (rand(p) * 2 - 1) * P().targetJitter;
  p.count += 1;
  p.periodStart = ended;
  p.period = { clears: 0, earned: 0, deaths: 0 };
  p.warned = false;
  p.targets = {
    clears: Math.max(1, Math.round(P().targetClears[idx] * jit() * (1 - relief))),
    earned: Math.max(1, Math.round(P().targetEarned[idx] * jit() * (1 - relief))),
    deaths: Math.max(0, idx), // 戰死上限 = 空間等級 - 1
    level: idx + 1,
  };
  emit(state, "kpiStart", logText(state, "kpiStart", { n: p.count, days: P().reviewDays, clears: p.targets.clears, earned: p.targets.earned, deaths: p.targets.deaths }));
}

/** 本期各項是否達成（給面板與結算共用） */
export function kpiStatus(state) {
  const p = ps(state);
  if (!p.targets) return null;
  const t = p.targets;
  const items = [
    { key: "clears", label: "通關場數", now: p.period.clears, target: t.clears, ok: p.period.clears >= t.clears },
    { key: "earned", label: "公庫入帳", now: p.period.earned, target: t.earned, ok: p.period.earned >= t.earned },
    { key: "deaths", label: "戰死人數（越少越好）", now: p.period.deaths, target: t.deaths, ok: p.period.deaths <= t.deaths },
  ];
  return { items, passed: items.filter((i) => i.ok).length, daysLeft: p.periodStart + P().reviewDays - endedDay(state) };
}

function review(state, ended) {
  const p = ps(state);
  const st = kpiStatus(state);
  const ok = st.passed;
  const pass = ok >= P().needPass;
  const perfect = ok === st.items.length;
  const crew = state.samsarites.filter((s) => s.location !== "pod");
  const rec = { n: p.count, day: ended, level: p.targets.level, got: { ...p.period }, ok, pass, perfect, items: st.items.map((i) => ({ key: i.key, now: i.now, target: i.target, ok: i.ok })), fine: 0 };
  if (pass) {
    p.streak = 0;
    for (const s of crew) s.stats.sanity = Math.min(100, s.stats.sanity + P().passSanity);
    p.taxCutUntil = ended + P().reviewDays;
    p.taxSurgeUntil = 0;
    if (perfect) p.freeRefresh += P().perfectFreeRefresh;
    emit(state, "kpi", logText(state, "kpiPass", { ok, san: P().passSanity, days: P().reviewDays, perfect: perfect ? `三項全過，黑市免費刷新 ${P().perfectFreeRefresh} 次。` : "" }), { kpi: "pass" });
  } else {
    p.streak += 1;
    const mult = Math.min(P().streakMax, 1 + P().streakStep * (p.streak - 1));
    const L = exemptOf(state);
    const surplus = Math.max(0, state.points - L);
    let fine = Math.min(surplus * P().failFinePct, Math.max(0, state.points) * P().failFineCapPct) * mult;
    fine = Math.round(Math.min(fine, surplus)); // 罰到 L 為止，不會把公庫罰進負債
    state.points -= fine;
    p.fineTotal += fine;
    rec.fine = fine;
    const loss = Math.round(P().failSanity * mult);
    for (const s of crew) if (s.stats.sanity > P().sanityFloor) s.stats.sanity = Math.max(P().sanityFloor, s.stats.sanity - loss);
    p.taxSurgeUntil = ended + P().reviewDays;
    p.taxCutUntil = 0;
    emit(state, "kpi", logText(state, "kpiFail", { ok, fine, san: loss, streak: p.streak }), { kpi: "fail" });
  }
  p.history.push(rec);
  if (p.history.length > P().historyMax) p.history.splice(0, p.history.length - P().historyMax);
  startPeriod(state, ended);
}

/** 每日結算掛鉤（advanceTick，endOfDay 之後）：啟動 → 日抽成 → 預警 → 期末考核 */
export function dailyPressure(state) {
  if (state.gameOver || !pressureActive(state)) return;
  const p = ps(state);
  const ended = endedDay(state);
  if (!p.targets) {
    if (ended < P().startDay) return;
    startPeriod(state, ended);
  }
  const tax = titheOf(state.points, exemptOf(state), titheMultOf(state, ended));
  if (tax > 0) {
    state.points -= tax;
    p.titheTotal += tax;
    p.weekTithe += tax;
  }
  if (ended % P().logEveryDays === 0 && p.weekTithe > 0) {
    emit(state, "tithe", logText(state, "tithe", { days: P().logEveryDays, tax: p.weekTithe, exempt: exemptOf(state) }));
    p.weekTithe = 0;
  }
  const left = p.periodStart + P().reviewDays - ended;
  if (left <= 0) review(state, ended);
  else if (left <= P().warnDays && !p.warned) {
    p.warned = true;
    const st = kpiStatus(state);
    emit(state, "kpiWarn", logText(state, "kpiWarn", { left, clears: p.period.clears, tClears: p.targets.clears, earned: p.period.earned, tEarned: p.targets.earned, deaths: p.period.deaths, tDeaths: p.targets.deaths }), { kpi: "warn", passed: st.passed });
  }
}
