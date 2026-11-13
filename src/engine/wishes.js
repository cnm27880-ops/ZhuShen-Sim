// 許願引擎（Phase 3-B）：輪迴者許願 → 玩家答應／拒絕 → 完成或失敗 → 心情狀態。純規則，不碰畫面。
// 種類資料：src/data/wishes.js；數字：CONFIG.wish；日誌：src/data/logs.js（wishAsk_*、wishDone_* …）。
//
// state.wishes：進行中的許願 { id, kind, mode, samsariteId, createdDay, deadlineDay, status, params, text }
//   status "pending" = 還沒回覆（畫面會跳彈窗）；"active" = 已答應、等完成
// 輪迴者身上：s.mood = { kind: "happy"|"upset", daysLeft } 或 null；s.vacationDays = 剩幾天假

import { CONFIG } from "../data/config.js";
import { WISHES, getWish } from "../data/wishes.js";
import { DUNGEONS, getDungeon } from "../data/dungeons.js";
import { SHOP_ITEMS, getShopItem } from "../data/shop.js";
import { randInt, pick, rand, weighted } from "./rng.js";
import { emit, currentDay, spend, canAfford, getSamsarite, shopTier } from "./core.js";
import { logText } from "./templates.js";

const W = () => CONFIG.wish;

export const wishesOf = (state, id) => (state.wishes ?? []).filter((w) => w.samsariteId === id);
export const pendingWishes = (state) => (state.wishes ?? []).filter((w) => w.status === "pending");
export const getWishById = (state, id) => (state.wishes ?? []).find((w) => w.id === id);
export const isOnVacation = (s) => (s.vacationDays ?? 0) > 0;

/** 文字模板用的變數（也給畫面彈窗填 costDesc／doneDesc） */
export function wishVars(state, w) {
  const s = getSamsarite(state, w.samsariteId);
  const item = getShopItem(w.params.itemId);
  const def = getWish(w.kind);
  return {
    A: s,
    wish: def?.name ?? "?",
    cost: w.params.cost,
    rest: w.params.rest,
    dungeon: getDungeon(w.params.dungeonId)?.name,
    item: item?.name,
    price: item?.price,
  };
}

// ───────── 許願的產生 ─────────

/** 這個人現在能許什麼願：回傳 [{ def, weight, params }] */
function possibleWishes(state, s) {
  const out = [];
  for (const def of WISHES) {
    const k = W().kinds[def.id];
    if (!k) continue;
    if (def.mode === "pay") out.push({ def, weight: k.weight, params: { cost: randInt(state, ...k.cost) } });
    else if (def.mode === "rest") out.push({ def, weight: k.weight, params: { rest: randInt(state, ...k.restDays) } });
    else if (def.mode === "dungeon") {
      const options = DUNGEONS.filter((d) => d.recommendedPower <= W().dungeonPowerCap);
      if (options.length > 0) out.push({ def, weight: k.weight, params: { dungeonId: pick(state, options).id } });
    } else if (def.mode === "gear") {
      const tier = shopTier(state);
      const options = SHOP_ITEMS.filter((i) => i.kind === "gear" && i.tier <= tier && s.gear?.[i.slot] !== i.id);
      if (options.length > 0) out.push({ def, weight: k.weight, params: { itemId: pick(state, options).id } });
    }
  }
  return out;
}

/** 每天的「特殊事件」骰中時呼叫：這個人許願了就回傳 true（取代原本的特殊事件） */
export function maybeWish(state, s) {
  state.wishes ??= [];
  if (s.location !== "space" || isOnVacation(s) || wishesOf(state, s.id).length > 0) return false; // 每人同時最多 1 個許願
  if (rand(state) >= W().chance) return false;
  const choices = possibleWishes(state, s);
  if (choices.length === 0) return false;
  const hit = weighted(state, choices);
  const day = currentDay(state);
  const wish = {
    id: state.nextWishId++,
    kind: hit.def.id,
    mode: hit.def.mode,
    samsariteId: s.id,
    createdDay: day,
    deadlineDay: day + W().kinds[hit.def.id].days,
    status: "pending",
    params: hit.params,
    text: "",
  };
  wish.text = logText(state, `wishAsk_${hit.def.id}`, wishVars(state, wish));
  state.wishes.push(wish);
  emit(state, "wish", wish.text, { wishId: wish.id, samsariteId: s.id });
  return true;
}

// ───────── 回覆許願 ─────────

