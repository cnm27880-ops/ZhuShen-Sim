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

1. Cloudflare 後台 → 左側「儲存空間與資料庫」→ D1 SQL 資料庫 →「建立資料庫」（需驗證）。
2. 名稱填 `zhushen-sim`，建立。
3. 進入這個資料庫 →「主控台 (Console)」分頁，把 `worker/schema.sql` 的內容**整份貼進去**執行。成功後左邊會看到 5 張表：`users`、`sessions`、`saves`、`scores`、`rank_snap`。
4. 記下「資料庫 ID (database_id)」，之後要填進 `wrangler.jsonc`。

## 三、Cloudflare：讓網站載入後端（需要先確認你的專案類型）

你的專案在 Cloudflare 是 Workers（從部署通知的網址判斷，需驗證）。要加後端，repo 裡需要一個 `wrangler.jsonc` 設定檔，內容大致是（**先不要自己加**，等確認部署指令後我再放進 repo）：

```jsonc
{
  "name": "zhushen-sim",
  "main": "worker/index.js",
  "compatibility_date": "（填部署當天的日期）",
  "assets": { "directory": ".", "binding": "ASSETS", "run_worker_first": ["/api/*"] },
  "d1_databases": [{ "binding": "DB", "database_name": "zhushen-sim", "database_id": "（步驟二第 4 點）" }]
}
```

請到 Cloudflare 後台你的 `zhushen-sim` 專案 → **設定 (Settings) → 建置 (Build)**，把「建置指令」「部署指令」「根目錄」三個欄位的內容回報給我。

## 四、Cloudflare：填變數與密鑰

專案 → 設定 → 變數和密鑰：

| 名稱 | 類型 | 內容 |
|---|---|---|
| `GOOGLE_CLIENT_ID` | 文字 | 步驟一第 9 點的用戶端 ID |
| `GOOGLE_CLIENT_SECRET` | **密鑰 (Secret)** | 步驟一第 9 點的用戶端密鑰 |
| `PUBLIC_ORIGIN` | 文字 | `https://ZhuShen-Sim.yuci8660.uk` |

## 後端 API 一覽（給前端用）

| 網址 | 用途 |
|---|---|
| `GET /api/auth/google/login` | 開始登入（瀏覽器直接導過去） |
| `GET /api/me` | 目前登入的人（沒登入回 `user: null`） |
| `POST /api/logout` | 登出 |
| `GET /api/save`、`GET /api/save?meta=1` | 讀雲端存檔／只讀版本號 |
| `PUT /api/save` | 寫存檔，`{data, baseUpdatedAt, force?}`；版本對不上回 409 |
| `PUT /api/score` | 更新成績，`{score, level, roster, clears}`，只增不減，30 秒內不能重送 |
| `PUT /api/settings` | `{hidden: true}` = 不上排行榜 |
| `GET /api/leaderboard?board=score\|level\|clears` | 前 20 名＋自己的名次＋相對昨天的升降 |

## 已知限制

- 成績是玩家瀏覽器送上來的，第一版只做合理範圍檢查（分數上限、等級 1～5、頻率限制），**擋不住有心人改數字**。真的有人刷榜再加更嚴的驗證。
- Workers 免費方案每天 10 萬次請求（需驗證，[官方定價頁](https://developers.cloudflare.com/workers/platform/pricing/)），玩家變多時要留意。
