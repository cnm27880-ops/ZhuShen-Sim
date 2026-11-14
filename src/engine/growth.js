// 養成引擎（Phase 4-B）：基因鎖 geneLock、個人強化 enhance、常規通關頓悟 insight。
// 純規則，不碰畫面；數字全部在 CONFIG.gene／enhance／insight 與 RANKS（成長倍率、基因鎖上限）。
//
// 重點規則（露葵 2026-11-14 拍板）：
//   - 基因鎖 0~4 階，入隊 0 階；上限依階級固定（C 1／B 2／A 3／S 4）。
//   - 突破下一階：必須先點滿「當階」強化次數上限、空間等級夠、積分夠、不超過自身階級上限。
//   - 強化與頓悟的增加量 = round(基礎量 × 階級成長倍率)，直接加進 s.stats（power／hp／defense／speed／luck）。
//   - 基因鎖「本體戰力乘區」只乘本體養成值（s.stats.power + s.inheritPower），不乘裝備白值（見 tags.js effectivePower）。
//   - 強化與突破只要人在主神空間（不在副本、不在催熟艙）就能做，帶傷也可以。
//   - 頓悟用獨立亂數流 state.growth.rngState，不動主亂數。

import { CONFIG, RANKS } from "../data/config.js";
import { rand, pick } from "./rng.js";
import { logText } from "./templates.js";
import { canAfford, emit, getSamsarite, spend, spendWallet } from "./core.js";

/** 頓悟的獨立亂數流（跟主神搞事、生小孩同樣的做法） */
export function newGrowthState(seed = 0) {
  return { rngState: (seed ^ 0x6f0d) | 0 };
}
const growth = (state) => (state.growth ??= newGrowthState(state.rngState));

// ───────── 查詢 ─────────

export const growthMultOf = (s) => RANKS[s.rank].growthMult;
export const geneLockOf = (s) => s.geneLock ?? 0;
/** 這個階級最高能突破到第幾階 */
export const maxGeneOf = (s) => RANKS[s.rank].maxGene;
/** 目前基因鎖階段的資料（名稱、強化上限、戰力乘區…） */
export const geneTierOf = (s) => CONFIG.gene.tiers[geneLockOf(s)];
/** 本體戰力乘區（只乘本體養成值） */
export const powerMultOf = (s) => geneTierOf(s).powerMult;
/** 目前基因鎖階段的強化次數上限 */
export const enhanceCapOf = (s) => geneTierOf(s).enhanceCap;
/** 頓悟累計次數上限 = (基因鎖階數 + 1) × capPerGene */
export const insightCapOf = (s) => (geneLockOf(s) + 1) * CONFIG.insight.capPerGene;

/** 第 n 次強化（n 從 1 算起）要花多少積分；超過最後一段回傳 null */
export function enhanceCostFor(n) {
  const tier = CONFIG.enhance.costTiers.find((t) => n <= t.upTo);
  return tier ? tier.cost : null;
}

const gainOf = (base, s) => Math.round(base * growthMultOf(s));

/** 每次強化會加多少（依階級成長倍率），給畫面與測試用 */
export function enhanceGain(s) {
  const g = CONFIG.enhance.gain;
  return {
    power: gainOf(g.power, s),
    hp: gainOf(g.hp, s),
    defense: gainOf(g.defense, s),
    speed: gainOf(g.speed, s),
    luck: gainOf(g.luck, s),
  };
}

const inHome = (s) => s.location === "space";

// ───────── 強化 ─────────

/** 現在能不能強化。回傳 { ok, reason, cost }；reason 是給畫面看的繁體中文 */
/** 付費來源（4-D-1）：預設公庫補助 state.points；opts.payer === "wallet" 時由輪迴者自己的私房錢付（不能欠債） */
const walletPay = (opts) => opts?.payer === "wallet";
function canPay(state, s, cost, opts) {
  return walletPay(opts) ? (s.wallet ?? 0) >= cost : canAfford(state, cost);
}
const payFail = (opts) => (walletPay(opts) ? "私房錢不夠" : "積分不夠（已達高利貸上限）");

export function checkEnhance(state, id, opts = null) {
  const s = getSamsarite(state, id);
  if (!s) return { ok: false, reason: "找不到這個人" };
  if (!inHome(s)) return { ok: false, reason: "只有待在主神空間才能強化" };
  const n = (s.enhanceCount ?? 0) + 1;
  if (n > enhanceCapOf(s)) {
    const next = geneLockOf(s) < maxGeneOf(s) ? "，需要先突破基因鎖" : "，已達此階級的基因鎖上限";
    return { ok: false, reason: `強化次數已達上限 ${enhanceCapOf(s)} 次${next}` };
  }
  const cost = enhanceCostFor(n);
  if (cost === null) return { ok: false, reason: "強化次數已達上限" };
  if (!canPay(state, s, cost, opts)) return { ok: false, reason: payFail(opts), cost };
  return { ok: true, cost };
}

export function enhance(state, id, opts = null) {
  const check = checkEnhance(state, id, opts);
  if (!check.ok) return check;
  const s = getSamsarite(state, id);
  if (walletPay(opts)) spendWallet(state, s, check.cost);
  else spend(state, check.cost);
  const gain = enhanceGain(s);
  for (const [key, v] of Object.entries(gain)) s.stats[key] += v;
  s.enhanceCount = (s.enhanceCount ?? 0) + 1;
  emit(
    state,
    "enhance",
    logText(state, "enhance", { A: s, cost: check.cost, n: s.enhanceCount, max: enhanceCapOf(s), power: gain.power, hp: gain.hp }),
    { samsariteId: s.id }
  );
  return { ok: true, cost: check.cost, gain };
}

