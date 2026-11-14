// 商店引擎（Phase 3-A）：階層解鎖、買東西（裝備、藥水；Phase 4-B 起強化改成個人強化，見 growth.js）、副本特殊獎勵（收藏）的效果。純規則，不碰畫面。
// 商品資料在 src/data/shop.js，特殊獎勵資料在 src/data/dungeons.js；要加東西只改資料表。

import { CONFIG, INJURIES } from "../data/config.js";
import { SHOP_ITEMS, SHOP_SLOT_LABELS, getShopItem } from "../data/shop.js";
import { getSpecialReward } from "../data/dungeons.js";
import { emit, spend, canAfford, getSamsarite, setInjury, shopTier } from "./core.js";
import { logText } from "./templates.js";
import { wishesAfterBuy } from "./wishes.js";

export { shopTier };

/** 下一階還差多少累積花費。已經是最高階就回傳 null */
export function nextTierInfo(state) {
  const tier = shopTier(state);
  const need = CONFIG.shopTierUnlock[tier]; // 索引 tier = 下一階
  return need === undefined ? null : { tier: tier + 1, need, remaining: Math.max(0, need - state.totalSpent) };
}

export function shopItemsOfTier(tier) {
  return SHOP_ITEMS.filter((i) => i.tier === tier);
}

/** 這件商品對這個人能不能買？回傳 { ok, reason } */
export function checkBuy(state, item, s) {
  if (!item) return { ok: false, reason: "沒有這個商品" };
  if (item.tier > shopTier(state)) {
    return { ok: false, reason: `Tier ${item.tier} 還沒解鎖（累積花費 ${CONFIG.shopTierUnlock[item.tier - 1]} 分）` };
  }
  if (!s) return { ok: false, reason: "請先選一個人" };
  if (s.location !== "space") return { ok: false, reason: `${s.name} 在副本裡` };
  if (!canAfford(state, item.price)) return { ok: false, reason: "積分不夠（連主神高利貸都借不到）" };
  if (item.kind === "gear" && s.gear?.[item.slot] === item.id) return { ok: false, reason: `${s.name} 已經裝備了${item.name}` };
  if (item.kind === "potion") {
    if (item.effect.heal && s.injury === 0) return { ok: false, reason: `${s.name} 沒有受傷` };
    if (item.effect.sanity && !item.effect.heal && s.stats.sanity >= 100) return { ok: false, reason: `${s.name} 的理智已經滿了` };
  }
  return { ok: true };
}

/** 買東西並套用在 targetId 身上。回傳 { ok, reason } */
export function buyItem(state, itemId, targetId) {
  const item = getShopItem(itemId);
  const s = getSamsarite(state, targetId);
  const check = checkBuy(state, item, s);
  if (!check.ok) return check;
  spend(state, item.price); // 階層解鎖的日誌由 core.spend 負責
  const vars = { A: s, item: item.name, cost: item.price };

  if (item.kind === "gear") {
    s.gear ??= {};
    const old = getShopItem(s.gear[item.slot]);
    s.gear[item.slot] = item.id;
    s.soulbound ??= {};
    s.soulbound[item.slot] = true; // 公庫賞賜：綁定，輪迴者自己逛街不會覆蓋（4-D-1）
    s.stats.sanity = Math.min(100, s.stats.sanity + CONFIG.wallet.giftSanity);
    const key = old ? "shopGearSwap" : "shopGear";
    emit(state, "shop", logText(state, key, { ...vars, slot: SHOP_SLOT_LABELS[item.slot], old: old?.name ?? "" }), { samsariteId: s.id });
    wishesAfterBuy(state, s, item); // 他許的就是這件裝備：許願完成
  } else if (item.kind === "potion") {
    if (item.effect.heal) {
      setInjury(s, Math.max(0, s.injury - item.effect.heal));
      emit(state, "shop", logText(state, "shopHeal", { ...vars, injury: INJURIES[s.injury].name }), { samsariteId: s.id });
    }
    if (item.effect.sanity) {
      s.stats.sanity = Math.min(100, s.stats.sanity + item.effect.sanity);
      if (!item.effect.heal) emit(state, "shop", logText(state, "shopCalm", { ...vars, san: item.effect.sanity }), { samsariteId: s.id });
    }
  }
  return { ok: true };
}

// ───────── 副本特殊獎勵（state.collection）的效果 ─────────

/** 把收藏裡所有獎勵的效果加總：{ passBonus, genreBonus: {類型: 加成}, rewardPct, injuryShield } */
export function collectionEffects(state) {
  const total = { passBonus: 0, genreBonus: {}, rewardPct: 0, injuryShield: 0 };
  for (const id of state.collection ?? []) {
    const e = getSpecialReward(id)?.effect;
    if (!e) continue;
    total.passBonus += e.passBonus ?? 0;
    total.rewardPct += e.rewardPct ?? 0;
    total.injuryShield += e.injuryShield ?? 0;
    for (const [genre, v] of Object.entries(e.genreBonus ?? {})) total.genreBonus[genre] = (total.genreBonus[genre] ?? 0) + v;
  }
  return total;
}

/** 收藏對某個副本「單房通過率」的加成（全域 + 該副本類型） */
export function collectionPassBonus(state, dungeon) {
  const e = collectionEffects(state);
  return e.passBonus + (e.genreBonus[dungeon.genre] ?? 0);
}
