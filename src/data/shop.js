// 商店商品資料表（Phase 3-A）。要加商品、改價格，只改這個檔案，引擎不用動。
// 階層解鎖門檻（累積花費）在 config.js 的 shopTierUnlock。
// Phase 4-A：裝備白值對齊各章錨點（單人武器＋防具戰力合計 Tier1 +16／T2 +60／T3 +220／T4 +900／T5 +3500），
//   約 5/8 給武器、3/8 給防具；價格是待 npm run sim 驗證的基準草稿。
// Phase 4-B：舊的商店強化（enhance）已移除，改成角色個人的強化／基因鎖（src/engine/growth.js）；商店只賣裝備與藥水。
//
// kind（商品種類）：
//   gear     基本裝備：永久穿在「一個人」身上，weapon／armor 各一格，買新的會換掉舊的
//   potion   藥水：買了立刻對「一個人」使用（不進背包）
// effect（效果）欄位：
//   power         戰力 +N（點數，會乘上標籤的 powerPct）
//   injuryShield  受傷時少受一級的機率（0.1 = 10%）
//   dodge         被點名受傷時直接閃過的機率
//   hp／defense／speed／luck  副屬性白值（Phase 4-C-1）：直接加進副屬性總值，不吃基因鎖乘區（見 engine/tags.js 的 subStat）
//   heal          藥水：傷勢降幾級（99 = 完全治癒）
//   sanity        藥水：理智回復多少
// 血統、瞳術、技藝、技能、員工合同：留到之後的 Phase。

export const SHOP_ITEMS = [
  // ───────── Tier 1（累積花費 0）：基本藥水、基本裝備 ─────────
  { id: "potion_heal", tier: 1, kind: "potion", name: "基本傷藥", icon: "🧪", price: 40, effect: { heal: 1 }, desc: "傷勢降 1 級（致命傷→重傷→輕傷→無傷）。" },
  { id: "potion_calm", tier: 1, kind: "potion", name: "鎮定劑", icon: "💊", price: 30, effect: { sanity: 25 }, desc: "理智 +25（上限 100）。" },
  { id: "weapon_club", tier: 1, kind: "gear", slot: "weapon", name: "鐵管", icon: "🔧", price: 80, effect: { power: 10, speed: 2 }, desc: "武器：戰力 +10，速度 +2。" },
  { id: "armor_cloth", tier: 1, kind: "gear", slot: "armor", name: "帆布外套", icon: "🧥", price: 70, effect: { power: 6, injuryShield: 0.05, defense: 4, hp: 10 }, desc: "防具：戰力 +6，防禦 +4，生命 +10，受傷時 5% 機率少受一級。" },

  // ───────── Tier 2（累積花費 600）：強化、比較好的裝備 ─────────
  { id: "potion_revive", tier: 2, kind: "potion", name: "急救針", icon: "💉", price: 100, effect: { heal: 99 }, desc: "傷勢完全治癒，不用再休養。" },
  { id: "weapon_steel", tier: 2, kind: "gear", slot: "weapon", name: "精鋼劍", icon: "🗡️", price: 380, effect: { power: 38, speed: 5, luck: 2 }, desc: "武器：戰力 +38，速度 +5，氣運 +2。" },
  { id: "armor_chain", tier: 2, kind: "gear", slot: "armor", name: "鏈甲", icon: "⛓️", price: 300, effect: { power: 22, injuryShield: 0.1, defense: 10, hp: 25 }, desc: "防具：戰力 +22，防禦 +10，生命 +25，受傷時 10% 機率少受一級。" },

  // ───────── Tier 3（累積花費 3000）：進階裝備 ─────────
  { id: "weapon_alloy", tier: 3, kind: "gear", slot: "weapon", name: "合金戰刀", icon: "⚔️", price: 1400, effect: { power: 140, speed: 12, luck: 5 }, desc: "武器：戰力 +140，速度 +12，氣運 +5。" },
  { id: "armor_composite", tier: 3, kind: "gear", slot: "armor", name: "複合護甲", icon: "🛡️", price: 1100, effect: { power: 80, injuryShield: 0.18, defense: 24, hp: 50 }, desc: "防具：戰力 +80，防禦 +24，生命 +50，受傷時 18% 機率少受一級。" },

  // ───────── Tier 4（累積花費 12000）：傳說裝備 ─────────
  { id: "weapon_legend", tier: 4, kind: "gear", slot: "weapon", name: "傳說之刃", icon: "🌟", price: 5500, effect: { power: 560, speed: 30, luck: 12 }, desc: "武器：戰力 +560，速度 +30，氣運 +12。" },
  { id: "armor_legend", tier: 4, kind: "gear", slot: "armor", name: "傳說戰甲", icon: "👑", price: 4200, effect: { power: 340, injuryShield: 0.3, dodge: 0.05, defense: 60, hp: 100 }, desc: "防具：戰力 +340，防禦 +60，生命 +100，受傷時 30% 機率少受一級，閃避 +5%。" },

  // ───────── Tier 5（累積花費 45000）：神話裝備（Phase 4-A）─────────
  { id: "weapon_myth", tier: 5, kind: "gear", slot: "weapon", name: "弒神之槍", icon: "🔱", price: 20000, effect: { power: 2200, speed: 70, luck: 30 }, desc: "武器：戰力 +2200，速度 +70，氣運 +30。" },
  { id: "armor_myth", tier: 5, kind: "gear", slot: "armor", name: "神骸鎧甲", icon: "🪽", price: 15000, effect: { power: 1300, injuryShield: 0.35, dodge: 0.08, defense: 140, hp: 250 }, desc: "防具：戰力 +1300，防禦 +140，生命 +250，受傷時 35% 機率少受一級，閃避 +8%。" },
];

export const SHOP_KIND_LABELS = { gear: "裝備", potion: "藥水" };
export const SHOP_SLOT_LABELS = { weapon: "武器", armor: "防具" };

export function getShopItem(id) {
  return SHOP_ITEMS.find((i) => i.id === id);
}
