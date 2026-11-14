// 商品資料表（Phase 4-D-2）：五階 × 四大分類。要加商品、改價格、換文案只改這個檔案，引擎不用動。
//
// category（分類）：
//   standard    常駐制式武防：開放對應階級後，「常駐制式商店」隨時可買（公庫買 = 賞賜綁定；輪迴者自己用私房錢買不綁定）
//   specialty   世界特產：武器／防具／血統（bloodline），綁定一張副本世界 worldId，只在黑市輪換出現
//   consumable  戰術保命耗材：治傷、回理智、單場 buff（injuryShield／defense／speed）、強制任務延期
//   contraband  狗血黑貨：單向加好感、清好感忘情水、捏造人標記、鎖私人休眠艙
// kind（機制種類）：gear（穿戴；slot = weapon／armor／bloodline）、potion（買了立刻用）、buff（放進出征耗材緩衝區，下次出征套用一場）、contraband（對另一位輪迴者使用）
// effect 欄位：
//   power／hp／defense／speed／luck   白值（戰力吃標籤%，副屬性不吃基因鎖乘區）
//   injuryShield／dodge               受傷少一級機率／閃避
//   powerPct                          血統：全隊有效戰力百分比區（只算持有者自己）
//   worldPass                         特產：在綁定的 worldId 副本單房通過率 +N
//   heal／sanity                      即時：傷勢降幾級（99 = 治癒）／理智回復
//   extendMandatory                   即時：主神強制任務期限 +N 天
//   loveTo／forget／doll／podLock     狗血黑貨（見 engine/shop.js 的 applyContraband）
// aiBuyTag：輪迴者自主逛街的偏好（'survival' | 'aggro' | 'communal' | 'drama'），見 engine/shopping.js
// 文案：目前是依各階數值錨點產生的「結構化精簡名稱」（2～7 字）；之後要換長文案，只填 ITEM_TEXT[id] = { name, desc, icon } 即可，數值與機制不受影響。
// 本檔排序：standard 先、其他後（許願「想要裝備」依 SHOP_ITEMS 順序抽，順序不能亂動）。

import { WORLD_LIST } from "./worlds.js";

/** 之後注入的完整文案放這裡：{ 商品id: { name?, desc?, icon? } } */
export const ITEM_TEXT = {};

const TIER_CN = ["", "一階", "二階", "三階", "四階", "五階"];

// 標準武防（沿用 4-A 的錨點：武器＋防具白值合計 T1 +16／T2 +60／T3 +220／T4 +900／T5 +3500）
const STANDARD = [
  { id: "weapon_club", tier: 1, slot: "weapon", name: "鐵管", icon: "🔧", price: 80, effect: { power: 10, speed: 2 }, desc: "武器：戰力 +10，速度 +2。" },
  { id: "armor_cloth", tier: 1, slot: "armor", name: "帆布外套", icon: "🧥", price: 70, effect: { power: 6, injuryShield: 0.05, defense: 4, hp: 10 }, desc: "防具：戰力 +6，防禦 +4，生命 +10，受傷時 5% 機率少受一級。" },
  { id: "weapon_steel", tier: 2, slot: "weapon", name: "精鋼劍", icon: "🗡️", price: 380, effect: { power: 38, speed: 5, luck: 2 }, desc: "武器：戰力 +38，速度 +5，氣運 +2。" },
  { id: "armor_chain", tier: 2, slot: "armor", name: "鏈甲", icon: "⛓️", price: 300, effect: { power: 22, injuryShield: 0.1, defense: 10, hp: 25 }, desc: "防具：戰力 +22，防禦 +10，生命 +25，受傷時 10% 機率少受一級。" },
  { id: "weapon_alloy", tier: 3, slot: "weapon", name: "合金戰刀", icon: "⚔️", price: 1400, effect: { power: 140, speed: 12, luck: 5 }, desc: "武器：戰力 +140，速度 +12，氣運 +5。" },
  { id: "armor_composite", tier: 3, slot: "armor", name: "複合護甲", icon: "🛡️", price: 1100, effect: { power: 80, injuryShield: 0.18, defense: 24, hp: 50 }, desc: "防具：戰力 +80，防禦 +24，生命 +50，受傷時 18% 機率少受一級。" },
  { id: "weapon_legend", tier: 4, slot: "weapon", name: "傳說之刃", icon: "🌟", price: 5500, effect: { power: 560, speed: 30, luck: 12 }, desc: "武器：戰力 +560，速度 +30，氣運 +12。" },
  { id: "armor_legend", tier: 4, slot: "armor", name: "傳說戰甲", icon: "👑", price: 4200, effect: { power: 340, injuryShield: 0.3, dodge: 0.05, defense: 60, hp: 100 }, desc: "防具：戰力 +340，防禦 +60，生命 +100，受傷時 30% 機率少受一級，閃避 +5%。" },
  { id: "weapon_myth", tier: 5, slot: "weapon", name: "弒神之槍", icon: "🔱", price: 20000, effect: { power: 2200, speed: 70, luck: 30 }, desc: "武器：戰力 +2200，速度 +70，氣運 +30。" },
  { id: "armor_myth", tier: 5, slot: "armor", name: "神骸鎧甲", icon: "🪽", price: 15000, effect: { power: 1300, injuryShield: 0.35, dodge: 0.08, defense: 140, hp: 250 }, desc: "防具：戰力 +1300，防禦 +140，生命 +250，受傷時 35% 機率少受一級，閃避 +8%。" },
].map((i) => ({ ...i, category: "standard", kind: "gear", aiBuyTag: i.slot === "weapon" ? "aggro" : "survival" }));

