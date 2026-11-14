# 主神空間主管模擬器 (ZhuShen-Sim)

養成管理模擬器：玩家扮演被主神壓榨的主神空間主管，管理輪迴者、派他們去副本送死、處理他們的八卦跟恩怨。

## 技術

- 純靜態網站：HTML + CSS + JavaScript，零外部依賴，沒有打包、沒有 build
- 存檔：localStorage 自動存檔
- 亂數：可重現亂數（seeded random）
- 測試：Node.js 測試（`npm test`）；平衡模擬（`npm run sim`）
- 部署：Cloudflare Pages（儲存庫 ZhuShen-Sim，子網域待定）

## 省 token 規則（最重要）

- **不要掃描整個專案**。先看下面的檔案地圖，只開跟任務有關的檔案。
- 不確定要改哪裡時，先列出你打算讀／改的檔案，等我同意再動手。
- 不要讀圖片、`node_modules/`、`package-lock.json`。
- 小改動用局部編輯，不要整檔重寫。改完只回報改了哪些檔案、各一句話，不要貼整段程式碼。
- 不要主動重構、改名、加套件或改其他沒提到的檔案。
- **每次改完一個問題就開新聊天室**，省額度。不要在一個聊天室裡連續改很多問題。

## 開發者說明

開發者是程式新手：回覆用繁體中文，步驟要具體，指令要能直接複製貼上。
專業術語首次出現附英文。

## 檔案地圖

