// 後端路由。所有網址都在 /api/ 底下；其他網址由 Cloudflare 直接給靜態檔（見 wrangler 設定的 run_worker_first）。
// createApp 把 fetch／時間做成可注入，測試才不用真的連 Google。

import { json } from "./util.js";
import { LIMITS } from "./limits.js";
import { loginRedirect, loginCallback, currentUser, logout, originOf } from "./auth.js";
import { cleanScore, submitScore, leaderboard } from "./board.js";

const bad = (error, status = 400) => json({ error }, status);

async function readJson(request) {
  const text = await request.text();
  if (text.length > LIMITS.maxBodyBytes) return { tooBig: true };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { body: null };
  }
}

export function createApp({ fetch: doFetch = (...a) => globalThis.fetch(...a), now = Date.now } = {}) {
  return async function handle(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (path === "/api/auth/google/login" && method === "GET") return loginRedirect(request, env);
    if (path === "/api/auth/google/callback" && method === "GET") return loginCallback(request, env, { doFetch, now });

    // 寫入類請求必須來自自己的網站（擋跨站偽造請求）
    if (method !== "GET" && request.headers.get("origin") !== originOf(request, env)) return bad("bad_origin", 403);

    if (path === "/api/leaderboard" && method === "GET") {
      const me = await currentUser(request, env, now);
      const data = await leaderboard(env, url.searchParams.get("board") ?? "score", me?.id ?? null, now());
      return data ? json(data) : bad("bad_board");
    }

    const user = await currentUser(request, env, now);
    if (path === "/api/me" && method === "GET") return json({ user: user ? { name: user.name, picture: user.picture, hidden: Boolean(user.hidden) } : null });
    if (!user) return bad("unauthorized", 401);

    if (path === "/api/logout" && method === "POST") return logout(request, env);

    if (path === "/api/settings" && method === "PUT") {
      const { body } = await readJson(request);
      if (typeof body?.hidden !== "boolean") return bad("bad_request");
      await env.DB.prepare("UPDATE users SET hidden = ? WHERE id = ?").bind(body.hidden ? 1 : 0, user.id).run();
      return json({ ok: true });
    }

    if (path === "/api/save" && method === "GET") {
      const row = await env.DB.prepare("SELECT data, updated_at FROM saves WHERE user_id = ?").bind(user.id).first();
      if (!row) return json({ save: null });
      return json({ save: { updatedAt: row.updated_at, ...(url.searchParams.get("meta") ? {} : { data: row.data }) } });
    }

    if (path === "/api/save" && method === "PUT") {
      const { body, tooBig } = await readJson(request);
      if (tooBig) return bad("too_big", 413);
      if (typeof body?.data !== "string" || new TextEncoder().encode(body.data).length > LIMITS.maxSaveBytes) return bad("bad_save", 413);
      try {
        if (typeof JSON.parse(body.data) !== "object") throw new Error();
      } catch {
        return bad("bad_save");
      }
      const row = await env.DB.prepare("SELECT updated_at FROM saves WHERE user_id = ?").bind(user.id).first();
      // 雲端已有存檔，而且玩家沒說「蓋掉」、也不是在最新版本上繼續玩 → 回報衝突，由玩家決定（不直接覆蓋）
      if (row && body.force !== true && body.baseUpdatedAt !== row.updated_at) return json({ error: "conflict", serverUpdatedAt: row.updated_at }, 409);
      const t = now();
      await env.DB.prepare("INSERT INTO saves (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").bind(user.id, body.data, t).run();
      return json({ ok: true, updatedAt: t });
    }

    if (path === "/api/score" && method === "PUT") {
      const { body } = await readJson(request);
      const s = cleanScore(body);
      if (!s) return bad("bad_score");
      return (await submitScore(env, user.id, s, now())) ? json({ ok: true }) : bad("too_frequent", 429);
    }

    return bad("not_found", 404);
  };
}
