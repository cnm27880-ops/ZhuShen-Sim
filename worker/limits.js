// 後端的上限與規則（伺服器端政策，跟遊戲平衡數字分開；要調只改這裡）。
export const LIMITS = {
  maxSaveBytes: 900_000,      // 單一存檔上限（D1 單列大小上限約 2 MB，需驗證；留餘裕）
  maxBodyBytes: 1_000_000,    // 任何請求內容上限
  scoreMinIntervalMs: 30_000, // 同一個人更新排行榜的最短間隔
  top: 20,                    // 排行榜顯示名次
  snapKeep: 200,              // 每日排名快照記錄前幾名
  caps: { score: 2_000_000_000, level: 5, roster: 500, clears: 60 }, // 合理範圍，超過直接拒絕
};
export const BOARDS = { score: "score", level: "level", clears: "clears" }; // 榜單名稱 → 欄位（白名單，避免 SQL 注入）
