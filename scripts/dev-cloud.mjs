// 本機「假雲端」預覽伺服器：靜態網站 + 真正的 worker/app.js 後端 + 假的 D1 + 假的 Google。
// 用來在自己電腦上試登入、雲端存檔、排行榜，不需要 Cloudflare 也不需要 Google 憑證。
// 資料只存在記憶體，關掉就消失。**只給開發預覽用，不會被部署。**
//
// 用法：npm run dev:cloud  →  打開 http://localhost:5174
//   登入時會直接以「開發者」身分登入；網址加 ?as=名字（在登入網址上，例如 /api/auth/google/login?as=小明）可以換身分，方便測試多個玩家。
// 需要 Node 22 以上（用內建的 node:sqlite）。

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../worker/app.js";
import { b64url } from "../worker/util.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.env.PORT) || 5174;
const ORIGIN = `http://localhost:${PORT}`;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };

// 假 D1（跟 test/cloud.test.js 同一套做法）
const db = new DatabaseSync(":memory:");
db.exec(readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8"));
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  first: async () => db.prepare(sql).get(...args) ?? null,
  all: async () => ({ results: db.prepare(sql).all(...args) }),
  run: async () => ({ meta: { changes: db.prepare(sql).run(...args).changes } }),
});
const env = { DB: { prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); } }, GOOGLE_CLIENT_ID: "dev-client", GOOGLE_CLIENT_SECRET: "dev-secret", PUBLIC_ORIGIN: ORIGIN };

// 假 Google：登入網址帶的 as=名字 與 nonce 暫存起來，token 端點回傳對應的 id_token
let pending = { name: "開發者", nonce: "" };
const fakeFetch = async () =>
  new Response(JSON.stringify({ id_token: `x.${b64url(new TextEncoder().encode(JSON.stringify({ iss: "https://accounts.google.com", aud: "dev-client", exp: Date.now() / 1000 + 3600, nonce: pending.nonce, sub: `dev-${pending.name}`, name: pending.name })))}.y` }), { status: 200 });
const app = createApp({ fetch: fakeFetch });

createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  if (url.pathname.startsWith("/api/")) {
    const body = ["GET", "HEAD"].includes(req.method) ? undefined : await new Promise((ok) => { let t = ""; req.on("data", (c) => (t += c)); req.on("end", () => ok(t)); });
    const r = await app(new Request(url, { method: req.method, headers: req.headers, body }), env);
    if (url.pathname === "/api/auth/google/login") {
      const to = new URL(r.headers.get("location"));
      pending = { name: url.searchParams.get("as") ?? "開發者", nonce: to.searchParams.get("nonce") };
      r.headers.set("location", `/api/auth/google/callback?code=dev&state=${to.searchParams.get("state")}`); // 跳過 Google，直接回來
    }
    const headers = {};
    r.headers.forEach((v, k) => (headers[k] = v));
    const cookies = r.headers.getSetCookie();
    if (cookies.length) headers["set-cookie"] = cookies;
    res.writeHead(r.status, headers).end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  const file = normalize(join(ROOT, decodeURIComponent(url.pathname) === "/" ? "index.html" : decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) return res.writeHead(403).end("Forbidden");
  try {
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" }).end(await readFile(file));
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(PORT, () => console.log(`假雲端預覽：${ORIGIN}（登入會直接成為「開發者」，資料只存在記憶體）`));
