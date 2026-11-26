// 副本首通特殊獎勵（第二批試玩回饋，Phase 3-1）：27 個原本 specialRewards 為空的世界各補 3 件（首通時隨機掉 1 件，永久生效）。
// 名稱是哈基米第二批稿（第四批換入）；id 不要動（舊存檔收藏紀錄靠它）。ch1_01／03／05 的獎勵在 dungeons.js 的 REAL_WORLDS。
//
// 效果（2026-11-26 起改成 14 種新效果框架，見 data/collectionFx.js 與 CONFIG.collection；**特殊物品絕不加通過率／戰力**）。
// 2b（2026-11-26）：哈基米配好 90 件的正式效果，表裡直接寫效果 key；P／G／R／S 舊代號只保留相容（LEGACY_KIND），不再使用。
// 數值預設 = CONFIG.collection.effects[key].unit，尾王 × CONFIG.collection.bossMult。

import { CONFIG } from "./config.js";
import { describeFx } from "./collectionFx.js";

export const LEGACY_KIND = { P: "intelGain", G: "insightChance", R: "rewardPct", S: "injuryShield" };

/** 世界 id → 3 件獎勵 [id, 名稱, 效果key]。id 跟著物品走、不隨世界改（舊存檔收藏靠 id）；同世界 3 件的順序就是畫面順序。
 *  2b 修正（2026-11-26，蘇爾審查 ITEM-NAME-AUDIT）：14 組名字整組搬去主題相符的世界（id 不動）；6 個世界（ch1_04、ch1_boss、ch3_04、ch3_boss、ch4_02、ch5_04）的 18 件新名由哈基米補齊，
 *  新 id 一律 `{世界}_n1／_n2／_n3`（與舊 id 不衝突）。ch1_01／03／05 的 9 件在 dungeons.js 的 REAL_WORLDS。 */
export const WORLD_REWARDS = {
  ch1_02: [["ch1_02_r1", "黑血", "healBoost"], ["ch1_02_r2", "碎骨刀", "shopDiscount"], ["ch1_02_r3", "染血繃帶", "injuryShield"]],
  ch1_04: [["ch1_04_n1", "斷裂的項圈", "deathSave"], ["ch1_04_n2", "染血號碼牌", "rewardPct"], ["ch1_04_n3", "空投信號彈", "intelGain"]],
  ch1_boss: [["ch1_boss_n1", "暴龍斷齒", "karmaDrop"], ["ch1_boss_n2", "化石心臟", "healBoost"], ["ch1_boss_n3", "翼龍羽骨", "hiddenRoom"]],
  ch2_01: [["ch2_04_r1", "沙蟲牙", "rewardPct"], ["ch2_04_r2", "舊水壺", "upkeepCut"], ["ch2_04_r3", "防風鏡", "intelGain"]],
  ch2_02: [["ch4_02_r1", "血酒杯", "bondLove"], ["ch4_02_r2", "銀樁", "deathSave"], ["ch4_02_r3", "蒼白獠牙", "rewardPct"]],
  ch2_03: [["ch3_05_r1", "金甲蟲", "rewardPct"], ["ch3_05_r2", "裹屍布", "deathSave"], ["ch3_05_r3", "法老權杖", "shopDiscount"]],
  ch2_04: [["ch1_04_r1", "鏽齒輪", "upkeepCut"], ["ch1_04_r2", "煤灰瓶", "hiddenRoom"], ["ch1_04_r3", "黃銅懷錶", "intelGain"]],
  ch2_05: [["ch2_02_r1", "鹽晶", "sanityGuard"], ["ch2_02_r2", "舊船票", "hiddenRoom"], ["ch2_02_r3", "深海藤壺", "injuryShield"]],
  ch2_boss: [["ch2_boss_r1", "龍血石", "healBoost"], ["ch2_boss_r2", "逆鱗", "deathSave"], ["ch2_boss_r3", "斷角", "insightChance"]],
  ch3_01: [["ch3_boss_r1", "古神觸鬚", "karmaDrop"], ["ch3_boss_r2", "瘋人日記", "insightChance"], ["ch3_boss_r3", "黑石碑", "sanityGuard"]],
  ch3_02: [["ch2_01_r1", "義眼", "intelGain"], ["ch2_01_r2", "廢晶片", "karmaDrop"], ["ch2_01_r3", "霓虹燈管", "sanityRegen"]],
  ch3_03: [["ch2_03_r1", "狐面", "tensionEase"], ["ch2_03_r2", "紙燈籠", "sanityRegen"], ["ch2_03_r3", "斷弦三味線", "bondLove"]],
  ch3_04: [["ch3_04_n1", "禁咒殘頁", "insightChance"], ["ch3_04_n2", "賢者石碎片", "shopDiscount"], ["ch3_04_n3", "元素恆定環", "injuryShield"]],
  ch3_05: [["ch1_boss_r1", "蟲母毒腺", "deathSave"], ["ch1_boss_r2", "幾丁質甲", "injuryShield"], ["ch1_boss_r3", "腦核", "insightChance"]],
  ch3_boss: [["ch3_boss_n1", "審判之矛碎片", "karmaDrop"], ["ch3_boss_n2", "避雷神紋", "sanityGuard"], ["ch3_boss_n3", "殘破羽人翼", "upkeepCut"]],
  ch4_01: [["ch3_01_r1", "仙人骨", "insightChance"], ["ch3_01_r2", "廢丹渣", "healBoost"], ["ch3_01_r3", "斷劍穗", "bondLove"]],
  ch4_02: [["ch4_02_n1", "斬魂刀殘刃", "insightChance"], ["ch4_02_n2", "虛之半面", "tensionEase"], ["ch4_02_n3", "靈子凝結體", "sanityRegen"]],
  ch4_03: [["ch4_01_r1", "星塵", "karmaDrop"], ["ch4_01_r2", "重力環", "injuryShield"], ["ch4_01_r3", "航行黑盒", "intelGain"]],
  ch4_04: [["ch4_04_r1", "魔神灰", "karmaDrop"], ["ch4_04_r2", "勇者斷劍", "tensionEase"], ["ch4_04_r3", "魔王戒", "shopDiscount"]],
  ch4_05: [["ch4_05_r1", "業火種", "karmaDrop"], ["ch4_05_r2", "判官筆", "insightChance"], ["ch4_05_r3", "生死簿殘頁", "deathSave"]],
  ch4_boss: [["ch4_boss_r1", "泰坦核心", "upkeepCut"], ["ch4_boss_r2", "神血結晶", "healBoost"], ["ch4_boss_r3", "雷霆之矛", "rewardPct"]],
  ch5_01: [["ch4_03_r1", "時之砂", "deathSave"], ["ch4_03_r2", "斷指針", "hiddenRoom"], ["ch4_03_r3", "莫比烏斯環", "insightChance"]],
  ch5_02: [["ch5_01_r1", "維度碎片", "hiddenRoom"], ["ch5_01_r2", "二向箔", "karmaDrop"], ["ch5_01_r3", "觀測眼", "intelGain"]],
  ch5_03: [["ch5_04_r1", "舊日遺骨", "deathSave"], ["ch5_04_r2", "黃衣殘布", "sanityGuard"], ["ch5_04_r3", "銀鑰匙", "hiddenRoom"]],
  ch5_04: [["ch5_04_n1", "封神榜殘卷", "deathSave"], ["ch5_04_n2", "先天葫蘆籽", "bondLove"], ["ch5_04_n3", "誅仙陣圖角", "intelGain"]],
  ch5_05: [["ch5_05_r1", "源代碼", "intelGain"], ["ch5_05_r2", "廢棄光碟", "shopDiscount"], ["ch5_05_r3", "管理員金鑰", "hiddenRoom"]],
  ch5_boss: [["ch5_boss_r1", "主神碎片", "karmaDrop"], ["ch5_boss_r2", "創世泥板", "insightChance"], ["ch5_boss_r3", "終焉之冠", "rewardPct"]],
};

