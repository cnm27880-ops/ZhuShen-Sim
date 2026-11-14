// 位面侵蝕 1★～10★（Phase 4-F-3）。純規則，不碰畫面。數字：CONFIG.erosion。
//   解鎖：首通第 3 章尾王（空間等級 >= 4）。任何「已首通」的世界可選星級 k（0 = 正常）：
//     有效推薦戰力 = 基礎 R × 1.45^k、通關積分與戰利品 = × 1.32^k、成功通關固定掉 k 顆侵蝕結晶（升級高階基建用）。
//   run.erosion = k；dungeon.js 的 dungeonOfRun／startRun／finishRun 掛鉤，這個檔案只放純函式。

import { CONFIG } from "../data/config.js";

const E = () => CONFIG.erosion;

export const erosionUnlocked = (state) => (state.spaceLevel ?? 1) >= E().unlockSpaceLevel;
export const erosionRMult = (k) => (k > 0 ? E().rMult ** k : 1);
export const erosionRewardMult = (k) => (k > 0 ? E().rewardMult ** k : 1);

/** 這個副本現在能不能打 k★？回傳 null（可以）或原因；k = 0 永遠可以 */
export function erosionBlock(state, dungeon, k) {
  if (!k) return null;
  if (!Number.isInteger(k) || k < 1 || k > E().maxStar) return `侵蝕星級要 1～${E().maxStar}`;
  if (!erosionUnlocked(state)) return `首通第 3 章尾王（空間 Lv.${E().unlockSpaceLevel}）後才解鎖位面侵蝕`;
  if ((state.dungeonStats?.[dungeon.id]?.clears ?? 0) <= 0) return "只有已首通的世界能挑戰侵蝕";
  return null;
}

/** 套上侵蝕對副本推薦戰力的倍率；回傳新物件，不動資料表 */
export function applyErosion(dungeon, k) {
  return k > 0 ? { ...dungeon, recommendedPower: Math.round(dungeon.recommendedPower * erosionRMult(k)), erosion: k } : dungeon;
}
