// 商店引擎（Phase 3-A；4-D-2 重構）：階層解鎖、買東西（制式武防、耗材、黑貨、特產裝備與血統）、副本特殊獎勵（收藏）的效果。純規則，不碰畫面。
// 商品資料在 src/data/shopItems.js，特殊獎勵資料在 src/data/dungeons.js；要加東西只改資料表。
//
// 付費者（opts.payer）：
//   "treasury"（預設）  主神公庫 state.points：「主動賞賜」。買裝備 → 綁定（soulbound）並讓該角色理智 +5。
//   "wallet"            輪迴者自己的私房錢 s.wallet：「自主逛街」（engine/shopping.js）；不綁定，不能覆蓋已綁定的裝備。
// 不論誰付錢，花費一律累加進 state.totalSpent（商店階層解鎖用）。
// 來源（opts.source）："shop" 常駐制式商店只賣 standard 與 permanent 耗材；"market" 黑市由 engine/market.js 傳入（可買任何商品、可帶折扣價 opts.price）。

import { noteContraband } from "./squad.js"; // 黑貨使用紀錄（4-E-3；循環引用只在執行時呼叫）
import { CONFIG, INJURIES } from "../data/config.js";
import { SHOP_ITEMS, SHOP_SLOT_LABELS, getShopItem } from "../data/shopItems.js";
import { getSpecialReward } from "../data/dungeons.js";
import { emit, spend, spendWallet, canAfford, getSamsarite, setInjury, shopTier } from "./core.js";
import { addLove, addHate, resetPair } from "./relations.js";
import { logText } from "./templates.js";
import { wishesAfterBuy } from "./wishes.js";

export { shopTier };

/** 下一階還差多少累積花費。已經是最高階就回傳 null */
export function nextTierInfo(state) {
  const tier = shopTier(state);
  const need = CONFIG.shopTierUnlock[tier]; // 索引 tier = 下一階
  return need === undefined ? null : { tier: tier + 1, need, remaining: Math.max(0, need - state.totalSpent) };
}

/** 常駐商店賣的商品：制式武防 + 常備耗材（permanent）。tier 省略 = 全部階層 */
export function shopItemsOfTier(tier = null) {
  return SHOP_ITEMS.filter((i) => (tier === null || i.tier === tier) && isPermanent(i));
}
export const isPermanent = (item) => item.category === "standard" || !!item.permanent;

/** 這件商品對這個人能不能買？回傳 { ok, reason }。opts：{ payer, price, source, victimId } */
export function checkBuy(state, item, s, opts = {}) {
  if (!item) return { ok: false, reason: "沒有這個商品" };
  const payer = opts.payer ?? "treasury";
  const price = opts.price ?? item.price;
  if (item.tier > shopTier(state)) {
    return { ok: false, reason: `Tier ${item.tier} 還沒解鎖（累積花費 ${CONFIG.shopTierUnlock[item.tier - 1]} 分）` };
  }
  if ((opts.source ?? "shop") === "shop" && !isPermanent(item)) return { ok: false, reason: "這件商品只在黑市出現" };
  if (!s) return { ok: false, reason: "請先選一個人" };
  if (s.location !== "space") return { ok: false, reason: `${s.name} 在副本裡` };
  if (payer === "wallet") {
    if ((s.wallet ?? 0) < price) return { ok: false, reason: `${s.name} 的私房錢不夠` };
  } else if (!canAfford(state, price)) return { ok: false, reason: "積分不夠（連主神高利貸都借不到）" };
  if (item.kind === "gear") {
    if (s.gear?.[item.slot] === item.id) return { ok: false, reason: `${s.name} 已經裝備了${item.name}` };
    if (payer === "wallet" && s.soulbound?.[item.slot]) return { ok: false, reason: `${s.name} 的${SHOP_SLOT_LABELS[item.slot]}是主管賞賜的綁定裝備` };
  } else if (item.kind === "potion") {
    if (item.effect.heal && s.injury === 0) return { ok: false, reason: `${s.name} 沒有受傷` };
    if (item.effect.sanity && !item.effect.heal && s.stats.sanity >= 100) return { ok: false, reason: `${s.name} 的理智已經滿了` };
    if (item.effect.extendMandatory && !state.mandatory?.pending) return { ok: false, reason: "目前沒有待派的強制任務" };
  } else if (item.kind === "buff") {
    if ((s.consumables?.length ?? 0) >= CONFIG.shop.consumableCap) return { ok: false, reason: `${s.name} 的出征耗材已經囤滿（${CONFIG.shop.consumableCap} 份）` };
  } else if (item.kind === "contraband") {
    const victim = getSamsarite(state, opts.victimId);
    if (!victim) return { ok: false, reason: "請選一個對象" };
    if (victim.id === s.id) return { ok: false, reason: "對象不能是自己" };
    if (victim.location !== "space") return { ok: false, reason: `${victim.name} 在副本裡` };
  }
  return { ok: true };
}

