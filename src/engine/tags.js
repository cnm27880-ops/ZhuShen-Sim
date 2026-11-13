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

/** 商店強化 + 裝備加在某個數值（power / injuryShield / dodge）上的總和 */
export function shopBonus(s, key) {
  const upgrade = s.upgrades?.[key] ?? 0;
  const gear = Object.values(s.gear ?? {}).reduce((n, id) => n + (getShopItem(id)?.effect?.[key] ?? 0), 0);
  return upgrade + gear;
}

/** 套上強化、裝備、標籤後的戰力（基礎戰力 stats.power 不會被改動）：(基礎 + 強化 + 裝備) × (1 + 標籤%) */
export function effectivePower(s) {
  const pct = tagsOf(s).reduce((sum, t) => sum + (t.powerPct ?? 0), 0);
  return Math.max(1, Math.round((s.stats.power + shopBonus(s, "power")) * (1 + pct)));
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
