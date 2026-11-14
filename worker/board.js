// 排行榜：更新自己的成績（只增不減）、前 20 名、自己的名次、相對昨天的名次變化。

import { LIMITS, BOARDS } from "./limits.js";

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
/** 輪迴者名字來自玩家的瀏覽器：只留可見字元、限制長度（畫面端仍必須用 textContent 顯示，不能當 HTML） */
const cleanName = (v) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, LIMITS.nameMax) : null);

/** 成績的基本合理性檢查。回傳整理過的物件，不合理回 null。 */
export function cleanScore(body) {
  const c = LIMITS.caps;
  if (!body || !isInt(body.score, 0, c.score) || !isInt(body.level, 1, c.level) || !isInt(body.roster, 0, c.roster) || !isInt(body.clears, 0, c.clears)) return null;
  if (!isInt(body.power, 0, c.power) || !isInt(body.life, 0, c.life)) return null;
  const powerName = cleanName(body.powerName);
  const lifeName = cleanName(body.lifeName);
  if (powerName === null || lifeName === null) return null;
  return { score: body.score, level: body.level, roster: body.roster, clears: body.clears, power: body.power, powerName, life: body.life, lifeName };
}

/** 只增不減：重開新局不會把最佳紀錄洗掉。回傳 false = 更新太頻繁。 */
export async function submitScore(env, userId, s, nowMs) {
  const row = await env.DB.prepare("SELECT updated_at FROM scores WHERE user_id = ?").bind(userId).first();
  if (row && nowMs - row.updated_at < LIMITS.scoreMinIntervalMs) return false;
  await env.DB.prepare(
    `INSERT INTO scores (user_id, score, level, roster, clears, best_power, best_power_name, longest_life, longest_life_name, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       score = MAX(score, excluded.score), level = MAX(level, excluded.level), roster = MAX(roster, excluded.roster), clears = MAX(clears, excluded.clears),
       best_power_name = CASE WHEN excluded.best_power > best_power THEN excluded.best_power_name ELSE best_power_name END,
       best_power = MAX(best_power, excluded.best_power),
       longest_life_name = CASE WHEN excluded.longest_life > longest_life THEN excluded.longest_life_name ELSE longest_life_name END,
       longest_life = MAX(longest_life, excluded.longest_life),
       updated_at = excluded.updated_at`
  ).bind(userId, s.score, s.level, s.roster, s.clears, s.power, s.powerName, s.life, s.lifeName, nowMs).run();
  return true;
}

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/** 每天第一次有人看榜時，把當下前 N 名拍成快照；隔天拿它跟當下名次比，就是上升／下降 */
async function ensureSnapshot(env, col, nowMs) {
  const day = dayOf(nowMs);
  const have = await env.DB.prepare("SELECT 1 AS x FROM rank_snap WHERE day = ? AND board = ? LIMIT 1").bind(day, col).first();
  if (have) return;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO rank_snap (day, board, user_id, rank)
     SELECT ?, ?, user_id, rnk FROM (
       SELECT s.user_id AS user_id, RANK() OVER (ORDER BY s.${col} DESC) AS rnk FROM scores s JOIN users u ON u.id = s.user_id WHERE u.hidden = 0
     ) WHERE rnk <= ?`
  ).bind(day, col, LIMITS.snapKeep).run();
}

export async function leaderboard(env, board, meId, nowMs) {
  const col = BOARDS[board];
  if (!col) return null;
  await ensureSnapshot(env, col, nowMs);
  const prevDay = (await env.DB.prepare("SELECT MAX(day) AS d FROM rank_snap WHERE board = ? AND day < ?").bind(col, dayOf(nowMs)).first())?.d ?? null;

  const rows = (await env.DB.prepare(
    `SELECT * FROM (
       SELECT u.id AS id, u.name AS name, u.picture AS picture, s.score AS score, s.level AS level, s.roster AS roster, s.clears AS clears,
              s.best_power AS power, s.best_power_name AS powerName, s.longest_life AS life, s.longest_life_name AS lifeName,
              RANK() OVER (ORDER BY s.${col} DESC) AS rank
       FROM scores s JOIN users u ON u.id = s.user_id WHERE u.hidden = 0
     ) ORDER BY rank ASC, name ASC LIMIT ?`
  ).bind(LIMITS.top).all()).results;

  const prevOf = async (id) => (prevDay ? (await env.DB.prepare("SELECT rank FROM rank_snap WHERE day = ? AND board = ? AND user_id = ?").bind(prevDay, col, id).first())?.rank ?? null : null);
  const entries = [];
  for (const r of rows) {
    const prev = await prevOf(r.id);
    entries.push({ rank: r.rank, name: r.name, picture: r.picture, score: r.score, level: r.level, roster: r.roster, clears: r.clears, power: r.power, powerName: r.powerName, life: r.life, lifeName: r.lifeName, me: r.id === meId, change: prev == null ? null : prev - r.rank });
  }

  let me = null;
  if (meId) {
    const mine = await env.DB.prepare("SELECT s.score AS score, s.level AS level, s.roster AS roster, s.clears AS clears, s.best_power AS power, s.best_power_name AS powerName, s.longest_life AS life, s.longest_life_name AS lifeName, s.best_power AS best_power, s.longest_life AS longest_life, u.hidden AS hidden FROM scores s JOIN users u ON u.id = s.user_id WHERE s.user_id = ?").bind(meId).first();
    if (mine && !mine.hidden) {
      const rank = (await env.DB.prepare(`SELECT COUNT(*) + 1 AS r FROM scores s JOIN users u ON u.id = s.user_id WHERE u.hidden = 0 AND s.${col} > ?`).bind(mine[col]).first()).r;
      const prev = await prevOf(meId);
      me = { rank, score: mine.score, level: mine.level, roster: mine.roster, clears: mine.clears, power: mine.power, powerName: mine.powerName, life: mine.life, lifeName: mine.lifeName, change: prev == null ? null : prev - rank };
    }
  }
  return { board, entries, me };
}
