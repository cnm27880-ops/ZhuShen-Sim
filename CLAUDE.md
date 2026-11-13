# 主神空間主管模擬器 (ZhuShen-Sim)

養成管理模擬器：玩家扮演被主神壓榨的主神空間主管，管理輪迴者、派他們去副本送死、處理他們的八卦跟恩怨。

## 技術

- 純靜態網站：HTML + CSS + JavaScript，零外部依賴，沒有打包、沒有 build
- 存檔：localStorage 自動存檔
- 亂數：可重現亂數（seeded random）
- 測試：Node.js 測試（`npm test`）
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
| `src/data/config.js` | 所有可調數字（開局積分、維持費、傷勢、抽卡機率、副本戰力、商店階層門檻 `shopTierUnlock` 等），改數字只改這裡 |
| `src/data/dungeons.js` | 副本資料表（3 個 MVP 副本：靈異村、太空船、魔法戰爭）；每個副本 3 個特殊獎勵（含永久效果 `effect`），`getSpecialReward(id)` 查獎勵 |
| `src/data/shop.js` | 商店商品資料表（Tier 1~4：強化／裝備／藥水，加商品只改這裡） |
| `src/data/tags.js` | 30 個 MVP 標籤 + 5 個副本環境標籤（資料表，加標籤只改這裡） |
| `src/engine/tags.js` | 抽標籤、戰力／通過率／獎勵／傷勢減免的標籤計算；`effectivePower` 與傷勢減免／閃避也會算入商店強化與裝備（`shopBonus`）；心情加成 `moodPowerPct`／`moodPassBonus` 也在這裡 |
| `src/data/relations.js` | 關係系統資料表：互動事件、借刀殺人手法、標籤特殊事件（每個事件的 `texts` 是多版本模板，加事件只改這裡） |
| `src/data/logs.js` | 日誌 Mad Libs 模板：系統／經濟／副本／關係的所有日誌句子（每個 key 多個版本）+ 依標籤而異的「反應」句池（加句子只改這裡） |
| `src/data/wishes.js` | 許願種類資料表（想吃好的／想放假／想去副本／想要裝備；`mode` 決定機制，數字在 `CONFIG.wish.kinds`，句子在 logs.js 的 `wishAsk_*`／`wishDone_*`） |
| `src/data/names.js` | 隨機姓名字庫 |
| `src/engine/` | 純規則引擎，不碰 DOM，可用 Node 直接測試 |
| `src/engine/templates.js` | 日誌模板引擎：`logText(state, key或texts陣列, vars)` 抽版本並填 `{A}{B}{react:池:A}`；抽版本用雜湊，不消耗主亂數 |
| `src/engine/rng.js` | 可重現亂數（rand / randInt / pick / weighted） |
| `src/engine/wishes.js` | 許願引擎：`maybeWish`（每日特殊事件骰掛鉤）、`acceptWish`／`refuseWish`、完成／失敗／超時、心情 `setMood`、`dailyWishes`（跨日倒數）；副本結算／商店購買各有掛鉤（`wishesAfterRun`／`wishesAfterBuy`） |
| `src/engine/relations.js` | 關係矩陣、每日互動、告白／戀人／靈魂伴侶／死敵、借刀殺人、直接殺人與主神懲罰、死亡連鎖、副本內內鬥／背刺／擋刀 |
| `src/engine/core.js` | 狀態、輪迴者、維持費、傷勢、高利貸、回收爐、抽卡、時間 tick、存檔、遊戲結束判定；`spend()` 累積花費並宣布商店解鎖、`shopTier()` 算階層 |
| `src/engine/shop.js` | 商店引擎：`buyItem`／`checkBuy`（強化、裝備、藥水）、`nextTierInfo`；`collectionEffects`／`collectionPassBonus`（副本特殊獎勵的效果） |
| `src/engine/dungeon.js` | 副本結算（5 個房間、成功率公式、通關機率）；並行副本：`startRun` 往 `state.runs` 加一場，`stepDueRooms`／`settleRuns` 依開場順序走房間／結算，結算摘要進 `state.runReports` 排隊；首通在結算時判定；掛鉤 `relationBonus` / `tagBonus`（含收藏加成）/ `rewardMultiplier`（含收藏加成）；首通掉特殊獎勵 id 進 `state.collection` |
| `src/engine/dispatch.js` | 自動派遣（`tryAutoDispatch` 一次排多隊，直到人手用完）、主迴圈一步 `step()`（走各副本該走的房間 → 時間 +1 → 結算）；含 `areEnemies()` 掛鉤 |
| `src/ui/main.js` | 畫面層，DOM 操作、CSS transition 滑動、emoji 顯示；含商店面板、視角鎖定（`viewedRun`／`renderDungeonView`／`toggle-follow`／`peek-run`）；`styles.css` 放所有樣式（`#dungeon-view`、`.route-*`、`.run-card`） |
| `test/` | 測試檔案（Node.js）：`engine`、`relations`、`templates`、`shop`、`wishes`、`parallel`（並行副本） |
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
- **一場副本 = 主神空間 1 天**：副本 5 個房間，每個房間 `roomTicks` 個時段（0.2 天）。主神空間與所有副本同步前進（`step()` 一步 = 1 個時段），可同時多場（含同一副本），不同隊不能有同一個人；副本中的人不扣維持費、不參與日常／關係／許願事件。同副本多場：成功率與傷勢表鎖定開場時的首次開荒／重打，首通與獎勵遞減在結算時依序計算（先結算的吃首通）。全滅的副本也要等時間到才結算。
- **成功率公式**：房間通過率 =（小隊總戰力 / 副本推薦戰力）× 50% + 標籤與環境相性 + 情報修正（首次開荒 -10%、重打 +5%）；關係加成 `relationBonus`（喜歡+10%、愛慕+20%、討厭-10%、仇恨-20%、靈魂伴侶+30%、死敵-25%，全隊上限 ±30%）。5 間通過 3 間以上算通關。
- **傷勢三級**：輕傷（休息 1 天）、重傷（3 天）、致命傷（7 天）。帶傷出征死亡率上升。
- **每日維持費**：基礎 10 分 + 階級加成（C+0、B+5、A+10、S+20）+ 傷勢加成（輕傷+5、重傷+15、致命傷+30）。只有待在主神空間才扣，副本裡不扣。
- **開局積分 500**（露葵 2026-11-13 由 150 調高）：夠抽三次 B~A 池。
- **抽卡**：B~A 池 150 分（70% B、30% A）、A~S 池 400 分（70% A、30% S），純隨機不保底。
- **獎勵遞減**：同一副本一直刷，獎勵越來越低，第 11 次後只剩 60% 地板價。
- **借刀殺人**：主神空間直接殺人會被主神懲罰，間接殺人（陷害、破壞裝備、騙去送死）允許。副本裡隨便殺。
- **各階級戰力**：C 34-42、B 42-54、A 68-84、S 105-135（範圍值，隨機生成）。
- **副本推薦戰力**：簡單 150、中等 5000、困難 100000（依計畫書；中等以上要等裝備／血統上線才打得動，角色基礎戰力範圍刻意不動）。

