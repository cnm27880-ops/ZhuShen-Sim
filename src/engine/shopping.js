// 輪迴者自主逛街與成長 AI（Phase 4-D-3）。純規則，不碰畫面；數字在 CONFIG.shopping。
// 每日 endOfDay（維持費與休養之後）：所有在主神空間（不在副本、不在催熟艙、沒被鎖進私人休眠艙）且私房錢 > 0 的輪迴者，
// 每人每天最多 2 次「購買／強化」動作，依序判斷：
//   1. 緊急保命：injury >= 2 先買治傷耗材；sanity < 45 先買回理智耗材
//   2. 基礎換裝：缺武器／防具、或裝備階層低於目前已解鎖階層 → 買買得起的最好制式或黑市武防（絕不覆蓋 soulbound 綁定裝備）
//   3. 自主強化／開基因鎖：花私房錢，且花完仍留 20% 備用金
//   4. 性格偏好與敗家搞事：依詞條權重搶購黑市商品；戀愛／偏執／低理智者有 5% 機率偷買 drama（買過後 10 天冷卻） 黑貨對隊友用
// 亂數用獨立流 state.aiShopRngState（數字），不動主亂數。每人最近的自主購買紀錄存在 s.shopLog（最多 CONFIG.shopping.logKeep 筆）。

import { CONFIG } from "../data/config.js";
import { SHOP_ITEMS, getShopItem } from "../data/shopItems.js";
import { rand, pick, weighted } from "./rng.js";
import { currentDay, shopTier } from "./core.js";
import { checkBuy, buyItem } from "./shop.js";
import { marketOf, checkMarketBuy, buyMarketSlot, slotPrice } from "./market.js";
import { enhance, checkEnhance, breakGene, checkBreakGene } from "./growth.js";
import { getRel, pairStatus } from "./relations.js";
import { getTag } from "../data/tags.js";

/** 把 state.aiShopRngState 包成 rand() 吃得下的亂數物件（讀寫都落回 state） */
export function aiRng(state) {
  return {
    get rngState() {
      return state.aiShopRngState;
    },
    set rngState(v) {
      state.aiShopRngState = v;
    },
  };
}

const hasTag = (s, id) => (s.tags ?? []).includes(id);
const DRAMA_TAGS = ["green_tea", "mad_matchmaker", "backstabber", "demon_path", "broken_heart"];

/** 性格上愛搞事的人：有搞事詞條、低理智、有戀人／靈魂伴侶，或對某人好感已達愛慕 */
export function isDramaProne(state, s) {
  const C = CONFIG.shopping;
  if (DRAMA_TAGS.some((t) => hasTag(s, t))) return true;
  if ((s.stats.sanity ?? 100) < C.lowSanity) return true;
  return state.samsarites.some(
    (o) => o.id !== s.id && o.location === "space" && (["lover", "soulmate"].includes(pairStatus(state, s, o)) || getRel(state, s, o).love >= CONFIG.relations.adoreAt)
  );
}

/** 依詞條決定偏好各 aiBuyTag 的權重（戰力詞條愛攻擊、減傷詞條愛保命、通過率詞條愛共用） */
export function buyTagWeights(s) {
  const w = { ...CONFIG.shopping.tagWeight };
  for (const id of s.tags ?? []) {
    const t = getTag(id);
    if (!t) continue;
    if ((t.powerPct ?? 0) > 0) w.aggro *= 2;
    if ((t.injuryShield ?? 0) > 0 || (t.dodge ?? 0) > 0) w.survival *= 2;
    if ((t.passBonus ?? 0) > 0) w.communal *= 2;
  }
  return w;
}

/** 候選：{ src: "shop" | "market", item, price, index? }。只列這個人此刻買得起（私房錢）而且 checkBuy 通過的 */
function offers(state, s, filter, extra = {}) {
  const out = [];
  for (const item of SHOP_ITEMS) {
    if (!filter(item)) continue;
    if ((item.category === "standard" || item.permanent) && checkBuy(state, item, s, { payer: "wallet", ...extra }).ok) out.push({ src: "shop", item, price: item.price });
  }
  marketOf(state).slots.forEach((slot, index) => {
    const item = getShopItem(slot.itemId);
    if (!item || slot.sold || !filter(item)) return;
    if (checkMarketBuy(state, index, s.id, { payer: "wallet", ...extra }).ok) out.push({ src: "market", item, price: slotPrice(state, slot).price, index });
  });
  return out;
}

function logOf(state, s, text) {
  (s.shopLog ??= []).push({ day: currentDay(state), text });
  if (s.shopLog.length > CONFIG.shopping.logKeep) s.shopLog.splice(0, s.shopLog.length - CONFIG.shopping.logKeep);
}

function execute(state, s, offer, extra = {}) {
  const r = offer.src === "market" ? buyMarketSlot(state, offer.index, s.id, { payer: "wallet", ...extra }) : buyItem(state, offer.item.id, s.id, { payer: "wallet", ...extra });
  if (r.ok) logOf(state, s, `買了【${offer.item.name}】（-${offer.price}）`);
  return r.ok;
}

// ───────── 四個優先序 ─────────