/** 答應得起嗎？ */
export function checkAccept(state, w) {
  if (!w || w.status !== "pending") return { ok: false, reason: "這個許願已經處理過了" };
  if (w.mode === "pay" && !canAfford(state, w.params.cost)) return { ok: false, reason: "積分不夠（連主神高利貸都借不到）" };
  return { ok: true };
}

export function acceptWish(state, wishId) {
  const w = getWishById(state, wishId);
  const check = checkAccept(state, w);
  if (!check.ok) return check;
  const s = getSamsarite(state, w.samsariteId);
  const vars = wishVars(state, w);
  emit(state, "wishAccept", logText(state, "wishAccept", vars));
  w.status = "active";
  if (w.mode === "pay") {
    spend(state, w.params.cost);
    completeWish(state, w);
  } else if (w.mode === "rest") {
    s.vacationDays = w.params.rest; // 休假期間不能派遣，維持費照付（人在主神空間本來就要付）
  }
  return { ok: true };
}

export function refuseWish(state, wishId) {
  const w = getWishById(state, wishId);
  if (!w || w.status !== "pending") return { ok: false, reason: "這個許願已經處理過了" };
  failWish(state, w, "wishRefuse");
  return { ok: true };
}

// ───────── 完成／失敗／心情 ─────────

function removeWish(state, w) {
  state.wishes = state.wishes.filter((x) => x.id !== w.id);
}

export function setMood(state, s, kind) {
  const m = W().moods[kind];
  s.mood = { kind, daysLeft: m.days };
  if (m.sanityLoss) s.stats.sanity = Math.max(0, s.stats.sanity - m.sanityLoss);
  const key = kind === "happy" ? "moodHappy" : "moodUpset";
  const pct = Math.round(Math.abs(m.passBonus ?? m.powerPct ?? 0) * 100);
  return logText(state, key, { A: s, days: m.days, pct, san: m.sanityLoss ?? 0 });
}

export function completeWish(state, w) {
  const s = getSamsarite(state, w.samsariteId);
  removeWish(state, w);
  if (!s) return;
  const text = logText(state, `wishDone_${w.kind}`, wishVars(state, w)) + "\n" + setMood(state, s, "happy");
  emit(state, "wishDone", text, { samsariteId: s.id });
}

/** logKey：wishRefuse（拒絕）、wishTimeout（超時）、wishFlop（想去副本卻沒通關） */
export function failWish(state, w, logKey) {
  const s = getSamsarite(state, w.samsariteId);
  removeWish(state, w);
  if (!s) return;
  const text = logText(state, logKey, wishVars(state, w)) + "\n" + setMood(state, s, "upset");
  emit(state, "wishFail", text, { samsariteId: s.id });
}

/** 人死了或被回收：他的許願直接取消，不扣心情 */
export function cancelWishesOf(state, id) {
  state.wishes = (state.wishes ?? []).filter((w) => w.samsariteId !== id);
}

// ───────── 掛鉤：副本結算、商店購買、每日結算 ─────────

/** 副本結算時呼叫：partyIds 是出征名單，survivorIds 是活著回來的人 */
export function wishesAfterRun(state, dungeonId, success, partyIds, survivorIds) {
  for (const w of [...(state.wishes ?? [])]) {
    if (w.mode !== "dungeon" || w.status !== "active" || w.params.dungeonId !== dungeonId) continue;
    if (!partyIds.includes(w.samsariteId) || !survivorIds.includes(w.samsariteId)) continue; // 死了的許願已被取消
    if (success) completeWish(state, w);
    else failWish(state, w, "wishFlop");
  }
}

/** 買了裝備之後呼叫：剛好是他許的那件就完成 */
export function wishesAfterBuy(state, s, item) {
  for (const w of [...wishesOf(state, s.id)]) {
    if (w.mode === "gear" && w.status === "active" && w.params.itemId === item.id) completeWish(state, w);
  }
}

/** 跨日時呼叫（在維持費結算之後、關係事件之前）：心情倒數、休假倒數、許願超時 */
export function dailyWishes(state) {
  const day = currentDay(state);
  for (const s of state.samsarites) {
    if (s.mood && --s.mood.daysLeft <= 0) s.mood = null;
  }
  for (const s of [...state.samsarites]) {
    if (!isOnVacation(s)) continue;
    if (--s.vacationDays <= 0) {
      s.vacationDays = 0;
      const w = wishesOf(state, s.id).find((x) => x.mode === "rest" && x.status === "active");
      if (w) completeWish(state, w);
    }
  }
  for (const w of [...(state.wishes ?? [])]) {
    if (w.mode === "rest" && w.status === "active") continue; // 休假中不算超時
    if (day >= w.deadlineDay) failWish(state, w, "wishTimeout");
  }
}