## 驗收指令

```bash
npm test
```

85 項測試都要通過。改完程式碼後，用 Chromium 實際操作一輪（手動派遣 → 副本 → 結算 → 抽卡 → 鎖定 → 回收 → 自動派遣 → 許願彈窗 → 重新整理讀檔），確認沒有主控台錯誤。

## 不可違反的規則

1. 這是獨立專案，與舊 AI-TRPG 專案無關；舊專案的規則（六維十技能、Prompt 快取契約等）不適用。
2. 不要破壞現有測試。改完程式碼後一定要跑 `npm test`，85 項都要通過。
3. 所有可調數字都要放在 `src/data/config.js`，不要寫死在引擎裡。
4. 引擎不要碰 DOM，畫面邏輯不要寫進引擎。
5. 機密（Token、金鑰）永遠不能進 git。

## 部署檢查清單

- 推上 `main` ＝ 自動部署到 Cloudflare Pages，合併前先確認測試都過。
- 儲存庫：`ZhuShen-Sim`，子網域待定。
- Cloudflare Pages 設定：Framework preset 選 None、Build command 留空、Build output directory 填 `/`。
- 部署前確認 `npm test` 85 項全過。

## 開發階段（現在不要做，除非我明確要求）

**Phase 1（已完成）**：骨架與經濟循環 — 時間、主神空間畫面、抽卡、維持費、傷勢、3 個副本純數值派遣、破產方案。