// ───────── 突破基因鎖 ─────────

/** 破鎖費用：持有對應階級的基因鎖助推 Buff（破鎖丹等耗材）時打折（4-E-8；破鎖沒有失敗判定，所以只有花費折扣） */
export function geneCostOf(s, next, base) {
  const b = s.geneBuff;
  return b && b.target === next ? Math.round(base * (1 - (b.costDiscount ?? 0))) : base;
}

/** 現在能不能突破到下一階。回傳 { ok, reason, cost, next }（next = 突破後的階數） */
export function checkBreakGene(state, id, opts = null) {
  const s = getSamsarite(state, id);
  if (!s) return { ok: false, reason: "找不到這個人" };
  if (!inHome(s)) return { ok: false, reason: "只有待在主神空間才能突破基因鎖" };
  const lock = geneLockOf(s);
  if (lock >= maxGeneOf(s)) return { ok: false, reason: `${s.rank} 級的基因鎖上限是第 ${maxGeneOf(s)} 階` };
  const next = lock + 1;
  const tier = CONFIG.gene.tiers[next];
  if ((s.enhanceCount ?? 0) < enhanceCapOf(s)) {
    return { ok: false, reason: `要先點滿目前階段的強化次數（${s.enhanceCount ?? 0}/${enhanceCapOf(s)}）`, next };
  }
  if ((state.spaceLevel ?? 1) < tier.spaceLevel) {
    return { ok: false, reason: `需要空間等級 Lv.${tier.spaceLevel}`, next, cost: geneCostOf(s, next, tier.cost) };
  }
  const cost = geneCostOf(s, next, tier.cost);
  if (!canPay(state, s, cost, opts)) return { ok: false, reason: payFail(opts), next, cost };
  return { ok: true, cost, next };
}

export function breakGene(state, id, opts = null) {
  const check = checkBreakGene(state, id, opts);
  if (!check.ok) return check;
  const s = getSamsarite(state, id);
  if (walletPay(opts)) spendWallet(state, s, check.cost);
  else spend(state, check.cost);
  s.geneLock = check.next;
  if (s.geneBuff?.target === check.next) s.geneBuff = null; // 助推 Buff 突破後消耗（4-E-8）
  const tier = CONFIG.gene.tiers[s.geneLock];
  emit(
    state,
    "breakGene",
    logText(state, "breakGene", { A: s, tier: s.geneLock, name: tier.name, cost: check.cost, mult: tier.powerMult, cap: tier.enhanceCap }),
    { samsariteId: s.id }
  );
  return { ok: true, cost: check.cost, tier: s.geneLock };
}

// ───────── 因果結晶掉落 ─────────

/**
 * 副本通關結算時呼叫（只在成功時）。number = 該副本是全域第幾關（相容保留，4-D-4 起不再使用）。
 * 掉落有兩種，各自獨立、可疊加：① 首通該關必掉（CONFIG.karma.firstClear）② 該章任一副本通關機率掉 1 顆（chapterRoll）。
 * 機率用獨立亂數流 state.growth.rngState，不動主亂數。回傳這次掉了幾顆。
 */
export function rollKarmaDrop(state, dungeon, number, firstClear) {
  const K = CONFIG.karma;
  let n = firstClear ? (K.firstClear[dungeon.id] ?? 0) : 0; // 4-D-4：依副本 id（number 參數保留相容，不再使用）
  const chance = K.chapterRoll[dungeon.chapter];
  if (chance && rand(growth(state)) < chance) n += 1;
  if (n > 0) {
    state.karmaCrystals = (state.karmaCrystals ?? 0) + n;
    emit(state, "karma", logText(state, "karmaDrop", { n, total: state.karmaCrystals }));
  }
  return n;
}

// ───────── 常規通關頓悟 ─────────

const SUB_NAMES = { hp: "生命", defense: "防禦", speed: "速度", luck: "運氣" };

/**
 * 副本「通關」結算時呼叫：每位存活隊員獨立擲 CONFIG.insight.chance，中了就頓悟。
 * 已達累計上限的人不擲。回傳這次頓悟的人與增加量（給結算摘要用）。
 */
export function rollInsights(state, survivors) {
  const C = CONFIG.insight;
  const g = growth(state);
  const hits = [];
  for (const s of survivors) {
    const done = s.insightCount ?? 0;
    if (done >= insightCapOf(s)) continue;
    if (rand(g) >= C.chance) continue;
    const subStat = pick(g, C.subStats);
    const power = gainOf(C.gainPower, s);
    const subGain = gainOf(C.gainSub, s);
    s.stats.power += power;
    s.stats[subStat] += subGain;
    s.insightCount = done + 1;
    hits.push({ id: s.id, name: s.name, power, subStat, subGain, n: s.insightCount });
    emit(
      state,
      "insight",
      logText(state, "insight", { A: s, power, sub: SUB_NAMES[subStat], subGain, n: s.insightCount, max: insightCapOf(s) }),
      { samsariteId: s.id }
    );
  }
  return hits;
}
