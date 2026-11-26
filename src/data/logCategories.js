// 主神日誌的分類（2026-11 試玩回饋第 11 項）：日誌每一條有個 type，這裡把 type 歸進七類篩選。
// 加新的日誌種類時，只要在 TYPE_CATEGORY 補一行；沒寫到的 type 會歸進「日常」。

/** 篩選列的按鈕：[分類 id, 顯示名稱]；all = 全部 */
export const LOG_CATEGORIES = [
  ["all", "全部"],
  ["drama", "狗血劇情"],
  ["battle", "戰鬥"],
  ["death", "死亡"],
  ["daily", "日常"],
  ["wish", "許願"],
  ["god", "主神"],
];

/** 每條日誌前面的小徽章字樣 */
export const LOG_BADGE = { drama: "狗血", battle: "戰鬥", death: "死亡", daily: "日常", wish: "許願", god: "主神" };

export const TYPE_CATEGORY = {
  // 狗血劇情：陰謀、狗血引擎（熱血羈絆／派系摩擦／修羅場）、衝突、小隊權力鬥爭
  // （social 日常互動與 relation 關係日常歸日常，2-1：不然狗血篩選會被泡麵與火鍋洗掉修羅場）
  scheme: "drama", drama: "drama", clash: "drama", squad: "drama", tension: "drama", grudge: "drama",
  social: "daily", relation: "daily", trait: "daily",
  // 戰鬥：副本過程與結算、受傷
  runStart: "battle", runParallel: "battle", runEnd: "battle", roomPass: "battle", roomFail: "battle", injury: "battle", injurySevere: "battle",
  dodge: "battle", mutation: "battle", env: "battle", greedy: "battle", erosion: "battle", rival: "battle", karma: "battle", relic: "battle",
  intel: "battle", dungeonEvent: "battle", board: "battle", sanityCrash: "battle",
  // 死亡
  death: "death", gameOver: "death", stele: "death", recycle: "death",
  // 許願
  wish: "wish", wishAccept: "wish", wishDone: "wish", wishFail: "wish",
  // 主神：搞事、強制任務、借錢
  god: "god", godEvent: "god", mandatory: "god", debt: "god", kpi: "god", levy: "god", kpiStart: "god", kpiWarn: "god", tithe: "god",
  // 日常：其餘（吃飯睡覺、買東西、抽卡、生小孩、基建…）
  dayEnd: "daily", shop: "daily", shopTier: "daily", market: "daily", wallet: "daily", gacha: "daily", gachaPity: "daily", birth: "daily",
  healed: "daily", lowSanity: "daily", shock: "daily", airdrop: "daily", facility: "daily", autoRisk: "daily", autoIdle: "daily", system: "daily", automation: "daily", autoFault: "daily",
};

export const categoryOf = (type) => TYPE_CATEGORY[type] ?? "daily";
