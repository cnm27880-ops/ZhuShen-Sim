// 商店引擎（Phase 3-A；4-D-2 重構）：階層解鎖、買東西（制式武防、耗材、黑貨、特產裝備與血統）、副本特殊獎勵（收藏）的效果。純規則，不碰畫面。
// 商品資料在 src/data/shopItems.js，特殊獎勵資料在 src/data/dungeons.js；要加東西只改資料表。
//
// 付費者（opts.payer）：
//   "treasury"（預設）  主神公庫 state.points：「主動賞賜」。買裝備 → 綁定（soulbound）並讓該角色理智 +5。
//   "wallet"            輪迴者自己的私房錢 s.wallet：「自主逛街」（engine/shopping.js）；不綁定，不能覆蓋已綁定的裝備。
// 不論誰付錢，花費一律累加進 state.totalSpent（商店階層解鎖用）。
// 來源（opts.source）："shop" 常駐制式商店只賣 standard 與 permanent 耗材；"market" 黑市由 engine/market.js 傳入（可買任何商品、可帶折扣價 opts.price）。

import { noteContraband, squadRng } from "./squad.js"; // 黑貨使用紀錄（4-E-3；循環引用只在執行時呼叫）
import { CONFIG, INJURIES } from "../data/config.js";
import { SHOP_ITEMS, SHOP_SLOT_LABELS, getShopItem, isNewItem } from "../data/shopItems.js";
import { getSpecialReward } from "../data/dungeons.js";
import { emit, spend, spendWallet, canAfford, getSamsarite, setInjury, shopTier } from "./core.js";
import { addLove, softenHate, addHate } from "./relations.js";
import { intelTargets, gainIntel, marketOf } from "./market.js";
import { pregnancyPartner, inducePregnancy } from "./lineage.js";
import { rand } from "./rng.js";
import { logText } from "./templates.js";
import { wishesAfterBuy } from "./wishes.js";

export { shopTier };

/** 下一階還差多少累積花費。已經是最高階就回傳 null */
export function nextTierInfo(state) {
  const tier = shopTier(state);
  const need = CONFIG.shopTierUnlock[tier]; // 索引 tier = 下一階
  return need === undefined ? null : { tier: tier + 1, need, remaining: Math.max(0, need - state.totalSpent) };
}

/** 常駐商店賣的商品：常駐裝備（8 件／階）+ 常備耗材（permanent：治傷藥、鎮靜劑）。tier 省略 = 全部階層 */
export function shopItemsOfTier(tier = null) {
  return SHOP_ITEMS.filter((i) => (tier === null || i.tier === tier) && isPermanent(i));
}
export const isPermanent = (item) => item.category === "standard" || !!item.permanent;

const homeMates = (state, s) => state.samsarites.filter((o) => o.id !== s.id && o.location === "space");

/**
 * 即用耗材（kind "use"）對這個人現在有沒有任何效果可套用？回傳 null（可以買）或原因。
 * 規則：只要有一個效果能生效就可以買（例如九轉金丹滿 3 次後沒受傷就不能買；受傷時仍可買來回傷，但不再加生命）。
 */
export function useBlock(state, item, s) {
  const e = item.effect ?? {};
  const reasons = [];
  const tests = [
    ["healInjury", () => (s.injury > 0 ? null : `${s.name} 沒有受傷`)],
    ["permHp", () => ((s.elixirUses ?? 0) < (e.maxUsesPerChar ?? 3) ? null : `${s.name} 的永久強化次數已達上限`)],
    ["sanity", () => (s.stats.sanity < 100 ? null : `${s.name} 的理智已經滿了`)],
    ["geneLockTarget", () => (s.geneBuff?.target === e.geneLockTarget ? `${s.name} 已經有同階的破鎖加成` : (s.geneLock ?? 0) >= e.geneLockTarget ? `${s.name} 的基因鎖已經 ${s.geneLock} 階` : null)],
    ["deathWard", () => ((s.deathWard ?? 0) >= 1 ? `${s.name} 已經帶著替死護符` : null)],
    ["intelGain", () => (intelTargets(state).length > 0 ? null : "所有已解鎖世界的情報都滿了")],
    ["hateDelta", () => (homeMates(state, s).length > 0 ? null : "空間裡沒有其他人")],
    ["teamLove", () => (homeMates(state, s).length > 0 ? null : "空間裡沒有其他人")],
    ["transferMadness", () => (homeMates(state, s).length > 0 ? null : "空間裡沒有可以嫁禍的人")],
    ["inducePregnancy", () => (pregnancyPartner(state, s) ? null : "沒有雙向淨好感 ≥ 60 且可以孕育的對象")],
  ];
  let any = false;
  for (const [key, test] of tests) {
    if (e[key] === undefined) continue;
    const r = test();
    if (r === null) any = true;
    else reasons.push(r);
  }
  return any ? null : (reasons[0] ?? "這件商品現在沒有效果");
}

