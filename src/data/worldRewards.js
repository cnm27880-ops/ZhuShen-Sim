// 副本首通特殊獎勵（第二批試玩回饋，Phase 3-1）：27 個原本 specialRewards 為空的世界各補 3 件（首通時隨機掉 1 件，永久生效）。
// 名稱是哈基米第二批稿（第四批換入）；id 不要動（舊存檔收藏紀錄靠它）。ch1_01／03／05 的獎勵在 dungeons.js（ch1_03 見 REAL_WORLDS）。
//
// 效果（2026-11-26 起改成 14 種新效果框架，見 data/collectionFx.js 與 CONFIG.collection；**特殊物品絕不加通過率／戰力**）。
// 2b（2026-11-26）：哈基米配好 90 件的正式效果，表裡直接寫效果 key；P／G／R／S 舊代號只保留相容（LEGACY_KIND），不再使用。
// 數值預設 = CONFIG.collection.effects[key].unit，尾王 × CONFIG.collection.bossMult。

import { CONFIG } from "./config.js";
import { describeFx } from "./collectionFx.js";

export const LEGACY_KIND = { P: "intelGain", G: "insightChance", R: "rewardPct", S: "injuryShield" };

/** 世界 id → 3 件獎勵 [名稱, 效果key（或 [名稱, key, 自訂數值]）]；順序即 id 後綴 _r1／_r2／_r3 */
export const WORLD_REWARDS = {
  ch1_02: [["黑血", "healBoost"], ["碎骨刀", "shopDiscount"], ["染血繃帶", "injuryShield"]],
  ch1_04: [["鏽齒輪", "upkeepCut"], ["煤灰瓶", "hiddenRoom"], ["黃銅懷錶", "intelGain"]],
  ch1_boss: [["蟲母毒腺", "deathSave"], ["幾丁質甲", "injuryShield"], ["腦核", "insightChance"]],
  ch2_01: [["義眼", "intelGain"], ["廢晶片", "karmaDrop"], ["霓虹燈管", "sanityRegen"]],
  ch2_02: [["鹽晶", "sanityGuard"], ["舊船票", "hiddenRoom"], ["深海藤壺", "injuryShield"]],
  ch2_03: [["狐面", "tensionEase"], ["紙燈籠", "sanityRegen"], ["斷弦三味線", "bondLove"]],
  ch2_04: [["沙蟲牙", "rewardPct"], ["舊水壺", "upkeepCut"], ["防風鏡", "intelGain"]],
  ch2_05: [["蠟封信", "intelGain"], ["鳥嘴面具", "sanityGuard"], ["放血刀", "healBoost"]],
  ch2_boss: [["龍血石", "healBoost"], ["逆鱗", "deathSave"], ["斷角", "insightChance"]],
  ch3_01: [["仙人骨", "insightChance"], ["廢丹渣", "healBoost"], ["斷劍穗", "bondLove"]],
  ch3_02: [["夢境沙", "sanityRegen"], ["陀螺", "sanityGuard"], ["碎鏡片", "hiddenRoom"]],
  ch3_03: [["黑羽毛", "tensionEase"], ["荊棘冠", "injuryShield"], ["告解書", "sanityRegen"]],
  ch3_04: [["輻射塵", "karmaDrop"], ["蓋革錶", "intelGain"], ["鉛盒", "injuryShield"]],
  ch3_05: [["金甲蟲", "rewardPct"], ["裹屍布", "deathSave"], ["法老權杖", "shopDiscount"]],
  ch3_boss: [["古神觸鬚", "karmaDrop"], ["瘋人日記", "insightChance"], ["黑石碑", "sanityGuard"]],
  ch4_01: [["星塵", "karmaDrop"], ["重力環", "injuryShield"], ["航行黑盒", "intelGain"]],
  ch4_02: [["血酒杯", "bondLove"], ["銀樁", "deathSave"], ["蒼白獠牙", "rewardPct"]],
  ch4_03: [["時之砂", "deathSave"], ["斷指針", "hiddenRoom"], ["莫比烏斯環", "insightChance"]],
  ch4_04: [["魔神灰", "karmaDrop"], ["勇者斷劍", "tensionEase"], ["魔王戒", "shopDiscount"]],
  ch4_05: [["業火種", "karmaDrop"], ["判官筆", "insightChance"], ["生死簿殘頁", "deathSave"]],
  ch4_boss: [["泰坦核心", "upkeepCut"], ["神血結晶", "healBoost"], ["雷霆之矛", "rewardPct"]],
  ch5_01: [["維度碎片", "hiddenRoom"], ["二向箔", "karmaDrop"], ["觀測眼", "intelGain"]],
  ch5_02: [["因果線", "insightChance"], ["命運紡錘", "tensionEase"], ["剪刀", "injuryShield"]],
  ch5_03: [["虛無結晶", "karmaDrop"], ["反物質瓶", "upkeepCut"], ["白洞核", "sanityRegen"]],
  ch5_04: [["舊日遺骨", "deathSave"], ["黃衣殘布", "sanityGuard"], ["銀鑰匙", "hiddenRoom"]],
  ch5_05: [["源代碼", "intelGain"], ["廢棄光碟", "shopDiscount"], ["管理員金鑰", "hiddenRoom"]],
  ch5_boss: [["主神碎片", "karmaDrop"], ["創世泥板", "insightChance"], ["終焉之冠", "rewardPct"]],
};

/** 依世界（id／boss／genre）組出該世界的首通特殊獎勵陣列；沒有登錄的世界回傳 [] */
export function buildWorldRewards(world) {
  const mult = world.boss ? CONFIG.collection.bossMult : 1;
  return (WORLD_REWARDS[world.id] ?? []).map(([name, kind, custom], i) => {
    const key = LEGACY_KIND[kind] ?? kind;
    const v = Math.round((custom ?? CONFIG.collection.effects[key].unit * mult) * 1000) / 1000;
    return { id: `${world.id}_r${i + 1}`, name, desc: describeFx(key, v), effect: { [key]: v } };
  });
}
