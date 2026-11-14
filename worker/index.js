// Cloudflare Worker 進入點：只處理 /api/*，其餘交給靜態檔。
import { createApp } from "./app.js";

const app = createApp();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await app(request, env);
      } catch (err) {
        console.error(err);
        return new Response(JSON.stringify({ error: "server_error" }), { status: 500, headers: { "content-type": "application/json" } });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
