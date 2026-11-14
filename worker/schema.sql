-- 主神空間打工日記：雲端存檔＋排行榜（Cloudflare D1）
-- 執行方式見 docs/CLOUD_SETUP.md。這個檔案可以重複執行（IF NOT EXISTS）。

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,            -- Google 帳號的 sub（不是 email，只是一串固定的數字 ID）
  name TEXT NOT NULL,
  picture TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,   -- 1 = 不上排行榜
  created_at INTEGER NOT NULL
);

-- 登入狀態放在伺服器端：cookie 只存隨機字串，資料庫只存它的雜湊，要登出／封鎖都能直接刪列
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS saves (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scores (
  user_id TEXT PRIMARY KEY,
  score INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  roster INTEGER NOT NULL DEFAULT 0,
  clears INTEGER NOT NULL DEFAULT 0,
  best_power INTEGER NOT NULL DEFAULT 0,        -- 最強輪迴者：歷來最高的有效戰力
  best_power_name TEXT NOT NULL DEFAULT '',
  longest_life INTEGER NOT NULL DEFAULT 0,      -- 最長壽輪迴者：歷來最長的存活天數（還活著的算到今天）
  longest_life_name TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scores_score ON scores(score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_level ON scores(level DESC);
CREATE INDEX IF NOT EXISTS idx_scores_clears ON scores(clears DESC);
CREATE INDEX IF NOT EXISTS idx_scores_power ON scores(best_power DESC);
CREATE INDEX IF NOT EXISTS idx_scores_life ON scores(longest_life DESC);

-- 每日排名快照：算「比昨天上升／下降幾名」用
CREATE TABLE IF NOT EXISTS rank_snap (
  day TEXT NOT NULL,
  board TEXT NOT NULL,
  user_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  PRIMARY KEY (day, board, user_id)
);
