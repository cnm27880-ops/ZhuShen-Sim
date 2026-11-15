// 雲端功能的前端：打後端 API、記住同步進度、背景同步存檔與排行榜成績。
// 後端沒部署（本機預覽、還沒設定 Cloudflare）時一律安靜失敗，遊戲照常用 localStorage 玩。

import { CLOUD } from "../data/config.js";

const META_KEY = "zhushen-cloud-meta"; // { uid, base }：上次跟雲端同步時，雲端存檔的版本號
const GUEST_KEY = "zhushen-guest"; // 玩家選過「訪客模式」就不再每次跳封面

const read = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key, value) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* 瀏覽器不給用 localStorage 就算了 */
  }
};

export const getMeta = () => {
  try {
    return JSON.parse(read(META_KEY) ?? "null");
  } catch {
    return null;
  }
};
export const setMeta = (uid, base) => write(META_KEY, JSON.stringify({ uid, base }));
export const clearMeta = () => write(META_KEY, null);
export const isGuest = () => read(GUEST_KEY) === "1";
export const setGuest = (on) => write(GUEST_KEY, on ? "1" : null);

/** 打後端：永遠不丟例外。回傳 { ok, status, data }，網路不通 status = 0 */
async function api(path, { method = "GET", body, timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* 不是 JSON（例如靜態伺服器回的 404 頁面）= 這裡沒有後端 */
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

export const LOGIN_URL = "/api/auth/google/login";

/** 問後端「我是誰」。available = 這個網站有雲端後端；loginReady = Google 憑證已設定好；user = 目前登入的人（沒登入是 null） */
export async function loadMe() {
  const r = await api("/api/me", { timeoutMs: CLOUD.meTimeoutMs });
  if (!r.ok || !r.data || !("user" in r.data)) return { available: false, loginReady: false, user: null };
  return { available: true, loginReady: r.data.loginReady !== false, user: r.data.user }; // loginReady：後台已填好 Google 憑證
}

export const fetchCloudSave = async (metaOnly = false) => {
  const r = await api(`/api/save${metaOnly ? "?meta=1" : ""}`);
  return r.ok ? { ok: true, save: r.data?.save ?? null } : { ok: false };
};
export const pushSave = (data, baseUpdatedAt, force = false) => api("/api/save", { method: "PUT", body: { data, baseUpdatedAt, force } });
export const pushScore = (payload) => api("/api/score", { method: "PUT", body: payload });
export const setHidden = (hidden) => api("/api/settings", { method: "PUT", body: { hidden } });
export const logout = () => api("/api/logout", { method: "POST", body: {} });
export const fetchBoard = async (board) => {
  const r = await api(`/api/leaderboard?board=${encodeURIComponent(board)}`);
  return r.ok ? { ok: true, ...r.data } : { ok: false };
};

/**
 * 背景同步器：存檔後排程上傳，最快每 CLOUD.saveIntervalMs 一次。
 * 遇到版本衝突（409）就停止自動上傳，呼叫 onConflict 讓玩家決定。
 */
export function createSyncer({ getUser, getScorePayload, onConflict }) {
  const syncer = {
    status: "idle", // idle 尚未同步／syncing／ok／error／conflict／off 沒登入
    lastOkAt: null,
    blocked: false, // 衝突未解決：不自動上傳
    _json: null,
    _timer: null,
    _lastPushAt: 0,
    _lastScoreAt: 0,
    _listeners: new Set(),
    onChange(fn) {
      this._listeners.add(fn);
    },
    _set(status) {
      this.status = status;
      for (const fn of this._listeners) fn(status);
    },
    /** 每次本機存檔後呼叫 */
    notifySaved(json) {
      this._json = json;
      if (!getUser() || this.blocked || this._timer) return;
      const wait = Math.max(0, this._lastPushAt + CLOUD.saveIntervalMs - Date.now());
      this._timer = setTimeout(() => {
        this._timer = null;
        this.pushNow();
      }, wait);
    },
    /** 立刻上傳（設定裡的「立即同步」、剛選好「用本機覆蓋雲端」）。force = 玩家已確認要蓋掉雲端 */
    async pushNow({ force = false } = {}) {
      clearTimeout(this._timer);
      this._timer = null;
      const user = getUser();
      if (!user || !this._json || (this.blocked && !force)) return false;
      this._set("syncing");
      this._lastPushAt = Date.now();
      const r = await pushSave(this._json, getMeta()?.uid === user.id ? getMeta().base : null, force);
      if (r.ok) {
        setMeta(user.id, r.data.updatedAt);
        this.blocked = false;
        this.lastOkAt = Date.now();
        this._set("ok");
        if (Date.now() - this._lastScoreAt >= CLOUD.scoreIntervalMs) {
          this._lastScoreAt = Date.now();
          pushScore(getScorePayload());
        }
        return true;
      }
      if (r.status === 409) {
        this.blocked = true;
        this._set("conflict");
        onConflict();
      } else {
        this._set("error");
      }
      return false;
    },
  };
  return syncer;
}
