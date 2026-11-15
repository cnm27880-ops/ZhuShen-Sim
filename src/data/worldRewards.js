// 副本首通特殊獎勵（第二批試玩回饋，Phase 3-1）：27 個原本 specialRewards 為空的世界各補 3 件（首通時隨機掉 1 件，永久生效）。
// 名稱與主題對應 worlds.js 的 WORLD_TEXT；這裡是小克寫的初稿，等哈基米潤飾名稱即可（改名字不動效果，id 不要動）。
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
  ch1_02: [["末日生存手冊", "P"], ["廢棄超市補給", "R"], ["防咬護頸", "S"]],
  ch1_04: [["求生者的短刀", "G"], ["椰子殼儲水袋", "S"], ["倒數項圈解碼器", "P"]],
  ch1_boss: [["巨獸骨牙項鍊", "G"], ["史前琥珀", "R"], ["骸骨護甲片", "S"]],
  ch2_01: [["無名刀譜", "G"], ["黃沙水囊", "S"], ["俠客銀票", "R"]],
  ch2_02: [["血族貴賓請柬", "P"], ["純銀十字架", "S"], ["古堡酒窖珍藏", "R"]],
  ch2_03: [["法老黃金面具", "G"], ["木乃伊裹布", "S"], ["墓室陪葬金飾", "R"]],
  ch2_04: [["差分機齒輪", "P"], ["蒸氣護肘", "S"], ["工匠公會訂單", "R"]],
  ch2_05: [["骷髏旗", "G"], ["受詛金幣", "R"], ["海圖殘片", "P"]],
  ch2_boss: [["炎龍逆鱗", "S"], ["龍巢黃金", "R"], ["龍息護符", "G"]],
  ch3_01: [["獵魔人的銀彈", "G"], ["老煤氣燈", "P"], ["驅疫鳥嘴面具", "S"]],
  ch3_02: [["駭客晶片", "P"], ["義體維修券", "S"], ["財閥黑卡", "R"]],
  ch3_03: [["陰陽師符紙", "G"], ["式神御守", "S"], ["百鬼面具", "P"]],
  ch3_04: [["奧術羅盤", "P"], ["鍊金試劑", "R"], ["元素護盾符文", "S"]],
  ch3_05: [["蟲殼護甲", "S"], ["母皇費洛蒙", "G"], ["殖民星礦脈樣本", "R"]],
  ch3_boss: [["雷霆審判矛尖", "G"], ["天空城通行證", "P"], ["避雷神紋", "S"]],
  ch4_01: [["本命飛劍", "G"], ["築基丹", "S"], ["靈石礦脈", "R"]],
  ch4_02: [["斬魄刀碎片", "G"], ["往生符", "S"], ["靈子結晶", "P"]],
  ch4_03: [["聖戰勳章", "P"], ["動力甲殘片", "S"], ["軌道補給艙", "R"]],
  ch4_04: [["女武神羽飾", "G"], ["世界樹枝", "S"], ["神庭戰利品", "R"]],
  ch4_05: [["祖巫圖騰", "G"], ["太古龍骨", "S"], ["蠻荒獸皮", "P"]],
  ch4_boss: [["虛空之眼", "P"], ["引力護符", "S"], ["噬界殘骸", "R"]],
  ch5_01: [["時鐘塔齒輪", "P"], ["因果絲線", "S"], ["時間線紀念幣", "R"]],
  ch5_02: [["二向箔殘片", "G"], ["星際隱匿罩", "S"], ["星海通行證", "R"]],
  ch5_03: [["古神銀鑰", "G"], ["理智護身符", "S"], ["不可名狀的饋贈", "P"]],
  ch5_04: [["封神榜殘頁", "P"], ["先天靈寶", "G"], ["渡劫護符", "S"]],
  ch5_05: [["戴森環碎片", "P"], ["量子備份", "S"], ["機械神國配給", "R"]],
  ch5_boss: [["初代系統權限碼", "P"], ["叛逆者之證", "G"], ["神座殘光", "R"]],
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
