// 詞條庫（懸浮球圖鑑）用的資料整理：好壞標示、類別名稱、關卡詞條的克制／優勢關係。
// 好壞「不是人工標的」，是照 tags.js 的數值欄位機械判定（規則見 toneOf），所以資料表一改，這裡自動跟著變。
// 若之後哈基米補標了好壞，在 tags.js 的標籤上加 `tone: "good"|"bad"|"mixed"|"neutral"` 就會優先採用。

import { TAGS, ACQUIRED_TAGS, ENV_TAGS } from "./tags.js";

export const TONE_LABEL = { good: "好", bad: "壞", mixed: "看情況", neutral: "中性" };
export const KIND_LABEL = { stat: "基礎", trait: "人格", soul: "靈魂核心", acquired: "事件獲得" };
export const RARITIES = ["N", "R", "SR", "SSR", "UR"];

/** 這個標籤所有數值效果的正負：回傳 { pos, neg } */
function signs(t) {
  let pos = 0;
  let neg = 0;
  const add = (v) => {
    if (typeof v !== "number" || v === 0) return;
    if (v > 0) pos++;
    else neg++;
  };
  add(t.powerPct);
  add(t.passBonus);
  add(t.rewardPct);
  add(t.injuryShield);
  add(t.dodge);
  for (const v of Object.values(t.genreBonus ?? {})) add(v);
  for (const v of Object.values(t.envBonus ?? {})) add(v);
  if (typeof t.loveGainMult === "number" && t.loveGainMult !== 1) add(t.loveGainMult - 1);
  if (t.swing) {
    pos++; // 賭徒標籤：通過率隨機浮動，同時有好有壞
    neg++;
  }
  return { pos, neg };
}

/** 好壞：只有正面 = good；只有負面 = bad；有正有負 = mixed（看情況）；沒有任何數值效果 = neutral */
export function toneOf(t) {
  if (t.tone) return t.tone;
  const { pos, neg } = signs(t);
  if (pos && neg) return "mixed";
  if (pos) return "good";
  if (neg) return "bad";
  return "neutral";
}

/** 所有人物詞條（抽卡標籤＋事件獲得標籤） */
export const PERSON_TAGS = [...TAGS, ...ACQUIRED_TAGS];

/** 關卡詞條的克制關係：它克誰（讓哪些人物詞條通過率下降）、誰克它（哪些人物詞條在這個環境加成） */
export function envRelations(envId) {
  const counters = []; // 誰克它：envBonus > 0
  const victims = []; // 它克誰：envBonus < 0
  for (const t of PERSON_TAGS) {
    const v = t.envBonus?.[envId];
    if (!v) continue;
    (v > 0 ? counters : victims).push({ tag: t, value: v });
  }
  return { counters, victims };
}

export const ENV_LIST = ENV_TAGS;
