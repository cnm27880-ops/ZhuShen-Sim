// 後端的上限與規則（伺服器端政策，跟遊戲平衡數字分開；要調只改這裡）。
export const LIMITS = {
  maxSaveBytes: 900_000,      // 單一存檔上限（D1 單列大小上限約 2 MB，需驗證；留餘裕）
  maxBodyBytes: 1_000_000,    // 任何請求內容上限
  scoreMinIntervalMs: 30_000, // 同一個人更新排行榜的最短間隔
  top: 20,                    // 排行榜顯示名次
  snapKeep: 200,              // 每日排名快照記錄前幾名
  caps: { level: 5, roster: 500, clears: 1000, power: 1_000_000_000, life: 100_000 }, nameMax: 20, // 合理範圍，超過直接拒絕
};
// 榜單名稱 → 資料庫欄位（白名單，避免 SQL 注入）：空間等級、副本通關數、最強輪迴者、最長壽輪迴者
export const BOARDS = { level: "level", clears: "clears", power: "best_power", life: "longest_life" };
