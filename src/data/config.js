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
    // Phase 4-C-3 維持費改制：單人日費 = round((基因鎖基準費 + 空間環境底費) ×（1 + 階級附加 + 傷勢醫藥費附加））
    upkeepGene: [8, 16, 35, 80, 180], // 個人基因鎖基準費，索引 = geneLock 0～4
    upkeepSpace: [0, 3, 7, 16, 36], // 空間環境底費，索引 = 空間等級 - 1
    debtLimit: [-500, -1500, -4500, -12000, -30000], // 主神高利貸上限（破產線）
    newbieUpkeepMult: 0.5, // 新手期（空間 Lv.1）每日維持費倍率（4-E-7：前期連負吃土，減免 50%）
  },

  // ── 經濟 ──
  debtShockSanity: 10, // 負債期間每天電擊一人，理智 -10
  recycle: { sanityLoss: 5 }, // 主神回收爐：其他人理智扣多少（計畫未定）；返還積分改看階級 RANKS[rank].recycleRefund（4-C-3）
  // 絕境空投（4-C-3）：存活人數（不含催熟艙）< minAlive 且積分 < pointsBelow，連續滿 everyDays 天，主神免費空投 1 名新人
  // rescue：true 時空投當作安全網，「沒人又借不到錢」不再直接判遊戲結束（否則全滅當下就死檔，空投來不及；4-C-6）
  airdrop: { minAlive: 2, pointsBelow: 120, everyDays: 3, rank: "C", rescue: true },
  // 商店 5 階的解鎖門檻：「累積花費」（抽卡也算）達到才開放。索引 0 = Tier 1（Phase 4-A）
  shopTierUnlock: [0, 600, 3000, 12000, 45000],
  shopDodgeMax: 0.9, // 閃避機率上限（標籤 + 商店加成加起來）

  // ── 雙錢包活體經濟（Phase 4-D-1）──
  // state.points = 主神公庫（維持費、抽卡、賞賜裝備、公庫補助強化／突破、黑市手動刷新）；每位輪迴者另有私房錢 s.wallet。
  // 副本結算總積分先抽 taxRate 入公庫，剩下由當場存活隊員平分進私房錢（全滅則全歸公庫）。
  tax: {
    default: 0.4,
    min: 0.2,
    max: 0.8,
    step: 0.1,
    lowAt: 0.3, // taxRate <= lowAt：在空間成員每日理智 +lowSanity
    lowSanity: 1,
    highAt: 0.6, // taxRate >= highAt（且 < crushAt）：每日理智 -highSanity
    highSanity: 2,
    crushAt: 0.8, // taxRate >= crushAt：每日理智 -crushSanity
    crushSanity: 4,
    deficitMinRate: 0.75, // 公庫赤字（積分 < 0）時，結算分潤臨時以 max(稅率, 這個數字) 抽稅抵債（不改 state.taxRate；4-E-7）
  },
  wallet: {
    giftSanity: 5, // 公庫買裝備賞賜給角色：該角色理智 +5（並標記綁定）
    deathForfeitPct: 0.5, // 戰死／被抹殺：私房錢這個比例充公回公庫，其餘消散（主動回收則 100% 歸公庫）
  },

  // ── 商店與黑市（Phase 4-D-2）──
  shop: {
    consumableCap: 3, // 出征耗材緩衝區最多囤幾份（下次出征全部套用，單場）
    worldPassCap: 0.06, // 全隊「特產裝備綁定世界通過率加成」合計上限
  },
  market: {
    refreshDays: 3, // 每幾天自動刷新一次 8 格黑市
    // 分槽保底（順序 = 格子編號）：3 格特產武防 + 2 格特產血統 + 2 格耗材 + 1 格黑貨
    slotPlan: ["gear", "gear", "gear", "bloodline", "bloodline", "consumable", "consumable", "contraband"],
    curTierWeight: 2, // 抽樣：目前解鎖最高階的商品權重
    prevTierWeight: 1, // 抽樣：前一階的商品權重
    manualBase: [50, 150, 450, 1200, 3000], // 手動刷新基礎價（公庫付），索引 = 空間等級 - 1；同日第 n 次刷新 = 基礎價 × n
    lockLimit: 1, // 最多免費鎖定幾格（刷新不會洗掉）
    intelDiscount: 0.85, // 特產綁定的世界情報滿格 → 85 折
  },

  // ── 動態任務榜、突變與奇物（Phase 4-D-4；詞綴資料在 src/data/mutations.js、奇物在 src/data/relics.js）──
  board: {
    slots: 3, // 常規任務槽數（尾王常駐、不佔槽）
    rotateDays: 2, // 每幾天自動輪換（不動已有隊伍出發的槽）；派隊的槽結算後立即補新槽
    // 抽槽時的章節權重（依「離目前最高已解鎖章」的距離）：同章、前一章、更早每章
    chapterWeight: { top: 5, prev: 3, older: 1 },
  },
  relic: {
    powerCap: 0.25, // 全部奇物的全隊有效戰力加成總和硬封頂
    greedyChance: 0.2, // 貪婪探索：通關後追加隱藏房的機率（濃霧走散 ×2）
    hiddenRMult: 1.35, // 隱藏房推薦戰力 R 倍率
    dupRewardPct: 0.5, // 已擁有的隱藏奇物 → 轉為額外積分（該副本基礎獎勵 × 這個比例）
    autoGreedyAt: 0.75, // 自動派遣：預估通關率達到這個數字且情報滿格就啟用貪婪探索
  },

  // ── 輪迴者自主逛街（Phase 4-D-3）──
  shopping: {
    maxActionsPerDay: 2, // 每人每天最多幾次購買／強化動作
    reservePct: 0.2, // 自主強化／敗家後，私房錢至少留這個比例當備用金
    calmBelow: 45, // 理智低於這個數字，優先買回理智耗材
    lowSanity: 45, // 理智低於這個數字算「低理智者」（愛搞事）
    dramaChance: 0.05, // 愛搞事的人，每天偷買 drama 黑貨對隊友使用的機率（4-D-7：露葵拍板由 15% 下修為 5%）
    dramaCooldownDays: 10, // 同一個人買過黑貨後，這麼多天內不會再偷買（保留偶發吃瓜驚喜感）
    tagWeight: { survival: 1, aggro: 1, communal: 0.5, drama: 0.1 }, // 搶購黑市的基礎偏好（詞條會再乘 2）
    logKeep: 6, // 每人最近的自主購買紀錄留幾筆（s.shopLog）
  },

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
    bondLove: 2, // 副本通關後，存活隊員兩兩之間「同行情誼」好感 +N（雙向；吊橋效應 ×1.5；4-D-4）
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

  // ── 主神強制血腥任務（Phase 4-C-4：4-A 拍板的數字，4-C 起正式啟用；文字在 src/data/mandatory.js）──
  forcedMission: {
    powerMult: 0.55, // R = max(本章基準, 前 4 強總戰力 × 0.55)，派最強 4 人約 77% 通關
    rooms: 5,
    toClear: 3,
    passCap: 0.8, // 單房通過率上限；不吃情報加成
    baseR: [160, 450, 1400, 3800, 9500], // 各空間等級的基準 R（4-C 後續：露葵 2026-11-14 由 [220,850,3600,15000,60000] 下修，只防「故意留菜鳥壓低動態難度」，避免剛升級就撞牆）
    reward: [260, 900, 3000, 9500, 30000],
    topN: 4, // 名冊前幾強的有效戰力總和拿來算 R
    startDay: 15, // 保護期：這天之後才開始計時（第一次觸發 = startDay + intervalDays）
    intervalDays: 12, // 兩次強制任務的間隔
    overPopIntervalDays: 6, // 人口超過軟上限時縮短成這個間隔
    popBase: 6, // 人口軟上限 = popBase + 空間等級 × popPerLevel（不含催熟艙嬰兒）
    popPerLevel: 2,
    deadlineDays: 2, // 觸發後幾天內必須派隊，否則抹殺
    purgeMin: 1, // 逾時抹殺人數 purgeMin～purgeMax（在主神空間內的人才會被抹殺）
    purgeMax: 2,
    purgeSanityLoss: 25, // 逾時抹殺後，全體存活者理智 -25
    failInjuryExtra: 1, // 單房失敗時受傷等級額外 +1
    deathRewardPct: 0.25, // 本場每戰死 1 名隊友，存活者結算總積分額外 +25%（加算）
  },

  // ── 戰鬥副屬性（Phase 4-C-1）：hp／defense／speed／luck 取總值 = stats（初始＋強化＋頓悟）＋裝備白值，不吃基因鎖乘區 ──
  combat: {
    defense: { k: 60, max: 0.65 }, // 受傷時觸發「傷勢少 1 級」的機率 = min(max, def ÷ (def + k))；原判輕傷則免傷
    speed: { k: 80, max: 0.5 }, // 副本戰死時觸發「極限閃避鎖血」（免死、改為致命傷）的機率 = min(max, spd ÷ (spd + k))
    hpRest: { base: 100, step: 40, chancePerStep: 0.25 }, // 超過 base 的部分每滿 step 點，每日休養 +chancePerStep 機率額外多恢復 1 級（可超過 100%）
    hpHalfPenalty: 180, // 總 hp 達到這個值，重傷／致命傷的戰力懲罰減半
    injuryPowerPct: [0, 0, -0.2, -0.4], // 傷勢等級（0 無傷／1 輕／2 重／3 致命）對個人有效戰力的百分比（Q2 暫定值，需驗證）
    luckReward: { perPoint: 0.005, max: 0.5 }, // 存活隊員平均 luck 每 1 點 +0.5% 結算積分，上限 +50%
  },

  // ── 英靈碑（Phase 4-C-5）：基因鎖 ≥ minGene 或出戰 ≥ minRuns 場的人，副本戰死／主神抹殺時入碑；碑上加成最高的前 topN 名生效 ──
  stele: {
    minGene: 1,
    minRuns: 15,
    topN: 4,
    bonusByGene: [0.02, 0.04, 0.08, 0.13, 0.2], // 依生前基因鎖 0～4 階，全隊有效戰力 +%（前 4 名合計最高 +80%）
    keep: 20, // 碑上最多留幾筆名單（其餘依加成低者淘汰）
  },

  // ── 理智閉環（Phase 4-C-2）：sanity 0～100 ──
  sanity: {
    // 由高到低；找第一個 sanity >= min 的檔位。powerPct 加進有效戰力的百分比區；clashMult 乘在隊內負面關係內鬥／背刺機率上
    tiers: [
      { min: 70, powerPct: 0, clashMult: 1 },
      { min: 30, powerPct: -0.1, clashMult: 1.5 },
      { min: 0, powerPct: -0.25, clashMult: 2.5 }, // 1～29（0 也算，反正日結會暴走）
    ],
    roomFailLoss: 5, // 副本單房失敗：受害者理智 -5
    teammateDeathLoss: 10, // 副本內同隊有人戰死：其他隊員理智 -10（取代舊的 deathFearSanity -3；空間內的死亡仍用 relations.deathFearSanity）
    restRecover: 3, // 人在主神空間（含帶傷休養）每日自然恢復
    crashDemonChance: 0.5, // 理智歸零日結：入魔砍傷隊友的機率（沒有其他人在空間就改自殘）；其餘自殘
    crashRecoverTo: 40, // 暴走發作後理智回升到
  },

  // ── 標籤（Phase 2）──
  tags: {
    tagBonusCap: 0.1, // 全隊標籤對「單房通過率」的加減上限（Phase 4-B：露葵拍板由 ±30% 改 ±10%）
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

  // ── 小隊隊長與五大流派（Phase 4-E；流派資料在 src/data/squadStyles.js，引擎在 engine/squad.js）──
  // 注意：關係矩陣的 love／hate 各自 0~100、不會是負的，所以規格裡的「好感」一律用「淨好感」= love - hate（-100~100）。
  squad: {
    forceStyle: null, // 測試／sim 專用：不是 null 時，所有隊長都強制開啟這個流派（communal／bond／farming／elite／mercenary）
    unlockSpaceLevel: 2, // 空間等級達到這個數字（首通第 1 章尾王）才啟用隊長系統
    captainPowerPct: 0.08, // 現任隊長個人有效戰力 +8%
    captainFailSanityCut: 1, // 隊長在隊出征時，全隊單房失敗的理智損耗 -1（最少扣 1）
    replaceBaseCost: 500, // 主神強行撤換令：公庫積分 = 這個數字 × 空間等級
    replaceCrystal: 1, // 撤換令另外消耗的因果結晶
    snubPowerRatio: 0.7, // 空降隊長戰力低於隊內最強老鳥的這個比例 → 不服空降
    snubSanity: 15, // 不服空降：戰力高於新隊長的老鳥理智 -15
    snubAffinity: 20, // 不服空降：對新隊長好感 -20
    coupGapPct: 0.15, // 雙強奪權：隊內戰力前兩名差距 < 15%
    coupAffinity: -15, // …而且雙方淨好感都 < -15（或兩人流派不同）
    coupLoserInjury: 1, // 奪權敗者 injury +1
    coupLoserSanity: 10, // 奪權敗者理智 -10
    seniorityLoveWeight: 2, // 和平順延（共產／羈絆）：分數 = 資歷天數 + 隊內平均好感 × 這個權重
    chronicleMax: 100, // 空間編年史最多留幾條
    // 流派機制（4-E-2）
    communal: { defenseBonus: 0.08, donatePct: 0.25, fundCapPerLevel: 15000, subsidyReserve: 0 }, // 4-E-7：捐獻率 50%→25%；互助金 >= 15000×空間等級 時老鳥暫停捐獻
    bond: { woundedWeight: 1.25, guardAffinity: 45, guardChance: 0.5, guardLove: 10, clearSanity: 4, steleMult: 1.5 },
    farming: { captainShare: 0.8, guardFeePct: 0.35, rookieUpkeepMult: 0.5, pigDeathReward: 0.2, pigStacks: 2, pigPowerPct: 0.12, dailyAffinity: -1, dailySanity: -1 },
    elite: { powerExp: 1.4, bossPowerMult: 1.15, failSanityMult: 2 },
    mercenary: { premium: 0.18, marketDiscount: 0.95, clashMult: 0.2, bondLoveMult: 0.5, worthBase: 100 },
  },

  // ── 5:2:1 人際與狗血修羅場（Phase 4-E-3；事件資料在 src/data/dramaEvents.js）──
  drama: {
    dailyChance: 0.25, // 每天結算時觸發一則空間日常人際事件的機率
    runChance: 0.3, // 副本成功結算（存活 2 人以上）時穿插一則人際事件的機率
    groupWeights: { bond: 5, friction: 2, melee: 1 }, // 熱血羈絆：派系摩擦：八點檔修羅場 = 5:2:1
    cooldownDays: 6, // 同一則事件同一組人的冷卻
    partnerAt: 65, // 淨好感雙向 >= 這個數字才會結成生死搭檔
    pairPowerPct: 0.04, // 生死搭檔同隊出征：雙方有效戰力各 +4%
    mentorSanity: 10, // 老鳥指導菜鳥：菜鳥理智回復
    feastSanity: 6, // 慶功宴：全體理智回復
    heirloomSanity: 8, // 擦拭遺物：理智回復
    tauntSanity: 6, // 強者嘲諷：弱者理智損失
    struggleWalletMin: 200, // 批鬥大會：私房錢超過這個數字才算「私藏小金庫」
    struggleConfiscate: 0.5, // 批鬥大會：充公比例（入互助金）
    coupTrigger: { affinity: -40, minConspirators: 2, win: 1.2 }, // 噬主夜襲：淨好感 <= -40 的成員 >= 2 人；隊長戰力 ×1.2 計算勝率
    contrabandWindowDays: 12, // 黑貨事發對質：只翻這幾天內的黑貨紀錄
    contrabandKeep: 6, // 黑貨紀錄最多留幾筆
  },

  // ── 跨代子嗣、先人遺物、叛逃野生 Boss（Phase 4-E-4；引擎在 engine/lineage.js）──
  lineage: {
    pairAffinity: 75, // 雙向淨好感 >= 75（而且都不是重傷以上）才有機會孕育
    birthChance: 0.02, // 符合條件的一對，每天孕育機率（4-E-7：5%→2%，目標自然演化每局子嗣 4～6）
    cooldownDays: 60, // 同一對孕育冷卻（4-E-7：30→60；3-F 戀人生子與孕育共用同一把雙親冷卻鎖）
    podDays: 7, // 培育期
    speedUpCostPerDay: 60, // 加速培育：每剩 1 天花公庫的積分 = 這個數字 × 空間等級
    talentPerGene: 0.05, // 天賦白值加成：家長平均基因鎖每 1 階 +5% 的子嗣基礎戰力
    talentFromParent: 0.5, // …加上家長自己的天賦比例 × 這個係數（代代相傳，但整體封頂）
    talentCap: 0.25, // 無論傳承幾代，天賦加成總上限（占子嗣基礎戰力的比例）硬封頂 +25%
    heirloomMinGene: 2, // 戰死時 geneLock >= 2（或現任隊長）才會留下遺物
    heirloomKeep: 8, // 遺物倉庫最多留幾件
    heirloomPct: 0.1, // 穿遺物：裝備白值 +10%
    heirloomFriendAffinity: 60, // 摯友門檻（淨好感）
    heirloomSanity: 10, // 子嗣／摯友穿上遺物：緬懷，理智 +10
    rogueMax: 5, // 叛逃野生 Boss 上限
    rogueAffinity: -45, // 叛逃條件（4-E-7 放寬）：對隊長淨好感 <= -45
    rogueSanity: 45, // 且（理智 < 45 或持有 rogueTag 詞條）
    rogueTag: "demon_path",
    rogueChance: 0.15, // 符合條件者每天叛逃機率
    rogueEncounter: 0.1, // 常規副本出征遭遇叛逃 Boss 的機率
    rogueRMult: 1.0, // 叛逃 Boss 戰力 = 該章常規關平均 R × 這個倍率
    rogueBountyPct: 0.5, // 擊敗賞金 = 該章一般關平均獎勵 × 這個比例（另加叛逃者帶走的私房錢）
    rogueCrystalChance: 0.35, // 擊敗後掉因果結晶機率
  },

  // ── 主神搞事（Phase 3-E；種類資料在 src/data/godEvents.js，數字全部「計畫未定」）──
  godEvent: {
    chance: 0.08, // 每天（沒在冷卻、沒有待回覆事件時）發生的機率
    cooldownDays: 5, // 發生後至少隔幾天才會再發生
    answerDays: 1, // 事件彈出後幾天內要回覆，沒回覆就視同「照辦」（突襲任務則視同抗命受罰）
    // 各種事件的數字。resolveCost = 花積分化解要多少（都比不化解的損失便宜）
    kinds: {
      // 臨時開銷稅：直接後果是純扣積分，所以化解不能只花更少的積分（4-E-7 修套利）：要花 resolveCost 分，再加全體留守者理智 -resolveSanityAll（異質代價）
      tax: { weight: 30, loss: [60, 120], resolveCost: 40, resolveSanityAll: 5 },
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
    bonusCap: 0.1, // 全隊關係對「單房通過率」的加減上限（Phase 4-B：露葵拍板由 ±30% 改 ±10%）
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

  // ── 基因鎖／強化／頓悟（Phase 4-B，露葵 2026-11-14 拍板）──
  // 基因鎖 geneLock 0~4 階：入隊 0 階；突破要「先點滿當階強化次數」「空間等級夠」「不超過自身階級上限」
  gene: {
    // 索引 = 基因鎖階數。enhanceCap = 該階強化次數上限；powerMult = 本體戰力乘區（只乘本體養成值，不乘裝備白值）
    // spaceLevel = 突破「到這一階」需要的空間等級；cost = 突破「到這一階」花的積分
    tiers: [
      { name: "凡人", enhanceCap: 3, powerMult: 1.0, spaceLevel: 1, cost: 0 },
      { name: "覺醒", enhanceCap: 6, powerMult: 2.2, spaceLevel: 2, cost: 300 },
      { name: "超凡", enhanceCap: 10, powerMult: 4.8, spaceLevel: 3, cost: 1200 },
      { name: "入聖", enhanceCap: 15, powerMult: 10.5, spaceLevel: 4, cost: 4500 },
      { name: "半神", enhanceCap: 20, powerMult: 23.0, spaceLevel: 5, cost: 16000 },
    ],
  },
  // 個人強化（取代舊商店強化）：每次增加的值 = round(base × 該階級成長倍率)；收費依「第 n 次強化」分段
  enhance: {
    gain: { power: 8, hp: 8, defense: 2, speed: 2, luck: 2 },
    costTiers: [
      { upTo: 3, cost: 80 },
      { upTo: 6, cost: 220 },
      { upTo: 10, cost: 650 },
      { upTo: 15, cost: 1800 },
      { upTo: 20, cost: 5000 },
    ],
  },
  // 常規通關頓悟：副本通關結算時，每位存活隊員獨立擲骰；每人累計上限 = (geneLock + 1) × capPerGene
  insight: {
    chance: 0.12,
    capPerGene: 4,
    gainPower: 3, // 戰力 +round(3 × 成長倍率)
    gainSub: 2, // 副屬性（hp／defense／speed／luck 四選一）+round(2 × 成長倍率)
    subStats: ["hp", "defense", "speed", "luck"],
  },
  // 尾王守門（防止零養成硬撞矇過）：各章第 4 關尾王需要「該章前 3 關合計成功結算滿 requiredClears 次」
  bossGate: { requiredClears: 8 },
  // 四階招募卡池（取代舊 150／400 雙池；Phase 4-B）。每 resetDays 天重置「本週抽數」（漲價計數），保底計數跨週保留
  // odds 順序 = C／B／A／S；pity = { every: 幾抽必出, minRank: 保底階級 } 或 null
  // 神級池：基礎 4500 分 + 每抽固定消耗 1 顆因果結晶（結晶不隨週內抽數遞增，只漲積分）
  gacha: {
    resetDays: 7, // Day 8、15、22… 重置（(day-1) % 7 === 0 且 day > 1）
    pools: [
      { id: "basic", name: "初級池（凡塵徵召）", spaceLevel: 1, base: 120, step: 20, crystal: 0, odds: { C: 75, B: 23, A: 2, S: 0 }, pity: null },
      { id: "mid", name: "中級池（精銳選拔）", spaceLevel: 2, base: 350, step: 60, crystal: 0, odds: { C: 30, B: 55, A: 15, S: 0 }, pity: { every: 10, minRank: "A" } },
      { id: "high", name: "高級池（超凡感應）", spaceLevel: 3, base: 1200, step: 200, crystal: 0, odds: { C: 0, B: 60, A: 35, S: 5 }, pity: { every: 25, minRank: "S" } },
      { id: "divine", name: "神級池（神格降臨）", spaceLevel: 4, base: 4500, step: 800, crystal: 1, odds: { C: 0, B: 25, A: 65, S: 10 }, pity: { every: 12, minRank: "S" } },
    ],
  },
  // 因果結晶：只用於神級池。firstClear = 該關首通必掉（4-D-4 起改用副本 id；30 世界後沿用 4-B 的供應量：第 3 章尾王 2 顆，第 4、5 章各取前 3 張常規關與尾王各 1 顆）；chapterRoll = 各章「任一副本通關」機率掉 1 顆（首通掉落與機率掉落各自獨立、可疊加）
  karma: {
    firstClear: { ch3_boss: 2, ch4_01: 1, ch4_02: 1, ch4_03: 1, ch4_boss: 1, ch5_01: 1, ch5_02: 1, ch5_03: 1, ch5_boss: 1 },
    chapterRoll: { 4: 0.15, 5: 0.25 },
  },

  // ── 自動派遣 ──
  auto: {
    minClearChance: 0.6, // 預估通關率低於這個數字就不自動派（計畫未定）
    targetClearChance: 0.9, // 通關率到這個數字就算「夠穩」，不再多派人（計畫未定）
    maxCandidates: 14, // 最多拿戰力前幾名來排列組合（避免人太多時算太久）
    dispatchAtTick: 5, // 每天第幾個時段檢查一次自動派遣
    holdForMandatory: true, // 強制任務待派時，前 4 強留給任務、等他們回家再派（期限前最後一個時段才硬派；4-C-6）
    missionFirst: true, // 有主神突襲任務時，自動派遣優先派任務目標去指定副本（通關率仍要達 minClearChance；Phase 3-E）
  },

  runReportMax: 20, // 排隊等玩家看的副本結算摘要最多留幾筆

  logMax: 300,
};

// 階級：維持費附加（基礎費的百分比）+ 各屬性的隨機範圍。
// Phase 4-A：所有人入隊時五維統一拉平為零階凡人；階級之後只決定成長倍率與基因鎖上限（Phase 4-B）。
// growthMult = 成長倍率（乘在每次強化與頓悟的增加量上）；maxGene = 基因鎖上限階數；
// recycleRefund = 回收返還積分（4-C-3 起接到回收爐）
const MORTAL = { power: [26, 34], hp: [90, 110], defense: [8, 14], speed: [8, 14], luck: [8, 14] };
export const RANKS = {
  C: { upkeepPct: 0, growthMult: 1.0, maxGene: 1, recycleRefund: 30, ...MORTAL },
  B: { upkeepPct: 0.25, growthMult: 1.25, maxGene: 2, recycleRefund: 80, ...MORTAL },
  A: { upkeepPct: 0.5, growthMult: 1.6, maxGene: 3, recycleRefund: 250, ...MORTAL },
  S: { upkeepPct: 1, growthMult: 2.0, maxGene: 4, recycleRefund: 800, ...MORTAL },
};

// 傷勢等級：索引 0~3。超過 3 = 死亡。upkeepPct = 醫藥費（基礎費的百分比；致命傷 150% 是小克依同比例推的暫定值，待確認）
export const INJURIES = [
  { name: "無傷", restDays: 0, upkeepPct: 0, deathBonus: 0 },
  { name: "輕傷", restDays: 1, upkeepPct: 0.25, deathBonus: 0.2 },
  { name: "重傷", restDays: 3, upkeepPct: 0.75, deathBonus: 0.5 },
  { name: "致命傷", restDays: 7, upkeepPct: 1.5, deathBonus: 0.8 },
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
  stele: { label: "有人名字刻上英靈碑", default: false },
  squad: { label: "隊長異動（冊封、順延、政變、撤換）", default: false },
  drama: { label: "狗血人際事件（慶功、批鬥、夜襲、修羅場）", default: false },
  mandatory: { label: "主神強制血腥任務（限時派隊，逾時抹殺）", default: true },
  birth: { label: "有小孩出生（進催熟艙）", default: true },
  hatch: { label: "催熟完成（小孩長成輪迴者）", default: true },
};
