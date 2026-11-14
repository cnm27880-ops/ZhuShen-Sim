// 商品資料表（Phase 4-E-8：200 件總表）：五階 × 40 件（8 常駐 + 18 世界特產 + 6 耗材 + 8 黑貨）。
// 原始列（名稱、價格、白值、描述）在 src/data/shopRaw.js；這裡負責解析，並用結構化欄位宣告特殊效果（EFFECTS／PASSIVES），引擎統一解析，禁止硬編碼單一 id。
//
// 欄位：id／name／tier／slot（weapon armor accessory bloodline consumable）／category／source／price／stats／aiBuyTag／desc，選配 effect／passive
//   category：standard 常駐（制式商店隨時可買）／specialty 世界特產（綁 worldId，只在黑市輪換）／consumable 耗材／contraband 黑貨（只在黑市）
//   source：「常駐」／世界 id（特產）／「耗材」／「黑貨」
//   kind：gear 穿戴／use 買了立刻用（治療、情報、好感、孕育…）／buff 放進出征耗材緩衝區、下次出征套用一場
//   stats：白值 { power, hp, defense, speed, luck }（不吃基因鎖乘區；血統也是白值）
//   effect（耗材）：healInjury（99 = 傷勢歸零）／permHp＋maxUsesPerChar／sanity／geneLockTarget＋costDiscount＋rateBonus／deathWard＋fullRecover／
//     intelGain＋targetCount／teamLove／clearHate／hateDelta／nextRunLoveBonus／transferMadness／inducePregnancy（normal／high／max）／
//     nextRunPowerMult／partyNextRunPowerMult／postRunInjury／partyPostRunSanity
//   passive（裝備著才生效）：dailySanity／runSanity／partyRunSanity／demonTendency／captainHateMult／captainLoveMult／coupPowerBonus
// 舊版（4-D-2，115 件）商品只供舊存檔相容，見 legacyItems.js；getShopItem 找不到新 id 時會退回舊表。

import { SHOP_RAW } from "./shopRaw.js";
import { WORLD_LIST } from "./worlds.js";
import { getLegacyItem } from "./legacyItems.js";

/** 之後注入的完整文案放這裡：{ 商品id: { name?, desc?, icon? } } */
export const ITEM_TEXT = {};

const STAT_KEYS = { p: "power", h: "hp", d: "defense", s: "speed", l: "luck" };

/** 耗材與黑貨耗材的結構化效果 */
export const EFFECTS = {
  t1_27: { healInjury: 1 },
  t1_28: { sanity: 20 },
  t1_29: { healInjury: 2 },
  t1_30: { geneLockTarget: 1, costDiscount: 0.15, rateBonus: 0.1 },
  t1_31: { intelGain: 20, targetCount: 1 },
  t1_32: { nextRunLoveBonus: 4 },
  t1_37: { nextRunPowerMult: 0.15, postRunInjury: 1 },
  t1_40: { hateDelta: -15 },
  t2_27: { healInjury: 2 },
  t2_28: { sanity: 30 },
  t2_29: { geneLockTarget: 2, costDiscount: 0.15, rateBonus: 0.1 },
  t2_30: { deathWard: 1 },
  t2_31: { intelGain: 25, targetCount: 1 },
  t2_32: { nextRunLoveBonus: 6 },
  t2_38: { nextRunPowerMult: 0.2, postRunInjury: 1 },
  t2_40: { hateDelta: -20, sanity: 10 },
  t3_27: { healInjury: 2 },
  t3_28: { sanity: 35 },
  t3_29: { geneLockTarget: 2, costDiscount: 0.2, rateBonus: 0.15 },
  t3_30: { deathWard: 1 },
  t3_31: { intelGain: 35, targetCount: 1 },
  t3_32: { nextRunLoveBonus: 8 },
  t3_38: { inducePregnancy: "normal" },
  t3_40: { nextRunPowerMult: 0.25, postRunInjury: 1 },
  t4_27: { healInjury: 99 },
  t4_28: { sanity: 60 },
  t4_29: { geneLockTarget: 3, costDiscount: 0.2, rateBonus: 0.15 },
  t4_30: { deathWard: 1, fullRecover: true },
  t4_31: { intelGain: 100, targetCount: 1 },
  t4_32: { hateDelta: -30 },
  t4_39: { inducePregnancy: "high" },
  t4_40: { transferMadness: true, sanity: 35, madnessSanityHit: 25, madnessHate: 25 },
  t5_27: { healInjury: 99, permHp: 10, maxUsesPerChar: 3 },
  t5_28: { sanity: 100 },
  t5_29: { geneLockTarget: 4, costDiscount: 0.25, rateBonus: 0.2 },
  t5_30: { deathWard: 1, fullRecover: true },
  t5_31: { intelGain: 100, targetCount: 3 },
  t5_32: { teamLove: 20, clearHate: true },
  t5_38: { partyNextRunPowerMult: 0.3, partyPostRunSanity: -15 },
  t5_39: { inducePregnancy: "max" },
};