/** 這件商品對這個人能不能買？回傳 { ok, reason }。opts：{ payer, price, source } */
export function checkBuy(state, item, s, opts = {}) {
  if (!item) return { ok: false, reason: "沒有這個商品" };
  if (!isNewItem(item.id)) return { ok: false, reason: "這是舊版商品，已停售" };
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
  } else if (item.kind === "buff") {
    if ((s.consumables?.length ?? 0) >= CONFIG.shop.consumableCap) return { ok: false, reason: `${s.name} 的出征耗材已經囤滿（${CONFIG.shop.consumableCap} 份）` };
  } else {
    const why = useBlock(state, item, s);
    if (why) return { ok: false, reason: why };
  }
  return { ok: true };
}

/** 買東西並套用在 targetId 身上。回傳 { ok, reason, price } */
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
    if (item.passive?.demonTendency === "sure" && !(s.tags ?? []).includes("demon_path")) (s.tags ??= []).push("demon_path"); // 必帶入魔傾向（4-E-8）
    if (self) {
      delete s.soulbound[item.slot]; // 自己買的不綁定
      selfLog();
    } else {
      s.soulbound[item.slot] = true; // 公庫賞賜：綁定，輪迴者自己逛街不會覆蓋（4-D-1）
      s.stats.sanity = Math.min(100, s.stats.sanity + CONFIG.wallet.giftSanity);
      emit(state, "shop", logText(state, old ? "shopGearSwap" : "shopGear", { ...vars, slot: SHOP_SLOT_LABELS[item.slot], old: old?.name ?? "" }), { samsariteId: s.id });
      wishesAfterBuy(state, s, item); // 他許的就是這件裝備：許願完成
    }
  } else if (item.kind === "buff") {
    (s.consumables ??= []).push(item.id);
    if (self) selfLog();
    else emit(state, "shop", logText(state, "shopBuff", vars), { samsariteId: s.id });
  } else {
    if (self) selfLog();
    const note = applyUse(state, item, s);
    if (!self) emit(state, "shop", logText(state, "shopUse", { ...vars, note }), { samsariteId: s.id });
  }
  return { ok: true, price };
}

