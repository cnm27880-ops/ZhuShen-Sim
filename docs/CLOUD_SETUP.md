# 雲端存檔＋排行榜 設定步驟（Cloudflare Workers + D1 + Google 登入）

後端程式在 `worker/`，已用測試驗證過資料邏輯。**下面這些要你自己在網站後台做，程式碼做不到。**
標「需驗證」的地方，是後台畫面可能改版，名稱跟你看到的不一樣時以畫面為準。

## 一、Google：取得登入用的 Client ID 與密鑰

1. 開 https://console.cloud.google.com/ ，用你的 Google 帳號登入。
2. 上方專案選單 →「新增專案」→ 名稱 `zhushen-sim` → 建立，並確認右上角已切到這個專案。
3. 左側選單找「API 和服務」→「OAuth 同意畫面」（新版可能叫「Google Auth Platform」）（需驗證）。
4. 使用者類型選「外部 (External)」→ 填：應用程式名稱「主神空間打工日記」、使用者支援電子郵件（你的信箱）、開發人員聯絡資訊（你的信箱）。
5. 範圍 (Scopes)：用預設的 `openid`、`profile` 就好，**不要加 email 以外的敏感範圍**。
6. **發布狀態要改成「正式環境 (In production)」**。停在「測試」狀態時，只有你手動加進名單的人能登入（需驗證）。只用 openid／profile 這類基本範圍，通常不需要送審。
7. 左側「憑證 (Credentials)」→「建立憑證」→「OAuth 用戶端 ID」→ 應用程式類型選「網頁應用程式」。
8. 「已授權的重新導向 URI」新增：
   - `https://ZhuShen-Sim.yuci8660.uk/api/auth/google/callback`
   - （想在本機測試再加）`http://localhost:8787/api/auth/google/callback`
9. 建立後會顯示 **用戶端 ID** 與 **用戶端密鑰**。**密鑰只能貼到 Cloudflare 後台，不要貼給任何人、不要放進程式或 git。**

## 二、Cloudflare：建資料庫

> 如果你在 2026-11-14 這個版本之前就已經執行過舊版 `schema.sql`，`scores` 表缺少新欄位，要在主控台另外執行：
> ```sql
> ALTER TABLE scores ADD COLUMN best_power INTEGER NOT NULL DEFAULT 0;
> ALTER TABLE scores ADD COLUMN best_power_name TEXT NOT NULL DEFAULT '';
> ALTER TABLE scores ADD COLUMN longest_life INTEGER NOT NULL DEFAULT 0;
> ALTER TABLE scores ADD COLUMN longest_life_name TEXT NOT NULL DEFAULT '';
> CREATE INDEX IF NOT EXISTS idx_scores_power ON scores(best_power DESC);
> CREATE INDEX IF NOT EXISTS idx_scores_life ON scores(longest_life DESC);
> ```
> 還沒執行過的人直接貼整份 `schema.sql` 就好。舊版若已建過 `score` 欄位，留著不用管，後端不再讀寫它。

1. Cloudflare 後台 → 左側「儲存空間與資料庫」→ D1 SQL 資料庫 →「建立資料庫」（需驗證）。
2. 名稱填 `zhushen-sim`，建立。
3. 進入這個資料庫 →「主控台 (Console)」分頁，把 `worker/schema.sql` 的內容**整份貼進去**執行。成功後左邊會看到 5 張表：`users`、`sessions`、`saves`、`scores`、`rank_snap`。
4. 記下「資料庫 ID (database_id)」，之後要填進 `wrangler.jsonc`。

## 三、Cloudflare：讓網站載入後端（已完成，說明用）

repo 根目錄的 `wrangler.jsonc` 已經設定好（Worker 名稱 `zhushen-sim`、後端 `worker/index.js`、D1 綁定 `DB`、`/api/*` 交給後端、其餘網址給靜態檔）；`.assetsignore` 負責不把程式碼與文件當成公開檔案上傳。Cloudflare 後台「建置指令空白、部署指令 `npx wrangler deploy`、根目錄 `/`」不要改。**推上 `main` 就會自動部署。**

## 四、Cloudflare：填變數與密鑰

**要等第一次部署完成（有後端程式碼之後）後台才看得到「變數與機密」區塊。** 專案 → 設定 → 變數與機密：

| 名稱 | 類型 | 內容 |
|---|---|---|
| `GOOGLE_CLIENT_ID` | 文字 | 步驟一第 9 點的用戶端 ID |
| `GOOGLE_CLIENT_SECRET` | **密鑰 (Secret)** | 步驟一第 9 點的用戶端密鑰 |
| `PUBLIC_ORIGIN` | 文字 | `https://ZhuShen-Sim.yuci8660.uk` |

## 本機預覽（不需要 Cloudflare 與 Google）

```bash
npm run dev:cloud
```

打開 http://localhost:5174 ，登入會直接以「開發者」身分登入；要測多個玩家，登入網址後面加 `?as=名字`（例如 `/api/auth/google/login?as=乙玩家`）。資料只存在記憶體，關掉就消失。需要 Node 22 以上。這個預覽用的是假的 Google 與假的資料庫，真正的 Google 登入只能部署後實測。

## 後端 API 一覽（給前端用）

| 網址 | 用途 |
|---|---|
| `GET /api/auth/google/login` | 開始登入（瀏覽器直接導過去） |
| `GET /api/me` | 目前登入的人（沒登入回 `user: null`） |
| `POST /api/logout` | 登出 |
| `GET /api/save`、`GET /api/save?meta=1` | 讀雲端存檔／只讀版本號 |
| `PUT /api/save` | 寫存檔，`{data, baseUpdatedAt, force?}`；版本對不上回 409 |
| `PUT /api/score` | 更新成績，`{level, roster, clears, power, powerName, life, lifeName}`，每項只增不減，30 秒內不能重送。`power`／`powerName` = 歷來最強輪迴者的戰力與名字；`life`／`lifeName` = 歷來最長壽輪迴者的存活天數與名字 |
| `PUT /api/settings` | `{hidden: true}` = 不上排行榜 |
| `GET /api/leaderboard?board=level\|clears\|power\|life` | 四個榜單（空間等級、副本通關分〔每個通關過的副本 1 分＋打過的最高侵蝕星級；`clears` 欄位存這個分數，上限 1000〕、最強輪迴者、最長壽輪迴者；總積分榜已取消）：前 20 名＋自己的名次＋相對昨天的升降 |

## 已知限制

- 成績是玩家瀏覽器送上來的，第一版只做合理範圍檢查（分數上限、等級 1～5、頻率限制），**擋不住有心人改數字**。真的有人刷榜再加更嚴的驗證。
- Workers 免費方案每天 10 萬次請求（需驗證，[官方定價頁](https://developers.cloudflare.com/workers/platform/pricing/)），玩家變多時要留意。
