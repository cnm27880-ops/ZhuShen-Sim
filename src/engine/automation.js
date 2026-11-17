// 自動化中樞（A-3 掛機壓力設計 階段 3）。純規則，不碰畫面。數字：CONFIG.automation；名稱：data/automation.js；日誌句：data/logs.js 的 auto*。
//
// 設計重點（露葵 2026-11 拍板）：自動化要靠「投資」換來，而且不是萬能的（參考極度缺氧 ONI：自動化設施建好很有成就感，放著不管仍會出事）。
//   - 兩個模組：🕊️ 調解中樞（自動調停人際張力）、📋 人力調度處（名冊低於目標就自動補人）。各 3 級，買等級花公庫並受空間等級限制。
//   - 每天扣維護費（公庫）；公庫不夠付（不借債）當天停擺，有錢了自動恢復。
//   - 故障：每天機率故障，故障後一定要玩家手動「維修」才恢復（沒有自動修復）。完全不維護的玩家，自動化會慢慢全部壞掉。
//   - 容量上限：調解中樞每天只處理固定件數、只處理等級 1～2 的事件、成功率比手動低；不會自動補償或拆開。
//     張力事件量隨在家人數平方成長，容量只隨等級線性成長，所以人多時自動化一定忙不過來，k=0 的玩家不會等同高手。
//   - 現有三個自動功能（自動派遣／建設／侵蝕）維持免費，不在這裡（等 A2 拉長主線後再重掃）。
// 亂數：只有「故障骰」用獨立亂數流 state.automation.rngState；自動調停的成功判定沿用張力亂數流（resolveTension）；
//   自動補人抽卡走一般抽卡亂數。沒投資（全部 0 級）時完全不消耗任何亂數。
//
//   state.automation = { rngState, levels: { mediate, recruit }, broken: {id: bool}, paidDay: {id: 第幾天已付維護費}, unpaid: {id: bool（付不起而停擺）},
//                        recruitTarget, stats }

import { CONFIG } from "../data/config.js";
import { AUTOMATION_ORDER, AUTOMATION_TEXT } from "../data/automation.js";
import { rand } from "./rng.js";
import { emit, currentDay, canAfford, spend, upkeepOf, checkGacha, pullGacha } from "./core.js";
import { pendingTension, resolveTension } from "./tension.js";
import { logText } from "./templates.js";

const A = () => CONFIG.automation;
const mod = (id) => A().modules[id];

// ───────── 狀態與亂數流 ─────────

export function newAutomationState(seed = 0) {
  return {
    rngState: (seed ^ 0xa07a) | 0,
    levels: Object.fromEntries(AUTOMATION_ORDER.map((id) => [id, 0])),
    broken: {},
    paidDay: {},
    unpaid: {},
    recruitTarget: 6,
    stats: { handled: 0, ok: 0, fail: 0, faults: 0, repairs: 0, repairSpent: 0, offDays: 0, maintPaid: 0, recruits: 0 },
  };
}

/** 取（必要時補）自動化狀態，舊存檔沒有就補預設 */
export function automationOf(state) {
  const a = (state.automation ??= newAutomationState(state.rngState));
  const d = newAutomationState(0);
  a.rngState ??= d.rngState;
  a.levels = { ...d.levels, ...(a.levels ?? {}) };
  a.broken ??= {};
  a.paidDay ??= {};
  a.unpaid ??= {};
  a.recruitTarget ??= d.recruitTarget;
  a.stats = { ...d.stats, ...(a.stats ?? {}) };
  return a;
}

function autoRng(state) {
  return {
    get rngState() {
      return automationOf(state).rngState;
    },
    set rngState(v) {
      automationOf(state).rngState = v;
    },
  };
}

export const automationLevel = (state, id) => automationOf(state).levels[id] ?? 0;

/** 這個模組「今天」有在運作嗎？（有等級、沒故障、今天的維護費已付） */
export function moduleActive(state, id) {
  const a = automationOf(state);
  return A().enabled && (a.levels[id] ?? 0) > 0 && !a.broken[id] && a.paidDay[id] === currentDay(state);
}

const levelValue = (state, id, key) => {
  const lv = automationLevel(state, id);
  return lv > 0 ? mod(id)[key][lv - 1] : 0;
};

// ───────── 購買與維修 ─────────

/** 現在能不能買下一級。回傳 { ok, reason, cost, next, unlock } */
export function checkAutomationBuy(state, id) {
  const m = mod(id);
  if (!m) return { ok: false, reason: "沒有這個模組" };
  const lv = automationLevel(state, id);
  if (lv >= m.max) return { ok: false, reason: "已達等級上限", next: lv };
  const next = lv + 1;
  const info = { cost: m.cost[lv], next, unlock: m.unlockSpace[lv] };
  if ((state.spaceLevel ?? 1) < info.unlock) return { ok: false, reason: `需要空間等級 Lv.${info.unlock}`, ...info };
  if (!canAfford(state, info.cost)) return { ok: false, reason: "積分不夠（已達高利貸上限）", ...info };
  return { ok: true, ...info };
}

export function buyAutomation(state, id) {
  const c = checkAutomationBuy(state, id);
  if (!c.ok) return c;
  if (!spend(state, c.cost, false)) return { ...c, ok: false, reason: "積分不夠（已達高利貸上限）" }; // 同基建，不計入商店階級
  automationOf(state).levels[id] = c.next;
  const t = AUTOMATION_TEXT[id];
  emit(state, "automation", logText(state, "autoBuy", { name: `${t.icon}${t.name}`, lv: c.next, max: mod(id).max, cost: c.cost }));
  return c;
}

