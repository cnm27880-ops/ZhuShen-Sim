// 標籤引擎：抽標籤、算標籤帶來的加成。純規則，不碰畫面。
// 這裡只「讀」src/data/tags.js 的資料表；要加標籤請改資料表，不用改這裡。

import { CONFIG } from "../data/config.js";
import { TAGS, getTag } from "../data/tags.js";
import { getShopItem } from "../data/shop.js";
import { rand, randInt, weighted } from "./rng.js";

function tagsOf(s) {
  return (s.tags ?? []).map(getTag).filter(Boolean);
}

/** 從某一類標籤裡，依稀有度權重抽 n 個（不重複） */
function drawKind(state, kind, n) {
  const pool = TAGS.filter((t) => t.kind === kind).map((t) => ({ tag: t, weight: CONFIG.tags.rarityWeights[t.rarity] ?? 0 }));
  const out = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const hit = weighted(state, pool);
    out.push(hit.tag.id);
    pool.splice(pool.indexOf(hit), 1);
  }
  return out;
}

/** 新輪迴者的標籤：基礎數值 2 + 性格機制 1~2 + 靈魂核心 1（計畫 3.3） */
export function rollTags(state) {
  const [minTrait, maxTrait] = CONFIG.tags.traitCount;
  return [
    ...drawKind(state, "stat", CONFIG.tags.statCount),
    ...drawKind(state, "trait", randInt(state, minTrait, maxTrait)),
    ...drawKind(state, "soul", 1),
  ];
}

/** 商店裝備加在某個數值（power 白值 / injuryShield / dodge）上的總和（Phase 4-B 起舊商店強化已移除） */
export function shopBonus(s, key) {
  return Object.values(s.gear ?? {}).reduce((n, id) => n + (getShopItem(id)?.effect?.[key] ?? 0), 0);
}

/** 本體值：初始基礎 + 強化累計 + 頓悟累計（這三項都已直接累加在 stats.power）+ 子嗣繼承值 */
export function bodyPower(s) {
  return s.stats.power + (s.inheritPower ?? 0);
}

/** 基因鎖的本體戰力乘區（×1.0 ~ ×23.0）；只乘本體值，不乘裝備白值 */
export function genePowerMult(s) {
  return CONFIG.gene.tiers[s.geneLock ?? 0]?.powerMult ?? 1;
}

/**
 * 有效戰力（Phase 4-B 公式）：max(1, round((本體值 × 基因鎖乘區 + 武器防具白值) × (1 + 戰力詞條% + 心情%)))
 * 基礎戰力 stats.power 不會被這個函式改動。
 */
export function effectivePower(s) {
  const pct = tagsOf(s).reduce((sum, t) => sum + (t.powerPct ?? 0), 0) + moodPowerPct(s);
  return Math.max(1, Math.round((bodyPower(s) * genePowerMult(s) + shopBonus(s, "power")) * (1 + pct)));
}

/** 心情狀態（許願系統）對戰力的加成：不爽 -10% 之類，數字在 CONFIG.wish.moods */
export function moodPowerPct(s) {
  return CONFIG.wish.moods[s.mood?.kind]?.powerPct ?? 0;
}

/** 全隊心情對「單房通過率」的加成（高興 +5%／人），有上限 */
export function moodPassBonus(party) {
  const sum = party.reduce((n, s) => n + (CONFIG.wish.moods[s.mood?.kind]?.passBonus ?? 0), 0);
  return Math.max(-CONFIG.wish.moodPassCap, Math.min(CONFIG.wish.moodPassCap, sum));
}

/** 全隊標籤對「單房通過率」的加成（已套用上限）。env 是環境標籤（可為 null） */
export function tagPassBonus(party, dungeon, env = null) {
  let sum = 0;
  for (const s of party) {
    for (const t of tagsOf(s)) {
      sum += t.passBonus ?? 0;
      sum += t.genreBonus?.[dungeon.genre] ?? 0;
      if (env) sum += t.envBonus?.[env.id] ?? 0;
    }
  }
  const cap = CONFIG.tags.tagBonusCap;
  return Math.max(-cap, Math.min(cap, sum));
}

/** 賭徒型標籤（烏鴉嘴等）每個房間的隨機浮動。會消耗亂數，所以只在真的檢定時才呼叫 */
export function tagSwing(state, party) {
  let total = 0;
  for (const s of party) {
    for (const t of tagsOf(s)) {
      if (t.swing) total += (rand(state) * 2 - 1) * t.swing;
    }
  }
  return total;
}

/** 全隊標籤對通關積分的加成（0.1 = +10%） */
export function tagRewardPct(party) {
  return party.reduce((sum, s) => sum + tagsOf(s).reduce((n, t) => n + (t.rewardPct ?? 0), 0), 0);
}

/** 這個人受傷時「少/多受一級」的機率（正數減免、負數加重） */
export function injuryShieldOf(s) {
  const v = tagsOf(s).reduce((sum, t) => sum + (t.injuryShield ?? 0), 0) + shopBonus(s, "injuryShield");
  return Math.max(-CONFIG.tags.injuryShieldMax, Math.min(CONFIG.tags.injuryShieldMax, v));
}

/** 被點名受傷時直接閃過的機率 */
export function dodgeOf(s) {
  return Math.min(CONFIG.shopDodgeMax, tagsOf(s).reduce((sum, t) => sum + (t.dodge ?? 0), 0) + shopBonus(s, "dodge"));
}
