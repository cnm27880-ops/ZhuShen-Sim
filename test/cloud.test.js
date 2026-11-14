// 雲端後端測試：用 node:sqlite 假裝成 D1，跑真正的 SQL；Google 用假的 fetch 取代。
// 舊版 Node 沒有 node:sqlite 時整組跳過（不影響其他測試）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createApp } from "../worker/app.js";
import { checkIdToken } from "../worker/auth.js";
import { cleanScore } from "../worker/board.js";
import { b64url } from "../worker/util.js";

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {}
const skip = DatabaseSync ? false : "此 Node 版本沒有 node:sqlite";

const ORIGIN = "https://game.test";
const CLIENT_ID = "client-123";

/** 最小的 D1 替身：prepare().bind().first()/all()/run()、batch() */
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8"));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: db.prepare(sql).run(...args).changes } }),
  });
  return { prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); } };
}

const idToken = (claims) => `x.${b64url(new TextEncoder().encode(JSON.stringify(claims)))}.y`;

/** 一個假世界：假 Google（回傳指定使用者）＋可調的時鐘 */
function world() {
  let t = 1_700_000_000_000;
  let googleUser = { sub: "u1", name: "小明", picture: "https://img.test/a.png" };
  const env = { DB: fakeD1(), GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: "secret", PUBLIC_ORIGIN: ORIGIN };
  const fakeFetch = async (url, init) => {
    assert.equal(url, "https://oauth2.googleapis.com/token");
    const nonce = world.nonce;
    return new Response(JSON.stringify({ id_token: idToken({ iss: "https://accounts.google.com", aud: CLIENT_ID, exp: t / 1000 + 3600, nonce, ...googleUser }) }), { status: 200 });
  };
  const app = createApp({ fetch: fakeFetch, now: () => t });
  const call = (method, path, { body, cookie, origin = ORIGIN } = {}) =>
    app(new Request(ORIGIN + path, { method, headers: { ...(cookie ? { cookie } : {}), ...(method !== "GET" ? { origin } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  /** 走完整個登入流程，回傳 session cookie */
  async function login(user = googleUser) {
    googleUser = user;
    const r1 = await call("GET", "/api/auth/google/login");
    const oauth = r1.headers.get("set-cookie").match(/__Host-oauth=([^;]+)/)[1];
    const [state, nonce] = oauth.split(".");
    world.nonce = nonce;
    const r2 = await call("GET", `/api/auth/google/callback?code=abc&state=${state}`, { cookie: `__Host-oauth=${oauth}` });
    assert.equal(r2.headers.get("location"), "/?login=ok");
    return r2.headers.getSetCookie().find((c) => c.startsWith("__Host-session=")).split(";")[0];
  }
  return { env, call, login, tick: (ms) => (t += ms), now: () => t };
}

test("登入：導向 Google 時帶 state／nonce，只要 openid profile", { skip }, async () => {
  const w = world();
  const r = await w.call("GET", "/api/auth/google/login");
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get("location"));
  assert.equal(loc.origin + loc.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(loc.searchParams.get("scope"), "openid profile");
  assert.equal(loc.searchParams.get("redirect_uri"), `${ORIGIN}/api/auth/google/callback`);
  assert.ok(loc.searchParams.get("state") && loc.searchParams.get("nonce"));
  assert.match(r.headers.get("set-cookie"), /__Host-oauth=.*Secure.*HttpOnly/s);
});

test("登入：state 對不上、沒帶 cookie 都失敗；成功後 /api/me 看得到人，登出後看不到", { skip }, async () => {
  const w = world();
  const r = await w.call("GET", "/api/auth/google/callback?code=abc&state=wrong", { cookie: "__Host-oauth=s.n" });
  assert.equal(r.headers.get("location"), "/?login=failed");
  assert.equal((await w.call("GET", "/api/auth/google/callback?code=abc&state=s")).headers.get("location"), "/?login=failed");
  const cookie = await w.login();
  assert.equal((await (await w.call("GET", "/api/me", { cookie })).json()).user.name, "小明");
  assert.equal((await (await w.call("GET", "/api/me")).json()).user, null);
  await w.call("POST", "/api/logout", { cookie });
  assert.equal((await (await w.call("GET", "/api/me", { cookie })).json()).user, null);
});

test("session 過期後失效；資料庫只存雜湊不存 cookie 原文", { skip }, async () => {
  const w = world();
  const cookie = await w.login();
  const token = cookie.split("=")[1];
  const rows = await w.env.DB.prepare("SELECT token_hash FROM sessions").all();
  assert.equal(rows.results.length, 1);
  assert.notEqual(rows.results[0].token_hash, token);
  w.tick(31 * 86400000);
  assert.equal((await (await w.call("GET", "/api/me", { cookie })).json()).user, null);
});

test("id_token 檢查：iss／aud／exp／nonce 任一不對都拒絕", () => {
  const ok = { iss: "https://accounts.google.com", aud: CLIENT_ID, exp: 2000, nonce: "n", sub: "1", name: "A" };
  const chk = (c) => checkIdToken(idToken(c), { clientId: CLIENT_ID, nonce: "n", nowMs: 1_000_000 });
  assert.equal(chk(ok).id, "1");
  assert.equal(chk({ ...ok, iss: "https://evil.test" }), null);
  assert.equal(chk({ ...ok, aud: "other" }), null);
  assert.equal(chk({ ...ok, exp: 999 }), null);
  assert.equal(chk({ ...ok, nonce: "x" }), null);
  assert.equal(chk({ ...ok, picture: "http://insecure/x.png" }).picture, null);
  assert.equal(checkIdToken("garbage", { clientId: CLIENT_ID, nonce: "n", nowMs: 0 }), null);
});

test("寫入請求：沒登入 401、來源不對 403", { skip }, async () => {
  const w = world();
  assert.equal((await w.call("PUT", "/api/save", { body: { data: "{}" } })).status, 401);
  const cookie = await w.login();
  assert.equal((await w.call("PUT", "/api/save", { cookie, origin: "https://evil.test", body: { data: "{}" } })).status, 403);
});

test("雲端存檔：第一次上傳、衝突不覆蓋、確認版本後可更新、force 可強蓋", { skip }, async () => {
  const w = world();
  const cookie = await w.login();
  assert.deepEqual(await (await w.call("GET", "/api/save", { cookie })).json(), { save: null });
  const first = await (await w.call("PUT", "/api/save", { cookie, body: { data: '{"a":1}', baseUpdatedAt: null } })).json();
  assert.ok(first.ok);
  // 沒帶最新版本號 = 另一台裝置想直接蓋 → 衝突
  w.tick(1000);
  const conflict = await w.call("PUT", "/api/save", { cookie, body: { data: '{"a":2}', baseUpdatedAt: null } });
  assert.equal(conflict.status, 409);
  assert.equal((await (await w.call("GET", "/api/save", { cookie })).json()).save.data, '{"a":1}');
  // 帶著最新版本號 → 可以更新
  const upd = await (await w.call("PUT", "/api/save", { cookie, body: { data: '{"a":3}', baseUpdatedAt: first.updatedAt } })).json();
  assert.ok(upd.ok && upd.updatedAt > first.updatedAt);
  // 玩家確認「用本機蓋掉雲端」
  assert.equal((await w.call("PUT", "/api/save", { cookie, body: { data: '{"a":4}', baseUpdatedAt: null, force: true } })).status, 200);
  assert.equal((await (await w.call("GET", "/api/save?meta=1", { cookie })).json()).save.data, undefined);
});

test("雲端存檔：太大、不是 JSON 都拒絕；每人只能碰自己的", { skip }, async () => {
  const w = world();
  const a = await w.login({ sub: "ua", name: "A", picture: null });
  const b = await w.login({ sub: "ub", name: "B", picture: null });
  assert.equal((await w.call("PUT", "/api/save", { cookie: a, body: { data: "not json" } })).status, 400);
  assert.equal((await w.call("PUT", "/api/save", { cookie: a, body: { data: JSON.stringify({ x: "y".repeat(1_000_000) }) } })).status, 413);
  await w.call("PUT", "/api/save", { cookie: a, body: { data: '{"who":"A"}' } });
  assert.deepEqual(await (await w.call("GET", "/api/save", { cookie: b })).json(), { save: null });
});

test("成績檢查：不合理的數字拒絕", () => {
  const ok = { score: 100, level: 2, roster: 5, clears: 3 };
  assert.deepEqual(cleanScore(ok), ok);
  for (const bad of [{ ...ok, score: -1 }, { ...ok, level: 6 }, { ...ok, level: 0 }, { ...ok, roster: 1.5 }, { ...ok, clears: 999 }, { ...ok, score: "9" }, null]) assert.equal(cleanScore(bad), null);
});

test("排行榜：只增不減、太頻繁拒絕、名次與自己的名次、隱藏、不重複", { skip }, async () => {
  const w = world();
  const users = [["u1", "甲", 500], ["u2", "乙", 900], ["u3", "丙", 900], ["u4", "丁", 100]];
  const cookies = {};
  for (const [sub, name, score] of users) {
    cookies[sub] = await w.login({ sub, name, picture: null });
    assert.equal((await w.call("PUT", "/api/score", { cookie: cookies[sub], body: { score, level: 1, roster: 3, clears: 1 } })).status, 200);
  }
  // 更新太頻繁
  assert.equal((await w.call("PUT", "/api/score", { cookie: cookies.u1, body: { score: 1, level: 1, roster: 1, clears: 0 } })).status, 429);
  w.tick(31_000);
  // 分數變低不會蓋掉最佳紀錄
  await w.call("PUT", "/api/score", { cookie: cookies.u1, body: { score: 50, level: 1, roster: 3, clears: 1 } });
  const board = await (await w.call("GET", "/api/leaderboard?board=score", { cookie: cookies.u1 })).json();
  assert.deepEqual(board.entries.map((e) => [e.name, e.rank]), [["丙", 1], ["乙", 1], ["甲", 3], ["丁", 4]]); // 同分同名次
  assert.equal(board.me.rank, 3);
  assert.equal(board.me.score, 500);
  // 不上排行榜：榜上看不到，自己也沒有名次
  await w.call("PUT", "/api/settings", { cookie: cookies.u2, body: { hidden: true } });
  const after = await (await w.call("GET", "/api/leaderboard?board=score", { cookie: cookies.u2 })).json();
  assert.ok(!after.entries.some((e) => e.name === "乙"));
  assert.equal(after.me, null);
  assert.equal((await (await w.call("GET", "/api/leaderboard?board=score", { cookie: cookies.u1 })).json()).me.rank, 2);
  // 未登入也能看榜；亂給榜單名稱回 400
  assert.equal((await w.call("GET", "/api/leaderboard?board=score")).status, 200);
  assert.equal((await w.call("GET", "/api/leaderboard?board=evil")).status, 400);
  assert.equal((await w.call("GET", "/api/leaderboard?board=level;DROP")).status, 400);
});

test("排行榜：隔天看得到名次上升／下降", { skip }, async () => {
  const w = world();
  const a = await w.login({ sub: "a", name: "A", picture: null });
  const b = await w.login({ sub: "b", name: "B", picture: null });
  await w.call("PUT", "/api/score", { cookie: a, body: { score: 200, level: 1, roster: 1, clears: 0 } });
  await w.call("PUT", "/api/score", { cookie: b, body: { score: 100, level: 1, roster: 1, clears: 0 } });
  const day1 = await (await w.call("GET", "/api/leaderboard?board=score", { cookie: b })).json();
  assert.equal(day1.entries[0].change, null); // 第一天沒有昨天可比
  w.tick(86400000 + 60_000);
  await w.call("PUT", "/api/score", { cookie: b, body: { score: 300, level: 1, roster: 1, clears: 0 } });
  const day2 = await (await w.call("GET", "/api/leaderboard?board=score", { cookie: b })).json();
  assert.deepEqual(day2.entries.map((e) => [e.name, e.rank, e.change]), [["B", 1, 1], ["A", 2, -1]]);
  assert.equal(day2.me.change, 1);
});