**Phase 2-A（已完成）**：30 個 MVP 標籤、環境標籤、成功率公式（標籤／環境相性）、首次開荒、獎勵遞減。

**Phase 2-B（已完成）**：關係矩陣、每日互動與告白、借刀殺人、死亡連鎖、副本內內鬥／背刺／擋刀、關係面板。日誌文字目前是固定句子。

**Phase 2-C（已完成）**：主神監控日誌 Mad Libs 模板。所有日誌（含副本、經濟、關係）改成多版本模板 + 標籤反應句；副本各房間的 `pass`／`fail` 文字仍在 `src/data/dungeons.js`（固定句，未模板化）。事件冷卻 7 天的記憶機制留到 Phase 3。

**Phase 3-A（已完成）**：商店 4 階（累積花費 0/1000/5000/10000 解鎖，抽卡也算）＋強化／基本裝備／藥水；副本特殊獎勵永久生效（直接加數值：通過率、類型通過率、通關積分、全員傷勢減免）。血統、瞳術、技藝、技能、員工合同還沒做。

**Phase 3-B（已完成）**：許願系統。輪迴者在每日「特殊事件」骰中以 `CONFIG.wish.chance` 機率許願，自動暫停（暫停事件 `wish`，預設開）並彈窗答應／拒絕；4 種許願（吃好的花積分、放假 N 天不能派遣、想去副本通關、想要商店裝備），每人同時最多 1 個，超時算失敗。完成 → 高興（每人通過率 +5%，上限 15%）；拒絕／超時／副本沒通關 → 不爽（戰力 -10%、理智 -10），皆持續 5 天。心情掛在 `s.mood`，不是標籤。許願人死了或被回收就取消。「想去副本」目前只選推薦戰力 ≤ `dungeonPowerCap` 的副本，且照單一副本設計（日後若改成多隊並行副本要重看 `wishesAfterRun`）。

**Phase 3-C（已完成）**：並行副本。`state.run` → `state.runs` 陣列（舊存檔單一 `run` 在 `deserialize` 遷移）；每場有 `id`、`startTick`、隊伍、環境標籤。畫面：主神空間不變，右側「進行中副本」卡片清單（`#run-list`），結算視窗用 `state.runReports` 排隊（一次彈一個，沿用 `runEnd` 暫停事件）。自動派遣一次排多隊。`wishesAfterRun` 本來就依單場的副本／出征名單判斷，並行下仍正確（`test/parallel.test.js` 有驗證）。`#dungeon-view` 與 `.route-*` 樣式由 3-D（視角鎖定）使用。

**Phase 3-D（已完成）**：視角鎖定。名冊卡片的 👁 或詳情視窗的「鎖定視角」按鈕，同時只能鎖定一人，再按取消。鎖定對象在副本時，主畫面自動切到他那場的 `#dungeon-view` 路線圖（5 個房間節點＋小隊滑動＋存活人數／通過率），回家就切回主神空間。沒鎖定時主畫面維持主神空間，點右側 `#run-list` 卡片可手動看那一場，再點一次（或「⬅ 返回」）取消；鎖定對象進／出副本時手動選擇會被清掉。存檔欄位 `state.settings.followId`（`createNewGame` 預設 null，`deserialize` 缺欄位補 null；引擎不讀它，只給畫面用）；`peekRunId` 只存在 UI、不存檔。鎖定的人死了或被回收，`afterChange()` 會自動解除。`renderDungeonView` 骨架每場只建一次，之後只更新節點／位置／隊員（避免重建打斷 CSS 滑動）。
**Phase 3（還沒做）**：狗血擴充 — 生小孩、員工合同、主神搞事；商店的血統／瞳術／技藝／技能。

**不做**：複雜動畫、音效、背景音樂（MVP 先不要）。

---

*這個檔案是給 Claude Code（小克）看的專案說明。設計有任何問題，先問開發者（露葵），不要自己猜。*
