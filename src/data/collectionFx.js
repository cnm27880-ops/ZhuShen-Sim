// 副本特殊物品（收藏）的 14 種效果：名稱、圖示與說明文字（數字在 CONFIG.collection.effects）。
// 規則：特殊物品效果**絕對不能加副本通過率、不能加戰力**（露葵 2026-11-26 定案）；每件物品恰好 1 種效果 { 效果key: 數值 }。
// 掛鉤位置（engine/collectionFx.js 的 collectionEffects 取總和後套上限）：
//   insightChance growth.js rollInsights｜intelGain dungeon.js finishRun 情報條｜healBoost core.js endOfDay 傷勢恢復
//   injuryShield dungeon.js hurt｜rewardPct dungeon.js 結算積分｜sanityRegen core.js endOfDay 理智回復｜sanityGuard squad.js failSanityLoss
//   karmaDrop growth.js rollKarmaDrop｜hiddenRoom dungeon.js maybeOpenHiddenRoom｜upkeepCut core.js upkeepOf
//   shopDiscount shop.js／market.js 價格｜bondLove dungeon.js 同行情誼｜deathSave dungeon.js 速度鎖血｜tensionEase tension.js pairProfile

const pct = (v) => `${Math.round(v * 1000) / 10}%`;
const num = (v) => `${Math.round(v * 100) / 100}`;

export const COLLECTION_FX = {
  insightChance: { name: "頓悟機率", icon: "💡", desc: (v) => `通關頓悟機率 +${pct(v)}。` },
  intelGain: { name: "情報獲取", icon: "👁️", desc: (v) => `副本情報條獲取 +${pct(v)}。` },
  healBoost: { name: "傷勢恢復", icon: "🩹", desc: (v) => `每日傷勢多降 1 級的機率 +${pct(v)}。` },
  injuryShield: { name: "傷勢減免", icon: "🛡️", desc: (v) => `全員受傷時多 ${pct(v)} 機率少受一級。` },
  rewardPct: { name: "通關積分", icon: "💰", desc: (v) => `所有副本通關積分 +${pct(v)}。` },
  sanityRegen: { name: "理智回復", icon: "🌿", desc: (v) => `留守每日理智回復 +${num(v)}（全收集合計取整）。` },
  sanityGuard: { name: "理智守護", icon: "🧘", desc: (v) => `副本單房失敗理智損耗 -${num(v)}（全收集合計取整，最少仍扣 1）。` },
  karmaDrop: { name: "結晶掉率", icon: "💎", desc: (v) => `因果結晶機率掉落 +${pct(v)}（只加在原本有機率掉的章節）。` },
  hiddenRoom: { name: "隱藏房", icon: "🔍", desc: (v) => `貪婪探索開出隱藏房機率 +${pct(v)}。` },
  upkeepCut: { name: "維持費減免", icon: "🧾", desc: (v) => `每日維持費 -${pct(v)}。` },
  shopDiscount: { name: "商店折扣", icon: "🏷️", desc: (v) => `商店與黑市價格 -${pct(v)}。` },
  bondLove: { name: "同行情誼", icon: "🤝", desc: (v) => `同行情誼好感 +${num(v)}（全收集合計取整）。` },
  deathSave: { name: "死裡逃生", icon: "🍀", desc: (v) => `副本戰死時鎖血免死機率 +${pct(v)}。` },
  tensionEase: { name: "張力緩和", icon: "🕊️", desc: (v) => `人際張力事件產生率 -${pct(v)}。` },
};

export const FX_KEYS = Object.keys(COLLECTION_FX);

/** 單件物品的說明文字 */
export function describeFx(key, value) {
  return COLLECTION_FX[key].desc(value);
}