// 世界特產：每個世界 1 件特產武防（同章 6 個世界：單數位置武器、雙數位置防具）＋ 1 個特產血統
const GEAR_ANCHOR = {
  weapon: [10, 38, 140, 560, 2200],
  armor: [6, 22, 80, 340, 1300],
};
const GEAR_SUB = {
  weapon: [{ speed: 3 }, { speed: 6, luck: 3 }, { speed: 15, luck: 6 }, { speed: 36, luck: 14 }, { speed: 84, luck: 36 }],
  armor: [{ defense: 5, hp: 12 }, { defense: 12, hp: 30 }, { defense: 28, hp: 60 }, { defense: 70, hp: 120 }, { defense: 165, hp: 300 }],
};
const GEAR_SHIELD = [0.06, 0.12, 0.2, 0.32, 0.38]; // 特產防具的傷勢減免
const GEAR_PRICE = { weapon: [120, 560, 2100, 8200, 30000], armor: [100, 450, 1650, 6300, 22500] };
const WORLD_PASS = [0.02, 0.025, 0.03, 0.035, 0.04]; // 特產武防在綁定世界的單房通過率加成（全隊加總另有上限，見 CONFIG.shop.worldPassCap）
const BLOOD_PCT = [0.04, 0.06, 0.08, 0.1, 0.13]; // 血統：持有者有效戰力 %
const BLOOD_SUBS = [{ hp: [15, 40, 90, 180, 400] }, { defense: [3, 8, 18, 40, 90] }, { speed: [3, 8, 18, 40, 90] }, { luck: [3, 8, 18, 40, 90] }, { hp: [15, 40, 90, 180, 400], luck: [2, 5, 12, 25, 60] }, { defense: [3, 8, 18, 40, 90], speed: [2, 5, 12, 25, 60] }];
const BLOOD_PRICE = [220, 900, 3300, 13000, 48000];

