// 人物傳記（功能 5）：一生大事記、關係摘要、成就，以及死亡時存下的傳記快照。純規則，不碰畫面。
// 大事記存在每個輪迴者身上 s.life = [{ day, kind, text }]（最多 LIFE_MAX 條，超過就丟最舊的、但永遠保留出生那條）。
// 「第一次…」靠 s.lifeFlags 防重複（舊存檔沒有就當空物件）。

import { CONFIG, INJURIES } from "../data/config.js";
import { getTag } from "../data/tags.js";
import { ACHIEVEMENTS } from "../data/achievements.js";
import { SHOP_SLOT_LABELS, getShopItem } from "../data/shopItems.js";
import { currentDay } from "./core.js";
import { effectivePower } from "./tags.js";

export const LIFE_MAX = 60;

/** 寫一條大事記 */
export function addLife(state, s, kind, text) {
  if (!s) return null;
  const list = (s.life ??= []);
  const entry = { day: currentDay(state), kind, text };
  list.push(entry);
  if (list.length > LIFE_MAX) list.splice(1, list.length - LIFE_MAX); // 保留第 1 條（出生／到職），丟最舊的中段
  return entry;
}

/** 「第一次…」只記一次：同一個 flag 之後再呼叫不會再寫 */
export function addLifeOnce(state, s, flag, kind, text) {
  if (!s) return null;
  const flags = (s.lifeFlags ??= {});
  if (flags[flag]) return null;
  flags[flag] = true;
  return addLife(state, s, kind, text);
}

const PARTNER_STATUS = new Set(["lover", "soulmate"]);

/** 把某個人的關係整理成名字（別人已經不在名冊就略過） */
function relationsOf(state, s) {
  const byId = new Map(state.samsarites.map((o) => [o.id, o]));
  const rows = [];
  for (const [key, r] of Object.entries(state.relations ?? {})) {
    const [a, b] = key.split(">").map(Number);
    if (a !== s.id) continue;
    const other = byId.get(b);
    if (other) rows.push({ other, love: r.love ?? 0, hate: r.hate ?? 0, status: r.status });
  }
  const partnerRow = rows.find((r) => PARTNER_STATUS.has(r.status));
  const likes = rows.filter((r) => r.love >= CONFIG.relations.likeAt && !PARTNER_STATUS.has(r.status)).sort((x, y) => y.love - x.love).slice(0, 3);
  const dislikes = rows.filter((r) => r.hate >= CONFIG.relations.dislikeAt && r.status !== "nemesis").sort((x, y) => y.hate - x.hate).slice(0, 3);
  return {
    partner: partnerRow ? { name: partnerRow.other.name, status: partnerRow.status } : null,
    likes: likes.map((r) => ({ name: r.other.name, love: r.love })),
    dislikes: dislikes.map((r) => ({ name: r.other.name, hate: r.hate })),
    nemeses: rows.filter((r) => r.status === "nemesis").map((r) => r.other.name),
    mentor: null, // 師徒關係系統還沒有（缺功能，不是 Bug），先留欄位讓畫面顯示「尚無」
  };
}

/** 目前身上的狀態字串（傷勢、心情、放假、被奪走裝備…） */
function statusesOf(state, s) {
  const out = [];
  if (s.injury > 0) out.push({ text: INJURIES[s.injury].name, tone: "bad" });
  const m = CONFIG.wish.moods[s.mood?.kind];
  if (m) out.push({ text: `${m.icon} ${m.label}（${s.mood.daysLeft} 天）`, tone: s.mood.kind === "upset" ? "bad" : "good" });
  if (s.stripped && currentDay(state) <= s.stripped.untilDay) out.push({ text: `被奪走裝備（${s.stripped.item}），不開心`, tone: "bad" });
  if (s.vacationDays > 0) out.push({ text: `🏖️ 放假中（${s.vacationDays} 天）`, tone: "" });
  if (s.podLockDays > 0) out.push({ text: `🛏️ 休眠艙（${s.podLockDays} 天）`, tone: "" });
  if (s.locked) out.push({ text: "🔒 已鎖定", tone: "" });
  return out;
}

/**
 * 一個人的傳記資料（純資料，沒有引用別的物件，死亡時可以直接存進墓園）。
 * extra：死亡時補 { alive: false, deathDay, cause }。
 */
export function bioOf(state, s, extra = {}) {
  const children = [
    ...state.samsarites.filter((o) => (o.parents ?? []).includes(s.id)).map((o) => ({ name: o.name, alive: true })),
    ...(state.graveyard ?? []).filter((g) => (g.bio?.parentIds ?? []).includes(s.id)).map((g) => ({ name: g.name, alive: false })),
  ];
  const parentNames = (s.parents ?? [])
    .map((id) => state.samsarites.find((o) => o.id === id)?.name ?? (state.graveyard ?? []).find((g) => g.bio?.id === id)?.name)
    .filter(Boolean);
  const bio = {
    id: s.id,
    alive: true,
    name: s.name,
    rank: s.rank,
    generation: s.generation ?? 1,
    geneLock: s.geneLock ?? 0,
    power: effectivePower(s),
    sanity: s.stats.sanity,
    wallet: s.wallet ?? 0,
    runs: s.runs ?? 0,
    kills: s.kills ?? 0,
    joinedDay: s.joinedDay ?? 1,
    injury: s.injury,
    parentIds: s.parents ?? [],
    parentNames,
    tags: (s.tags ?? []).map((id) => getTag(id)).filter(Boolean).map((t) => ({ id: t.id, name: t.name, rarity: t.rarity, desc: t.desc })),
    gear: Object.fromEntries(Object.keys(SHOP_SLOT_LABELS).map((slot) => [slot, getShopItem(s.gear?.[slot])?.name ?? null])),
    relations: relationsOf(state, s),
    children,
    life: (s.life ?? []).map((e) => ({ ...e })),
    statuses: statusesOf(state, s),
    ...extra,
  };
  bio.achievements = ACHIEVEMENTS.filter((a) => a.test({ s: { ...s, runs: bio.runs }, bio })).map(({ id, icon, name, desc }) => ({ id, icon, name, desc }));
  return bio;
}

/** 墓園裡第 index 筆的傳記（沒有就 null）；舊墓園紀錄沒有 bio，補一份簡版 */
export function graveBio(state, index) {
  const g = state.graveyard?.[index];
  if (!g) return null;
  if (g.bio) return g.bio;
  return {
    alive: false, name: g.name, rank: g.rank, generation: 1, geneLock: 0, power: 0, sanity: 0, wallet: 0, runs: 0, kills: 0, joinedDay: 1, injury: 0,
    parentNames: [], tags: [], gear: {}, relations: { partner: null, likes: [], dislikes: [], nemeses: [], mentor: null }, children: [], achievements: [], statuses: [],
    life: [{ day: g.day, kind: "death", text: `${g.cause}。` }], deathDay: g.day, cause: g.cause,
  };
}