/** 維修費（公庫）：當級維護費 × repairMult */
export const repairCost = (state, id) => {
  const lv = automationLevel(state, id);
  return lv > 0 ? Math.round(mod(id).maint[lv - 1] * A().repairMult) : 0;
};

export function repairModule(state, id) {
  const a = automationOf(state);
  if (!a.broken[id]) return { ok: false, reason: "這個模組沒有故障" };
  const cost = repairCost(state, id);
  if (!canAfford(state, cost)) return { ok: false, reason: "積分不夠（已達高利貸上限）", cost };
  spend(state, cost, false);
  a.broken[id] = false;
  a.stats.repairs += 1;
  a.stats.repairSpent += cost;
  const t = AUTOMATION_TEXT[id];
  emit(state, "automation", logText(state, "autoRepair", { name: `${t.icon}${t.name}`, cost }));
  return { ok: true, cost };
}

/** 人力調度處的名冊目標（夾在 1～當級上限） */
export function recruitCap(state) {
  return levelValue(state, "recruit", "rosterCap");
}
export function setRecruitTarget(state, n) {
  const a = automationOf(state);
  a.recruitTarget = Math.max(1, Math.min(Math.max(1, recruitCap(state)), Math.round(Number(n) || 1)));
  return a.recruitTarget;
}

// ───────── 自動調停（由 tension.js 的 dailyTension 在隊長自動調停之後呼叫）─────────

/** 調解中樞：每天依期限由近到遠最多處理 capacity 件（只處理等級 <= maxEventLevel、還沒試過調停的事件） */
export function autoMediate(state) {
  if (!moduleActive(state, "mediate")) return;
  const a = automationOf(state);
  const cap = levelValue(state, "mediate", "capacity");
  const maxLv = levelValue(state, "mediate", "maxEventLevel");
  const mult = levelValue(state, "mediate", "chanceMult");
  let n = 0;
  for (const ev of pendingTension(state)) {
    if (n >= cap) break;
    if (ev.tried || ev.level > maxLv) continue;
    n += 1;
    a.stats.handled += 1;
    emit(state, "tension", logText(state, "autoMediate", { A: state.samsarites.find((s) => s.id === ev.aId), B: state.samsarites.find((s) => s.id === ev.bId) }));
    const r = resolveTension(state, ev.id, "mediate", { chanceMult: mult });
    if (r.ok && r.success) a.stats.ok += 1;
    else a.stats.fail += 1;
  }
}

// ───────── 自動補人 ─────────

const rosterCount = (state) => state.samsarites.filter((s) => s.location !== "pod").length;
const dailyUpkeepNow = (state) => state.samsarites.filter((s) => s.location !== "dungeon").reduce((n, s) => n + upkeepOf(s, state), 0);

function autoRecruit(state) {
  if (!moduleActive(state, "recruit")) return;
  const a = automationOf(state);
  const target = Math.min(a.recruitTarget, recruitCap(state));
  const reserve = levelValue(state, "recruit", "reserveDays");
  for (let i = 0; i < mod("recruit").perDay && rosterCount(state) < target; i++) {
    // 只抽「目前能抽（不用因果結晶）的最便宜卡池」，而且抽完公庫仍要高於 reserve 天維持費
    const pool = CONFIG.gacha.pools
      .map((p) => checkGacha(state, p.id))
      .filter((c) => c.ok && c.crystal === 0)
      .sort((x, y) => x.cost - y.cost)[0];
    if (!pool || state.points - pool.cost < dailyUpkeepNow(state) * reserve) return;
    const s = pullGacha(state, pool.pool.id);
    if (!s) return;
    a.stats.recruits += 1;
    emit(state, "automation", logText(state, "autoRecruit", { A: s, rank: s.rank, cost: pool.cost }));
  }
}

// ───────── 每日結算（advanceTick，dailyTension 之前）─────────

/** 每個有等級、沒故障的模組：公庫付得起 → 擲故障 → 沒故障才付維護費、今天運作；付不起 → 今天停擺。最後自動補人 */
export function dailyAutomation(state) {
  if (state.gameOver || !A().enabled) return;
  const a = automationOf(state);
  const day = currentDay(state);
  for (const id of AUTOMATION_ORDER) {
    const lv = a.levels[id] ?? 0;
    if (lv <= 0 || a.broken[id]) continue;
    const t = AUTOMATION_TEXT[id];
    const fee = mod(id).maint[lv - 1];
    if (state.points < fee) {
      a.stats.offDays += 1;
      if (!a.unpaid[id]) {
        a.unpaid[id] = true;
        emit(state, "automation", logText(state, "autoOffline", { name: `${t.icon}${t.name}`, fee }));
      }
      continue;
    }
    a.unpaid[id] = false;
    if (rand(autoRng(state)) < mod(id).fault[lv - 1]) {
      a.broken[id] = true;
      a.stats.faults += 1;
      emit(state, "autoFault", logText(state, "autoFault", { name: `${t.icon}${t.name}`, cost: repairCost(state, id) }));
      continue;
    }
    state.points -= fee;
    a.stats.maintPaid += fee;
    a.paidDay[id] = day;
  }
  autoRecruit(state);
}

/** 畫面用 */
export function automationInfo(state) {
  const a = automationOf(state);
  return AUTOMATION_ORDER.map((id) => {
    const lv = a.levels[id] ?? 0;
    const m = mod(id);
    return {
      id,
      ...AUTOMATION_TEXT[id],
      lv,
      max: m.max,
      broken: !!a.broken[id],
      unpaid: !!a.unpaid[id],
      maint: lv > 0 ? m.maint[lv - 1] : 0,
      repair: repairCost(state, id),
      buy: checkAutomationBuy(state, id),
    };
  });
}
