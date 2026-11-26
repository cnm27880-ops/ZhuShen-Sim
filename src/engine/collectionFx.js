// 副本特殊物品（收藏）效果加總（露葵 2026-11-26：14 種效果框架，絕不加通過率／戰力；資料 data/collectionFx.js，數字 CONFIG.collection）。
// 純函式、不碰亂數。每件物品的 effect 是 { 效果key: 數值 }；跨物品加總後套各自上限。
// 加總結果用 WeakMap 依「收藏張數」快取（收藏只會增加），每日結算每人都會查維持費，不能每次重掃 90 件。
import { CONFIG } from "../data/config.js";
import { getSpecialReward } from "../data/dungeons.js";
import { FX_KEYS } from "../data/collectionFx.js";

const cache = new WeakMap();

export function emptyCollectionFx() {
  return Object.fromEntries(FX_KEYS.map((k) => [k, 0]));
}

/** 收藏全部加總（已套上限）：{ insightChance, intelGain, ..., tensionEase } 都是數字，沒收藏 = 全 0 */
export function collectionEffects(state) {
  const list = state?.collection ?? [];
  const hit = cache.get(state);
  if (hit && hit.len === list.length && hit.ref === list) return hit.total;
  const total = emptyCollectionFx();
  for (const id of list) {
    const e = getSpecialReward(id)?.effect;
    if (!e) continue;
    for (const k of FX_KEYS) total[k] += e[k] ?? 0;
  }
  for (const k of FX_KEYS) total[k] = Math.min(CONFIG.collection.effects[k].cap, total[k]);
  cache.set(state, { len: list.length, ref: list, total });
  return total;
}

/** 舊介面相容：特殊物品不再加通過率，永遠回傳 0 */
export function collectionPassBonus() {
  return 0;
}