| 檔案 | 用途 |
|---|---|
| `index.html` | 主頁面，遊戲介面 |
| `src/data/config.js` | 所有可調數字（開局積分、空間等級表 `space`、章節房數／門檻 `dungeon.chapters`、飽和公式 `dungeon.saturation`、情報條 `dungeon.intel`、傷勢、抽卡機率、商店階層門檻 `shopTierUnlock`、強制任務數字 `forcedMission` 等），改數字只改這裡；Phase 4-B 新增 `gene`（基因鎖階段表）、`enhance`（強化增量與費用）、`insight`（頓悟）、`bossGate`（尾王守門）、`gacha`（四卡池）、`karma`（因果結晶掉落），`RANKS` 多了 `growthMult`／`maxGene`／`recycleRefund`；標籤與關係加成上限已改 ±10% |
| `src/data/dungeons.js` | 副本資料表（4-D-4 起五章 × 6 張 = 30 個世界：每章 5 張常規 + 1 張尾王，id 見 `worlds.js`，第 1 章前 3 個真實世界保留語意 id；其餘 R／獎勵由各章錨點等比內插，`CHAPTER_ANCHOR`；舊說明如下，數字已被 4-D-6 覆蓋：`chapter`、`boss`、`rooms` 長度＝該章房數）；第 1 章前 3 關是靈異村、太空船、魔法戰爭（各 3 個特殊獎勵），其餘 17 關是 `placeholder()` 佔位資料；`getSpecialReward(id)` 查獎勵；Phase 4-B 起 R 與獎勵已依 sim 校正（尾王 R 倍率 ×1.8／2.4／2.5／2.0／0.65、第 5 章一般關 R ×0.6、各章獎勵 ×1／2.5／4.5／9／8）；全域第幾關 = 陣列順序（`dungeonNumber`） |
| `src/data/shop.js` | 相容用的 re-export（商品資料表已在 4-D-2 搬到 `shopItems.js`） |
| `src/data/shopItems.js` | **商品資料表（4-E-8，200 件）**：解析 `shopRaw.js` 的原始列，每階 40 件（8 常駐 + 18 世界特產〔每世界 3 件，編號 09～26 依序綁世界〕+ 6 耗材 + 8 黑貨）；欄位 `id`（`t1_01`～`t5_40`）／`name`／`tier`／`slot`（weapon armor accessory bloodline consumable）／`category`（standard specialty consumable contraband）／`source`／`price`／`stats`（白值）／`aiBuyTag`／`desc`，選配 `effect`（耗材：`healInjury`／`permHp`＋`maxUsesPerChar`／`sanity`／`geneLockTarget`＋`costDiscount`／`deathWard`＋`fullRecover`／`intelGain`＋`targetCount`／`teamLove`／`clearHate`／`hateDelta`／`nextRunLoveBonus`／`transferMadness`／`inducePregnancy`／`nextRunPowerMult`／`partyNextRunPowerMult`／`postRunInjury`／`partyPostRunSanity`）與 `passive`（黑貨裝備：`dailySanity`／`runSanity`／`partyRunSanity`／`demonTendency`／`captainHateMult`／`captainLoveMult`／`coupPowerBonus`）；`kind`：gear／use（買了立刻用）／buff（進出征耗材緩衝區）；`permanent`：每階 `_27`、`_28` 與 `t1_29` 常駐可買。`itemStat(item,key)` 統一讀白值（新版看 `stats`，舊版看 `effect`）；`getShopItem` 找不到新 id 會退回舊表。**要改價錢、名稱、描述、白值只改 `shopRaw.js`；特殊效果在這裡的 `EFFECTS`／`PASSIVES`** |
| `src/data/shopRaw.js` | 200 件商店總表原始列（`id｜名稱｜槽位｜來源 S/W/C/K｜價格｜白值代號 p h d s l｜aiBuyTag｜描述`） |
| `src/data/legacyItems.js` | **舊版 115 件商品表（4-D-2），已停售，只供存檔相容**：舊存檔穿著的舊裝備、囤的耗材、遺物照原名稱與數值計算（`getLegacyItem`） |
| `src/engine/gearFx.js` | 裝備被動與爆發耗材的共用解析（4-E-8）：`passiveSum`／`gearMult`／`gearDaily`（日結理智、入魔傾向）／`gearAfterRun`（出戰扣理智、隨機扣隊友理智）／`sanityHarm`（AI 防呆用） |
| `src/data/worlds.js` | 30 世界清單 `WORLD_LIST`（id／章節／尾王）、舊 id 遷移表 `LEGACY_WORLD_IDS`／`migrateWorldId`；**4-E-8**：`WORLD_TEXT`（30 世界正式名稱與題材描述，規格編號 `chN_0X`）、`WORLD_ALIAS`（第 1 章第 1／3／5 關對應 `ghost_village`／`silent_ark`／`ember_war`）。前 3 個世界的房間文字與首通獎勵名稱已對齊新題材（`dungeons.js`） |
| `src/data/mutations.js` | 6 大突變詞綴（吊橋效應／斷電黑夜／分贓誘惑／血月狂躁／濃霧走散／風平浪靜 35%）：欄位 `weight`／`loveMult`／`failSanity`／`rewardPct`／`clashMult`／`rMult`／`speedSaveMod`／`relicChanceMult` |
| `src/data/relics.js` | 60 件奇物（每世界 1 首通奇物 `first` + 1 隱藏奇物 `hidden`），`powerPct` 微幅被動；`RELIC_TEXT[id]` 預留長文案 |
| `src/data/tags.js` | 30 個 MVP 標籤 + 5 個副本環境標籤（資料表，加標籤只改這裡） |
| `src/engine/tags.js` | 抽標籤、戰力／通過率／獎勵／傷勢減免的標籤計算；`effectivePower` 與傷勢減免／閃避也會算入商店強化與裝備（`shopBonus`）；心情加成 `moodPowerPct`／`moodPassBonus` 也在這裡；Phase 4-B 起 `effectivePower` = max(1, round((本體值 × 基因鎖乘區 + 武器防具白值) × (1 + 詞條% + 心情%)))，本體值 = `stats.power + inheritPower`；`shopBonus` 只剩裝備；新增 `bodyPower`／`genePowerMult` |
| `src/data/relations.js` | 關係系統資料表：互動事件、借刀殺人手法、標籤特殊事件（每個事件的 `texts` 是多版本模板，加事件只改這裡） |
| `src/data/logs.js` | 日誌 Mad Libs 模板：系統／經濟／副本／關係的所有日誌句子（每個 key 多個版本）+ 依標籤而異的「反應」句池（加句子只改這裡） |
| `src/data/wishes.js` | 許願種類資料表（想吃好的／想放假／想去副本／想要裝備；`mode` 決定機制，數字在 `CONFIG.wish.kinds`，句子在 logs.js 的 `wishAsk_*`／`wishDone_*`） |
| `src/data/godEvents.js` | 主神搞事事件種類資料表（臨時開銷稅／電擊抽查／強制健檢／突襲任務；`mode` 決定機制，數字在 `CONFIG.godEvent.kinds`，句子在 logs.js 的 `godAsk_*`／`godDone_*`／`godResolve_*`／`godRaid*`） |
| `src/data/names.js` | 隨機姓名字庫 |
| `src/engine/` | 純規則引擎，不碰 DOM，可用 Node 直接測試 |
| `src/engine/templates.js` | 日誌模板引擎：`logText(state, key或texts陣列, vars)` 抽版本並填 `{A}{B}{react:池:A}`；抽版本用雜湊，不消耗主亂數 |
| `src/engine/rng.js` | 可重現亂數（rand / randInt / pick / weighted） |
| `src/engine/wishes.js` | 許願引擎：`maybeWish`（每日特殊事件骰掛鉤）、`acceptWish`／`refuseWish`、完成／失敗／超時、心情 `setMood`、`dailyWishes`（跨日倒數）；副本結算／商店購買各有掛鉤（`wishesAfterRun`／`wishesAfterBuy`） |
| `src/engine/godEvents.js` | 主神搞事引擎（Phase 3-E）：`dailyGod`（每日結算掛鉤：任務逾期 → 沒回覆的事件過期 → 骰新事件）、`acceptGodEvent`／`resolveGodEvent`（照辦／花積分化解）、突襲任務 `godAfterRun`（副本結算掛鉤）、`cancelGodOf`（死亡／回收取消）；用 `state.god.rngState` 獨立亂數流，不動主亂數 |
| `src/engine/children.js` | 生小孩與催熟艙引擎（Phase 3-F）：`dailyNursery`（每日結算掛鉤：催熟倒數 → 戀人／靈魂伴侶擲懷孕）、`giveBirth`、標籤繼承、`podCost`（嬰兒維持費）；嬰兒 `location: "pod"`；用 `state.nursery.rngState` 獨立亂數流，不動主亂數 |
| `src/engine/growth.js` | 養成引擎（Phase 4-B）：`enhance`／`checkEnhance`（個人強化，增量 = round(基礎 × 階級成長倍率)，直接加進 `s.stats`）、`breakGene`／`checkBreakGene`（突破基因鎖：先點滿當階強化、空間等級夠、不超過階級上限、花積分）、`rollInsights`（通關頓悟）、`rollKarmaDrop`（因果結晶）；頓悟與結晶用 `state.growth.rngState` 獨立亂數流，不動主亂數 |
| `src/data/mandatory.js` | 主神強制血腥任務的文字資料（Phase 4-C-4）：動態副本的名稱、5 個房間的通過／失敗句；數字在 `CONFIG.forcedMission` |
| `src/engine/sanity.js` | 理智引擎（4-C-2）：`dailySanity`（理智 0 的人日結暴走：入魔砍傷隊友＋走火入魔標籤／自殘，之後理智回到 40）；`state.sanity.rngState` 獨立亂數流。理智檔位的戰力／內鬥倍率在 `engine/tags.js`（`sanityPowerPct`／`sanityClashMult`） |
| `src/engine/mandatory.js` | 主神強制血腥任務引擎（4-C-4）：`dailyMandatory`（每日掛鉤：發布／逾時抹殺）、`buildMandatoryDungeon`（動態副本快照，存進 `run.dungeonDef`）、`mandatoryR`、`popLimit`；`state.mandatory = { rngState, lastDay, pending, nextId }`；出發走 `startRun(state, MANDATORY_ID, 隊員)`，結算在 `finishRun` 的 mandatory 分支 |
| `src/engine/memorial.js` | 英靈碑引擎（4-C-5）：`enshrine`（入碑）、`steleBonusOf`（前 4 名加成）、`refreshSteleBonus`（寫進每人 `s.steleBonus`，因為 `effectivePower` 沒有 state 參數）；`state.memorialStele` |
| `src/engine/relations.js` | 關係矩陣、每日互動、告白／戀人／靈魂伴侶／死敵、借刀殺人、直接殺人與主神懲罰、死亡連鎖、副本內內鬥／背刺／擋刀 |
| `src/engine/core.js` | 狀態（含 `state.god`、`state.spaceLevel`、`state.chapterClearDay`）、輪迴者、維持費 `upkeepOf(s, state)`（跟空間等級走）、破產線 `debtLimitOf(state)`、傷勢、高利貸、回收爐、抽卡、時間 tick、存檔、遊戲結束判定；`spend()` 累積花費並宣布商店解鎖、`shopTier()` 算階層；Phase 4-B：輪迴者新欄位 `geneLock`／`enhanceCount`／`insightCount`／`inheritPower`、`state.karmaCrystals`／`gacha`／`growth`／`chapterClears`；四池抽卡 `pullGacha`／`checkGacha`／`gachaInfo`（空間等級解鎖、每 7 天重置本週漲價、獨立保底、神級池耗結晶；週數由天數算出，所以讀檔不會錯）；`deserialize` 補新欄位並清掉舊 `upgrades`／`bought`（不退費） |；**4-D**：`state.taxRate`／`squad`（預留）／`market`／`aiShopRngState`／`board`／`relicCodex`，輪迴者新欄位 `wallet`／`soulbound`／`consumables`／`runBuff`／`lockedInPodBy`／`podLockDays`／`shopLog`／`customProfile`／`relicBonus`；`spend`（公庫）／`spendWallet`（私房錢）／`addSpent` 都累加 `totalSpent`；`endOfDay` 掛稅率理智、休眠艙倒數、`dailyShopping`；`deserialize` 遷移舊副本 id 並補新欄位
| `src/engine/shop.js` | 商店引擎：`buyItem`／`checkBuy`（`opts.payer` = treasury 公庫賞賜〔綁定＋理智 +5〕或 wallet 私房錢〔不綁定、不覆蓋綁定裝備〕；`opts.source` = shop／market；黑貨帶 `victimId`）、`consumeRunBuffs`（出征耗材轉單場 `runBuff`）、`nextTierInfo`；`collectionEffects`／`collectionPassBonus` |
| `src/engine/wallet.js` | 雙錢包（4-D-1）：`distributeLoot`（稅入公庫、其餘存活隊員平分私房錢，可傳 `opts.rate` 給 4-E 覆寫）、`setTaxRate`、`taxSanityDaily`、`forfeitWallet`（戰死 50%／回收 100% 歸公庫） |
| `src/engine/market.js` | 8 格分槽黑市（4-D-2）：`refreshMarket`／`dailyMarket`（每 3 天）／`manualRefresh`（公庫付、同日遞增）／`lockSlot`（上限 1）／`slotPrice`（情報滿格 85 折）／`buyMarketSlot`／`marketInfo`；獨立亂數流 `state.market.rngState`（任務榜與突變抽樣共用） |
| `src/engine/shopping.js` | 輪迴者自主逛街 AI（4-D-3）：`dailyShopping`（保命→換裝→自費強化／開基因鎖〔留 20% 備用金〕→性格偏好與 15% 偷買黑貨）；獨立亂數流 `state.aiShopRngState`（`aiRng` 包裝） |
| `src/engine/board.js` | 動態任務榜（4-D-4）：3 槽、每槽 1 個突變詞綴、每 2 天輪換、派隊槽結算後補新槽；`boardTargets`／`fillBoard`／`rotateBoard`／`afterRunBoard` |
| `src/engine/relics.js` | 奇物圖鑑（4-D-4）：`grantRelic`（已擁有回 `dup`）、`relicBonusOf`（全部加總硬封頂 +25%）、`refreshRelicBonus`（寫進 `s.relicBonus`，`effectivePower` 讀）、`relicInfo` |
| `src/data/squadStyles.js` | 小隊五大流派資料（4-E-1）：`SQUAD_STYLES`（名稱／圖示／說明）與 `TAG_STYLE`（既有詞條 → 流派分數，隊長詞條加總取最高；平手依 `TIE_ORDER`；無對應詞條 = 共生羈絆流）。要調整哪個詞條歸哪個流派只改這裡，不新增標籤（避免動到抽卡亂數） |
| `src/data/dramaEvents.js` | 5:2:1 人際事件池（4-E-3）：24 則（熱血羈絆 15／派系摩擦 6／八點檔修羅場 3），每則有 `cast`（選角方式）、`fx`（效果）、`texts`（≥3 版本文案）；擴充詞庫只改這裡（新選角方式才要動 `engine/drama.js` 的 `CASTS`） |
| `src/engine/squad.js` | 小隊引擎（4-E-1／2）：`appointCaptain`／`replaceCaptain`（主神撤換令）／`replacePreview`（不服空降預覽）／`dailySquad`（自動冊封、三軌繼承：順延／雙強奪權／撤換）／`deriveSquadStyle`／`candidateStyle`；`squadRng`（獨立亂數流 `state.squadRngState`）；流派機制查詢函式（`squadDefenseBonus`／`failSanityLoss`／`bondGuard`／`farmingPigDied`／`communalInherit`／`squadMarketMult`…）給 dungeon／wallet／shopping／market／core 掛鉤；`bump` 累計次數（`state.squad.counters`）；`CONFIG.squad.forceStyle` 給 sim 強制流派 |
| `src/engine/drama.js` | 5:2:1 事件引擎（4-E-3）：`dailyDrama`（每日 25%）／`dramaAfterRun`（副本成功 30%）／`runDrama`／`pickGroup`／`playable`／`applyEvent`；噬主夜襲 `resolveCoupNight` |
| `src/engine/lineage.js` | 跨代與編年史（4-E-4／5）：`addChronicle`（上限 100 條）、`applyLineage`（世代、天賦 `talentPct` 封頂 +25%）、`inducePregnancy`／`speedUpPod`（孕育、加速出艙；實際生產共用 `children.js` 的 `giveBirth`）、`leaveHeirloom`／`bestowHeirloom`／`heirloomHeirs`（先人遺物）、`dailyLineage`（叛逃判定＋孕育）、`defect`／`isDefectImmune`／`rogueDungeon`／`resolveRogueFight`（叛逃野生 Boss） |
| `src/data/facilities.js` | 5 座永久基建的名稱／圖示／說明與順序（4-F-3）；數字（等級上限、總造價、結晶門檻、每級效果）在 `CONFIG.facility.defs` |
| `src/engine/facilities.js` | 永久基建引擎（4-F-3）：`state.facilities`（gravity／pods／stele／nursery／radar 各自等級）、`levelCost`（等比遞增，總和 = 設定總造價）、`checkUpgrade`／`upgradeFacility`（扣積分＋侵蝕結晶；共產流互助金超過軟上限的部分最多折抵 30% 造價 `communalSubsidy`）、`dailyFacilities`（自動建設：公庫高於 30000×空間等級 才動用，便宜的先升）；效果查詢 `gravityPct`（寫進每人 `s.facilityBonus`，`effectivePower` 讀）／`podsHeal`（重傷多一次痊癒，獨立亂數流 `state.facilityRngState`）／`restSanityBonus`／`geneDiscountOf`（growth.js `geneCostOf` 與破鎖耗材加算、總折扣封頂 -45%）／`podDaysCut`／`talentFloor`（children／lineage 掛鉤）／`intelGainBonus`（dungeon 情報條）／`rivalRewardBonus` |
| `src/engine/erosion.js` | 位面侵蝕 1★～10★（4-F-3）：`erosionBlock`（Lv.4 解鎖、只能打已首通世界）、`applyErosion`（R ×1.45^k，回傳新物件）、`erosionRewardMult`（×1.32^k）；`run.erosion = k`，`dungeonOfRun`／`startRun(opts.erosion)`／`finishRun`（積分倍率、成功掉 k 顆 `state.erosionCrystals`、記 `state.maxErosion`）掛鉤；侵蝕出征不累計尾王守門的 `chapterClears` |
| `src/data/rivals.js` | 八大洲際宿敵隊（4-F-1）：`RIVAL_SQUADS`（RivalSquadSnapshot：`id／name／factionStyle／rMult／rewardMult／mortalityMod／specialRule／roster`；煉獄惡魔隊 `lockedR` 硬鎖 1.25）、`RIVAL_ROOMS`（5 房文字）、`RIVAL_TAUNTS`（叛逃者互嗆）；`RIVAL_ID = "rival_clash"` |
| `src/engine/rivals.js` | 洲際宿敵團戰與跨隊修羅場（4-F-1／2）：`state.rivals = { rngState, nextDay, pending, nextId, squads: { 隊伍id: { roster: [叛逃者快照], meets, wins } }, stats }`；`dailyRivals`（空間 Lv.1 零觸發；升 Lv.2 後 35～45 天首次倒數，之後每 35～45 天刷出，限時 5 天，刷出當天與剩 1 天發 `rival` 事件，歸零自動徵召戰力最高 4 人，沒人可派寬限 3 天後取消）、`buildRivalDungeon`（動態副本快照：R = max(baseR[等級], 前 4 強戰力×0.45)×rMult×(1+3%×敵隊叛逃者)；策反骰在刷出時就擲好存 `pending.revoltRoll`，所以預覽不吃亂數）、`rivalOnStart`／`rivalFinish`（勝：各隊特色獎勵＋反拐；敗：公庫 -20%（<=0 不扣）、存活者重傷＋理智 -15、私奔；兩者都擲春風一度）、`isElopeImmune`（隊長／soulbound／customProfile 100% 免疫）、`defectTo`（整份快照進敵隊 roster，反拐／勝利時優先拐回）、`hybridBirth`（單親混血子嗣，`hybridOrigin`、資質 +15% 仍封頂 +25%）；`run.rival`、`report.rival`；致死率打折 `rivalSpare`（dungeon.js `hurt` 掛鉤）；亂數用獨立流 `state.rivals.rngState` |
| `src/engine/gossip.js` | 《主神八卦日報》資料整理（4-F-4）：`buildGossip(state)` → `{ header, headline, graph, steles }`（頭條取最新的 coup／elope／inferno／guard／單人多胎家族編年史，沒有則尾王首通；關係圖前 6 名最戲劇的角色，邊 love 粉紅／hate 血紅／rift 紫；碑文前 3 名）；純函式、不吃亂數 |
| `src/ui/gossipCard.js` | 八卦日報 Canvas 2D 繪製（900×1260 邏輯尺寸、依 devicePixelRatio 放大最多 2 倍、不載入外部圖片）：`drawGossipCard`／`downloadGossipPng`／`copyText`／`wrapText`／`fitText` |
| `src/engine/dungeon.js` | 副本結算（飽和公式 `powerRate`、章節房數／門檻 `roomCount`／`roomsToClear`、各副本獨立情報條 `intelBonus`（開場鎖進 `run.intel`）、解鎖 `isUnlocked`／`unlockedDungeons`、尾王首通讓空間升級）；並行副本：`startRun` 往 `state.runs` 加一場，`stepDueRooms`／`settleRuns` 依開場順序走房間／結算，結算摘要進 `state.runReports` 排隊；首通在結算時判定；掛鉤 `relationBonus` / `tagBonus`（含收藏加成）/ `rewardMultiplier`（含收藏加成）；首通掉特殊獎勵 id 進 `state.collection`；結算尾端掛 `wishesAfterRun`（許願）與 `godAfterRun`（主神突襲任務）；Phase 4-B：尾王守門 `bossGateInfo`（該章前 3 關合計成功結算滿 8 次才開放，已首通不再鎖，`startRun` 會回報進度）、`isUnlocked` 含守門；結算成功時掛 `rollKarmaDrop`（結晶）與 `rollInsights`（存活隊員頓悟），結果進結算摘要 `karma`／`insights` |；**4-D**：`startRun(state, id, party, { slotId, greedy })`（任務榜槽帶突變詞綴；貪婪探索要情報滿格）、`applyMutation`（血月 R ×1.15）、`runRoomTotal`（含隱藏房）、`stepHiddenRoom`（通關後 20%〔濃霧 40%〕追加 R×1.35 隱藏房，用 market 亂數流）、結算 `distributeLoot` 分潤、首通奇物／隱藏奇物（已擁有轉積分）、同行情誼好感（`dungeon.bondLove`，吊橋 ×1.5）
| `src/engine/alerts.js` | 新暫停警報＋一生大事記的「第一次受傷」（2026-11 Bug 清單）：`checkAlerts` 每步掃名冊，有人重傷／致命傷、理智 < 20 各在跨過門檻時提醒一次（事件 `injurySevere`／`lowSanity`，門檻在 `ALERT_LEVELS`） |
| `src/engine/autoMode.js` | 自動小幫手三種模式（省心／均衡／掌控）：`applyAutoMode`／`currentAutoMode`；模式定義在 `config.js` 的 `AUTO_MODES`，符合不了任何一種就顯示「自訂」 |
| `src/engine/inventory.js` | 物資倉庫：`buyStock`（公庫批量買常備藥進 `state.inventory`，計入商店階級）／`useStock`（選人使用）／`stockTargets`（依需求排序）；只有常駐商店的即用耗材走倉庫 |
| `src/engine/life.js`、`src/data/achievements.js` | 人物傳記：`addLife`／`addLifeOnce`（一生大事記 `s.life`，上限 60）、`bioOf`（純資料傳記，死亡時存進 `state.graveyard[i].bio`）、`graveBio`；成就條件全在 `achievements.js` |
| `src/engine/gearTransfer.js` | 裝備轉移：`checkTransfer`／`transferGear`（對方同欄有裝備就互換；被奪走者套「不爽」心情＋`s.stripped`） |
| `src/engine/dispatch.js` | 自動派遣（候選人依 `effectivePower` 排序、只挑已解鎖副本；`tryAutoDispatch` 一次排多隊，直到人手用完；`planAutoDispatch` 有突襲任務時優先派目標，見 3-E）、主迴圈一步 `step()`（走各副本該走的房間 → 時間 +1 → 結算）；含 `areEnemies()` 掛鉤 |；**4-D-4**：`autoTargets` = 任務榜未出發的槽 + 已解鎖尾王；情報滿格且預估通關率 ≥ 0.75 自動貪婪探索
| `src/ui/main.js` | 畫面層，DOM 操作、CSS transition 滑動；**房間家具已改 CSS 形狀**（`ROOMS.decor` = `[類型, x%, y%, 選用 CSS 變數]`，樣式在 `styles.css` 的 `.f-類型`，用 `cqw/cqh` 容器單位）；小人頭頂狀態泡泡 `bubbleOf`（CSS 圖形、依房間顯示活動與姿勢 `data-act`）、劇情事件在小人身上跳提示 `popOnMinis`、名冊卡「最近」`recentOf`、暫停時的今日摘要 `renderDaySummary`（`#day-summary`）、人物傳記卡 `bioCard` 改白底粉彩頭；頂欄分資源／時間／功能三組、操作列分主要／次要／待辦三組（2026-11 美化，依 DESIGN.md：膠囊按鈕、主要＝黑底白字）；含商店面板、主神搞事彈窗（`godEvent()`、`#btn-god`）、視角鎖定（`viewedRun`／`renderDungeonView`／`toggle-follow`／`peek-run`）；`styles.css` 放所有樣式（`#dungeon-view`、`.route-*`、`.run-card`） |
| `test/` | 測試檔案（Node.js）：Phase 4-F 新增 `facilities`（基建造價／結晶／共產補貼／開鎖折扣封頂／各設施效果／自動建設／侵蝕倍率與結晶／自動挑戰侵蝕）、`rivals`（Lv.1 零觸發、35～45 天節奏、自動徵召、inferno 硬鎖、戰敗保護、私奔免疫鐵律、反拐、肉豬策反、春風一度、勝利特色）、`gossip`（頭條／關係圖／碑文／種子碼）；`engine`、`relations`、`templates`、`shop`、`wishes`、`parallel`（並行副本）、`godEvents`（主神搞事）、`children`（生小孩）、`chapters`（空間等級／章節）；Phase 4-B 新增 `growth`（基因鎖／強化／頓悟／effectivePower 公式）、`gacha`（四卡池、保底、漲價、結晶）、`gate`（尾王守門、結晶掉落、頓悟結算）；Phase 4-C 新增 `combat`（副屬性）、`sanity`（理智）、`economy`（維持費／回收／空投）、`mandatory`（強制任務）、`memorial`（英靈碑）；Phase 4-D 新增 `wallet`（雙錢包、稅率、遺產）、`market`（商品表、黑市分槽／鎖格／85 折、耗材、黑貨）、`shopping`（逛街 AI）、`board`（30 世界、任務榜、突變、奇物、貪婪探索）|
| `scripts/sim.mjs` | 平衡模擬器（4-E-8：`--autoStrategy=safe|balanced|aggressive` 可模擬玩家版自動派遣戰力門檻，預設 off 維持基準曲線；`--forceStyle=` 強制小隊流派；報表有政變／叛逃／子嗣／遺物／流派分佈）（`npm run sim -- --seeds=100 --days=120`）：模擬玩家自動補人、買裝備、自動派遣，統計各章尾王首通天數（對照目標 Day 30/80/165/300/450）、死亡、破產；Phase 4-B 升級：機器人會選最高可用卡池、強化、突破基因鎖、買裝備；Phase 4-C-6：人口超過軟上限時回收最弱的非核心冗員、統計強制任務／被抹殺／英靈碑、`--mpower` 覆寫 `forcedMission.powerMult`；可用 `--rmult`／`--bossr`／`--reward`／`--minClear`／`--roster`／`--reserve`／`--growReserve` 在執行時覆寫數字（不動資料檔）、`--json=1` 機器可讀、`--trace=種子`（加 `--events=1`）逐日除錯、`--perseed=1` 看每組種子；Phase 4-D-6：接通雙錢包（`--tax=0.4`）、任務榜選關（走引擎自動派遣）、輪迴者自主逛街、機器人公庫賞賜黑市特產；報表多了公庫期末均值、輪迴者總消費、公庫總支出、奇物收集數；Phase 4-F：機器人預設開自動建設與自動挑戰侵蝕（`--facilities=0`／`--erosion=0` 關閉），報表多了基建期末等級、侵蝕出征／結晶、洲際碰撞勝率與私奔／反拐／混血子嗣／策反次數（跑 100 組種子 × 900 天約 12 分鐘）；**注意** `--rmult`／`--bossr` 是疊乘在 `dungeons.js` 現值（已含 `F_R_MULT`）之上 |
| `README.md` | 專案說明 + 待確認的設計問題 |
| `docs/GAME_DESIGN_PLAN.md` | 完整遊戲設計計畫 |
| `server.mjs` | 本機預覽用迷你伺服器（`npm start` → http://localhost:5173） |

