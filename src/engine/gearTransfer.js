// 裝備轉移（功能 3）：主管把 A 穿的裝備卸下、轉給 B。被奪走的人會不開心（心情「不爽」＋理智下降），傳記顯示「被奪走裝備，不開心」。
// 流程在畫面上是：選 A 的裝備 → 卸下 → 選 B → 完成；引擎一次做完（要嘛整個成功、要嘛什麼都不動，裝備不會消失）。
// B 該欄位已有裝備時雙方互換，兩人都算被奪走。數字：CONFIG.gearTransfer；心情效果沿用許願的「不爽」（CONFIG.wish.moods.upset）。

import { CONFIG } from "../data/config.js";
import { SHOP_SLOT_LABELS, getShopItem } from "../data/shopItems.js";
import { emit, currentDay, getSamsarite } from "./core.js";
import { setMood } from "./wishes.js";
import { addLife } from "./life.js";

/** 這次轉移行不行？回傳 { ok, reason, swap }（swap：B 該欄位已有裝備，會互換） */
export function checkTransfer(state, fromId, slot, toId) {
  const from = getSamsarite(state, fromId);
  const to = getSamsarite(state, toId);
  if (!from || !to) return { ok: false, reason: "找不到這個人" };
  if (from.id === to.id) return { ok: false, reason: "不能轉給自己" };
  if (!(slot in SHOP_SLOT_LABELS)) return { ok: false, reason: "沒有這個裝備欄" };
  if (from.location !== "space" || to.location !== "space") return { ok: false, reason: "兩個人都要在主神空間才能轉移" };
  const itemId = from.gear?.[slot];
  if (!itemId) return { ok: false, reason: `${from.name} 的${SHOP_SLOT_LABELS[slot]}是空的` };
  if (to.gear?.[slot] === itemId) return { ok: false, reason: `${to.name} 已經裝備了同一件` };
  return { ok: true, swap: !!to.gear?.[slot] };
}

function strip(state, s, itemName) {
  const cfg = CONFIG.gearTransfer;
  const text = setMood(state, s, cfg.mood); // 心情「不爽」：戰力 -10%、理智 -10、持續數天（見 CONFIG.wish.moods）
  s.stripped = { day: currentDay(state), item: itemName, untilDay: currentDay(state) + CONFIG.wish.moods[cfg.mood].days };
  addLife(state, s, "stripped", `被主管奪走了【${itemName}】，很不開心。`);
  return text;
}

/** 把 from 的 slot 欄裝備轉給 to。回傳 { ok, reason, swap } */
export function transferGear(state, fromId, slot, toId) {
  const check = checkTransfer(state, fromId, slot, toId);
  if (!check.ok) return check;
  const from = getSamsarite(state, fromId);
  const to = getSamsarite(state, toId);
  const mine = getShopItem(from.gear[slot]);
  const theirs = getShopItem(to.gear?.[slot]);
  from.gear ??= {};
  to.gear ??= {};
  from.gear[slot] = theirs?.id; // 互換：B 的舊裝備給 A；B 沒有就變空
  if (!theirs) delete from.gear[slot];
  to.gear[slot] = mine.id;
  for (const p of [from, to]) { // 轉手後都不再是公庫賞賜綁定、也不再是先人遺物
    if (p.soulbound) delete p.soulbound[slot];
    if (p.heirloomSlots) delete p.heirloomSlots[slot];
  }
  if (mine.passive?.demonTendency === "sure" && !(to.tags ?? []).includes("demon_path")) (to.tags ??= []).push("demon_path"); // 必帶入魔傾向（同商店買裝備）
  addLife(state, to, "gear", `從 ${from.name} 手上接下了【${mine.name}】。`);
  emit(state, "social", `🔄 主管把 ${from.name} 的【${mine.name}】${theirs ? `與 ${to.name} 的【${theirs.name}】互換` : `轉給了 ${to.name}`}。`, { samsariteId: from.id });
  emit(state, "social", strip(state, from, mine.name), { samsariteId: from.id });
  if (theirs) emit(state, "social", strip(state, to, theirs.name), { samsariteId: to.id });
  return { ok: true, swap: check.swap };
}
