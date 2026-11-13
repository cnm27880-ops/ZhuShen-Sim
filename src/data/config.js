// 主神空間主管模擬器 —— 所有「可調整的數字」都集中在這個檔案。
// 想調整遊戲平衡（價格、維持費、傷勢天數…）只要改這裡，不用動其他程式碼。
// 數字來源：docs/GAME_DESIGN_PLAN.md 第 19 節；標了「計畫未定」的是 Phase 1 先填的暫定值。

export const CONFIG = {
  // ── 時間 ──
  ticksPerDay: 10, // 一天切成 10 個時段（tick）
  tickMs: 2000, // 1x 速度下，每個時段的真實毫秒數（一天 = 20 秒）
  roomMs: 2400, // 1x 速度下，副本每走一個房間的真實毫秒數
  roomTicks: 2, // 每個房間 = 0.2 天 = 2 個時段（5 個房間剛好 1 天）
  speeds: [1, 2, 5, 10],

  // ── 開局（計畫未定）──
  startingPoints: 150,
  startingSamsarites: 3,
  startingRank: "C",

  // ── 經濟 ──
  upkeepBase: 10, // 每人每天基礎維持費
  debtLimit: -500, // 主神高利貸上限
  debtShockSanity: 10, // 負債期間每天電擊一人，理智 -10
  recycle: { points: 30, sanityLoss: 5 }, // 主神回收爐（理智扣多少：計畫未定）

  // ── 副本 ──
  partyMax: 4, // 一隊最多幾人（計畫未定）
  dungeon: {
    rooms: 5,
    roomsToClear: 3, // 5 個房間要通過幾個才算通關（計畫寫法有歧義，見 README「待確認」）
    basePassRate: 0.5, // 計畫書 5.8：戰力剛好等於推薦戰力時，單房通過率只有 50%
    minPassRate: 0.05,
    maxPassRate: 0.95,
    // 房間失敗時，受害者傷勢「加重幾級」的機率權重（計畫只寫「隨機決定」）
    injuryRoll: [
      { levels: 1, weight: 65 },
      { levels: 2, weight: 27 },
      { levels: 3, weight: 8 },
    ],
    // 首次開荒（還沒通關過、沒有情報）：通過率扣分、受傷更重（計畫 5.6，數字為建議值）
    firstClearPenalty: 0.1,
    firstClearInjuryRoll: [
      { levels: 1, weight: 45 },
      { levels: 2, weight: 38 },
      { levels: 3, weight: 17 },
    ],
    firstClearBonus: 50, // 首次通關額外 +50 分
    replayBonus: 0.05, // 重打已通關副本（有情報）通過率 +5%（計畫 5.5）
    // 獎勵遞減（計畫 5.7）：用「這是第幾次通關」查表，從上往下第一個符合的生效
    rewardTiers: [
      { upTo: 1, mult: 1.0 }, // 首次通關：基礎值（另外加 firstClearBonus）
      { upTo: 3, mult: 1.2 },
      { upTo: 5, mult: 1.0 },
      { upTo: 10, mult: 0.8 },
      { upTo: Infinity, mult: 0.6 }, // 地板價
    ],
  },

  // ── 標籤（Phase 2）──
  tags: {
    tagBonusCap: 0.3, // 全隊標籤對「單房通過率」的加減上限（避免標籤疊太高）
    // 新輪迴者的標籤數量：基礎數值標籤 2 個 + 性格機制標籤 1~2 個 + 靈魂核心標籤 1 個
    statCount: 2,
    traitCount: [1, 2],
    // 稀有度抽選權重（計畫 4.2；MVP 沒有 UR 標籤，抽不到就自動略過）
    rarityWeights: { N: 45, R: 30, SR: 15, SSR: 8, UR: 2 },
    injuryShieldMax: 0.9, // 傷勢減免機率上限
  },

  // ── 自動派遣 ──
  auto: {
    minClearChance: 0.6, // 預估通關率低於這個數字就不自動派（計畫未定）
    targetClearChance: 0.9, // 通關率到這個數字就算「夠穩」，不再多派人（計畫未定）
    maxCandidates: 14, // 最多拿戰力前幾名來排列組合（避免人太多時算太久）
    dispatchAtTick: 5, // 每天第幾個時段檢查一次自動派遣
  },

  logMax: 300,
};

// 階級：維持費加成 + 各屬性的隨機範圍（屬性範圍：計畫未定）
export const RANKS = {
  C: { upkeep: 0, power: [34, 42], hp: [80, 100], defense: [8, 12], speed: [8, 12], luck: [1, 10] },
  B: { upkeep: 5, power: [42, 54], hp: [110, 140], defense: [12, 18], speed: [10, 16], luck: [1, 12] },
  A: { upkeep: 10, power: [68, 84], hp: [150, 190], defense: [18, 26], speed: [14, 22], luck: [1, 15] },
  S: { upkeep: 20, power: [105, 135], hp: [210, 260], defense: [26, 38], speed: [20, 30], luck: [1, 20] },
};

// 傷勢等級：索引 0~3。超過 3 = 死亡。
export const INJURIES = [
  { name: "無傷", restDays: 0, upkeep: 0, deathBonus: 0 },
  { name: "輕傷", restDays: 1, upkeep: 5, deathBonus: 0.2 },
  { name: "重傷", restDays: 3, upkeep: 15, deathBonus: 0.5 },
  { name: "致命傷", restDays: 7, upkeep: 30, deathBonus: 0.8 },
];

// 卡池：純隨機、不保底
export const GACHA_POOLS = [
  { id: "ba", name: "B~A 池", cost: 150, odds: [{ rank: "B", weight: 70 }, { rank: "A", weight: 30 }] },
  { id: "as", name: "A~S 池", cost: 400, odds: [{ rank: "A", weight: 70 }, { rank: "S", weight: 30 }] },
];

// 會觸發「自動暫停」的事件種類。之後的 Phase 要加新事件（許願、生小孩…）只要在這裡加一行。
export const PAUSE_EVENTS = {
  death: { label: "有人死掉", default: true },
  runEnd: { label: "副本結算", default: true },
  debt: { label: "開始負債（主神高利貸）", default: true },
  healed: { label: "有人傷癒", default: false },
  autoIdle: { label: "自動派遣找不到合適隊伍", default: false },
};
