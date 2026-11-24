// 主神空間主管模擬器 —— 所有「可調整的數字」都集中在這個檔案。
// 想調整遊戲平衡（價格、維持費、傷勢天數…）只要改這裡，不用動其他程式碼。
// 數字來源：docs/GAME_DESIGN_PLAN.md 第 19 節；標了「計畫未定」的是 Phase 1 先填的暫定值。
// Phase 4-A（2026-11-14 露葵拍板）：空間等級、五章 20 關、飽和公式、情報條、五維統一。標「待 sim 驗證」的是基準草稿，用 npm run sim 校正。

export const CONFIG = {
  // ── 時間 ──
  ticksPerDay: 10, // 一天切成 10 個時段（tick）
  tickMs: 2500, // 1x 速度下，每個時段的真實毫秒數（一天 = 25 秒；4-E-8：由 2000 放慢 25%，後期人多時手操較從容）
  roomMs: 3000, // （4-E-8：由 2400 放慢 25%） 1x 速度下，副本每走一個房間的真實毫秒數
  roomTicks: 2, // 每個房間 = 0.2 天 = 2 個時段（5 房 = 1 天、7 房 = 1.4 天…12 房 = 2.4 天；Phase 4-A 起副本長度跟房數走）
  speeds: [0.5, 1, 2, 5, 10], // 0.5x 是慢速微操檔；鍵盤 1～5 對應這五檔（4-E-8）

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
  // 掛機壓力設計（A-3，露葵 2026-11 拍板）：空投取消（enabled=false，程式保留），團滅改成真結局（rescue=false）；改由下面的 ending 處理新手救濟
  airdrop: { enabled: false, minAlive: 2, pointsBelow: 120, everyDays: 3, rank: "C", rescue: false },
  // 團滅結局與評分（A-3；engine/ending.js）。數字都是暫定值，需露葵驗證
  ending: {
    protectDays: 15, // 遊戲天數 < 這個數字：不判負債結局；名冊死光時給一次性新手救濟（只有一次）
    debtGraceDays: 3, // 負債結局：頂到破產線（debtLimitOf）連續滿這麼多天才結束（副本結算可能還來得及補救）
    relief: { count: 3, rank: "C" }, // 新手救濟：保護期內第一次死光（且抽不起最便宜卡池）時，免費補幾名新人
    // 評分 = 各項加總（取整）：存活天數、首通尾王章數、總通關場數、英靈碑累計入碑數、公庫峰值（相對開局積分取 log10）、最高世代
    score: { perDay: 1, perBossChapter: 500, perClear: 10, perStele: 20, perGeneration: 100, peakLog: 100 },
    // 稱號：取分數 >= min 的最高一檔
    titles: [
      { min: 0, title: "三天就被換掉的主管" },
      { min: 150, title: "剛學會當社畜的主管" },
      { min: 600, title: "撐過一陣子的主管" },
      { min: 2000, title: "資深壓榨者" },
      { min: 6000, title: "讓主神記住名字的主管" },
      { min: 15000, title: "主神都想請教的傳奇主管" },
    ],
  },
  // 商店 6 階的解鎖條件（第二批試玩回饋 16）：改看章節尾王首通，不再看累積花費。索引 0 = Tier 1。
  // 值 = 要先首通哪一章的尾王（0 = 開局就有）。Tier 2 = 通關第 1 章尾王 … Tier 6 = 通關第 5 章尾王。
  shopTierBossChapter: [0, 1, 2, 3, 4, 5],
  // 副本首通特殊獎勵（收藏）全部疊加的上限（第二批回饋 3-1：30 個世界各有獎勵，避免堆到爆）。原本 3 個世界的總和遠低於這些上限
  collection: { passCap: 0.15, genreCap: 0.15, rewardCap: 0.3, injuryShieldCap: 0.5 }, // 全域通過率／單一類型通過率／通關積分／「全員受傷時少受一級」的機率（第三批決策 5）
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
    // 抗藥性（常駐藥的濫用防護）：同一個人、同一類藥（治傷／回理智各算）在滾動 days 天內用得越多次，效果越差。
    // mult[n] = 已用 n 次後的下一次效果倍率（超過就用最後一個）；治傷的「全癒」藥最多視為 healCap 級。
    // minBuyMult：逛街 AI 與一鍵批量使用，預期倍率低於這個數字就不買／不用，免得浪費。只管常駐商店的藥，黑市貨不受影響。
    tolerance: { days: 7, mult: [1, 0.5, 0.25, 0.1], healCap: 3, minBuyMult: 0.5 },
    demonTendencyChance: 0.05, // 穿著帶「入魔傾向」被動的裝備，每天獲得走火入魔詞條的機率（4-E-8；t5_36 必定入魔）
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
    harmSanityBelow: 50, // 理智低於這個數字，AI 禁買會害理智的黑貨與耗材（4-E-8）
    calmBelow: 45, // 理智低於這個數字，優先買回理智耗材
    lowSanity: 45, // 理智低於這個數字算「低理智者」（愛搞事）
    dramaChance: 0.05, // 愛搞事的人，每天偷買 drama 黑貨對隊友使用的機率（4-D-7：露葵拍板由 15% 下修為 5%）
    dramaCooldownDays: 10, // 同一個人買過黑貨後，這麼多天內不會再偷買（保留偶發吃瓜驚喜感）
    tagWeight: { survival: 1, aggro: 1, communal: 0.5, drama: 0.1 }, // 搶購黑市的基礎偏好（詞條會再乘 2）
    logKeep: 6, // 每人最近的自主購買紀錄留幾筆（s.shopLog）
    // 個性掛鉤（個性系統 v1b ②，暫定值需露葵驗證）：只看 s.traits.altruism 利他度，永不顯示數字；全部不抽亂數
    // aid：利他度 >= min 的人，替「買不起治傷藥的重傷同伴」轉帳（上限自己私房錢的 giftPctMax）讓對方買藥；冷卻 cooldownDays、每人每天最多 maxPerDay 次
    // hoard：利他度 <= -min 的人（利己），備用金比例多 extraReservePct，黑市搶購時黑貨權重 × contrabandWeightMult
    trait: {
      enabled: true,
      min: 40,
      aid: { cooldownDays: 3, maxPerDay: 1, giftPctMax: 0.3, minSanity: 45, allyInjury: 2 },
      hoard: { extraReservePct: 0.15, contrabandWeightMult: 3 },
    },
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
    // 派遣畫面「預估通關率」最高顯示幾 %（2026-11 露葵：單房 85% 不是必過、還要 N 房過 K 房，不該顯示 99%）。只影響顯示，不影響實際判定
    chanceDisplayCap: 95,
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
    // 天數底線壓力（A-3 階段 4，暫定值需露葵驗證）：只看天數、不記狀態；掛機者不會因為「沒人管」而自動變強，所以這裡逼他面對
    floorRampDay: 60, // 這天之前完全不加壓（新手期不受影響）
    floorIntervalStepDays: 30, // 從 floorRampDay 起，每過幾天把觸發間隔縮短一次
    floorIntervalShrink: 1, // 每次縮短幾天
    floorIntervalMin: 4, // 觸發間隔下限（天）；需大於 deadlineDays，玩家才有機會派隊
    floorRPerDay: 0.004, // 推薦戰力 R 乘數：從 floorRampDay 起每天 +0.4%
    floorRCap: 2, // R 乘數上限（×2，約 Day 310 封頂）
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
    groupWeights: { bond: 3, friction: 2, melee: 1 }, // 熱血羈絆：派系摩擦：八點檔修羅場 = 3:2:1（第二批回饋 19，露葵決定；修羅場演不了先退派系摩擦）
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
    pregnancyItemAffinity: 60, // 催生黑貨的對象：雙向淨好感 >= 60（4-E-8）
    pairAffinity: 75, // 雙向淨好感 >= 75（而且都不是重傷以上）才有機會孕育
    birthChance: 0.01, // 符合條件的一對，每天自然孕育基礎機率（4-E-8 收尾：固定 1.0%/天，不再為了壓子嗣總數下調；每局生多少交給小隊生態自然演化，sim 只記錄）
    bondBonus: 0.005, // 小隊流派是 bond（共生羈絆流）：每日孕育檢定 +0.5%
    cozyBonus: 0.015, // 雙方當日都留守空間、沒重傷，且處於「社交助興」狀態：每日孕育檢定額外 +1.5%
    cozyAffinity: 85, // 社交助興條件之二：雙向淨好感 >= 85 且雙方私房錢 >= cozyWallet（逛街的春宵小事件）
    cozyWallet: 500,
    cozyDays: 3, // 合道仙露（全隊好感耗材）的助興狀態持續幾天
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

  // ── 強徵私房錢（主管壓榨輪迴者的手段；引擎 engine/levy.js）──
  // 玩家手動發動，沒有自動版。對所有非催熟艙的輪迴者按比例徵收私房錢（100% 進公庫，不計入考核營收）。
  // 每人先保留「保命底線」（minReserve 與 reserveDays 天維持費取大者）。被徵者有機率拒繳：拒繳者不付錢，但對隊長好感扣更多。
  levy: {
    minReserve: 50, // 每人至少保留多少私房錢
    reserveDays: 3, // 或保留幾天的維持費（取大者）
    // 三檔：pct 徵收比例（對底線以上的部分）、sanity 付款者理智扣多少、affinity 付款者對隊長淨好感扣多少、
    // refuse 基礎拒繳率、cooldown 發動後全檔位共用的冷卻天數、mood 是否讓全員套用「不爽」心情（5 天，另扣 10 理智）
    tiers: [
      { id: "mild", name: "溫和募捐", icon: "🧧", pct: 0.2, sanity: 3, affinity: 0, refuse: 0.05, cooldown: 7, mood: false },
      { id: "firm", name: "強硬攤派", icon: "📜", pct: 0.4, sanity: 8, affinity: 5, refuse: 0.15, cooldown: 14, mood: false },
      { id: "raid", name: "全面搜刮", icon: "🏴\u200d☠️", pct: 0.7, sanity: 5, affinity: 15, refuse: 0.3, cooldown: 21, mood: true },
    ],
    // 拒繳率加成（疊加，最高 maxRefuse）：低理智、有戀人／靈魂伴侶在身邊護著、穿主管賞賜的綁定裝備（自恃是紅人）、對隊長淨好感為負
    refuseBonus: { lowSanity: 0.1, veryLowSanity: 0.2, partner: 0.1, soulbound: 0.1, negativeAffinity: 0.1 },
    lowSanityBelow: 60,
    veryLowSanityBelow: 30,
    maxRefuse: 0.9,
    refuseExtraAffinity: 5, // 拒繳者對隊長淨好感額外再扣這個數字（在該檔位的 affinity 之外）
    // 個性掛鉤（個性系統 v1b ①，暫定值需露葵驗證）：只看 s.traits 的順從度 obedience 與利他度 altruism，永不顯示數字
    // min／strong：|分數| 達到 min 算「有特色」、達到 strong 算「極端」；rebel 順從度低（叛逆）加拒繳率、selfish 利他度低（利己）加、
    // altruist 利他度高減；個性加成合計夾在 -capDown～+capUp，之後仍受 maxRefuse 與 0 下限約束。順從度高（聽話）暫不影響
    traitRefuse: {
      enabled: true,
      min: 40,
      strong: 70,
      rebel: { mid: 0.08, strong: 0.15 },
      selfish: { mid: 0.06, strong: 0.1 },
      altruist: { mid: 0.06, strong: 0.1 },
      capUp: 0.2,
      capDown: 0.1,
    },
  },

  // ── 輪迴者個性系統 v1a（隱藏的五條個性維度；引擎 engine/personality.js、engine/traitEvents.js）──
  // 每人五條軸各 -100～+100（永不顯示數字），由「遊戲種子＋輪迴者 id」雜湊產生，不吃主亂數。
  // 個性事件用 state.trait.rngState 獨立亂數流；效果刻意很小（理智、小額私房錢、對同伴好感），完全不動戰力與通過率，
  // 也不動對隊長的好感（避免推高私奔）。v1b 才接強徵拒繳與逛街 AI。
  personality: {
    enabled: true,
    sd: 28, // 分數標準差（四個均勻值相加近似常態）：單軸 |x|≥60 約 3%，至少一軸 ≥60 約 15%
    tagBias: 1, // 詞條偏移倍率（1 = 照 data/personality.js 的偏移表；0 = 關閉，個性與詞條完全獨立）
    eventChance: 0.03, // 每個留守者每天觸發個性事件的機率（每人每天固定消耗 1 次亂數）
    personCooldown: 10, // 同一個人兩次個性事件至少間隔幾天
    eventCooldown: 20, // 同一個人同一種事件至少間隔幾天
    eventMin: 40, // 該軸絕對值至少多少才會發生這條軸的事件／才算「有特色」
    archetypeAfter: 3, // 揭露過幾次側寫就給原型名稱（同軸可多次，每次句子不同）
    seenCap: 12, // 每人最多保留幾筆已揭露側寫（超過丟最舊的）
    sanityFloor: 1, // 個性事件扣理智不會扣到比這個低（避免觸發暴走）
    minWallet: 30, // 要掏錢／被收費的人，私房錢至少要有這麼多
    // 雙人碰撞事件（v1b ③，暫定值需露葵驗證；事件內容與效果數字在 data/traitEvents.js 的 TRAIT_DUETS）：
    // 每個留守者（非隊長）每天固定擲 1 次 chance，擲中就找「事件 × 對象」；隊長不當任何一方；冷卻沿用 personCooldown／eventCooldown；
    // 走獨立亂數流 state.trait.duetRngState（不動主亂數，也不動單人事件的亂數順序）
    duet: { enabled: true, chance: 0.02 },
    // 個性 v2（暫定值需露葵驗證；enabled=false 時副本擋刀／背刺、叛逃、私奔與 v1b 逐項相同）：
    // 擋刀只調「守護者」的機率（候選人仍是愛慕／靈魂伴侶，擲骰次數不變，不動主亂數順序）；
    // 非背刺詞條的「陰謀者」背刺走獨立亂數流 state.trait.clashRngState；叛逃／私奔只調門檻與免疫。
    v2: {
      enabled: true,
      min: 40, // 該軸絕對值至少多少才算「有特色」（跟 eventMin 同義，獨立設定）
      protect: { altruismHi: 1.4, altruismLo: 0.5, courageHi: 1.15, courageLo: 0.8, cap: 0.6 }, // 擋刀機率倍率（乘在 relations.protectChance 上）、機率上限
      schemer: { enabled: true, mult: 0.3 }, // 利他 <= -min 且野心 >= +min 的非背刺詞條者：每房背刺機率 = backstabChance × mult × 理智倍率 × 突變倍率
      loyalMin: 70, // 順從度 >= 這個值：叛逃、私奔 100% 免疫（死忠）
      defectShift: { obeyHi: -5, obeyLo: 5 }, // 叛逃淨好感門檻位移（順從度 >= min 收緊、<= -min 放寬；rogueAffinity -45 → -50／-40）
      elopeShift: { obeyHi: -10, obeyLo: 5 }, // 私奔淨好感門檻位移（elope.affinity -5 → -15／0）
    },
  },

  // ── 離心力：人際張力與怨氣（A-3 階段 2；引擎 engine/tension.js，事件資料 data/tensionEvents.js）──
  // 設計：每天對「都在主神空間的每一對人」擲張力機率，期望事件量隨在家人數平方成長，沒有任何人數上限。
  // 事件帶遊戲內期限（暫停不消耗）；玩家可調停／補償／拆開／無視。無視或逾期 → 怨氣上升；怨氣過門檻 → 叛逃／互殺／政變／抗命。
  // 以下全部是暫定值，需 sim 校正（--bot=idle／casual／full × --roster 掃描）。
  tension: {
    enabled: true,
    baseChance: 0.03, // 一對中性關係的人，每天產生張力事件的基礎機率（sim 校準：n=6 約每 20 天一件、n=24 約每天 0.7 件，讓 attention k=1 在大名冊忙不過來、k=3 勉強夠用）
    maxChance: 0.12, // 單一對每天機率上限
    hateMult: { dislike: 4, hate: 8, nemesis: 12 }, // 任一方向仇恨 >= 討厭線／仇恨線／死敵
    negAffinityMult: 2, // 雙向淨好感都 < 0
    ambitionMult: 3, // 野心 vs 野心（兩人都 >= personalityMin）
    altruismMult: 2.5, // 利他 vs 利己（一個 >= +min、一個 <= -min）
    personalityMin: 40,
    captainMult: 2, // 一方是隊長，另一方順從度 <= -min 且對隊長淨好感 <= captainAffinity
    captainAffinity: -15,
    triangleMult: 3, // 搶同一人（雙方對第三人淨好感都 >= fanAffinity）
    triangleLoverMult: 4, // …而且其中一方是第三人的戀人／靈魂伴侶
    fanAffinity: 45,
    lowSanity: [{ below: 30, mult: 2 }, { below: 60, mult: 1.3 }], // 兩人較低的理智
    grudgeDiv: 100, // 雙方怨氣加總 ÷ 這個數字 = 額外倍率（1 + (gA+gB)/100）
    // 預防（降低產生率）
    loverMult: 0.3, // 戀人／靈魂伴侶
    friendMult: 0.5, // 雙向淨好感都 >= friendAffinity
    friendAffinity: 50,
    apartMult: 0.2, // 「拆開」期間
    pairCooldown: 8, // 處理完（或爆發）後同一對至少隔幾天才會再有事
    deadlineDays: [3, 2, 1], // 等級 1／2／3 的處理期限（遊戲日，用 currentDay 計，暫停不消耗）
    // 無視逾期：雙方怨氣 + ignoreGrudge[等級-1]、互相仇恨 + ignoreHate，等級 1～2 升一級重發，等級 3 結束（爆發）
    // 2026-11 idle 掛機崩壞校準（露葵拍板目標：掛機崩壞中位數約 Day 100）：[10,15,20]／6 → [18,27,36]／7，只加重「不處理事件」的後果
    ignoreGrudge: [18, 27, 36],
    ignoreHate: 7,
    // 調停：成功率 = base + obedience×平均順從度/100 + captain×(隊長對雙方淨好感>=0 則加) + sanity×(兩人平均理智-50)/100，夾在 min~max；每件事只能試一次
    mediate: { base: 0.55, obedience: 0.15, captain: 0.1, sanity: 0.2, min: 0.2, max: 0.9, okGrudge: -15, okHate: -10, failGrudge: 5, failHate: 4 },
    // 補償（選一方）：花公庫 = costDays × 兩人日維持費 × 等級倍率 × (1.5 ^ 近期補償次數)
    compensate: { costDays: 3, levelMult: [1, 1.5, 2], repeatMult: 1.5, repeatWindow: 20, payeeGrudge: -25, payeeAffinity: 8, otherGrudge: 10, otherHate: 6 },
    // 拆開：指定一人放假（不能派遣），該對產生率降低
    apart: { vacationDays: 3, days: 6 },
    // 隊長自動調停（只處理等級 1、隊長不在事件裡、對雙方淨好感 >= 0、理智 >= captainSanity）
    captainAuto: { chance: 0.25, captainSanity: 50, grudge: -8, hate: -5 },
    // 怨氣
    grudgeDecay: 1, // 每天自然消退
    warnAt: 50, // 警報線（alerts.js；降到 rearmAt 以下重新武裝）
    rearmAt: 30,
    crisisAt: 70, // 達到就每天擲後果
    crisisChance: 0.12,
    afterOutcome: 35, // 後果發生後怨氣回到這個數字
    // 後果權重（available 才抽）：defect 叛逃／kill 互殺／coup 政變夜襲／defy 抗命（不爽心情，兜底）
    outcomes: { defect: 25, kill: 25, coup: 20, defy: 30 },
    courageWeight: 0.25, // 膽識每 +100 讓叛逃／互殺權重 × (1 + 0.25)；順從度 -100 同理（個性只改權重，不顯示數字）
    killMinHate: 60, // 互殺對象：仇恨最高且 >= 這個數字
    coupMinGrudge: 50, // 政變：怨氣 >= 這個數字且對隊長淨好感 <= 0 的人至少 minConspirators 個
    minConspirators: 2,
    elopeGrudge: 70, // 私奔候選：怨氣 >= 這個數字（rivals.js elopeCandidate）
    climate: [30, 60], // 空間氣氛等級線（最高怨氣）：平靜 / 暗流 / 一觸即發
  },

  // ── 自動化中樞（A-3 階段 3；引擎 engine/automation.js，名稱說明 data/automation.js）──
  // 設計（露葵 2026-11 拍板）：自動化要靠投資換來，而且不萬能（參考 ONI：自動化設施好用，但沒維護仍會出事）。
  //   - 花公庫買等級（空間等級門檻）；每天扣維護費，付不起就當天停擺（不借債）。
  //   - 故障：每天機率故障，故障後必須玩家手動「維修」才恢復（沒有自動修復）。
  //   - 容量上限：每天處理的件數固定；張力事件量約隨人數平方成長，容量只隨等級線性成長。
  //   - 自動調停永遠不處理等級 3 事件，也不會自動補償／拆開；成功率低於手動。
  // 未投資（全部 0 級）時完全不消耗亂數、不改變任何結果。以下全部是暫定值，需 sim 校正。
  automation: {
    enabled: true,
    repairMult: 10, // 維修費 = 該模組當級維護費 × 這個數字（公庫）
    modules: {
      // mediate 調解中樞：自動調停人際張力。陣列索引 = 等級 - 1
      mediate: {
        max: 3,
        unlockSpace: [2, 3, 4], // 買這一級需要的空間等級
        cost: [2000, 10000, 40000], // 買這一級的造價（公庫積分；階段 3 校準後下修，讓早期買得起）
        maint: [8, 25, 60], // 每日維護費
        fault: [0.03, 0.02, 0.01], // 每日故障機率
        capacity: [2, 3, 4], // 每日最多自動處理幾件
        maxEventLevel: [1, 2, 2], // 只處理等級 <= 這個數字的事件（等級 3 永遠留給人）
        chanceMult: [0.85, 0.9, 0.95], // 自動調停成功率 = 手動調停成功率 × 這個
      },
      // recruit 人力調度處：名冊低於目標就自動抽最便宜的卡池補人
      recruit: {
        max: 3,
        unlockSpace: [2, 3, 4],
        cost: [1500, 8000, 25000],
        maint: [12, 40, 100],
        fault: [0.03, 0.02, 0.01],
        rosterCap: [6, 10, 14], // 玩家可設定的名冊目標上限
        perDay: 1, // 每天最多補幾人
        reserveDays: [15, 12, 10], // 抽完後公庫仍要高於「目前每日維持費 × 這個天數」才抽
      },
    },
  },

  // ── 壓力系統（Phase A-2：主神抽成＋主神考核；引擎 engine/pressure.js）──
  // 設計：壓力錨定在公庫存量，不看天數或戰力（衝太快的玩家公庫還小，自然不被抽）。空間 Lv.1 完全零觸發；陣列索引 = 空間等級 - 1。
  pressure: {
    startLevel: 2, // 空間等級 >= 這個才啟動（Lv.1 新手期豁免）
    startDay: 30, // 且遊戲天數 >= 這個才開始第一期考核（第一次結算約在 Day 60）
    // 累進抽成：每日對公庫「超過免稅額 L 的部分」按邊際級距計稅（只對超額部分，跟個人所得稅一樣）
    exempt: [0, 40000, 150000, 500000, 1500000], // 免稅額 L（Lv.1 = 0 代表關閉）
    brackets: [ // upTo = 該級距上限（L 的倍數），rate = 每日稅率
      { upTo: 3, rate: 0.006 },
      { upTo: 10, rate: 0.015 },
      { upTo: Infinity, rate: 0.03 },
    ],
    dailyCapPct: 0.04, // 單日抽成不超過公庫的 3%（且抽完公庫不低於 L）
    logEveryDays: 7, // 日誌每幾天彙總一則抽成（避免洗版）
    // 主神考核：每期 reviewDays 天，三項過兩項算達標（通關數、營收、戰死人數）
    reviewDays: 30,
    needPass: 2,
    targetClears: [0, 18, 22, 27, 32], // 期間成功結算場數
    targetEarned: [0, 8000, 28000, 115000, 1100000], // 期間入公庫的積分（稅入）
    // 戰死上限 = 空間等級 - 1 人（副本戰死＋被主神抹殺）
    targetJitter: 0.1, // 通關數與營收目標在期初用獨立亂數流浮動 ±10%（主神臨時加碼）
    passSanity: 10, // 達標：全員理智 +10
    passTaxCutPct: 0.5, // 達標：之後一期累進抽成 -50%
    perfectFreeRefresh: 2, // 3 項全過：黑市免費手動刷新次數
    failSanity: 8, // 未達標：全員理智 -8（理智已 <= sanityFloor 的人不再扣，扣到最低停在 sanityFloor）
    sanityFloor: 20,
    failFinePct: 0.08, // 未達標罰金 = 公庫超過 L 部分的 8%
    failFineCapPct: 0.15, // 罰金最多公庫的 15%（且不低於 L）
    failTaxSurge: 0.5, // 未達標：之後一期累進抽成 +50%
    streakStep: 0.5, // 連敗加重：第 n 次連續未達標，罰金與理智 ×(1 + 0.5 × (n-1))，最多 streakMax
    streakMax: 2,
    reliefAfter: 2, // 連續未達標達這個次數，下期目標開始減免
    reliefStep: 0.15, // 每多一次 -15%
    reliefMax: 0.3, // 最多 -30%
    historyMax: 6, // 保留幾期的考核紀錄
    warnDays: 5, // 距離考核結算剩幾天時提醒一次
  },

  // ── 主神搞事（Phase 3-E；種類資料在 src/data/godEvents.js，數字全部「計畫未定」）──
  godEvent: {
    chance: 0.08, // 每天（沒在冷卻、沒有待回覆事件時）發生的機率
    cooldownDays: 5, // 發生後至少隔幾天才會再發生
    answerDays: 1, // 事件彈出後幾天內要回覆，沒回覆就視同「照辦」（突襲任務則視同抗命受罰）
    // 各種事件的數字。resolveCost = 花積分化解要多少（都比不化解的損失便宜）
    kinds: {
      // 臨時開銷稅：直接後果是純扣積分，所以化解不能只花更少的積分（4-E-7 修套利）：要花 resolveCost 分，再加全體留守者理智 -resolveSanityAll（異質代價）
      // lossPct（A-3 階段 4，暫定）：實際扣款 = max(loss 隨機值 × 章節倍率, 公庫 × lossPct)，早期仍是固定小額，後期才真的痛
      tax: { weight: 30, loss: [60, 120], lossPct: 0.03, resolveCost: 40, resolveSanityAll: 5 },
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

  // 天數對應章節（第四批 7、8 節，engine/dayChapter.js）：許願「想去副本」、突襲任務挑副本、主神搞事積分倍率共用
  dayChapter: {
    days: [30, 70, 175, 320], // 到第幾天進入第 2／3／4／5 章（sim 尾王首通中位數 32／73／175／322／382 取整，之後可再校正）
    godMult: [1, 3, 10, 30, 100], // 各章的主神搞事積分倍率（化解費、損失、補償、通關獎勵、抗命罰金；config 的原始數字是第 1 章基準）
    powerShare: 0.8, // 挑副本時：推薦戰力要 <= 名冊前 4 強有效戰力總和 × 這個數字，才算「打得動」
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
    // 第二批回饋 20：日常靜默、只寫關係進展。原本 work 0.5／social 0.3，12 人每天約 3.6 則社交日誌，隨人數線性膨脹
    dailyRoll: { work: 0.65, social: 0.15 }, // 其餘 20% 是特殊事件（陰謀、標籤事件）
    socialDailyCap: 3, // 全隊每天最多幾次社交互動；超過的社交骰改成日常（理智 +workSanity）
    socialLog: false, // 一般社交互動要不要寫進日誌（false = 只算好感／仇恨數字；告白、戀人、死敵、陰謀等關係進展照寫）
    // 互動優先找快要突破的那對：好感差不到 nearRange 就到告白線、仇恨差不到 nearRange 就到陰謀線或死敵線，挑人權重額外 +nearBonus
    nearRange: 30,
    nearBonus: 6,
    nearPickChance: 0.7, // 有「快要突破」的配對時，這次社交互動直接改由他們發生的機率（其餘照權重抽人）
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

  // ── 裝備轉移（功能 3）：被奪走裝備的人套用哪種心情（見 wish.moods）──
  gearTransfer: { mood: "upset" },

  // ── 自動派遣 ──
  auto: {
    minClearChance: 0.6, // 預估通關率低於這個數字就不自動派（計畫未定）
    targetClearChance: 0.9, // 通關率到這個數字就算「夠穩」，不再多派人（計畫未定）
    maxCandidates: 14, // 最多拿戰力前幾名來排列組合（避免人太多時算太久）
    dispatchAtTick: 5, // 每天第幾個時段檢查一次自動派遣
    holdForMandatory: true, // 強制任務待派時，前 4 強留給任務、等他們回家再派（期限前最後一個時段才硬派；4-C-6）
    defaultStrategy: "balanced", // 自動派遣風險策略預設（4-E-8）；sim 預設用 "off" 維持基準曲線
    strategies: { safe: 1.2, balanced: 1.0, aggressive: 0.8, balancedNewbie: 0.8 }, // 隊伍總戰力 >= 關卡有效推薦戰力 × 倍率才出擊（balancedNewbie：空間 Lv.1 新手期的均衡檔；A-3 Lv.1 修正由 0.85 放寬到 0.8，暫定值需露葵驗證）
    // 三種策略是一整套不同的行為（不只是戰力倍率）：minClear 通關率門檻、maxTeams 每輪（=每天）最多派幾隊、
    // maxInjury 隊員傷勢上限（0 無傷／1 輕傷／3 致命傷）、maxDeathRisk 預估「隊伍有人戰死」機率上限、reserve 至少留幾人在家休息。
    // 注意：玩家的 settings.protect.noInjured 開著時，傷員一律不派（策略只會比它更嚴，不會更鬆）。"off"（sim 基準曲線）不套用這些限制。
    rules: {
      safe: { minClear: 0.85, maxTeams: 1, maxInjury: 0, maxDeathRisk: 0.05, reserve: 2 },
      balanced: { minClear: 0.75, maxTeams: 2, maxInjury: 1, maxDeathRisk: 0.2, reserve: 1 },
      aggressive: { minClear: 0.6, maxTeams: 99, maxInjury: 3, maxDeathRisk: 1, reserve: 0 },
    },
    // 空間 Lv.1 新手期專用規則（A-3 Lv.1 經濟性團滅修正）：有列到的策略在 Lv.1 改用這組，Lv.2 起回到 rules；沒列到的策略不變。
    // 只放寬通關率門檻 minClear（0.75 → 0.6）；其餘維持 balanced。sim（idle、名冊 12、40 組種子 × 450 天）：Lv.1 破產／死光 33% → 15%、
    // Day≤60 死亡平均 1.95 → 2.38（+22%）。maxTeams／maxDeathRisk／reserve 單獨放寬幾乎沒有效果，所以不動。暫定值需露葵驗證。
    newbieRules: {
      balanced: { minClear: 0.6, maxTeams: 2, maxInjury: 1, maxDeathRisk: 0.2, reserve: 1 },
    },
    deathRehit: 0.5, // 死亡風險估算：同一人在副本裡被打中第二次時，戰死的平均機率（輕 20%／重 50%／致命 80% 的中間值，暫定，需驗證）
    riskLogEveryDays: 3, // 「任務風險過高，自動派遣暫緩出擊」最多每幾天提示一次
    missionFirst: true, // 有主神突襲任務時，自動派遣優先派任務目標去指定副本（通關率仍要達 minClearChance；Phase 3-E）
  },

  // ── 4-F-3 主神空間永久基建（引擎 engine/facilities.js；名稱說明在 data/facilities.js）──
  facility: {
    costGrowth: 1.45, // 各級造價等比遞增：第 n 級 = 第 1 級 × growth^(n-1)，總和 = totalCost
    safeWaterPerLevel: 30000, // 自動建設：公庫要高於 這個數字 × 空間等級 才動用（只花超過水位的部分）
    communalSubsidyPct: 0.3, // 共產流互助金超過軟上限的部分，可折抵升級造價最多這個比例
    geneDiscountCap: 0.45, // 開鎖費用總折扣（破鎖耗材 + 法則共鳴碑）封頂
    // 設施定義：max 等級上限、totalCost 滿級總造價、crystalAt[Lv-1] = 升到該級要消耗的侵蝕結晶、perLevel = 每級效果
    defs: {
      gravity: { max: 10, totalCost: 800000, crystalAt: [0, 0, 0, 0, 0, 2, 4, 6, 9, 12], perLevel: { powerPct: 0.03 } },
      pods: { max: 10, totalCost: 500000, crystalAt: [0, 0, 0, 0, 0, 1, 2, 4, 6, 8], perLevel: { healChance: 0.05, restSanity: 0.5 } },
      stele: { max: 10, totalCost: 900000, crystalAt: [0, 0, 0, 0, 0, 2, 4, 6, 9, 12], perLevel: { geneDiscount: 0.02 } },
      nursery: { max: 5, totalCost: 600000, crystalAt: [0, 0, 0, 5, 10], perLevel: { podDaysCut: 0.05, talentFloor: 0.04 } },
      radar: { max: 5, totalCost: 450000, crystalAt: [0, 0, 0, 4, 8], perLevel: { intelGain: 0.1, rivalReward: 0.08 } },
    },
  },

  // ── 4-F-3 位面侵蝕 1★～10★（已首通的世界可選星級；引擎 engine/erosion.js）──
  erosion: {
    unlockSpaceLevel: 4, // 首通第 3 章尾王（空間升到 Lv.4）後解鎖
    maxStar: 10,
    rMult: 1.45, // effectiveR = baseR × rMult^k
    rewardMult: 1.32, // 通關積分／戰利品 = × rewardMult^k
    crystalPerStar: 1, // 成功通關 k★ 固定掉 k 顆侵蝕結晶
    autoWorlds: 3, // 自動挑戰侵蝕：從已首通的世界裡挑獎勵最高的前幾個來試
  },

  // ── 4-F-1／4-F-2 八大洲際宿敵團戰與跨隊修羅場（資料在 data/rivals.js；引擎 engine/rivals.js）──
  rival: {
    unlockSpaceLevel: 2, // 空間 Lv.1 絕對不觸發
    firstMin: 35, // 剛升到 Lv.2 時，第一次碰撞倒數天數（35～45 天隨機）
    firstMax: 45,
    intervalMin: 35, // 之後每隔 35～45 天
    intervalMax: 45,
    deadlineDays: 5, // 刷出後限時 5 天處理（逾時自動徵召精銳）
    maxGraceDays: 3, // 倒數歸零時若空間沒人可派，最多再寬限幾天，仍沒人就取消（不罰）
    draftSize: 4, // 自動徵召人數
    rooms: 5,
    toClear: 3,
    passCap: 0.85,
    powerMult: 0.45, // baseRivalR = max(baseR[空間等級], 名冊前 4 強有效戰力 × 這個)
    baseR: [200, 600, 1800, 5000, 12000],
    reward: [400, 1400, 4500, 14000, 45000],
    shieldPassPenalty: 0.04, // 中皇天命隊「護體」：我方每房通過率 -4%
    lossPointsPct: 0.2, // 落敗：扣當前正數公庫的 20%（公庫 <= 0 不扣）
    lossInjury: 2, // 落敗：參戰存活者傷勢至少重傷
    lossSanity: 15, // 洲際羞辱：參戰存活者理智 -15
    defectorRPct: 0.03, // 每名叛逃到敵隊的前我方成員，使該隊 R +3%（以敵方打手身分登場）
    elope: { affinity: -5, lowSanity: 45, lowSanityAffinity: 15, chance: 0.35, lureChance: 0.12, maxPerFight: 1 }, // 候選：對隊長淨好感 <= -5，或（理智 < 45 且淨好感 < 15）。落敗 35% 私奔；對 golden／joyous 不論勝負再多一次 12% 挖角檢定（各單場最多 1 人）
    counter: { chance: 0.15, rosterCap: 24 }, // 勝利：我方人數 < 上限、隊長 bond／communal 流派，15% 拐走對面失意副手
    hybrid: { joyousChance: 0.35, otherChance: 0.1, talentBonus: 0.15, cooldownDays: 60, minAffinity: 30 }, // 戰場停火・春風一度
    pigRevolt: { chance: 0.4, rReduce: 0.15, minAvgAffinity: 40, recruitLove: 50 }, // 東櫻肉豬策反
    mortalityJoyous: -0.7, // 合歡粉紅隊：雙方致死率 -70%
    mortalityRetire: -0.5, // 萬年養老隊：低殺意，致死率 -50%
    infernoCrystals: 4, // 煉獄惡魔隊：必掉 T4/T5 黑貨或這麼多顆侵蝕結晶（各 50%）
    zhonghuangCrystals: 2,
    goldenWalletPct: 0.6, // 黃金財團隊：額外把「結算積分 × 這個比例」平分進存活者私房錢（不抽稅）
    retireHeal: 1, // 萬年養老隊：戰勝全體存活者傷勢 -1 級
    mechEnhance: 1, // 機械飛昇隊：戰勝每位存活者免費強化 1 次（未滿強化上限者）
    relicFullPct: 1.5, // 北極星洲隊：奇物已全收集時轉成「基礎獎勵 × 這個比例」積分
  },

  // ── 4-F-4 《主神八卦日報》圖卡 ──
  gossip: { width: 900, height: 1260, nodes: 6, steles: 3 },

  runReportMax: 20, // 排隊等玩家看的副本結算摘要最多留幾筆

  logMax: 300,
  // 不寫進主神日誌的訊息種類（2026-11 露葵：每日結算、商店等級、錢包、市集、自動閒置、保底）。
  // 這些事件照常產生（暫停事件、測試用的 state.events 不受影響），只是不佔日誌版面與 logMax 額度。
  logHiddenTypes: ["dayEnd", "shopTier", "wallet", "market", "autoIdle", "gachaPity"],
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
  kpi: { label: "主神考核結算（達標或被罰，自動處理，不需回覆）", default: false },
  stele: { label: "有人名字刻上英靈碑", default: false },
  squad: { label: "隊長異動（冊封、順延、政變、撤換）", default: false },
  drama: { label: "狗血人際事件（慶功、批鬥、夜襲、修羅場）", default: false },
  mandatory: { label: "主神強制血腥任務（限時派隊，逾時抹殺）", default: true },
  birth: { label: "有小孩出生（進催熟艙）", default: true },
  hatch: { label: "催熟完成（小孩長成輪迴者）", default: true },
  rival: { label: "洲際碰撞任務（刷出當天與剩餘 1 天預警）", default: true },
  injurySevere: { label: "有人重傷／致命傷", default: true },
  lowSanity: { label: "有人理智低於 20（快崩潰）", default: true },
  grudge: { label: "有人怨氣爆表（快要叛逃、動手或抗命）", default: true },
  tension: { label: "輪迴者之間起了摩擦（麻煩清單新增；人多時會很頻繁）", default: false },
  autoFault: { label: "自動化設施故障（要到基建面板手動維修）", default: true },
};

// 自動小幫手三種模式（功能 4）：取代一堆開關。pause："all" 全部事件都暫停、"major" 預設重大事件（PAUSE_EVENTS 的 default）暫停、
// 陣列 = 只有列出的事件暫停。strategy = null 表示不動目前的自動派遣策略。想自己調的人在面板「進階自訂」。
export const AUTO_MODES = {
  easy: { icon: "😌", label: "省心模式", desc: "自動派遣開著（均衡策略），只在死人、許願、強制任務時才暫停。", autoDispatch: true, strategy: "balanced", pause: ["death", "wish", "mandatory"] },
  balanced: { icon: "⚖️", label: "均衡模式", desc: "自動派遣開著、用保守策略，重大事件（死亡、結算、主神搞事…）都會暫停。", autoDispatch: true, strategy: "safe", pause: "major" },
  control: { icon: "🎮", label: "掌控模式", desc: "自動派遣關掉、任何事件都暫停，所有決定都由你自己下。", autoDispatch: false, strategy: null, pause: "all" },
};

// 新增暫停事件的門檻（問題 5）：傷勢 >= severeInjury、理智 < lowSanity 時各提醒一次（恢復後才會再提醒）
export const ALERT_LEVELS = { severeInjury: 2, lowSanity: 20 };
// 怨氣警報線在 CONFIG.tension.warnAt／rearmAt（A-3 階段 2）

// 雲端功能（Google 登入、雲端存檔、排行榜）的前端數字。後端的上限在 worker/limits.js。
export const CLOUD = {
  discordUrl: "https://discord.gg/2K273vE36", // 封面與設定的 Discord 邀請連結
  saveIntervalMs: 120_000, // 自動存檔後，最快多久同步一次到雲端（省 Workers 免費請求額度：每天 10 萬次）
  scoreIntervalMs: 300_000, // 排行榜成績最快多久送一次（後端另有 30 秒下限）
  meTimeoutMs: 4000, // 開遊戲時問「你登入了嗎」最多等幾毫秒，逾時就當作雲端功能不可用，直接進遊戲
  previewTop: 5, // 封面排行榜預覽顯示前幾名
  defaultBoard: "power", // 封面預覽與排行榜預設榜單
  clearStarWeight: 1, // 「副本通關」榜的算法：每個通關過的副本 1 分，加上它打過的最高侵蝕星級 × 這個權重
  boards: [
    ["level", "空間等級"],
    ["clears", "副本通關"],
    ["power", "最強輪迴者"],
    ["life", "最長壽輪迴者"],
  ],
};
