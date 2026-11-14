// Google 登入（OpenID Connect 伺服器端流程）：導去 Google → 帶著 code 回來 → 後端用密鑰換 id_token → 建立 session。
// 密鑰 GOOGLE_CLIENT_SECRET 只放在 Cloudflare 後台，不進 git。

import { json, randomToken, sha256Hex, parseCookies, setCookie, fromB64url } from "./util.js";

export const COOKIE_SESSION = "__Host-session";
export const COOKIE_OAUTH = "__Host-oauth";
export const SESSION_DAYS = 30;
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";

export const originOf = (request, env) => env.PUBLIC_ORIGIN ?? new URL(request.url).origin;

export function loginRedirect(request, env) {
  const state = randomToken(16);
  const nonce = randomToken(16);
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${originOf(request, env)}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid profile", // 只要名字與頭像，不要 email
    state,
    nonce,
    prompt: "select_account",
  });
  return new Response(null, {
    status: 302,
    headers: { location: `${GOOGLE_AUTH}?${params}`, "set-cookie": setCookie(COOKIE_OAUTH, `${state}.${nonce}`, { maxAge: 600 }), "cache-control": "no-store" },
  });
}

const back = (to, ...cookies) => {
  const h = new Headers({ location: to, "cache-control": "no-store" });
  for (const c of cookies) h.append("set-cookie", c);
  return new Response(null, { status: 302, headers: h });
};

/** 檢查 id_token 的內容（Google 文件：直接從 token 端點收到的 token 可信，但仍要驗 iss／aud／exp／nonce） */
export function checkIdToken(idToken, { clientId, nonce, nowMs }) {
  const parts = String(idToken).split(".");
  if (parts.length !== 3) return null;
  let c;
  try {
    c = JSON.parse(fromB64url(parts[1]));
  } catch {
    return null;
  }
  if (c.iss !== "https://accounts.google.com" && c.iss !== "accounts.google.com") return null;
  if (c.aud !== clientId) return null;
  if (!(c.exp * 1000 > nowMs)) return null;
  if (c.nonce !== nonce) return null;
  if (!c.sub) return null;
  return { id: String(c.sub), name: String(c.name ?? "無名輪迴者").slice(0, 40), picture: typeof c.picture === "string" && c.picture.startsWith("https://") ? c.picture.slice(0, 300) : null };
}

export async function loginCallback(request, env, { doFetch, now }) {
  const url = new URL(request.url);
  const cookies = parseCookies(request.headers.get("cookie"));
  const clearOauth = setCookie(COOKIE_OAUTH, "", { maxAge: 0 });
  if (url.searchParams.get("error")) return back("/?login=cancelled", clearOauth);
  const [state, nonce] = (cookies[COOKIE_OAUTH] ?? "").split(".");
  const code = url.searchParams.get("code");
  if (!state || !nonce || !code || url.searchParams.get("state") !== state) return back("/?login=failed", clearOauth);

  const res = await doFetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${originOf(request, env)}/api/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) return back("/?login=failed", clearOauth);
  const profile = checkIdToken((await res.json()).id_token, { clientId: env.GOOGLE_CLIENT_ID, nonce, nowMs: now() });
  if (!profile) return back("/?login=failed", clearOauth);

  const t = now();
  const token = randomToken(32);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(t),
    env.DB.prepare("INSERT INTO users (id, name, picture, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, picture = excluded.picture").bind(profile.id, profile.name, profile.picture, t),
    env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await sha256Hex(token), profile.id, t + SESSION_DAYS * 86400000),
  ]);
  return back("/?login=ok", clearOauth, setCookie(COOKIE_SESSION, token, { maxAge: SESSION_DAYS * 86400 }));
}

/** 讀 cookie → 查資料庫 → 回傳登入的人（沒登入或過期回 null） */
export async function currentUser(request, env, now) {
  const token = parseCookies(request.headers.get("cookie"))[COOKIE_SESSION];
  if (!token) return null;
  return env.DB.prepare(
    "SELECT u.id, u.name, u.picture, u.hidden FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?"
  ).bind(await sha256Hex(token), now()).first();
}

export async function logout(request, env) {
  const token = parseCookies(request.headers.get("cookie"))[COOKIE_SESSION];
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  return json({ ok: true }, 200, { "set-cookie": setCookie(COOKIE_SESSION, "", { maxAge: 0 }) });
}
