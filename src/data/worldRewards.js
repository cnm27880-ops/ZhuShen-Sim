// 副本首通特殊獎勵（第二批試玩回饋，Phase 3-1）：27 個原本 specialRewards 為空的世界各補 3 件（首通時隨機掉 1 件，永久生效）。
// 名稱是哈基米第二批稿（第四批換入）；種類（P／G／R／S）與效果是小克定的，改名字不動效果，id 不要動。ch1_01／03／05 的獎勵在 dungeons.js（ch1_03、ch1_05 的名字也已換成哈基米稿）。
//
// 效果類型（引擎 engine/shop.js collectionEffects 已支援的 4 種，沒有新增機制）：
//   P = passBonus   所有副本單房通過率加成
//   G = genreBonus  該世界類型（靈異／科幻／奇幻）副本的通過率加成
//   R = rewardPct   所有副本通關積分加成
//   S = injuryShield 全員受傷時「少受一級」的機率（不是減傷幅度）
// 數字（REWARD_VALUE）：普通關 P 1%／G 3%／R 3%／S 3%，尾王 ×1.5。
// 因為收藏全部疊加，總量上限在 CONFIG.collection（passCap／genreCap／rewardCap／injuryShieldCap），避免 30 個世界全收完把通過率堆到爆。

export const REWARD_VALUE = { P: 0.01, G: 0.03, R: 0.03, S: 0.03 };
export const BOSS_REWARD_MULT = 1.5;

/** 世界 id → 3 件獎勵 [名稱, 類型]；順序即 id 後綴 _r1／_r2／_r3 */
export const WORLD_REWARDS = {
  ch1_02: [["黑血", "P"], ["碎骨刀", "R"], ["染血繃帶", "S"]],
  ch1_04: [["鏽齒輪", "G"], ["煤灰瓶", "S"], ["黃銅懷錶", "P"]],
  ch1_boss: [["蟲母毒腺", "G"], ["幾丁質甲", "R"], ["腦核", "S"]],
  ch2_01: [["義眼", "G"], ["廢晶片", "S"], ["霓虹燈管", "R"]],
  ch2_02: [["鹽晶", "P"], ["舊船票", "S"], ["深海藤壺", "R"]],
  ch2_03: [["狐面", "G"], ["紙燈籠", "S"], ["斷弦三味線", "R"]],
  ch2_04: [["沙蟲牙", "P"], ["舊水壺", "S"], ["防風鏡", "R"]],
  ch2_05: [["蠟封信", "G"], ["鳥嘴面具", "R"], ["放血刀", "P"]],
  ch2_boss: [["龍血石", "S"], ["逆鱗", "R"], ["斷角", "G"]],
  ch3_01: [["仙人骨", "G"], ["廢丹渣", "P"], ["斷劍穗", "S"]],
  ch3_02: [["夢境沙", "P"], ["陀螺", "S"], ["碎鏡片", "R"]],
  ch3_03: [["黑羽毛", "G"], ["荊棘冠", "S"], ["告解書", "P"]],
  ch3_04: [["輻射塵", "P"], ["蓋革錶", "R"], ["鉛盒", "S"]],
  ch3_05: [["金甲蟲", "S"], ["裹屍布", "G"], ["法老權杖", "R"]],
  ch3_boss: [["古神觸鬚", "G"], ["瘋人日記", "P"], ["黑石碑", "S"]],
  ch4_01: [["星塵", "G"], ["重力環", "S"], ["航行黑盒", "R"]],
  ch4_02: [["血酒杯", "G"], ["銀樁", "S"], ["蒼白獠牙", "P"]],
  ch4_03: [["時之砂", "P"], ["斷指針", "S"], ["莫比烏斯環", "R"]],
  ch4_04: [["魔神灰", "G"], ["勇者斷劍", "S"], ["魔王戒", "R"]],
  ch4_05: [["業火種", "G"], ["判官筆", "S"], ["生死簿殘頁", "P"]],
  ch4_boss: [["泰坦核心", "P"], ["神血結晶", "S"], ["雷霆之矛", "R"]],
  ch5_01: [["維度碎片", "P"], ["二向箔", "S"], ["觀測眼", "R"]],
  ch5_02: [["因果線", "G"], ["命運紡錘", "S"], ["剪刀", "R"]],
  ch5_03: [["虛無結晶", "G"], ["反物質瓶", "S"], ["白洞核", "P"]],
  ch5_04: [["舊日遺骨", "P"], ["黃衣殘布", "G"], ["銀鑰匙", "S"]],
  ch5_05: [["源代碼", "P"], ["廢棄光碟", "S"], ["管理員金鑰", "R"]],
  ch5_boss: [["主神碎片", "P"], ["創世泥板", "G"], ["終焉之冠", "R"]],
};

const pct = (v) => `${Math.round(v * 1000) / 10}%`;

/** 依世界（id／boss／genre）組出該世界的首通特殊獎勵陣列；沒有登錄的世界回傳 [] */
export function buildWorldRewards(world) {
  const mult = world.boss ? BOSS_REWARD_MULT : 1;
  return (WORLD_REWARDS[world.id] ?? []).map(([name, kind], i) => {
    const v = Math.round(REWARD_VALUE[kind] * mult * 1000) / 1000;
    const id = `${world.id}_r${i + 1}`;
    if (kind === "P") return { id, name, desc: `所有副本通過率 +${pct(v)}。`, effect: { passBonus: v } };
    if (kind === "G") return { id, name, desc: `${world.genre}副本通過率 +${pct(v)}。`, effect: { genreBonus: { [world.genre]: v } } };
    if (kind === "R") return { id, name, desc: `所有副本通關積分 +${pct(v)}。`, effect: { rewardPct: v } };
    return { id, name, desc: `全員受傷時多 ${pct(v)} 機率少受一級。`, effect: { injuryShield: v } };
  });
}