/** 買東西並套用在 targetId 身上（黑貨：targetId = 使用者 A，opts.victimId = 對象 B）。回傳 { ok, reason, price } */
export function buyItem(state, itemId, targetId, opts = {}) {
  const item = getShopItem(itemId);
  const s = getSamsarite(state, targetId);
  const check = checkBuy(state, item, s, opts);
  if (!check.ok) return check;
  const payer = opts.payer ?? "treasury";
  const price = opts.price ?? item.price;
  if (payer === "wallet") spendWallet(state, s, price);
  else spend(state, price); // 階層解鎖的日誌由 core.addSpent 負責
  const vars = { A: s, item: item.name, cost: price };
  const self = payer === "wallet";
  const selfLog = () => emit(state, "shop", logText(state, "shopSelf", { ...vars, left: s.wallet }), { samsariteId: s.id });

  if (item.kind === "gear") {
    s.gear ??= {};
    s.soulbound ??= {};
    const old = getShopItem(s.gear[item.slot]);
    s.gear[item.slot] = item.id;
    if (s.heirloomSlots) delete s.heirloomSlots[item.slot]; // 換掉裝備就不再是先人遺物（4-E-4）
    if (self) {
      delete s.soulbound[item.slot]; // 自己買的不綁定
      selfLog();
    } else {
      s.soulbound[item.slot] = true; // 公庫賞賜：綁定，輪迴者自己逛街不會覆蓋（4-D-1）
      s.stats.sanity = Math.min(100, s.stats.sanity + CONFIG.wallet.giftSanity);
      emit(state, "shop", logText(state, old ? "shopGearSwap" : "shopGear", { ...vars, slot: SHOP_SLOT_LABELS[item.slot], old: old?.name ?? "" }), { samsariteId: s.id });
      wishesAfterBuy(state, s, item); // 他許的就是這件裝備：許願完成
    }
  } else if (item.kind === "potion") {
    if (self) selfLog();
    if (item.effect.heal) {
      setInjury(s, Math.max(0, s.injury - item.effect.heal));
      if (!self) emit(state, "shop", logText(state, "shopHeal", { ...vars, injury: INJURIES[s.injury].name }), { samsariteId: s.id });
    }
    if (item.effect.sanity) {
      s.stats.sanity = Math.min(100, s.stats.sanity + item.effect.sanity);
      if (!item.effect.heal && !self) emit(state, "shop", logText(state, "shopCalm", { ...vars, san: item.effect.sanity }), { samsariteId: s.id });
    }
    if (item.effect.extendMandatory) {
      state.mandatory.pending.deadlineDay += item.effect.extendMandatory;
      emit(state, "shop", logText(state, "shopExtend", { ...vars, days: item.effect.extendMandatory }), { samsariteId: s.id });
    }
  } else if (item.kind === "buff") {
    (s.consumables ??= []).push(item.id);
    if (self) selfLog();
    else emit(state, "shop", logText(state, "shopBuff", vars), { samsariteId: s.id });
  } else if (item.kind === "contraband") {
    applyContraband(state, item, s, getSamsarite(state, opts.victimId), price);
  }
  return { ok: true, price };
}

/** 狗血黑貨的效果（使用者 a、對象 b） */
function applyContraband(state, item, a, b, price) {
  const e = item.effect;
  noteContraband(state, a, b, item); // 留下紀錄，4-E-3 的「黑貨事發對質」會翻出來
  const vars = { A: a, B: b, item: item.name, cost: price };
  if (e.loveTo) {
    addLove(state, b, a, e.loveTo); // 單向：b 對 a 的好感（a 對 b 不變）
    emit(state, "social", logText(state, "contraLove", { ...vars, n: e.loveTo }), { samsariteId: a.id });
  } else if (e.forget) {
    resetPair(state, a, b);
    emit(state, "social", logText(state, "contraForget", vars), { samsariteId: a.id });
  } else if (e.doll) {
    for (const o of state.samsarites) {
      if (o.id === b.id || o.location !== "space") continue;
      addLove(state, o, b, -e.doll);
      addHate(state, o, b, Math.round(e.doll / 2));
    }
    emit(state, "scheme", logText(state, "contraDoll", vars), { samsariteId: a.id });
  } else if (e.podLock) {
    b.lockedInPodBy = a.id;
    b.podLockDays = e.podLock;
    emit(state, "scheme", logText(state, "contraPod", { ...vars, days: e.podLock }), { samsariteId: a.id });
  }
}

// ───────── 出征耗材（單場 buff）─────────

/** 出發時呼叫：把緩衝區裡所有 buff 耗材加總成這一場的 runBuff 並清空緩衝區。沒有耗材時不動 */
export function consumeRunBuffs(s) {
  if (!s.consumables?.length) return;
  const buff = {};
  for (const id of s.consumables) {
    for (const [k, v] of Object.entries(getShopItem(id)?.effect ?? {})) buff[k] = (buff[k] ?? 0) + v;
  }
  s.runBuff = buff;
  s.consumables = [];
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

