// 後端共用小工具：亂數、雜湊、cookie、JSON 回應。只用 Web 標準 API（Workers 與 Node 都有）。

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

export const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function fromB64url(str) {
  const pad = "=".repeat((4 - (str.length % 4)) % 4);
  const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function parseCookies(header) {
  const out = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** __Host- 前綴的 cookie：瀏覽器強制要求 Secure、Path=/、不能指定 Domain，別的子網域寫不進來 */
export function setCookie(name, value, { maxAge, httpOnly = true } = {}) {
  return `${name}=${value}; Path=/; Secure; SameSite=Lax${httpOnly ? "; HttpOnly" : ""}${maxAge !== undefined ? `; Max-Age=${maxAge}` : ""}`;
}
