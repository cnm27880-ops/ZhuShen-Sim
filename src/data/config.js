// 主神空間主管模擬器 —— 所有「可調整的數字」都集中在這個檔案。
// 想調整遊戲平衡（價格、維持費、傷勢天數…）只要改這裡，不用動其他程式碼。
// 數字來源：docs/GAME_DESIGN_PLAN.md 第 19 節；標了「計畫未定」的是 Phase 1 先填的暫定值。
// Phase 4-A（2026-11-14 露葵拍板）：空間等級、五章 20 關、飽和公式、情報條、五維統一。標「待 sim 驗證」的是基準草稿，用 npm run sim 校正。

export const CONFIG = {
  // ── 時間 ──
  ticksPerDay: 10, // 一天切成 10 個時段（tick）
  tickMs: 2000, // 1x 速度下，每個時段的真實毫秒數（一天 = 20 秒）
  roomMs: 2400, // 1x 速度下，副本每走一個房間的真實毫秒數
  roomTicks: 2, // 每個房間 = 0.2 天 = 2 個時段（5 房 = 1 天、7 房 = 1.4 天…12 房 = 2.4 天；Phase 4-A 起副本長度跟房數走）
  speeds: [1, 2, 5, 10],

  // ── 開局（Phase 4-A：送 3 個 C 級 + 600 分，夠補 1~2 抽並留緩衝）──
  startingPoints: 600,
  startingSamsarites: 3,
  startingRank: "C",

  // ── 空間等級（Phase 4-A）：Lv.1 開局，每首通一章尾王升 1 級（最高 Lv.5）。索引 0 = Lv.1 ──
  space: {
    maxLevel: 5,
    upkeepBase: [8, 16, 35, 80, 180], // 每人每天基礎維持費；階級／傷勢附加費是它的百分比（見 RANKS.upkeepPct、INJURIES.upkeepPct）
    debtLimit: [-500, -1500, -4500, -12000, -30000], // 主神高利貸上限（破產線）
  },

  // ── 經濟 ──
  debtShockSanity: 10, // 負債期間每天電擊一人，理智 -10
  recycle: { points: 30, sanityLoss: 5 }, // 主神回收爐（理智扣多少：計畫未定）
  // 商店 5 階的解鎖門檻：「累積花費」（抽卡也算）達到才開放。索引 0 = Tier 1（Phase 4-A）
  shopTierUnlock: [0, 600, 3000, 12000, 45000],
  shopDodgeMax: 0.9, // 閃避機率上限（標籤 + 商店加成加起來）

  // ── 副本 ──
  partyMax: 4, // 一隊最多幾人（計畫未定）
  dungeon: {
    // 五章的房數與過關門檻（直接寫死，不用公式，避免 6 房／12 房無條件進位變太難）。索引 0 = 第 1 章
    // 副本資料（src/data/dungeons.js）的 rooms 陣列長度必須等於該章 rooms（測試會檢查）
    chapters: [
      { rooms: 5, toClear: 3 },
      { rooms: 7, toClear: 4 },
      { rooms: 8, toClear: 5 },
      { rooms: 10, toClear: 6 },
      { rooms: 12, toClear: 7 },
    ],
    // 飽和公式：單房戰力基礎率 = scale × P ÷ (P + R × k)。P = 小隊總戰力、R = 推薦戰力；戰力再高也只會逼近 scale
    saturation: { scale: 0.85, k: 0.55 },
    // 情報條：每個副本獨立。第一次 start，之後每結算一場（不論成敗）+perRun，最多 max（8 場刷滿）
    intel: { start: -0.03, perRun: 0.015, max: 0.09 },
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
    firstClearBonusPct: 0.5, // 首次通關額外 + 基礎獎勵 × 50%（舊版固定 +50 分，對後期關卡太少；待 sim 驗證）
    // 獎勵遞減（計畫 5.7）：用「這是第幾次通關」查表，從上往下第一個符合的生效
    rewardTiers: [
      { upTo: 1, mult: 1.0 }, // 首次通關：基礎值（另外加 firstClearBonus）
      { upTo: 3, mult: 1.2 },
      { upTo: 5, mult: 1.0 },
      { upTo: 10, mult: 0.8 },
      { upTo: Infinity, mult: 0.75 }, // 地板價（刷圖低保倍率，Phase 4-A 由 0.6 調為 0.75）
    ],
  },

  // ── 主神強制血腥任務（Phase 4-D 才會用到，4-A 先記錄拍板數字）──
  forcedMission: {
    powerMult: 0.55, // R = max(本章基準, 前 4 強總戰力 × 0.55)，派最強 4 人約 77% 通關
    rooms: 5,
    toClear: 3,
    passCap: 0.8, // 單房通過率上限；不吃情報加成
    baseR: [220, 850, 3600, 15000, 60000], // 各空間等級的基準 R（待 sim 驗證）
    reward: [260, 900, 3000, 9500, 30000],
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

  // ── 許願系統（Phase 3-B）：輪迴者主動向主管許願，答應完成 → 高興；拒絕或超時 → 不爽 ──
  wish: {
    chance: 0.4, // 每人每天抽到「特殊事件」（dailyRoll 剩下的 20%）時，改成許願的機率（實際每人每天約 20% × 40% = 8%）
    dungeonPowerCap: 150, // 「想去副本」只會選推薦戰力不超過這個數字的副本（打不贏的副本不會許願）
    // 心情狀態：掛在輪迴者身上、持續 days 天，直接加減數值（不是標籤）
    moods: {
      happy: { label: "高興", icon: "😊", days: 5, passBonus: 0.05 }, // 每位高興的隊員讓單房通過率 +5%
      upset: { label: "不爽", icon: "😠", days: 5, powerPct: -0.1, sanityLoss: 10 }, // 戰力 -10%，變不爽那一刻理智 -10
    },
    moodPassCap: 0.15, // 全隊心情對單房通過率的加成上限（±）
    // 各種許願的數字（種類資料在 src/data/wishes.js）。days = 從許願那天起幾天內要處理（超時算失敗）
    kinds: {
      eat: { weight: 40, days: 2, cost: [30, 60] }, // 想吃好的：答應當下扣 cost 範圍內的積分
      vacation: { weight: 25, days: 2, restDays: [2, 3] }, // 想放假：休息 restDays 天，期間不能派遣、維持費照付
      dungeon: { weight: 20, days: 7 }, // 想去某個副本：期限內派他去並通關
      gear: { weight: 15, days: 5 }, // 想要某件商店裝備：期限內幫他買下
    },
  },

  // ── 生小孩與主神催熟艙（Phase 3-F；計畫書 §7，機率與繼承比例都是「計畫未定」的暫定值，需驗證）──
  child: {
    chance: { lover: 0.03, soulmate: 0.05 }, // 戀人／靈魂伴侶「雙方都在主神空間」時，每天懷上小孩的機率
    cooldownDays: 10, // 同一對生完後至少隔幾天才會再生
    maxInPod: 2, // 催熟艙同時最多幾個嬰兒（滿了就不再生）
    podDays: 3, // 催熟艙時間（計畫 §7.4）
    podUpkeep: 5, // 催熟期間每天維持費（計畫 §7.4）
    inheritChance: 0.7, // 每個標籤欄位改成「照抄父母同類標籤」的機率（其餘照一般抽卡隨機）
    rankUpChance: 0.1, // 小孩階級 = 隨機一位家長的階級，有這個機率再升一階（最高 S）
    familyLove: 30, // 出生時小孩與兩位家長互相的好感（30 還不到「喜歡」，不會直接加成出征）
  },

  // ── 主神搞事（Phase 3-E；種類資料在 src/data/godEvents.js，數字全部「計畫未定」）──
  godEvent: {
    chance: 0.08, // 每天（沒在冷卻、沒有待回覆事件時）發生的機率
    cooldownDays: 5, // 發生後至少隔幾天才會再發生
    answerDays: 1, // 事件彈出後幾天內要回覆，沒回覆就視同「照辦」（突襲任務則視同抗命受罰）
    // 各種事件的數字。resolveCost = 花積分化解要多少（都比不化解的損失便宜）
    kinds: {
      tax: { weight: 30, loss: [60, 120], resolveCost: 40 }, // 臨時開銷稅：扣 loss 範圍內的積分（可扣到負債，不低於高利貸上限）
      shock: { weight: 30, sanityLoss: 20, resolveCost: 30 }, // 電擊抽查：點名一人理智 -20
      checkup: {
        weight: 25,
        resolveCost: 20,
        injuryLevels: 1, // 健檢出事：傷勢加重幾級（最高致命傷）
        rewardPoints: [40, 80], // 健檢補償：拿積分
        rewardSanity: 15, // 健檢補償：回理智（上限 100）
        outcomes: [
          { type: "injury", weight: 40 },
          { type: "points", weight: 35 },
          { type: "sanity", weight: 25 },
        ],
      },
      raid: {
        weight: 15,
        days: 7, // 接下任務後的期限
        resolveCost: 80,
        dungeonPowerCap: 150, // 只會指定推薦戰力不超過這個數字的副本
        rewardPoints: [150, 250], // 通關獎勵
        penaltyPoints: 100, // 抗命或超時：扣積分，且被點名的人變「不爽」
      },
    },
  },

  // ── 關係系統（Phase 2-B；計畫第 6 節，標「計畫未定」的是暫定值）──
  relations: {
    // 關係等級門檻（好感／仇恨 0~100）
    likeAt: 50, // 喜歡（好感 50~79）
    adoreAt: 80, // 愛慕（好感 80+）
    dislikeAt: 50, // 討厭（仇恨 50~79）
    hateAt: 80, // 仇恨（仇恨 80+）→ 自動派遣「禁止仇恨／死敵同隊」會擋
    nemesisAt: 100, // 仇恨滿了就結成死敵
    soulmateAt: 95, // 戀人雙方好感都到這個數字 = 靈魂伴侶
    // 一起出戰的單房通過率加成（計畫 6.3；靈魂伴侶／死敵的數字計畫未定）
    passBonus: { like: 0.1, adore: 0.2, soulmate: 0.3, dislike: -0.1, hate: -0.2, nemesis: -0.25 },
    bonusCap: 0.3, // 全隊關係對「單房通過率」的加減上限（避免 4 人 6 對疊太高）
    // 每天的行動骰（計畫 13.1：50% 日常 / 30% 找人互動 / 20% 特殊事件）
    dailyRoll: { work: 0.5, social: 0.3 }, // 其餘 20% 是特殊事件（陰謀、標籤事件）
    eventCooldownDays: 7, // 同一對人、同一種互動 7 天內不重複
    hateDecayPerDay: 0.5, // 仇恨每天自然消退一點（死敵不消退）
    workSanity: 1, // 日常行動：理智 +1
    confessLove: 50, // 好感到這個數字才會告白
    confessSanityLoss: 8, // 被拒絕：告白者理智下降
    // 借刀殺人（計畫 6.6）：仇恨夠高才會動手腳
    schemeHate: 60,
    discoverChance: 0.25, // 被害者識破的機率（識破後對兇手仇恨 +discoverHate）
    discoverHate: 25,
    frameSanityLoss: 15, // 陷害成功：被害者被主神懲罰，理智下降
    sabotageDeathBonus: 0.3, // 裝備被破壞：下次出征被打中時，額外直接死亡機率
    rumorLove: -8, // 散播謠言：其他留守的人對被害者好感下降
    rumorHate: 5,
    // 直接動手殺人（會被主神懲罰，計畫 6.6）：只有仇恨極高的人才會
    directKillHate: 90,
    directKillChance: 0.15, // 抽到特殊事件、且仇恨夠高時，直接動手的機率
    directInjury: 1, // 沒殺成：被害者多受幾級傷
    punish: {
      points: 500, // 扣積分（可以扣到負債，不低於高利貸上限）
      weights: [
        { type: "points", weight: 50 },
        { type: "tag", weight: 30 }, // 洗掉一個標籤
        { type: "erase", weight: 20 }, // 直接抹殺
      ],
    },
    // 死亡連鎖（計畫 6.4）
    mournLove: 60, // 好感到這個數字（或有戀人／靈魂伴侶關係）才算「死者的戀人／死黨」
    mournerRoll: [
      { type: "breakthrough", weight: 1 },
      { type: "broken", weight: 1 },
      { type: "demon", weight: 1 },
    ],
    soulmateRoll: [
      { type: "broken", weight: 1 },
      { type: "demon", weight: 1 },
    ],
    breakthroughMult: 1.3, // 頓悟：全屬性 +30%
    brokenMult: 0.8, // 道心破碎：全屬性 -20%
    demonSanityLoss: 20,
    brokenSanityLoss: 15,
    inheritMult: 1.1, // 笑面虎偷遺產：全屬性永久 +10%
    inheritLove: -5, // 所有人對笑面虎好感 -5（沒人喜歡他）
    deathFearSanity: 3, // 其他人看到有人死，理智 -3
    // 副本內的互相傷害
    infightChance: { hate: 0.3, nemesis: 0.5 }, // 隊內有仇人／死敵時，每個房間互相攻擊的機率
    backstabChance: 0.1, // 背刺成癮者每個房間背刺隊友的機率
    protectChance: 0.25, // 愛慕／靈魂伴侶替對方擋下傷害的機率
    attackHate: 30, // 被隊友打了：對兇手仇恨 +30
  },

  // ── 自動派遣 ──
  auto: {
    minClearChance: 0.6, // 預估通關率低於這個數字就不自動派（計畫未定）
    targetClearChance: 0.9, // 通關率到這個數字就算「夠穩」，不再多派人（計畫未定）
    maxCandidates: 14, // 最多拿戰力前幾名來排列組合（避免人太多時算太久）
    dispatchAtTick: 5, // 每天第幾個時段檢查一次自動派遣
    missionFirst: true, // 有主神突襲任務時，自動派遣優先派任務目標去指定副本（通關率仍要達 minClearChance；Phase 3-E）
  },

  runReportMax: 20, // 排隊等玩家看的副本結算摘要最多留幾筆

  logMax: 300,
};

// 階級：維持費附加（基礎費的百分比）+ 各屬性的隨機範圍。
// Phase 4-A：所有人入隊時五維統一拉平為零階凡人；階級之後只決定成長倍率與基因鎖上限（Phase 4-B）。
const MORTAL = { power: [26, 34], hp: [90, 110], defense: [8, 14], speed: [8, 14], luck: [8, 14] };
export const RANKS = {
  C: { upkeepPct: 0, ...MORTAL },
  B: { upkeepPct: 0.25, ...MORTAL },
  A: { upkeepPct: 0.5, ...MORTAL },
  S: { upkeepPct: 1, ...MORTAL },
};

// 傷勢等級：索引 0~3。超過 3 = 死亡。upkeepPct = 醫藥費（基礎費的百分比；致命傷 150% 是小克依同比例推的暫定值，待確認）
export const INJURIES = [
  { name: "無傷", restDays: 0, upkeepPct: 0, deathBonus: 0 },
  { name: "輕傷", restDays: 1, upkeepPct: 0.25, deathBonus: 0.2 },
  { name: "重傷", restDays: 3, upkeepPct: 0.75, deathBonus: 0.5 },
  { name: "致命傷", restDays: 7, upkeepPct: 1.5, deathBonus: 0.8 },
];

// 卡池：純隨機、不保底
export const GACHA_POOLS = [
  { id: "ba", name: "B~A 池", cost: 150, odds: [{ rank: "B", weight: 70 }, { rank: "A", weight: 30 }] },
  { id: "as", name: "A~S 池", cost: 400, odds: [{ rank: "A", weight: 70 }, { rank: "S", weight: 30 }] },
];

// 會觸發「自動暫停」的事件種類。之後的 Phase 要加新事件（許願、生小孩…）只要在這裡加一行。
export const PAUSE_EVENTS = {
  death: { label: "有人死掉", default: true },
  relation: { label: "關係重大變化（告白、死敵、主神懲罰）", default: true },
  scheme: { label: "有人搞借刀殺人", default: false },
  runEnd: { label: "副本結算", default: true },
  debt: { label: "開始負債（主神高利貸）", default: true },
  healed: { label: "有人傷癒", default: false },
  autoIdle: { label: "自動派遣找不到合適隊伍", default: false },
  wish: { label: "輪迴者許願（彈窗讓你答應或拒絕）", default: true },
  godEvent: { label: "主神搞事（彈窗讓你照辦或花積分化解）", default: true },
  birth: { label: "有小孩出生（進催熟艙）", default: true },
  hatch: { label: "催熟完成（小孩長成輪迴者）", default: true },
};
