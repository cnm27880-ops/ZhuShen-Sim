// 測試用：商店階級改看章節尾王首通（第二批試玩回饋 16），舊測試用「累積花費」開階，這裡把舊門檻換算成尾王首通紀錄。
// 舊門檻：600 → Tier 2、3000 → Tier 3、12000 → Tier 4、45000 → Tier 5（Tier 6 要用 setShopTier）。

/** 直接指定商店階級（1~6）：把第 1 ~ (tier-1) 章尾王標成已首通，其餘清掉 */
export function setShopTier(state, tier) {
  state.chapterClearDay = {};
  for (let ch = 1; ch < tier; ch++) state.chapterClearDay[ch] = 1;
}

/** 舊寫法 `state.totalSpent = n` 的替身：照舊門檻換算成階級，totalSpent 照樣設定（只當統計） */
export function setSpentTier(state, spent) {
  state.totalSpent = spent;
  setShopTier(state, spent >= 45000 ? 5 : spent >= 12000 ? 4 : spent >= 3000 ? 3 : spent >= 600 ? 2 : 1);
}