/** 黑貨裝備的被動（穿著期間生效；demonTendency "sure" = 一穿上就必定入魔） */
export const PASSIVES = {
  t1_33: { dailySanity: -1 },
  t1_35: { runSanity: -2 },
  t1_36: { demonTendency: true },
  t1_39: { dailySanity: -1 },
  t2_33: { dailySanity: -1 },
  t2_34: { dailySanity: -1 },
  t2_36: { demonTendency: true },
  t2_37: { runSanity: -3 },
  t2_39: { captainHateMult: 0.6 },
  t3_33: { dailySanity: -1 },
  t3_36: { demonTendency: true },
  t3_39: { captainHateMult: 0.5 },
  t4_34: { dailySanity: -1 },
  t4_36: { demonTendency: true },
  t4_37: { dailySanity: -2 },
  t4_38: { runSanity: -5 },
  t5_33: { dailySanity: -2 },
  t5_34: { dailySanity: -1 },
  t5_35: { partyRunSanity: -3 },
  t5_36: { demonTendency: "sure" },
  t5_37: { captainLoveMult: 0.7 },
  t5_40: { coupPowerBonus: 0.2 },
};

/** 放進出征耗材緩衝區（下次出征才生效）的效果欄位；其餘耗材買了立刻用 */
const BUFFER_KEYS = ["nextRunPowerMult", "partyNextRunPowerMult", "postRunInjury", "partyPostRunSanity", "nextRunLoveBonus"];

const SLOT_ICON = { weapon: "🗡️", armor: "🛡️", accessory: "💍", bloodline: "🧬", consumable: "🧪" };
const CATEGORY = { S: "standard", W: "specialty", C: "consumable", K: "contraband" };

function parseStats(code) {
  const out = {};
  if (code === "-") return out;
  for (const tok of code.split(" ")) out[STAT_KEYS[tok[0]]] = Number(tok.slice(1));
  return out;
}

export const SHOP_ITEMS = SHOP_RAW.trim()
  .split("\n")
  .map((line) => {
    const [id, name, slot, src, price, stats, tag, desc] = line.split("|");
    const [, t, n] = id.match(/^t(\d)_(\d\d)$/);
    const tier = Number(t);
    const num = Number(n);
    const category = CATEGORY[src];
    const worldId = src === "W" ? WORLD_LIST.filter((w) => w.chapter === tier)[Math.floor((num - 9) / 3)].id : undefined;
    const effect = EFFECTS[id] ?? {};
    const passive = PASSIVES[id];
    const kind = slot !== "consumable" ? "gear" : Object.keys(effect).some((k) => BUFFER_KEYS.includes(k)) ? "buff" : "use";
    const item = {
      id, name, tier, slot, category, kind,
      source: src === "S" ? "常駐" : src === "W" ? worldId : src === "K" ? "黑貨" : "耗材",
      price: Number(price),
      stats: parseStats(stats),
      aiBuyTag: tag,
      desc,
      icon: category === "contraband" && slot === "consumable" ? "☠️" : SLOT_ICON[slot],
      effect,
      // 常駐耗材：每階的治傷藥與鎮靜劑（第 1 階再加急救針）常駐商店也賣，確保前期醫療不斷鏈
      permanent: slot === "consumable" && category === "consumable" && (num === 27 || num === 28 || id === "t1_29") ? true : undefined,
    };
    if (worldId) item.worldId = worldId;
    if (passive) item.passive = passive;
    return { ...item, ...(ITEM_TEXT[id] ?? {}) };
  });

export const SHOP_KIND_LABELS = { gear: "裝備", use: "即用耗材", buff: "出征耗材", potion: "藥水", contraband: "黑貨" };
export const SHOP_CATEGORY_LABELS = { standard: "常駐", specialty: "特產", consumable: "耗材", contraband: "黑貨" };
export const SHOP_SLOT_LABELS = { weapon: "武器", armor: "防具", accessory: "飾品", bloodline: "血統" };
/** 穿戴欄（武器、防具、飾品、血統） */
export const GEAR_SLOTS = ["weapon", "armor", "accessory", "bloodline"];

/** 新版 aiBuyTag（dps／tank／speed…）歸到逛街 AI 的偏好群組：aggro 攻擊／survival 保命／communal 共用／drama 搞事 */
export const AI_GROUP = { dps: "aggro", speed: "aggro", tank: "survival", heal: "survival", sanity: "survival", luck: "communal", balanced: "communal", support: "communal", taboo: "drama", aggro: "aggro", survival: "survival", communal: "communal", drama: "drama" };

const BY_ID = new Map(SHOP_ITEMS.map((i) => [i.id, i]));
/** 找商品：先找新版 200 件，找不到再退回舊版（舊存檔裡已穿戴的裝備、囤的耗材照原本數值計算） */
export function getShopItem(id) {
  return BY_ID.get(id) ?? getLegacyItem(id);
}
export const isNewItem = (id) => BY_ID.has(id);

/** 這件商品對某個數值的白值：新版看 stats，舊版看 effect（舊版沒有 stats） */
export function itemStat(item, key) {
  return item?.stats ? (item.stats[key] ?? 0) : (item?.effect?.[key] ?? 0);
}
