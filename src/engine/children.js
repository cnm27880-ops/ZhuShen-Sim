// 生小孩與主神催熟艙引擎（Phase 3-F，計畫書 §7.1／§7.3／§7.4）。純規則，不碰畫面。
// 數字：CONFIG.child；日誌：src/data/logs.js（birth、hatch）；暫停事件：birth／hatch。
//
// 流程：戀人／靈魂伴侶雙方都在主神空間 → 每天有機率懷上 → 嬰兒直接進催熟艙（location "pod"）
//       → podDays 天後長成輪迴者（location "space"），標籤大部分繼承父母。
// 嬰兒在催熟艙：不能派遣、不參與日常／許願／主神搞事（這些系統本來就只看 location "space"）、
//               每天只吃 CONFIG.child.podUpkeep 分、不能被回收。
// 為了不改變既有的種子結果，這裡用獨立亂數流 state.nursery.rngState（跟主神搞事同樣的做法）。
// 目前只做「輪迴者之間」生小孩；跟副本 NPC 生小孩要等員工合同（計畫 §7.2、§8）。

import { CONFIG, RANKS } from "../data/config.js";
import { getTag } from "../data/tags.js";
import { rand, pick } from "./rng.js";
import { emit, currentDay, createSamsarite, getSamsarite } from "./core.js";
import { pairStatus, addLove } from "./relations.js";
import { logText } from "./templates.js";
import { podDaysCut } from "./facilities.js"; // 同上（4-F-3）
import { popLimit } from "./mandatory.js"; // 人口上限（#14、#23）
import { applyLineage, addChronicle } from "./lineage.js"; // 世代、天賦封頂、編年史（4-E-4；循環引用只在執行時呼叫）

const C = () => CONFIG.child;

/** 全新的生小孩狀態（新遊戲、舊存檔補欄位時用） */
export function newNurseryState(seed = 0) {
  return { rngState: (seed ^ 0xb4b1) | 0 };
}

const nursery = (state) => (state.nursery ??= newNurseryState(state.rngState));
export const podBabies = (state) => state.samsarites.filter((s) => s.location === "pod");

/** 催熟艙裡所有嬰兒今天的維持費總和（core.endOfDay 會加進帳單） */
export function podCost(state) {
  return podBabies(state).length * C().podUpkeep;
}

const pairKey = (a, b) => (a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`);
const tagName = (id) => getTag(id)?.name ?? id;

/**
 * 每天結算時呼叫（在關係事件之後）：
 * 先讓催熟艙倒數（今天剛出生的不算），再擲新生兒。
 */
export function dailyNursery(state) {
  if (state.gameOver) return;
  for (const baby of podBabies(state)) {
    baby.podDaysLeft = Math.max(0, baby.podDaysLeft - 1);
    if (baby.podDaysLeft <= 0) hatch(state, baby); // 人數已滿時 hatch 不會出艙，嬰兒留在艙裡隔天再試（#23）
  }

  const g = nursery(state);
  const day = currentDay(state);
  const list = state.samsarites;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const [a, b] = [list[i], list[j]];
      const chance = C().chance[pairStatus(state, a, b)];
      if (!chance || a.location !== "space" || b.location !== "space") continue;
      if (podBabies(state).length >= C().maxInPod) return; // 催熟艙滿了：今天不再生
      if (headcount(state) >= popLimit(state)) return; // 空間人數已達上限：不再生（#14，與 lineageBlock 一致）
      if ((state.cooldowns?.[`birth:${pairKey(a, b)}`] ?? 0) > day) continue;
      if (rand(g) < chance) giveBirth(state, a, b);
    }
  }
}

/**
 * 兩位家長生出一個嬰兒，放進催熟艙（測試可以直接呼叫）。
 * opts（4-E-4 跨代子嗣用）：rng 亂數流（預設催熟艙自己的）、podDays 培育天數、cooldownDays 同一對冷卻、lineage 為 true 時保證繼承一個家長性格詞條
 */
export function giveBirth(state, a, b, opts = {}) {
  const g = opts.rng ?? nursery(state);
  state.cooldowns ??= {};
  state.cooldowns[`birth:${pairKey(a, b)}`] = currentDay(state) + (opts.cooldownDays ?? CONFIG.lineage.cooldownDays) // 3-F 與 4-E 共用同一把雙親冷卻鎖（4-E-7）;

  // 階級：隨機一位家長的階級，有機會再升一階（最高 S）
  const ranks = Object.keys(RANKS);
  let at = ranks.indexOf(pick(g, [a, b]).rank);
  if (rand(g) < C().rankUpChance) at = Math.min(ranks.length - 1, at + 1);

  const child = createSamsarite(state, ranks[at], g); // 先照一般規則抽（名字、數值、標籤），再套繼承
  child.tags = inheritTags(g, child.tags, [a, b]);
  child.inheritedTags = child.tags.filter((t) => a.tags.includes(t) || b.tags.includes(t));
  child.location = "pod";
  child.podDaysLeft = Math.max(1, Math.round((opts.podDays ?? C().podDays) * (1 - podDaysCut(state)))); // 萬界育嬰堂縮短培育期（4-F-3）
  child.parents = [a.id, b.id];
  child.joinedDay = currentDay(state);
  applyLineage(state, child, [a, b], g, !!opts.lineage, opts.talent ?? "normal"); // 世代、天賦白值（總封頂 +25%）、保證繼承性格詞條（4-E-4）
  state.samsarites.push(child);

  // 家人之間有一點好感（不到「喜歡」，不會直接變成出征加成）
  for (const p of [a, b]) {
    addLove(state, p, child, C().familyLove);
    addLove(state, child, p, C().familyLove);
  }
  const text = logText(state, "birth", { A: a, B: b, C: child, rank: child.rank, days: child.podDaysLeft });
  emit(state, "birth", text, { samsariteId: child.id });
  addChronicle(state, "birth", `第 ${child.generation} 代：${text}`);
  return child;
}

/** 每個標籤欄位有 inheritChance 的機率改成父母同類（stat／trait／soul）的標籤，不重複 */
function inheritTags(g, rolled, parents) {
  const out = [...rolled];
  out.forEach((id, i) => {
    const kind = getTag(id)?.kind;
    const pool = parents
      .flatMap((p) => p.tags)
      .filter((t) => getTag(t)?.kind === kind && !out.includes(t));
    if (pool.length > 0 && rand(g) < C().inheritChance) out[i] = pick(g, pool);
  });
  return out;
}

/** 催熟完成：嬰兒長成 18 歲青壯年，成為可用的輪迴者 */
export function hatch(state, baby) {
  if (headcount(state) >= popLimit(state)) return false; // #23：人口已滿，嬰兒暫留艙內（podDaysLeft 保持 0），之後再試
  baby.location = "space";
  baby.podDaysLeft = 0;
  const names = (baby.inheritedTags ?? []).map(tagName).map((n) => `【${n}】`);
  emit(
    state,
    "hatch",
    logText(state, names.length > 0 ? "hatch" : "hatchPlain", { C: baby, rank: baby.rank, tags: names.join("與"), days: C().podDays }),
    { samsariteId: baby.id }
  );
  return true;
}

/** 在主神空間系統裡的人數（不含催熟艙嬰兒） */
const headcount = (state) => state.samsarites.filter((s) => s.location !== "pod").length;

/** 給畫面用：家長的名字（家長已經不在世就省略） */
export function parentNames(state, s) {
  return (s.parents ?? []).map((id) => getSamsarite(state, id)?.name).filter(Boolean);
}