const SPECIALTY = [];
for (let tier = 1; tier <= 5; tier++) {
  const worlds = WORLD_LIST.filter((w) => w.chapter === tier);
  worlds.forEach((w, idx) => {
    const t = tier - 1;
    const slot = idx % 2 === 0 ? "weapon" : "armor";
    const effect = { power: Math.round(GEAR_ANCHOR[slot][t] * 1.25), ...GEAR_SUB[slot][t], worldPass: WORLD_PASS[t] };
    if (slot === "armor") effect.injuryShield = GEAR_SHIELD[t];
    SPECIALTY.push({
      id: `spec_${w.id}_${slot}`, tier, category: "specialty", kind: "gear", slot, worldId: w.id,
      name: `${TIER_CN[tier]}${idx + 1}號${slot === "weapon" ? "刃" : "甲"}`, icon: slot === "weapon" ? "🗡️" : "🛡️",
      price: GEAR_PRICE[slot][t], effect, aiBuyTag: slot === "weapon" ? "aggro" : "survival",
      desc: `${slot === "weapon" ? "特產武器" : "特產防具"}：戰力 +${effect.power}，綁定世界通過率 +${Math.round(WORLD_PASS[t] * 100 * 10) / 10}%。`,
    });
    const sub = {};
    for (const [k, arr] of Object.entries(BLOOD_SUBS[idx])) sub[k] = arr[t];
    SPECIALTY.push({
      id: `spec_${w.id}_blood`, tier, category: "specialty", kind: "gear", slot: "bloodline", worldId: w.id,
      name: `${TIER_CN[tier]}${idx + 1}號血脈`, icon: "🧬", price: BLOOD_PRICE[t],
      effect: { powerPct: BLOOD_PCT[t], ...sub, worldPass: WORLD_PASS[t] / 2 }, aiBuyTag: idx % 2 === 0 ? "aggro" : "communal",
      desc: `血統（每人限 1，覆蓋舊血統）：有效戰力 +${Math.round(BLOOD_PCT[t] * 100)}%。`,
    });
  });
}

// 耗材（每階 5 種）。potion_heal／potion_calm／potion_revive 沿用舊 id，並標 permanent：常駐商店也賣（不然黑市沒抽到就沒藥可買）
const CONSUMABLE = [];
const HEAL = [1, 99, 2, 99, 99]; // T2 是舊的「急救針」（完全治癒）
const CALM = [25, 35, 50, 70, 100];
const SHIELD = [0.1, 0.15, 0.2, 0.25, 0.3];
const TACTIC = [{ defense: 4, speed: 4 }, { defense: 10, speed: 10 }, { defense: 24, speed: 24 }, { defense: 60, speed: 60 }, { defense: 140, speed: 140 }];
const CPRICE = [1, 3, 10, 38, 125]; // 乘上各耗材的基數
const LEGACY_CONSUMABLE_ID = { "1heal": "potion_heal", "1calm": "potion_calm", "2heal": "potion_revive" };
for (let tier = 1; tier <= 5; tier++) {
  const t = tier - 1;
  const heal = LEGACY_CONSUMABLE_ID[`${tier}heal`];
  const calm = LEGACY_CONSUMABLE_ID[`${tier}calm`];
  CONSUMABLE.push(
    { id: heal ?? `cons_heal_t${tier}`, tier, kind: "potion", name: tier === 2 ? "急救針" : tier === 1 ? "基本傷藥" : `${TIER_CN[tier]}治傷劑`, icon: "🧪", price: heal === "potion_heal" ? 40 : heal === "potion_revive" ? 100 : 40 * CPRICE[t], effect: { heal: HEAL[t] }, permanent: tier <= 2, aiBuyTag: "survival", desc: HEAL[t] >= 99 ? "傷勢完全治癒，不用再休養。" : `傷勢降 ${HEAL[t]} 級。` },
    { id: calm ?? `cons_calm_t${tier}`, tier, kind: "potion", name: tier === 1 ? "鎮定劑" : `${TIER_CN[tier]}鎮靜劑`, icon: "💊", price: calm === "potion_calm" ? 30 : 30 * CPRICE[t], effect: { sanity: CALM[t] }, permanent: tier === 1, aiBuyTag: "survival", desc: `理智 +${CALM[t]}（上限 100）。` },
    { id: `cons_shield_t${tier}`, tier, kind: "buff", name: `${TIER_CN[tier]}護符`, icon: "📿", price: 60 * CPRICE[t], effect: { injuryShield: SHIELD[t] }, aiBuyTag: "survival", desc: `下一場出征：受傷時 ${Math.round(SHIELD[t] * 100)}% 機率少受一級（單場）。` },
    { id: `cons_tactic_t${tier}`, tier, kind: "buff", name: `${TIER_CN[tier]}戰術藥`, icon: "💥", price: 70 * CPRICE[t], effect: { ...TACTIC[t] }, aiBuyTag: "aggro", desc: `下一場出征：防禦 +${TACTIC[t].defense}、速度 +${TACTIC[t].speed}（單場）。` },
    { id: `cons_extend_t${tier}`, tier, kind: "potion", name: `${TIER_CN[tier]}延期令`, icon: "⏳", price: 80 * CPRICE[t], effect: { extendMandatory: 2 }, aiBuyTag: "communal", desc: "主神強制任務期限 +2 天（沒有待派任務時不能買）。" }
  );
}
for (const c of CONSUMABLE) c.category = "consumable";