/** 找不到合適世界、留檔備用的 6 組 18 件（不列入 90 件，世界不會掉）。仍要能用 id 查到：舊存檔收藏裡可能有，deserialize 對不上的 id 會被丟掉。數值照非尾王單件值。 */
export const ARCHIVED_REWARDS = [
  ["ch2_05_r1", "蠟封信", "intelGain"],
  ["ch2_05_r2", "鳥嘴面具", "sanityGuard"],
  ["ch2_05_r3", "放血刀", "healBoost"],
  ["ch3_02_r1", "夢境沙", "sanityRegen"],
  ["ch3_02_r2", "陀螺", "sanityGuard"],
  ["ch3_02_r3", "碎鏡片", "hiddenRoom"],
  ["ch3_03_r1", "黑羽毛", "tensionEase"],
  ["ch3_03_r2", "荊棘冠", "injuryShield"],
  ["ch3_03_r3", "告解書", "sanityRegen"],
  ["ch3_04_r1", "輻射塵", "karmaDrop"],
  ["ch3_04_r2", "蓋革錶", "intelGain"],
  ["ch3_04_r3", "鉛盒", "injuryShield"],
  ["ch5_02_r1", "因果線", "insightChance"],
  ["ch5_02_r2", "命運紡錘", "tensionEase"],
  ["ch5_02_r3", "剪刀", "injuryShield"],
  ["ch5_03_r1", "虛無結晶", "karmaDrop"],
  ["ch5_03_r2", "反物質瓶", "upkeepCut"],
  ["ch5_03_r3", "白洞核", "sanityRegen"],
];

function makeReward(id, name, key, mult) {
  const v = Math.round(CONFIG.collection.effects[key].unit * mult * 1000) / 1000;
  return { id, name, desc: describeFx(key, v), effect: { [key]: v } };
}

/** 依世界（id／boss）組出該世界的首通特殊獎勵陣列；沒有登錄的世界回傳 []。尾王世界的 3 件 × CONFIG.collection.bossMult（看「世界」不看物品原 id） */
export function buildWorldRewards(world) {
  const mult = world.boss ? CONFIG.collection.bossMult : 1;
  return (WORLD_REWARDS[world.id] ?? []).map(([id, name, key]) => makeReward(id, name, key, mult));
}

export const ARCHIVED_REWARD_LIST = ARCHIVED_REWARDS.map(([id, name, key]) => makeReward(id, name, key, 1));