/** 即用耗材的效果（結構化欄位統一解析，不看單一 id）。回傳效果摘要文字給日誌用 */
function applyUse(state, item, s) {
  const e = item.effect ?? {};
  const notes = [];
  const mates = homeMates(state, s);
  if (e.healInjury && s.injury > 0) {
    setInjury(s, e.healInjury >= 99 ? 0 : Math.max(0, s.injury - e.healInjury));
    notes.push(`傷勢降為${INJURIES[s.injury].name}`);
  }
  if (e.permHp && (s.elixirUses ?? 0) < (e.maxUsesPerChar ?? 3)) {
    s.stats.hp += e.permHp;
    s.elixirUses = (s.elixirUses ?? 0) + 1;
    notes.push(`永久生命 +${e.permHp}（${s.elixirUses}/${e.maxUsesPerChar ?? 3}）`);
  }
  if (e.sanity) {
    s.stats.sanity = Math.min(100, s.stats.sanity + e.sanity);
    notes.push(`理智 +${e.sanity}`);
  }
  if (e.geneLockTarget) {
    s.geneBuff = { target: e.geneLockTarget, costDiscount: e.costDiscount ?? 0, rateBonus: e.rateBonus ?? 0 };
    notes.push(`下次衝刺 ${e.geneLockTarget} 階基因鎖花費 -${Math.round((e.costDiscount ?? 0) * 100)}%`);
  }
  if (e.deathWard) {
    s.deathWard = 1;
    s.deathWardFull = !!e.fullRecover;
    notes.push(e.fullRecover ? "獲得替死護符（免死並全狀態恢復）" : "獲得替死護符（免死一次，改落輕傷）");
  }
  if (e.intelGain) {
    const rng = marketOf(state);
    const pool = [...intelTargets(state)];
    const hit = [];
    for (let i = 0; i < (e.targetCount ?? 1) && pool.length > 0; i++) {
      const w = pool.splice(Math.floor(rand(rng) * pool.length), 1)[0];
      gainIntel(state, w.id, e.intelGain);
      hit.push(w.name);
    }
    notes.push(`情報 +${e.intelGain}%：${hit.join("、")}`);
  }
  if (e.teamLove || e.hateDelta || e.clearHate) {
    const group = [s, ...mates];
    for (const a of group) {
      for (const b of group) {
        if (a.id === b.id) continue;
        if (e.teamLove) addLove(state, a, b, e.teamLove);
        if (e.clearHate || e.hateDelta) softenHate(state, a, b, { reduce: -(e.hateDelta ?? 0), clear: !!e.clearHate });
      }
    }
    if (e.teamLove) notes.push(`全隊雙向好感 +${e.teamLove}`);
    if (e.clearHate) notes.push("全隊仇恨清零");
    else if (e.hateDelta) notes.push(`全隊仇恨 ${e.hateDelta}`);
  }
  if (e.transferMadness && mates.length > 0) {
    s.tags = (s.tags ?? []).filter((t) => t !== "demon_path"); // 抹除瘋狂狀態
    const rng = squadRng(state);
    const victim = mates[Math.floor(rand(rng) * mates.length)];
    victim.stats.sanity = Math.max(0, victim.stats.sanity - (e.madnessSanityHit ?? 25));
    addHate(state, victim, s, e.madnessHate ?? 25);
    noteContraband(state, s, victim, item);
    notes.push(`瘋狂轉嫁給 ${victim.name}（理智 -${e.madnessSanityHit ?? 25}、對你仇恨 +${e.madnessHate ?? 25}）`);
  }
  if (e.inducePregnancy) {
    const partner = pregnancyPartner(state, s);
    const kid = partner ? inducePregnancy(state, s, partner, { force: true, talent: e.inducePregnancy }) : null;
    if (kid) {
      noteContraband(state, s, partner, item);
      notes.push(`與 ${partner.name} 孕育了第 ${kid.generation} 代（天賦 +${Math.round((kid.talentPct ?? 0) * 100)}%）`);
    }
  }
  return notes.join("；") || "沒有明顯變化";
}

// ───────── 出征耗材（單場 buff）─────────

/**
 * 出發時呼叫：把緩衝區裡的耗材合成這一場的 runBuff 並清空緩衝區。沒有耗材時不動。
 * 爆發類（nextRunPowerMult／partyNextRunPowerMult）只取最高 1 件，嚴禁連乘；舊版加法型 buff（防禦、速度、受傷減免）照舊相加。
 * 產出欄位：powerPct、partyPowerPct、postRunInjury、partyPostRunSanity、loveBonus。
 */
export function consumeRunBuffs(s) {
  if (!s.consumables?.length) return;
  const buff = {};
  for (const id of s.consumables) {
    for (const [k, v] of Object.entries(getShopItem(id)?.effect ?? {})) {
      if (k === "nextRunPowerMult") buff.powerPct = Math.max(buff.powerPct ?? 0, v);
      else if (k === "partyNextRunPowerMult") buff.partyPowerPct = Math.max(buff.partyPowerPct ?? 0, v);
      else if (k === "postRunInjury") buff.postRunInjury = Math.max(buff.postRunInjury ?? 0, v);
      else if (k === "partyPostRunSanity") buff.partyPostRunSanity = Math.min(buff.partyPostRunSanity ?? 0, v);
      else if (k === "nextRunLoveBonus") buff.loveBonus = Math.max(buff.loveBonus ?? 0, v);
      else buff[k] = (buff[k] ?? 0) + v;
    }
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