// 狗血黑貨（每階 4 種）。用法：使用者 A 對對象 B（不能同一人）
const LOVE_TO = [15, 20, 30, 40, 50];
const FAKE_HIT = [10, 15, 20, 30, 40]; // 捏造人標記：其他留守的人對 B 的好感 -N（另仇恨 +N/2）
const CONTRA_PRICE = [1, 3, 10, 38, 125];
const CONTRABAND = [];
for (let tier = 1; tier <= 5; tier++) {
  const t = tier - 1;
  CONTRABAND.push(
    { id: `contra_love_t${tier}`, tier, name: `${TIER_CN[tier]}迷魂香`, icon: "💘", price: 90 * CONTRA_PRICE[t], effect: { loveTo: LOVE_TO[t] }, desc: `單向加好感：對象 B 對使用者 A 的好感 +${LOVE_TO[t]}。` },
    { id: `contra_forget_t${tier}`, tier, name: `${TIER_CN[tier]}忘情水`, icon: "🍶", price: 70 * CONTRA_PRICE[t], effect: { forget: true }, desc: "A、B 之間雙向的好感與仇恨全部歸零，戀人／死敵狀態一併解除。" },
    { id: tier === 1 ? "drama_custom_doll" : `drama_custom_doll_t${tier}`, tier, name: `${TIER_CN[tier]}捏造人偶`, icon: "🪆", price: 100 * CONTRA_PRICE[t], effect: { doll: FAKE_HIT[t] }, desc: `捏造人標記：其他留守的人對 B 的好感 -${FAKE_HIT[t]}（仇恨 +${Math.round(FAKE_HIT[t] / 2)}），吃瓜日誌登場。` },
    { id: `contra_pod_t${tier}`, tier, name: `${TIER_CN[tier]}休眠艙`, icon: "🛏️", price: 120 * CONTRA_PRICE[t], effect: { podLock: 3 }, desc: "把 B 鎖進私人休眠艙 3 天：不能派遣、不能逛街（維持費照付）。" }
  );
}
for (const c of CONTRABAND) Object.assign(c, { category: "contraband", kind: "contraband", aiBuyTag: "drama" });

/** 套用 ITEM_TEXT 覆蓋後的完整商品表 */
export const SHOP_ITEMS = [...STANDARD, ...CONSUMABLE, ...CONTRABAND, ...SPECIALTY].map((i) => ({ ...i, ...(ITEM_TEXT[i.id] ?? {}) }));

export const SHOP_KIND_LABELS = { gear: "裝備", potion: "藥水", buff: "出征耗材", contraband: "黑貨" };
export const SHOP_CATEGORY_LABELS = { standard: "制式", specialty: "特產", consumable: "耗材", contraband: "黑貨" };
export const SHOP_SLOT_LABELS = { weapon: "武器", armor: "防具", bloodline: "血統" };
/** 一般穿戴欄（武器、防具；血統另算） */
export const GEAR_SLOTS = ["weapon", "armor", "bloodline"];

const BY_ID = new Map(SHOP_ITEMS.map((i) => [i.id, i]));
export function getShopItem(id) {
  return BY_ID.get(id);
}