> 檔案地圖是 CLAUDE.md 最重要的部分之一。把每個重要檔案的用途寫清楚，就不用每次都去猜、去掃描整個專案，直接照地圖找檔案，省很多額度。

## 慣例與注意

- UI 文字一律繁體中文。
- 所有可調數字都放在 `src/data/config.js`，不要寫死在引擎裡面。
- 引擎（`src/engine/`）是純規則，不碰 DOM，方便測試。畫面邏輯全部放在 `src/ui/`。
- 擴充標籤、副本時，只改 `src/data/` 裡面的資料表，不要改引擎。
- 迷你小人用 CSS transition 滑動，不要做複雜動畫。配件用 emoji，不要畫圖。
- 主神空間背景是白色，迷你小人統一顏色，靠配件跟服飾區分。
- 看到疑似 bug 的地方，先問是不是刻意設計，不要直接當 bug 改。
- 檔案操作前先盤點、逐一驗證，刪除或移動前先確認範圍。

## 核心設計（寫程式前必讀）

完整設計在 docs/GAME_DESIGN_PLAN.md，這裡只列影響程式架構的關鍵決策：

- **遊戲類型**：養成管理模擬器，不是回合制、不是動作遊戲。時間自動跑，玩家看小人、做管理決策。
- **沒有強制下副本期限**：玩家自己決定要不要派人去，壓力來自每日維持費跟主神無聊搞事。
- **副本長度跟房數走**（Phase 4-A）：第 1～5 章房數 5／7／8／10／12，每個房間 `roomTicks` 個時段（0.2 天），所以一場是 1／1.4／1.6／2／2.4 天。主神空間與所有副本同步前進（`step()` 一步 = 1 個時段），可同時多場（含同一副本），不同隊不能有同一個人；副本中的人不扣維持費、不參與日常／關係／許願事件。同副本多場：成功率與傷勢表鎖定開場時的首次開荒／重打，首通與獎勵遞減在結算時依序計算（先結算的吃首通）。全滅的副本也要等時間到才結算。
- **成功率公式（Phase 4-A 飽和公式）**：房間通過率 = 0.85 × P ÷ (P + R × 0.55) + 情報條 + 標籤與環境相性 + 心情；關係加成 `relationBonus`（喜歡+10%、愛慕+20%、討厭-10%、仇恨-20%、靈魂伴侶+30%、死敵-25%，全隊上限 ±10%；標籤加成上限同為 ±10%，Phase 4-B 由 ±30% 改）。情報條每個副本獨立：-3% 起，每結算一場 +1.5%，上限 +9%。過關門檻依章節 3／4／5／6／7 房（直接寫在 config，不用公式）。
- **空間等級 Lv.1～5**：每首通一章尾王（第 4 關）升 1 級並解鎖下一章；基礎日維持費 8／16／35／80／180、破產線 -500／-1500／-4500／-12000／-30000。
- **傷勢三級**：輕傷（休息 1 天）、重傷（3 天）、致命傷（7 天）。帶傷出征死亡率上升。
- **每日維持費（Phase 4-C-3 改制）**：單人日費 = round((**個人基因鎖基準費** [8,16,35,80,180] 依 `geneLock` 0～4 + **空間環境底費** [0,3,7,16,36] 依空間等級) ×（1 + 階級附加 C 0%／B 25%／A 50%／S 100% + 醫藥費 輕傷 25%／重傷 75%／致命傷 150%））。只有待在主神空間才扣，副本裡不扣；催熟艙嬰兒固定小額。`upkeepPartsOf(s, state)` 給 UI 拆開顯示。
- **絕境空投（4-C-3）**：名冊（不含催熟艙）存活 < 2 且積分 < 120，**連續**滿 3 天，主神免費空投 1 名 C 級（`dailyAirdrop`，獨立亂數流，條件中斷歸零）。`CONFIG.airdrop.rescue`（預設開）：空投當安全網，**「沒人又借不到錢」不再直接遊戲結束**（否則全滅當下就死檔，空投來不及；4-C-6 為了讓空投有效而改，這個結局實質消失，需露葵確認）。
- **回收爐（4-C-3）**：返還積分依階級 C 30／B 80／A 250／S 800（`RANKS[rank].recycleRefund`，取代舊固定 30），其他人理智 -5 不變。
- **戰鬥副屬性（4-C-1）**：hp／defense／speed／luck 取總值 `subStat(s, key)` = `stats`（初始＋強化＋頓悟）＋裝備白值（商店裝備 `effect` 新增 `hp／defense／speed／luck`，不吃基因鎖乘區）。防禦：受傷時 `min(0.65, def/(def+60))` 機率傷勢少 1 級（輕傷可免傷，和標籤／裝備的 `injuryShield` 獨立疊加）；速度：副本內判定戰死時 `min(0.5, spd/(spd+80))` 機率鎖血免死、改落致命傷（不適用空間內殺人與主神抹殺）；**健康免猝死**：進該房前 `injury === 0` 的人，這房最重只落致命傷；hp：超過 100 每滿 40 點 +25% 機率每日多恢復 1 級（降 1 級、休養天數重算），總 hp ≥ 180 時傷勢戰力懲罰減半；**傷勢戰力懲罰（新增，暫定）**重傷 -20%／致命傷 -40%（`CONFIG.combat.injuryPowerPct`）；氣運：存活隊員平均 luck 每點 +0.5% 結算積分（上限 +50%）。數字全在 `CONFIG.combat`。
- **理智閉環（4-C-2）**：sanity ≥ 70 無懲罰；30～69 戰力 -10%、隊內內鬥／背刺機率 ×1.5；0～29 戰力 -25%、×2.5（內鬥取兩人中理智較低者的檔位）。扣理智：副本單房失敗受害者 -5、副本內同隊戰死其他隊員 -10（空間內的死亡仍是全員 -3）；恢復：人在主神空間（含帶傷）每日 +3。理智 0 的人日結暴走（`dailySanity`，在 `endOfDay` 補理智之前）。`demon_path` 改版：戰力 +8%、走火入魔者自己對別人的好感獲取減半、別人對他照常（`loveGainMult`，單箭頭修羅場）。數字在 `CONFIG.sanity`。
- **主神強制血腥任務（4-C-4）**：Day 15 保護期後計時，每 12 天一次（人口 > 6 + 空間等級×2 時改 6 天，每日重算）；觸發後 2 天內必須派隊，**不可花積分化解**，逾時主神抹殺 1～2 名在空間的人（空間最後一人不死、改致命傷）、全員理智 -25。關卡：5 房過 3、單房上限 80%、單房失敗傷勢 +1、R = max(空間等級基準 [220,850,3600,15000,60000], 名冊前 4 強有效戰力 × 0.55)、基礎獎勵 [260,900,3000,9500,30000]（`baseR` 已於 4-C 後續下修為 [160,450,1400,3800,9500]，只防留菜鳥壓低難度）、每戰死 1 人存活者 +25%（加算）；通關存活者照常頓悟，不計尾王守門、不掉結晶、無情報條與獎勵遞減。強制任務待派時主神搞事不擲新事件；**自動派遣**會替任務保留前 4 強（`CONFIG.auto.holdForMandatory`），等他們回家再派，期限前最後一個時段才硬派。UI：`#btn-mandatory` 與派遣面板頂端的專屬選項。數字在 `CONFIG.forcedMission`。
- **英靈碑（4-C-5）**：`geneLock ≥ 1` 或出征 ≥ 15 場的人，**副本戰死**（含被隊友殺）或**主神抹殺**（強制任務逾時、直接殺人的主神懲罰）時入碑，主動回收與空間內被同伴殺害不算。碑上加成最高的前 4 名生效，依生前基因鎖 0～4 階 +2／4／8／13／20% 全隊有效戰力（加進 `effectivePower` 的百分比區，最多 +80%）；碑最多留 20 筆。UI：`#btn-stele` 名單與總加成。數字在 `CONFIG.stele`。
- **開局**（露葵 2026-11-14）：600 分 + 3 個 C 級。所有階級入隊五維統一為零階凡人（戰力 26~34、生命 90~110、防禦／速度／運氣 8~14）；階級之後只決定成長倍率與基因鎖上限（Phase 4-B）。
- **抽卡（Phase 4-B 四階卡池，取代舊 150／400 雙池）**：初級／中級／高級／神級池，依 `state.spaceLevel >= 1／2／3／4` 解鎖（未解鎖 UI 鎖住）。基礎價 120／350／1200／4500，本週每多抽 1 次加 20／60／200／800 分；機率 C／B／A／S：初級 75／23／2／0、中級 30／55／15／0、高級 0／60／35／5、神級 0／25／65／10。每 7 天（Day 8、15、22…）重置「本週抽數」，各池保底計數跨週保留：中級第 10 抽必出 A 以上、高級第 25 抽必出 S、神級第 12 抽必出 S（抽中保底階級才歸零）。神級池每抽固定消耗 1 顆因果結晶（結晶不隨週內抽數遞增）。
- **因果結晶**：第 12 關首通 +2 顆、第 13～20 關首通各 +1 顆；另外第 4 章任一副本通關 15%、第 5 章 25% 機率 +1 顆（首通必掉與機率掉落各自獨立、可疊加）。只用於神級池。
- **基因鎖／強化／頓悟（Phase 4-B）**：`geneLock` 0～4 階，入隊 0 階，上限依階級固定 C 1／B 2／A 3／S 4。階段：強化次數上限 3／6／10／15／20、本體戰力乘區 ×1.0／2.2／4.8／10.5／23.0、突破到該階需空間 Lv.2／3／4／5、費用 300／1200／4500／16000；**突破前必須先點滿當階強化次數**。成長倍率 C ×1.00／B ×1.25／A ×1.60／S ×2.00，乘在每次強化與頓悟的增量上。個人強化每次 戰力 +round(8×倍率)、生命 +round(8×倍率)、防禦／速度／運氣各 +round(2×倍率)，費用依第 n 次：1～3 次 80、4～6 次 220、7～10 次 650、11～15 次 1800、16～20 次 5000；人在主神空間（不在副本／催熟艙）即可強化、突破，帶傷也行。通關頓悟：副本成功結算時，每位存活隊員 12% 觸發，戰力 +round(3×倍率)，另隨機一項副屬性（生命／防禦／速度／運氣）+round(2×倍率)；每人累計上限 (geneLock + 1) × 4 次。**基因鎖乘區只乘本體值，不乘裝備白值**。回收返還積分（C 30／B 80／A 250／S 800）只存在 `RANKS.recycleRefund`，尚未接到回收爐。
- **尾王守門（Phase 4-B）**：各章第 4 關尾王需要「該章前 3 關合計成功結算滿 8 次」（含首通與重打、失敗不算）才開放；已首通過的不再鎖。計數在 `state.chapterClears`。
- **獎勵遞減**：同一副本一直刷，獎勵越來越低，第 11 次後只剩 75% 地板價。首通額外 + 基礎獎勵 × 50%。
- **借刀殺人**：主神空間直接殺人會被主神懲罰，間接殺人（陷害、破壞裝備、騙去送死）允許。副本裡隨便殺。
- **Phase 4-C-6 曲線再校正**：維持費改制＋空投＋副屬性＋英靈碑讓經濟與存活力大增，積分不再是瓶頸（獎勵倍率從 ×0.15 到 ×4.5 對進度幾乎沒影響），進度改由 R 決定。`dungeons.js` 現值 = 4-B 的值再乘：獎勵第 2～5 章 ×1／0.6／0.4／0.4（相對 4-A 原始表 ×2.5／2.7／3.6／3.2）；R 第 2 章 ×1.1、第 3 章一般 ×1.6／尾王 ×2.2、第 4 章 ×1.6、第 5 章 ×1.4。實測（`npm run sim -- --seeds=100 --days=900`）：尾王首通中位數 Day 27／81／167／323／427（偏差 -10%／+1%／+1%／+8%／-5%），首通比例 99%／90%／90%／86%／85%，遊戲結束 0%（4-B 約 41% 種子陷入死亡螺旋）。**4-C 後續（露葵拍板）**：`baseR` 下修為 [160,450,1400,3800,9500] 後重跑 sim：尾王首通中位數 Day 27／74／154／281／407（偏差 -10%／-7%／-7%／-6%／-10%），強制任務通關率 61%（目標 65～80%，略低）、每局戰死約 23 人、遊戲結束 0%。**以下是下修前（4-C-6）的紀錄**：強制任務通關率約 46%、每局戰死約 32 人（總戰死約 74 人/900 天），`forcedMission.powerMult` 在 0.40～0.55 對通關率幾乎沒影響（R 由 `baseR` 下限決定，Lv.5 的 60000 高於當時隊伍戰力），要降死亡得調 `baseR`（未動）；最終積分約 2200 萬，後期積分嚴重過剩。
- **（以下是 4-B 的數字，已被 4-C-6 覆蓋）副本推薦戰力與獎勵（Phase 4-B 依 sim 校正）**：推薦戰力 R 第 1 章 90／130／185／468、第 2 章 380／540／760／2520、第 3 章 1550／2200／3100／11000、第 4 章 6400／9100／12800／36000、第 5 章 15600／22200／31200／46800；通關基礎獎勵第 1 章 95／125／165／230、第 2 章 850／1125／1500／2050、第 3 章 5175／6750／9000／12150、第 4 章 32400／43200／57600／77400、第 5 章 92000／120000／160000／224000（全表在 `src/data/dungeons.js`）。目標：各章尾王首通中位數約 Day 30／80／165／300／450（±20% 內算達標）。**校正結果**（`npm run sim -- --seeds=100 --days=450`，機器人預設參數）：中位數 Day 30／86／171／275／380，首通比例 92%／74%／65%／41%／17%；第 5 章因 450 天視窗截尾偏低，用 `--days=900` 量為 Day 446。**已知**：①獎勵倍率要抬到 ×2.5／×4.5／×9 才讓機器人撐得住（升級後維持費翻倍、核心隊伍死亡後無法重建），這代表維持費、死亡率與獎勵的比例值得日後重看；②約 4 成種子在高等級會因核心隊伍死光而陷入「新人養不起」的死亡螺旋（模擬 `存活<=1`）；③自動派遣 `minClearChance` 0.6 會讓弱隊去打高 R 副本，出征門檻調高會讓全部章節大幅變慢，所以維持預設；④第 5 章首通時間受「戰力上限（基因鎖與結晶限制 S 級供應）」而非獎勵限制，第 5 章獎勵倍率 ×8 不影響進度。

- **Phase 4-E 小隊隊長與五大流派（露葵 2026-11-14 規格；數字在 `CONFIG.squad`／`drama`／`lineage`）**：
  - **隊長（4-E-1）**：空間 Lv.2 啟用；首次任命免費，當天結算前沒指派就自動冊封戰力最高者；隊長個人戰力 +8%、在隊時單房失敗理智損耗 -1（最少 1）。**流派由隊長性格詞條決定**（`deriveSquadStyle`，對應表 `data/squadStyles.js`，無對應詞條＝共生羈絆流），UI 任命列表明牌顯示。隊長死亡／被回收：和平順延（共產／羈絆看資歷＋平均好感、養殖／菁英看戰力、傭兵看私房錢＋裝備身價）；戰力前兩名差 < 15% 且（雙方淨好感都 < -15 或流派不同）爆發隊長印記爭奪戰；主神撤換令花 500×空間等級＋1 結晶，空降戰力 < 最強老鳥 70% 則比他強的老鳥理智 -15、好感 -20。
  - **「好感」一律指淨好感 `affinity = love - hate`**（love／hate 各自 0～100 不會是負的）；`shiftAffinity` 扣好感先扣 love、扣光轉 hate。
  - **五大流派（4-E-2）**：communal 均分＋戰死遺產全進 `communalFund`、老鳥捐 50%／菜鳥補貼、防禦 +0.08；bond 帶傷 ×1.25、擋刀（好感 ≥45 且未重傷、50%、每場 1 次）、通關理智 +4、碑文 ×1.5；farming 隊長在隊 80%（留守抽 35%）、零階新人維持費 -50%、肉豬陣亡隊長 +12% 戰力／結算 +20%（2 層）、**每日對隊長好感 -1**（規格原為 -2，sim 校正）、理智 -1；elite 戰力^1.4 分贓、尾王／叛逃 Boss +15%、失敗理智 ×2；mercenary 稅後 +18% 溢價按身價分、黑市 95 折、內鬥 ×0.2、同行情誼減半。分潤在 `wallet.distributeLoot`（回傳多了 `shares`／`style`）。
  - **5:2:1 事件（4-E-3）**：每日 25%、副本成功結算 30%；群組權重 bond:friction:melee = 5:2:1，抽到的群組演不了就退回 bond。生死搭檔（雙向淨好感 ≥65）同隊 `partyPower` +4%。黑貨使用紀錄在 `state.squad.contraband`。
  - **子嗣／遺物／叛逃（4-E-4）**：孕育條件雙向淨好感 ≥75、都沒重傷、冷卻 30 天、7 天培育（可花公庫加速）；與 3-F 戀人生子共用 `giveBirth`，兩邊都有 `generation`／`talentPct`（`inheritPower` 天賦，硬封頂 +25%）。geneLock ≥2 或隊長副本戰死 → 最高階武防進 `armoryHeirlooms`（上限 8，穿上白值 +10%）。叛逃：對隊長淨好感 ≤ -55 且理智 < 25，15%/天；隊長、對隊長好感 > 0、穿 soulbound 裝、有 `customProfile` 者 100% 免疫；上限 5 名，常規副本 10% 亂入最後一房。**孕育道具商店裡還沒有**（只有 `inducePregnancy` 接口，避免動黑市抽樣亂數）。
  - **UI（4-E-5）**：頂欄 `#btn-squad` 徽章；指揮部四分頁（指揮／遺物庫／編年史／叛逃者）；角色詳情「世代／小隊」列。暫停事件新增 `squad`、`drama`（預設關）。
  - **4-E-6／4-E-7 校正結果**（`npm run sim -- --seeds=100 --days=900`，自然演化，4-E-7 後）：尾王首通中位數 Day 24／66／175／281／428（-20%／-17%／+6%／-6%／-5%，第 1 章偏快是新手期維持費減半造成，仍在 ±25% 內），遊戲結束 0%，公庫期末均值約 360 萬，流派分佈約 elite 63%／bond 16%／communal 15%／mercenary 4%／farming 2%（自動冊封取最高戰力，偏菁英）。`--forceStyle` 五流派全部在 ±25% 內。每局孕育子嗣約 3.5（只計 4-E 孕育，不含 3-F 戀人生子）、叛逃約 0.04 次（4/100 局發生）、communal 強制流派期末互助金約 208 萬（4-E-7 前 494 萬）。**已知**：互助金的入口（戰死者遺產 100%）沒有上限，只有老鳥捐獻受軟上限；之後要再壓可調 `donatePct` 或加遺產上限。
  - **4-E-7 數值收尾與實測補丁**：①孕育冷卻 60 天、孕育機率 2%/天，3-F 與 4-E 共用同一把雙親冷卻鎖（`giveBirth` 預設冷卻 = `CONFIG.lineage.cooldownDays`）；②共產流捐獻率 25%、互助金 ≥ `fundCapPerLevel`（15000）× 空間等級時老鳥暫停捐獻，補貼擴及重傷治療費與「基因鎖低於隊長的 1 階者」衝 2 階（補到費用 ÷ 0.8 以涵蓋 20% 備用金規則）；③叛逃條件放寬為淨好感 ≤ -45 且（理智 < 45 或 `demon_path`），免疫名單不變；④新手期：空間 Lv.1 每日維持費 ×`CONFIG.space.newbieUpkeepMult`（0.5）；⑤公庫赤字時 `distributeLoot` 臨時以 max(稅率, `CONFIG.tax.deficitMinRate` 0.75) 抽稅，不改 `state.taxRate`；⑥主神「臨時開銷稅」化解改為花積分＋全體留守者理智 -5（異質代價；`godEventEconomics` + 測試掃描禁止同幣別套利）；⑦UI：任何放大視窗開著時隱藏 `#run-list` 迷你小窗；派遣／抽卡／許願／主神事件／小隊指揮部開窗自動暫停、關窗恢復（開窗前已手動暫停則維持暫停；存檔寫回開窗前的暫停狀態）；任務榜（用套突變後的實際 R）、尾王區、指定任務、奇物圖鑑一律依推薦戰力升序。

- **Phase 4-E-8 世界文本、200 件商店與 UX（露葵 2026-11-14 規格）**：
  - **30 世界**：正式名稱與去版權化描述在 `worlds.js` 的 `WORLD_TEXT`；數值沿用 `CHAPTER_ANCHOR` 並確保同章 R 與獎勵嚴格升序。**200 件總表上線後全隊戰力約為 4-D 的 2 倍（每人 4 個穿戴欄，血統也是白值），所以各章推薦戰力 R 另乘 `E8_R_MULT` = ×1.4／1.5／1.5／1.65／2.2（`dungeons.js`，含前 3 個真實世界與尾王）**。
  - **穿戴欄**新增 `accessory`（飾品）；血統改成白值（不再是百分比）；常駐 8 件含 2 個血統。逛街 AI 的換裝掃 4 個欄位。**停售**：舊的迷魂香／忘情水／捏造人偶／休眠艙／延期令／出征護符與戰術藥（新總表沒有）；因此 4-E-3 的「黑貨事發對質」改綁新黑貨耗材（奪舍禁符、催生黑貨），「造人泥替身被本尊撞破」改成「催生黑貨被本尊撞破」。
  - **耗材與黑貨效果（結構化欄位，引擎統一解析）**：九轉金丹永久生命 +10（`s.elixirUses` 單人上限 3，滿了 AI 不買、手動賞賜僅回傷）；破鎖助推 `s.geneBuff`（對應階級破鎖折抵：T1～2 20%／T3～4 25%／T5 30%，突破後消耗；破鎖沒有失敗判定，所以耗材只有花費折扣、沒有成功率）；替死護符 `s.deathWard`（上限 1，致死判定消耗：一般改輕傷、`fullRecover` 傷勢清零回滿理智）；世界情報道具 `gainIntel`（情報條 0～100% 對應 -3%～+9%，只動已解鎖未滿的世界）；好感／消仇走 `softenHate`；催生黑貨走 `inducePregnancy(…, {talent})`（normal／high 保底 15%／max 頂滿 25%，對象需雙向淨好感 ≥ 60）；爆發耗材（個人 `nextRunPowerMult`、全隊 `partyNextRunPowerMult`）同場只取最高 1 件不連乘，`postRunInjury`／`partyPostRunSanity` 在結算扣；裝備被動由 `gearFx.js` 在日結／結算／`addLove`／`addHate`／政變檢定掛鉤。
  - **AI 防呆**（`aiAllowed`）：理智 < 50 不買會害理智的黑貨；重傷不買燃血類；有替死符不重複買；催生黑貨只在有對象時由 5% 搞事骰偷買。
  - **舊存檔**：舊裝備／遺物照舊名稱與白值計算；黑市舊貨自動重抽（`refreshStaleSlots`）；新欄位 `elixirUses`／`deathWard`／`deathWardFull`／`geneBuff`／`state.autoStrategy`／`settings.autoPause` 補預設。
  - **UX**：①自動派遣看戰力下菜 `state.autoStrategy`（safe ×1.2／balanced ×1.0〔Lv.1 ×0.85〕／aggressive ×0.8 的「隊伍戰力 ÷ 關卡有效推薦戰力」門檻，全擋就待機休整，風險提示每 3 天最多一次；sim 預設 off）；②強制任務徵召無視日常自動派遣鎖（鎖只管日常掛機）、刷出當下與最後 1 天各提醒一次（事件 `mandatory`）；③空白鍵暫停／繼續、數字鍵 1～5 切速、新增 0.5x、1x 放慢 25%（`tickMs` 2500）；④設定頁「自動暫停」總開關控制開窗自動暫停；稅率 ≤30%／≥60% 頂欄顯色；⑤詞條效果說明（懸浮＋點擊面板）、隊長指揮部頂部職責與五流派對照表、上崗手冊第 6 張卡。
  - **校正**（`npm run sim -- --seeds=100 --days=900`，自然演化）：未校正 R 時尾王首通中位數 Day 21／59／119／198／250；校正後 Day 32／78／169／276／371（+7%／-2%／+2%／-8%／-18%），遊戲結束 0%；`--forceStyle` 抽樣：communal 第 5 章 -24%、bond 第 5 章 -25%（已在邊緣，第 5 章偏快）。自然孕育固定 1.0%/天（bond 流派 +0.5%；雙方留守、沒重傷且「社交助興」再 +1.5%：帶著沒用掉的同行好感耗材、喝過合道仙露 3 天內、或雙向淨好感 ≥85 且私房錢各 ≥500）；**不再追求每局子嗣總數，sim 只記錄**（自然演化約 17 個，含催生黑貨約 3）、叛逃約 0.06 次。**收尾版 sim**（自然演化）：尾王首通 Day 32／78／170／272／364（+7%／-2%／+3%／-9%／-19%），遊戲結束 0%。**已知**：bond／communal 後期偏快。
  - **收尾微調**：前 3 個世界（密室殺陣、喪屍危城、猛鬼宿舍）的房間文字改寫對齊新世界觀（喪屍危城原本是佔位房間），密室殺陣與猛鬼宿舍的首通獎勵改名（id 與效果不變：破局者手札／防爆機關護具／洞悉死門之眼；夜巡者的警覺／辟邪護身符／桃木驅鬼釘；兩個世界的 `genre` 標籤仍是舊的「靈異」「科幻」）；`❓ 上崗手冊` 改成雙分頁（🌱 新手上崗教學〔預設〕／💼 進階社畜手冊，內容在 `main.js` 的 `GUIDE_PAGES`）。

- **Phase 4-D 活體雙錢包經濟（露葵 2026-11-14 規格；數字在 `CONFIG.tax`／`wallet`／`shop`／`market`／`board`／`relic`／`shopping`）**：
  - **公庫與私房錢（4-D-1）**：`state.points` = 主神公庫（維持費、抽卡、賞賜裝備、公庫補助強化／突破、黑市手動刷新）；每人 `s.wallet` = 私房錢。`state.taxRate`（預設 0.40，UI 0.20～0.80、步進 0.10）。副本／強制任務結算總積分先抽 `round(總額 × 稅率)` 入公庫，其餘由當場存活隊員平分入私房錢（除不盡的零頭歸公庫；全滅全歸公庫）——`distributeLoot` 獨立函式，4-E 流派可傳 `rate` 覆寫。稅率 ≤ 0.30 在空間成員每日理智 +1、≥ 0.60 −2、≥ 0.80 −4。公庫買裝備 = 賞賜：綁定（`s.soulbound[slot]`，自己逛街不會覆蓋）且理智 +5；主動回收 100% 私房錢連同返還金歸公庫，戰死／被抹殺 50% 充公、50% 消散。**公庫與私房錢的商店／黑市／強化消費一律累加進 `state.totalSpent`**。
  - **商店與黑市（4-D-2）**：常駐商店只賣 `standard` 制式武防與 `permanent` 常備藥；特產／耗材／黑貨走 8 格黑市（每 3 天換貨，3 特產武防＋2 特產血統＋2 耗材＋1 黑貨，每格限購 1 次，抽樣範圍 = 當前最高 Tier 與前一階；手動刷新公庫付 [50,150,450,1200,3000] × 同日第 n 次；可鎖 1 格；特產綁定世界情報滿格 85 折）。裝備欄：武器／防具／血統（每人 1 個，覆蓋舊血統，`powerPct` 吃進有效戰力）；特產武防在綁定世界單房通過率加成（全隊上限 `shop.worldPassCap` 6%）；耗材 `buff` 進 `s.consumables`（上限 3）、出征時轉單場 `runBuff`；黑貨：迷魂香（單向加好感）／忘情水（雙向清零）／捏造人偶（`drama_custom_doll`，其他留守者對對象好感 −N、仇恨 +N/2）／私人休眠艙（鎖 3 天，不能派遣、不能逛街）。延期令：強制任務期限 +2 天。
  - **逛街 AI（4-D-3）**：`endOfDay` 維持費與休養後，在空間、非休眠艙、私房錢 > 0 的人每天最多 2 次動作：重傷買治傷、理智 < 45 買回理智 → 缺武防或階層低於已解鎖階層就換裝（不覆蓋綁定）→ 私房錢花完仍留 20% 才自費強化／突破 → 依詞條偏好搶購黑市；愛搞事者（搞事詞條、低理智、戀人／愛慕對象在場）每天擲一次 5% 偷買黑貨（4-D-7 由 15% 下修；同一人買過後 10 天冷卻，`s.lastDramaDay`）。
  - **30 世界、任務榜、突變、奇物（4-D-4）**：每章 5 常規＋1 尾王（尾王守門仍是該章常規關累計 8 次）；常規副本走 3 槽任務榜（每 2 天輪換、章節權重偏最高章 5／前一章 3／更早 1、每槽 1 個突變詞綴，派隊的槽結算後補新槽），尾王常駐、不佔槽。突變：吊橋效應（同行情誼好感 ×1.5，基礎 +2）、斷電黑夜（單房失敗再 −3 理智、積分 +15%）、分贓誘惑（積分 +25%、內鬥／背刺 ×1.5）、血月狂躁（R ×1.15、積分 +20%）、濃霧走散（速度鎖血 −5%、隱藏房機率翻倍）、風平浪靜（35%）。每世界 2 奇物（首通必得／貪婪探索隱藏房掉落，已擁有轉 `dupRewardPct` 額外積分）；貪婪探索要該副本情報滿格，通關門檻達標後 20%（濃霧 40%）追加 1 間 R×1.35 隱藏房；60 件奇物原始加成合計 30%，全隊有效戰力硬封頂 +25%。主神突襲／許願的指定副本不在榜上，UI 另開「指定任務」區。
  - **4-D-7 試玩 UX 補丁**：許願／主神搞事／強制任務派遣與一般派遣畫面顯示隊員狀態摘要折疊區（姓名、戰力、傷勢、理智），有人 `injury >= 2` 或 `sanity < 30` 顯示紅色警告；頂欄 `❓ 上崗手冊`（`guide()`，5 張規則卡片；新局第 1 天首次自動彈出，`state.settings.guideSeen` 記住不重複打擾，未讀時按鈕脈動）。
  - **預留（4-E 前不實裝邏輯）**：`state.squad = { captainId, style }`、`s.customProfile`。
  - **4-D-6 校正結果**（`npm run sim -- --seeds=100 --days=900`，預設稅率 0.40）：尾王首通中位數 Day 27／68／180／300／454（偏差 -10%／-15%／+9%／0%／+1%），首通比例 99%／98%／97%／95%／88%，遊戲結束 0%；公庫期末均值約 310 萬（4-C 約 2200 萬；輪迴者總消費約 327 萬、機器人公庫總支出約 263 萬）；奇物平均收集 44／60。為此調整（寫進 `dungeons.js` 的 `CHAPTER_ANCHOR`）：第 2～5 章 R 再乘常規 ×1.3／0.9／1.4／1.8、尾王 ×1.5／0.9／1.5／2.4（雙錢包＋血統＋奇物讓後期變強太快）；獎勵第 3～5 章再乘 ×0.85／0.5／0.45（壓低公庫堆積）。**暫定值需露葵驗證**：同行情誼好感 +2、捏造人偶與休眠艙效果、（露葵已於 4-D-7 拍板：校正係數、同行情誼 +2、奇物與商品價格、捏造人偶與休眠艙效果全部確認採用）。

- **Phase 4-F 永久基建、位面侵蝕、洲際宿敵、八卦日報（露葵 2026-11-14 規格；數字在 `CONFIG.facility`／`erosion`／`rival`／`gossip`）**：
  - **永久基建（4-F-3）**：`state.facilities` 五座（重力修煉室 Lv.10〔全隊基礎戰力 +3%/級〕、生命溫養艙 Lv.10〔重傷自然痊癒 +5%/級、留守理智 +0.5/級〕、法則共鳴碑 Lv.10〔開鎖費 -2%/級，與破鎖耗材加算總封頂 -45%〕、萬界育嬰堂 Lv.5〔培育期 -5%/級、資質下限 +4%/級〕、星界觀測樞 Lv.5〔情報獲取 +10%/級、洲際勝利積分與掉落 +8%/級〕），造價等比遞增（`costGrowth` 1.45，滿級總和 80／50／90／60／45 萬），高階要侵蝕結晶（重力／共鳴碑 Lv.6～10 = 2/4/6/9/12、溫養艙 1/2/4/6/8、育嬰堂 Lv.4～5 = 5/10、觀測樞 4/8）。共產流隊長且 `communalFund` 超過軟上限時，超額最多折抵 30% 造價。`state.autoUpgradeFacilities`（預設 false；sim 預設開）：日結公庫高於 30000×空間等級才動用超出部分，便宜優先。UI：`🏗️ 基建` 面板。
  - **位面侵蝕 1★～10★**：空間 Lv.4（首通第 3 章尾王）解鎖，已首通世界可選 k★：R ×1.45^k、積分 ×1.32^k、成功掉 k 顆 `state.erosionCrystals`、記 `state.maxErosion`。派遣畫面有星級下拉。**自動挑戰侵蝕**（`state.autoErosion`，預設 false；sim 預設開）只在「主線卡關」（打得過的任務章節都低於最前線）或「第 5 章尾王通過後」才接手，從已首通世界裡獎勵最高的前 3 個挑可安全吃下的最高星級；**不這樣限制會搶走推進主線的人手**（實測：無限制時第 4 章尾王永遠打不到）。
  - **洲際碰撞（4-F-1）**：空間 Lv.1 零觸發；升 Lv.2 後 35～45 天首次、之後每 35～45 天刷出（不連續同一隊），限時 5 天，刷出當天與剩 1 天發 `rival` 事件（暫停事件＋預警彈窗，受「自動暫停」總開關控制），歸零自動徵召戰力最高 4 人（無視日常鎖）。碰撞是動態副本（5 房過 3、單房上限 85%；R = max(`baseR`[空間等級], 前 4 強戰力×0.45)×宿敵 rMult）。**落敗**：公庫 -20%（<= 0 不扣）、存活者重傷＋理智 -15、私奔判定，不 Game Over。八隊特色：polaris 奇物／zhonghuang 護體（我方通過率 -4%）+結晶 2／dongying 肉豬策反／inferno R×1.25 硬鎖、獎勵 ×1.8、黑貨（抹殺奇點）或結晶 4／golden 全隊私房錢＋同心香囊／joyous 致死率 -70%、春風 35%／mech 免疫精神加成（關係與心情正向加成失效）、免費強化＋公庫積分／retire 致死率 -50%、全體傷勢 -1＋買路財。
  - **跨隊修羅場（4-F-2）**：春風一度（合歡 35%、其他 10%；隨機 1 名非孕期／冷卻外且未重傷的我方成員生單親「跨洲混血子嗣」，`hybridOrigin`、資質 +15% 仍封頂 +25%，冷卻 60 天）；私奔（候選：對隊長淨好感 <= -5，或理智 < 45 且淨好感 < 15；落敗時 35%、單場最多 1 人；對 golden 黃金財團／joyous 合歡粉紅隊**不論勝負**戰後再檢定一次 12%〔重金挖角／魅惑拐人，單場最多 1 人〕；整份快照進敵隊 `roster`，下次同隊登場當打手、R 每人 +3%、有互嗆日誌；**隊長／soulbound（有任何綁定裝備）／`customProfile` 100% 免疫**）；反拐（勝利、人數未滿、隊長 bond／communal，15% 拐走副手；優先拐回自己的叛逃者）；東櫻肉豬策反（隊長 communal／bond 或隊員對隊長平均淨好感 >= 40，40% 起義：R -15%、戰後收編 1 名 A／B 新人，對隊長好感 +50）。**規格 `soulbound === true` 與程式不符**（`s.soulbound` 是 `{ 欄位: true }`）：兩種都視為神眷綁定。「高魅力／高好感體質」沒有對應欄位，春風一度與反拐沒有額外門檻。
  - **八卦日報（4-F-4）**：頂欄 `📰 八卦日報`，Canvas 900×1260 直式報紙（報頭＋經營戰報／頭條／愛恨關係圖／英靈碑＋種子碼），可下載 PNG、複製種子碼。`state.seed` 是新增的本局初始種子（舊存檔為 null，顯示「舊存檔無種子碼」）。新增編年史種類 `elope`／`counter`／`inferno`／`guard`（擋刀者戰死）／`hybrid`／`rival`。
  - **新增存檔欄位**：`state.seed`／`facilities`／`erosionCrystals`／`autoUpgradeFacilities`／`autoErosion`／`maxErosion`／`facilityRngState`／`rivals`，輪迴者 `facilityBonus`／`hybridOrigin`，run 的 `erosion`／`rival`，結算摘要 `erosion`／`erosionCrystals`／`rival`；`deserialize` 缺欄位補預設。暫停事件新增 `rival`（預設開）。
  - **R 曲線校正（`dungeons.js` 的 `F_R_MULT` = ×1／1／1／1.6／1.7）**：基建與結晶讓後期成長更快，未校正時 900 天自然演化尾王首通中位數約 Day 32／79／165／219／318；第 4、5 章 R 再乘 ×1.6／1.7。實測（`npm run sim -- --seeds=100 --days=900`，自動建設與自動挑戰侵蝕開）：**Day 32／79／165／333／474**（+7%／-1%／0%／+11%／+5%），首通比例 97%／96%／95%／94%／84%，**遊戲結束 0%**，公庫期末均值約 31 萬（4-E-8 約 185 萬）、輪迴者總消費約 501 萬；基建期末平均等級：重力 5.8／溫養艙 6.6／共鳴碑 5.6／育嬰堂 2.3／觀測樞 2.5；侵蝕每局約 191 場（通關 107）、最高星級均值 6.2★、期末剩餘結晶約 253（結晶供過於求，不是瓶頸，積分才是）；洲際碰撞每局約 19.6 場、勝率 58%、戰死 2.8 人、私奔 0.00、反拐 0.73、混血子嗣 2.2、策反 0.76（**私奔放寬前**；放寬後見下方）。**已知**：①第 5 章 900 天內通關比例 84%（4-E-8 約 90%），報表中位數只算有通關的局，全局真實中位數略高；②私奔放寬後（候選 <= -5 或低理智且 < 15、落敗 35%、golden／joyous 挖角 12%）重跑 sim：尾王首通 Day 32／79／159／333／489（第 5 章比例 82%）、遊戲結束 0%、洲際勝率 58%（`powerMult` 維持 0.45）、每局私奔約 0.51 次（約每百局 51 次，**高於要求的 5～20 次區間**，數字照規格沒再動，要壓可調 `CONFIG.rival.elope` 的 `chance`／`lureChance`／候選門檻）；③ ×1.9／3.1 的建議起點實測第 5 章只剩 40% 局通關、中位數 Day 717，所以改用 ×1.6／1.7；④洲際落敗扣公庫是 20%，公庫大時損失絕對值不小，但 sim 無死檔。**暫定值需露葵驗證**：洲際 `powerMult` 0.45、私奔頻率（見上）與各隊獎勵倍率／特色細節、基建造價成長 1.45、侵蝕自動挑戰的「卡關才接手」規則、洲際任務 `baseR`／`reward` 表。

## 2026-11 Bug 修復與功能更新（已完成，細節看 git 紀錄與 `test/bugfix.test.js`）

- **自動派遣策略**：`config.js` 的 `auto.rules`（穩健／均衡／激進各有通關率門檻、每日隊數、傷勢上限、死亡風險上限、留守人數；`off` 給 sim 用，維持舊行為）；`dungeon.js` 的 `deathRisk` 為粗估（需驗證）。強制任務自動徵召尊重鎖定與傷員保護，只有最後期限且沒人可派才放寬。
- **刻意沒改的設計（請露葵確認）**：#9 整點結束的副本隊員不補扣維持費（與「副本中的人不扣維持費」衝突，未改）；#28 侵蝕通關不計入尾王守門（維持設計，介面已註明）；#16 起，基建／黑市手動刷新／事件化解費／許願吃好的／加速出艙／撤換隊長不再計入商店階級（`spend(state, cost, false)`）。
- 舊存檔補欄位：`state.inventory`、輪迴者 `life`／`lifeFlags`／`kills`。

## 驗收指令

```bash
npm test
```

420 項測試都要通過。改到數值時再跑 `npm run sim` 看各章首通天數。改完程式碼後，用 Chromium 實際操作一輪（手動派遣 → 副本 → 結算 → 抽卡 → 鎖定 → 回收 → 自動派遣 → 許願彈窗 → 主神搞事彈窗 → 重新整理讀檔），確認沒有主控台錯誤。

## 不可違反的規則

1. 這是獨立專案，與舊 AI-TRPG 專案無關；舊專案的規則（六維十技能、Prompt 快取契約等）不適用。
2. 不要破壞現有測試。改完程式碼後一定要跑 `npm test`，420 項都要通過。
3. 所有可調數字都要放在 `src/data/config.js`，不要寫死在引擎裡。
4. 引擎不要碰 DOM，畫面邏輯不要寫進引擎。
5. 機密（Token、金鑰）永遠不能進 git。

## 部署檢查清單

- 推上 `main` ＝ 自動部署到 Cloudflare Pages，合併前先確認測試都過。
- 儲存庫：`ZhuShen-Sim`，子網域待定。
- Cloudflare Pages 設定：Framework preset 選 None、Build command 留空、Build output directory 填 `/`。
- 部署前確認 `npm test` 420 項全過。

## 開發階段（現在不要做，除非我明確要求）

**Phase 1（已完成）**：骨架與經濟循環 — 時間、主神空間畫面、抽卡、維持費、傷勢、3 個副本純數值派遣、破產方案。

**Phase 2-A（已完成）**：30 個 MVP 標籤、環境標籤、成功率公式（標籤／環境相性）、首次開荒、獎勵遞減。

**Phase 2-B（已完成）**：關係矩陣、每日互動與告白、借刀殺人、死亡連鎖、副本內內鬥／背刺／擋刀、關係面板。日誌文字目前是固定句子。

**Phase 2-C（已完成）**：主神監控日誌 Mad Libs 模板。所有日誌（含副本、經濟、關係）改成多版本模板 + 標籤反應句；副本各房間的 `pass`／`fail` 文字仍在 `src/data/dungeons.js`（固定句，未模板化）。事件冷卻 7 天的記憶機制留到 Phase 3。

**Phase 3-A（已完成）**：商店 4 階（累積花費 0/1000/5000/10000 解鎖，抽卡也算）＋強化／基本裝備／藥水；副本特殊獎勵永久生效（直接加數值：通過率、類型通過率、通關積分、全員傷勢減免）。血統、瞳術、技藝、技能、員工合同還沒做。

**Phase 3-B（已完成）**：許願系統。輪迴者在每日「特殊事件」骰中以 `CONFIG.wish.chance` 機率許願，自動暫停（暫停事件 `wish`，預設開）並彈窗答應／拒絕；4 種許願（吃好的花積分、放假 N 天不能派遣、想去副本通關、想要商店裝備），每人同時最多 1 個，超時算失敗。完成 → 高興（每人通過率 +5%，上限 15%）；拒絕／超時／副本沒通關 → 不爽（戰力 -10%、理智 -10），皆持續 5 天。心情掛在 `s.mood`，不是標籤。許願人死了或被回收就取消。「想去副本」目前只選推薦戰力 ≤ `dungeonPowerCap` 的副本，且照單一副本設計（日後若改成多隊並行副本要重看 `wishesAfterRun`）。

**Phase 3-C（已完成）**：並行副本。`state.run` → `state.runs` 陣列（舊存檔單一 `run` 在 `deserialize` 遷移）；每場有 `id`、`startTick`、隊伍、環境標籤。畫面：主神空間不變，右側「進行中副本」卡片清單（`#run-list`），結算視窗用 `state.runReports` 排隊（一次彈一個，沿用 `runEnd` 暫停事件）。自動派遣一次排多隊。`wishesAfterRun` 本來就依單場的副本／出征名單判斷，並行下仍正確（`test/parallel.test.js` 有驗證）。`#dungeon-view` 與 `.route-*` 樣式由 3-D（視角鎖定）使用。

**Phase 3-D（已完成）**：視角鎖定。名冊卡片的 👁 或詳情視窗的「鎖定視角」按鈕，同時只能鎖定一人，再按取消。鎖定對象在副本時，主畫面自動切到他那場的 `#dungeon-view` 路線圖（5 個房間節點＋小隊滑動＋存活人數／通過率），回家就切回主神空間。沒鎖定時主畫面維持主神空間，點右側 `#run-list` 卡片可手動看那一場，再點一次（或「⬅ 返回」）取消；鎖定對象進／出副本時手動選擇會被清掉。存檔欄位 `state.settings.followId`（`createNewGame` 預設 null，`deserialize` 缺欄位補 null；引擎不讀它，只給畫面用）；`peekRunId` 只存在 UI、不存檔。鎖定的人死了或被回收，`afterChange()` 會自動解除。`renderDungeonView` 骨架每場只建一次，之後只更新節點／位置／隊員（避免重建打斷 CSS 滑動）。
**Phase 3-E（已完成）**：主神搞事。每天跨日在「許願結算之後、關係事件之前」擲一次（`CONFIG.godEvent.chance` 8%；發生後冷卻 `cooldownDays` 5 天；待回覆事件未處理時不再擲）。**不掛在逐人的特殊事件骰上**（那是每人一次），而是整個空間一次，且用 `state.god.rngState` 獨立亂數流，所以不改變既有種子結果。4 種事件：臨時開銷稅（全體扣積分）、電擊抽查（點名一人理智下降）、強制健檢（點名一人：受傷／積分／理智三選一）、突襲任務（點名一人限時去指定副本，`dungeonPowerCap` 內；通關 +積分並高興，逾期／抗命扣積分並不爽）。只點名／影響留在主神空間的人（全員在副本就這天不擲；突襲任務還要求目標無傷、沒放假、沒有進行中的任務）。玩家可「照辦」或「花積分化解」（`resolveCost`，花的錢算進累積花費）；`answerDays` 天內沒回覆：一般事件視同照辦，突襲任務視同抗命受罰。突襲任務期限內可重打，人死了或被回收就取消（不罰）；期限到時目標還在副本中，等那場結算再算。新暫停事件 `godEvent`（預設開）：事件彈窗強制暫停；關掉則改用 `#btn-god` 手動處理。存檔欄位 `state.god = { rngState, cooldownUntilDay, pending, mission, nextId }`，`deserialize` 缺欄位補預設。**自動派遣優先任務**（`CONFIG.auto.missionFirst`，預設開）：`planAutoDispatch` 在任務目標還能被自動派遣（在家、沒鎖定、沒放假、保護開著時沒受傷）時，先找「含目標、打任務副本、預估通關率 ≥ `minClearChance`」的最佳隊伍，找不到才走一般邏輯，所以不會硬送人去死。**已知限制**：開局的 C 階目標常常家裡沒有健康隊友、通關率達不到門檻，這時任務仍會逾期（5 個種子模擬 10 場任務只完成 1 場，目標全是 C 階、最佳通關率 0～0.54）；要不要讓突襲任務挑得到可行目標，留給露葵決定。
**Phase 3-F（已完成）**：生小孩＋主神催熟艙（只做輪迴者之間）。戀人／靈魂伴侶雙方都在主神空間時，每天 `CONFIG.child.chance`（3%／5%）懷上，同一對冷卻 10 天、催熟艙同時最多 2 個；嬰兒直接進催熟艙（`location: "pod"`，`podDaysLeft` 3 天，每天只吃 5 分，不能派遣／回收，不參與日常／許願／主神搞事——這些系統本來就只看 `location === "space"`），期滿 `hatch` 長成輪迴者。階級＝隨機一位家長的階級（10% 再升一階）；標籤照一般抽卡抽出，再讓每個欄位有 70% 機率改抄父母同類標籤（`inheritedTags` 記錄抄了哪些）。小孩與家長互相好感 30。新暫停事件 `birth`、`hatch`（預設開，用頂端橫幅提示，沒做彈窗）。存檔欄位 `state.nursery`、輪迴者 `podDaysLeft`／`parents`／`inheritedTags`，`deserialize` 缺欄位補預設。`createSamsarite` 多了選用參數 `rng`。**機率、繼承比例、階級規則都是暫定值，需露葵驗證。**
**Phase 4-A（已完成）**：空間等級與章節。空間 Lv.1～5（`state.spaceLevel`，首通各章尾王升級，`state.chapterClearDay` 記天數）；五章 20 關（第 1 章前 3 關沿用舊副本，其餘佔位）；房數 5／7／8／10／12、門檻 3／4／5／6／7；飽和公式；各副本獨立情報條；維持費／破產線跟等級；商店 5 階（0／600／3000／12000／45000），裝備白值對齊章節錨點；五維統一；開局 600 分；`npm run sim` 平衡模擬。路線圖房間超過 6 間時隱藏節點名稱（`.route.dense`），改成滑鼠提示。**已知**：4-A 的模擬第 1 章尾王中位數第 4 天就首通（目標 Day 30），主因是標籤加成（自動派遣挑出的隊伍平均 +24%，上限 30%）佔了飽和公式可用區間的一大塊，加上 Tier 1 裝備便宜；**露葵 2026-11-14 決定**：等 4-B 完成後用 `npm run sim -- --days=450` 統一校正五章曲線；標籤加成上限 `CONFIG.tags.tagBonusCap` 與關係加成上限 `CONFIG.relations.bonusCap` 由 ±30% 改為 ±10%，排入 4-B 一起改；致命傷醫藥費 150%、首通 +基礎獎勵 50%、裝備白值武器 5/8／防具 3/8、暫留舊強化商品都已確認。`forcedMission` 只記錄數字（4-C-4 起已啟用）。
**Phase 4-B（已完成）**：基因鎖＋四卡池＋個人強化／通關頓悟＋尾王守門＋標籤／關係加成上限 ±10%＋五章曲線校正。規格細節（數字、公式、舊存檔處理）見上面「核心設計」的抽卡／因果結晶／基因鎖／尾王守門／副本推薦戰力各條。實作位置：`engine/growth.js`（強化、突破、頓悟、結晶掉落）、`engine/core.js`（四池、存檔遷移）、`engine/dungeon.js`（守門、結算掛鉤）、`engine/tags.js`（`effectivePower`）。舊存檔：缺的新欄位補預設，舊商店強化（`upgrades`／`bought`）清除、不退費，舊卡池狀態丟棄；已首通過的尾王不受守門鎖。UI：抽卡面板顯示四池狀態（鎖定原因、本週價格、保底進度、結晶），角色詳情有「強化」「突破基因鎖」按鈕與不能按的原因，派遣面板顯示尾王守門進度，結算視窗顯示結晶與頓悟，頂欄顯示因果結晶數。**沒做**：回收返還積分接回收爐（只存數字）、子嗣繼承值（欄位預留，4-E 才用）、副屬性（防禦／速度／運氣）的實際用途（4-C）。
**Phase 4-C（已完成）**：戰鬥副屬性（4-C-1）、理智閉環（4-C-2）、維持費改制＋絕境空投＋回收返還（4-C-3）、主神強制血腥任務（4-C-4，原排在 4-D，露葵 2026-11-14 併入 4-C）、英靈碑（4-C-5，原排在 4-E 的一部分）、sim 與曲線再校正（4-C-6）。規格與數字見上面「核心設計」各條。**新增存檔欄位**：`state.sanity`／`airdrop`／`mandatory`／`memorialStele`、輪迴者 `steleBonus`、run 的 `mandatory`／`dungeonDef`／`extraInjury`，`deserialize` 缺欄位補預設。**暫定值需露葵驗證**：傷勢戰力懲罰 -20%／-40%、理智扣減／恢復數字、強制任務通關率偏低、空投救援取消「遊戲結束」。
**Phase 4-D（已完成）**：活體雙錢包經濟、分槽黑市、輪迴者自主逛街、30 世界骨架＋3 槽動態任務榜＋6 大突變＋60 奇物＋貪婪探索、UI 綁定、sim 校正（6 個子階段 4-D-1～4-D-6，規格與數字見上面「核心設計」的 Phase 4-D 條）。**注入長文案時**：只改 `data/shopItems.js` 的 `ITEM_TEXT`、`data/relics.js` 的 `RELIC_TEXT`、`data/dungeons.js` 的世界內容，機制與測試不用動。
**Phase 4-E（已完成）**：隊長冊封與三軌繼承、五大流派、5:2:1 人際事件、跨代子嗣、先人遺物、叛逃野生 Boss、指揮部與空間編年史（6 個子階段 4-E-1～4-E-6，規格與數字見上面「核心設計」的 Phase 4-E 條）。**新增存檔欄位**：`state.squad`（擴充 `communalFund`／`captainSeq`／`contraband`／`counters`）、`squadRngState`、`chronicles`、`armoryHeirlooms`、`rogueBosses`，輪迴者 `generation`／`bondPartnerId`／`heirloomSlots`／`captainBonus`／`tempPowerPct`／`captainNo`／`maxBossChapter`／`talentPct`，`deserialize` 缺欄位補預設。
**Phase 4-E-8（已完成，4-E 的收尾）**：30 世界正式文本、200 件商店總表與結構化耗材／黑貨效果、舊存檔相容、AI 防呆，並附 5 項實測 UX 修補（規格與校正見上面「核心設計」的 Phase 4-E-8 條）。
**Phase 4-F（已完成）**：永久基建 5 座、位面侵蝕 1★～10★（含自動挑戰）、八大洲際宿敵團戰、跨隊修羅場（春風一度／私奔／反拐／肉豬策反）、《主神八卦日報》Canvas 圖卡、第 4／5 章 R 校正（規格與數字見上面「核心設計」的 Phase 4-F 條）。原本排在 4-F 的主神即時干預、子嗣繼承值接上、事件引擎重構順延到下一階段。
**Phase 4-G～4-J（還沒做）**：主神即時干預、子嗣繼承值接上、事件引擎重構、小黑屋／信徒／事件鏈／叛逃 Boss、修羅場等、吃瓜 UI、標籤庫擴充（編號待露葵重排）。
**Phase 3（還沒做）**：員工合同（含副本 NPC 與跟 NPC 生小孩）；商店的血統／瞳術／技藝／技能；事件冷卻記憶、事件鏈；更多許願種類與主神搞事種類（見 docs 計畫書 §9、§12、§13）。

**不做**：複雜動畫、音效、背景音樂（MVP 先不要）。

---

*這個檔案是給 Claude Code（小克）看的專案說明。設計有任何問題，先問開發者（露葵），不要自己猜。*
