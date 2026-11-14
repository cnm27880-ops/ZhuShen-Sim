// 理智引擎（Phase 4-C-2）：理智歸零的跨日暴走。純規則，不碰畫面。
// 戰力／內鬥的理智檔位在 engine/tags.js（sanityPowerPct／sanityClashMult）；扣理智的來源在 dungeon.js（單房失敗、同隊戰死）；
// 休息日自然恢復在 core.js 的 endOfDay。數字全在 CONFIG.sanity。
// 用 state.sanity.rngState 獨立亂數流，不動主亂數。

import { CONFIG } from "../data/config.js";
import { rand, pick } from "./rng.js";
import { emit, setInjury } from "./core.js"; // 循環引用：只在執行時呼叫，載入時不碰
import { logText } from "./templates.js";

export function newSanityState(seed = 0) {
  return { rngState: (seed ^ 0x5a17) | 0 };
}

const stream = (state) => (state.sanity ??= newSanityState(state.rngState));

/** 傷勢 +1，最高致命傷（不會因此死亡） */
function hurtOne(s) {
  setInjury(s, Math.min(3, s.injury + 1));
}

/**
 * 日結算：留在主神空間、理智剛好 0 的人暴走。
 *  - 50%：入魔砍傷隨機一位同在空間的人（對方傷勢 +1），自己得到「走火入魔」標籤
 *  - 50%（或空間裡沒有其他人）：自殘（自己傷勢 +1）
 * 發作後理智回升到 crashRecoverTo。要在 endOfDay 的「休息恢復」之前呼叫，歸零的人才不會先被補一點而躲過。
 */
export function dailySanity(state) {
  const rng = stream(state);
  const crashing = state.samsarites.filter((s) => s.location === "space" && s.stats.sanity === 0);
  for (const s of crashing) {
    const others = state.samsarites.filter((o) => o.id !== s.id && o.location === "space");
    if (others.length > 0 && rand(rng) < CONFIG.sanity.crashDemonChance) {
      const victim = pick(rng, others);
      hurtOne(victim);
      s.tags ??= [];
      if (!s.tags.includes("demon_path")) s.tags.push("demon_path");
      emit(state, "sanityCrash", logText(state, "sanityCrashDemon", { A: s, B: victim, injury: victim.injury }), { samsariteId: s.id });
    } else {
      hurtOne(s);
      emit(state, "sanityCrash", logText(state, "sanityCrashSelf", { A: s }), { samsariteId: s.id });
    }
    s.stats.sanity = CONFIG.sanity.crashRecoverTo;
  }
}