function emergency(state, s) {
  if (s.injury >= 2) {
    const heals = offers(state, s, (i) => i.kind === "potion" && i.effect.heal);
    // 能一次治到輕傷以下的優先，其次便宜的
    heals.sort((a, b) => (b.item.effect.heal >= s.injury) - (a.item.effect.heal >= s.injury) || a.price - b.price);
    if (heals[0]) return execute(state, s, heals[0]);
  }
  if ((s.stats.sanity ?? 100) < CONFIG.shopping.calmBelow) {
    const calms = offers(state, s, (i) => i.kind === "potion" && i.effect.sanity && !i.effect.heal);
    calms.sort((a, b) => a.price - b.price);
    if (calms[0]) return execute(state, s, calms[0]);
  }
  return false;
}

function regear(state, s) {
  const tier = shopTier(state);
  for (const slot of ["weapon", "armor"]) {
    if (s.soulbound?.[slot]) continue; // 主管賞賜的綁定裝備絕不覆蓋
    const cur = getShopItem(s.gear?.[slot]);
    if (cur && cur.tier >= tier) continue;
    const better = offers(state, s, (i) => i.kind === "gear" && i.slot === slot && (i.effect.power ?? 0) > (cur?.effect.power ?? -1)).filter((o) => o.item.category !== "contraband");
    better.sort((a, b) => (b.item.effect.power ?? 0) - (a.item.effect.power ?? 0));
    if (better[0] && execute(state, s, better[0])) return true;
  }
  return false;
}

function selfGrow(state, s) {
  const keep = 1 - CONFIG.shopping.reservePct; // 花完仍要留 reservePct 備用金 → 費用 ≤ 私房錢 × 0.8
  const bg = checkBreakGene(state, s.id, { payer: "wallet" });
  if (bg.ok && bg.cost <= s.wallet * keep) {
    breakGene(state, s.id, { payer: "wallet" });
    logOf(state, s, `突破基因鎖（-${bg.cost}）`);
    return true;
  }
  const en = checkEnhance(state, s.id, { payer: "wallet" });
  if (en.ok && en.cost <= s.wallet * keep) {
    enhance(state, s.id, { payer: "wallet" });
    logOf(state, s, `強化（-${en.cost}）`);
    return true;
  }
  return false;
}

function victimFor(state, s, item, rng) {
  const others = state.samsarites.filter((o) => o.id !== s.id && o.location === "space");
  if (others.length === 0) return null;
  const by = (f) => others.reduce((best, o) => (f(o) > f(best) ? o : best), others[0]);
  if (item.effect.loveTo) return by((o) => getRel(state, s, o).love); // 對自己暗戀的人下手
  if (item.effect.forget) return by((o) => getRel(state, s, o).hate + getRel(state, s, o).love);
  return getRel(state, s, by((o) => getRel(state, s, o).hate)).hate > 0 ? by((o) => getRel(state, s, o).hate) : pick(rng, others);
}

function leisure(state, s, ctx) {
  const C = CONFIG.shopping;
  const rng = aiRng(state);
  // 4a. 搞事：愛搞事的人 5% 機率偷買黑貨（近 10 天買過就不擲）
  const cooling = s.lastDramaDay != null && currentDay(state) - s.lastDramaDay < C.dramaCooldownDays; // 近 10 天買過黑貨：不擲骰
  const roll = !ctx.dramaRolled && !cooling && isDramaProne(state, s); // 每人每天只擲一次搞事骰（不論當天有幾次動作）
  ctx.dramaRolled = true;
  if (roll && rand(rng) < C.dramaChance) {
    const slots = marketOf(state).slots.map((slot, index) => ({ slot, index, item: getShopItem(slot.itemId) })).filter((x) => x.item?.kind === "contraband" && !x.slot.sold);
    for (const x of slots) {
      const victim = victimFor(state, s, x.item, rng);
      if (!victim) continue;
      const price = slotPrice(state, x.slot).price;
      if (price > s.wallet * (1 - C.reservePct)) continue;
      if (checkMarketBuy(state, x.index, s.id, { payer: "wallet", victimId: victim.id }).ok) {
        const ok = execute(state, s, { src: "market", item: x.item, price, index: x.index }, { victimId: victim.id });
        if (ok) {
          s.lastDramaDay = currentDay(state);
          return true;
        }
      }
    }
  }
  // 4b. 依性格偏好搶購黑市（非黑貨）：花完仍留備用金
  const w = buyTagWeights(s);
  const cands = offers(state, s, (i) => i.kind !== "contraband")
    .filter((o) => o.src === "market" && o.price <= s.wallet * (1 - C.reservePct))
    .map((o) => ({ ...o, weight: w[o.item.aiBuyTag] ?? 1 }));
  if (cands.length === 0) return false;
  return execute(state, s, weighted(rng, cands));
}

/** 每日結算掛鉤：逐人（依 id 順序，亂數才可重現）自主消費 */
export function dailyShopping(state) {
  const C = CONFIG.shopping;
  let actions = 0;
  const people = [...state.samsarites].filter((s) => s.location === "space" && (s.wallet ?? 0) > 0 && !(s.podLockDays > 0)).sort((a, b) => a.id - b.id);
  for (const s of people) {
    const ctx = { dramaRolled: false };
    for (let n = 0; n < C.maxActionsPerDay; n++) {
      if ((s.wallet ?? 0) <= 0) break;
      const done = emergency(state, s) || regear(state, s) || selfGrow(state, s) || leisure(state, s, ctx);
      if (!done) break;
      actions += 1;
    }
  }
  return actions;
}
