// 詞條庫（懸浮球圖鑑，2026-11 試玩回饋第 9 項）：
//   · 一顆永遠在最上層的懸浮球，點開是可拖曳、可調整大小的視窗；關視窗後懸浮球還在
//   · 兩個分頁：人物詞條／關卡詞條；篩選只有「階級」與「好／壞／中性」，另有搜尋
//   · 小人檔案頁開著時（main.js 呼叫 setFocus），這個小人身上的詞條自動置頂；關掉檔案頁就取消置頂
//   · 效果只顯示一行「效果」：已做進引擎的詞條顯示引擎實際在算的效果，其餘顯示 codexTags.js 的 effect

import { esc } from "./html.js";
import { CODEX_ALL, CODEX_ENV_ALL, toneOf, TONE_LABEL, RARITIES } from "../data/tagCodex.js";
import { getTag, getEnvTag } from "../data/tags.js";

const POS_KEY = "zhushen-codex-win";
const pct = (v) => `${v >= 0 ? "+" : ""}${Math.round(v * 1000) / 10}%`;

export function createCodex({ getState, describeTag }) {
  const ui = { open: false, tab: "person", rarity: new Set(), tone: "all", q: "", focusId: null, tagId: null };
  let win = null;
  let orb = null;

  // ───────── 視窗外殼 ─────────

  function build() {
    orb = document.createElement("button");
    orb.id = "codex-orb";
    orb.type = "button";
    orb.title = "詞條庫（人物詞條／關卡詞條）";
    orb.setAttribute("aria-label", "詞條庫");
    orb.innerHTML = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 21.5A2.5 2.5 0 0 1 6.5 19H20"/></svg>`;
    orb.addEventListener("click", () => (ui.open ? close() : open()));
    document.body.appendChild(orb);

    win = document.createElement("div");
    win.id = "codex-win";
    win.style.display = "none";
    win.innerHTML = `<div class="cx-bar"><b>詞條庫</b><span class="cx-hint">可拖曳標題列移動、拉右下角調整大小</span><button type="button" class="cx-x" data-cx="close" aria-label="關閉詞條庫">×</button></div>
      <div class="cx-top"></div>
      <div class="cx-list"></div>`;
    document.body.appendChild(win);

    restoreRect();
    enableDrag();
    win.addEventListener("click", onClick);
    win.addEventListener("input", (e) => {
      if (e.target.matches("[data-cx-q]")) {
        ui.q = e.target.value.trim();
        renderList();
      }
    });
    if (typeof ResizeObserver === "function") new ResizeObserver(() => saveRect()).observe(win);
  }

  function restoreRect() {
    let r = null;
    try {
      r = JSON.parse(localStorage.getItem(POS_KEY) ?? "null");
    } catch {
      r = null;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(r?.w ?? 420, vw - 16);
    const h = Math.min(r?.h ?? 560, vh - 16);
    win.style.width = `${w}px`;
    win.style.height = `${h}px`;
    win.style.left = `${Math.max(0, Math.min(r?.x ?? vw - w - 16, vw - 60))}px`;
    win.style.top = `${Math.max(0, Math.min(r?.y ?? 70, vh - 60))}px`;
  }

  function saveRect() {
    if (!win || win.style.display === "none") return;
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ x: win.offsetLeft, y: win.offsetTop, w: win.offsetWidth, h: win.offsetHeight }));
    } catch {
      /* 瀏覽器不給存就算了 */
    }
  }

  function enableDrag() {
    const bar = win.querySelector(".cx-bar");
    let drag = null;
    bar.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      drag = { dx: e.clientX - win.offsetLeft, dy: e.clientY - win.offsetTop };
      bar.setPointerCapture(e.pointerId);
    });
    bar.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const x = Math.max(-win.offsetWidth + 80, Math.min(e.clientX - drag.dx, window.innerWidth - 80));
      const y = Math.max(0, Math.min(e.clientY - drag.dy, window.innerHeight - 40));
      win.style.left = `${x}px`;
      win.style.top = `${y}px`;
    });
    const end = () => {
      if (drag) saveRect();
      drag = null;
    };
    bar.addEventListener("pointerup", end);
    bar.addEventListener("pointercancel", end);
  }

  // ───────── 開關 ─────────

  function open(opts = {}) {
    if (!win) build();
    if (opts.tagId) ui.tagId = opts.tagId;
    ui.tab = "person";
    ui.open = true;
    win.style.display = "flex";
    render();
  }
  function close() {
    ui.open = false;
    if (win) win.style.display = "none";
  }

  /** 每次畫面更新時呼叫：遊戲還沒載入（封面）時藏起懸浮球 */
  function sync(visible) {
    if (!orb) build();
    orb.style.display = visible ? "" : "none";
    if (!visible && ui.open) close();
  }

  /** 小人檔案頁開著就傳他的 id，關掉傳 null：詞條庫開著時，這個小人的詞條自動置頂／取消置頂 */
  function setFocus(id) {
    const next = id ?? null;
    if (next === ui.focusId) return;
    ui.focusId = next;
    if (ui.open && ui.tab === "person") renderList();
  }

  // ───────── 內容 ─────────

  const isNeutral = (t) => toneOf(t) === "mixed" || toneOf(t) === "neutral"; // 「中性」= 有加有減或沒數值

  function matches(t) {
    if (ui.rarity.size && !ui.rarity.has(t.rarity)) return false;
    if (ui.tone === "good" && toneOf(t) !== "good") return false;
    if (ui.tone === "bad" && toneOf(t) !== "bad") return false;
    if (ui.tone === "neutral" && !isNeutral(t)) return false;
    if (ui.q && !`${t.name}${t.fullName ?? ""}${t.desc}${t.effect ?? ""}`.toLowerCase().includes(ui.q.toLowerCase())) return false;
    return true;
  }

  const chip = (label, attr, on) => `<button type="button" class="cx-chip ${on ? "on" : ""}" ${attr}>${label}</button>`;
  const toneLabel = (t) => (toneOf(t) === "good" ? "好" : toneOf(t) === "bad" ? "壞" : "中性");

  function renderTop() {
    const top = win.querySelector(".cx-top");
    const tabs = `<div class="cx-tabs">${chip("人物詞條", 'data-cx="tab" data-v="person"', ui.tab === "person")}${chip("關卡詞條", 'data-cx="tab" data-v="env"', ui.tab === "env")}</div>`;
    const search = `<input type="search" class="cx-q" data-cx-q placeholder="搜尋詞條名稱或說明" value="${esc(ui.q)}" />`;
    let filters = "";
    if (ui.tab === "person") {
      const rar = RARITIES.map((r) => chip(r, `data-cx="rar" data-v="${r}"`, ui.rarity.has(r))).join("");
      const tone = [["all", "全部"], ["good", "好"], ["bad", "壞"], ["neutral", "中性"]].map(([v, l]) => chip(l, `data-cx="tone" data-v="${v}"`, ui.tone === v)).join("");
      filters = `<div class="cx-row-f">${rar}</div><div class="cx-row-f">${tone}</div>`;
    }
    top.innerHTML = `${tabs}${search}${filters}`;
  }

  function personRow(t, pinned = false) {
    const tone = toneOf(t);
    const real = t.gameId ? getTag(t.gameId) : null; // 遊戲引擎裡真的在算的效果
    const effect = real ? describeTag(real).effects : t.effect;
    const ev = t.event ? `<details class="cx-cats"><summary>事件舉例</summary><div class="cx-fx">${esc(t.event)}</div></details>` : "";
    return `<div class="cx-item ${pinned ? "pinned" : ""} ${ui.tagId === t.id ? "hl" : ""}" data-tag="${t.id}">
      <div class="cx-head"><span class="tag-chip tag-${t.rarity}">${t.rarity}｜${esc(t.name)}</span><span class="cx-tone tone-${tone === "neutral" ? "mixed" : tone}">${toneLabel(t)}</span></div>
      <div class="cx-desc">${esc(t.desc)}</div>
      ${effect ? `<div class="cx-fx">效果：${esc(effect)}</div>` : ""}
      ${ev}
    </div>`;
  }

  function envRow(e) {
    const real = e.gameId ? getEnvTag(e.gameId) : null;
    const liveFx = real ? [real.passMod ? `全隊通過率 ${pct(real.passMod)}` : "", real.rewardMult && real.rewardMult !== 1 ? `通關積分 ×${real.rewardMult}` : ""].filter(Boolean).join("；") || "沒有直接數值（只影響特定詞條）" : "";
    const effect = real ? liveFx : e.effect;
    return `<div class="cx-item" data-env="${e.id}">
      <div class="cx-head"><b>${esc(e.name)}</b>${e.sub ? `<small>${esc(e.sub)}</small>` : ""}</div>
      <div class="cx-desc">${esc(e.desc)}</div>
      <div class="cx-fx">效果：${esc(effect)}</div>
      <div class="cx-fx"><b>它克誰（極度克制）</b>：${esc(e.countered || "（無）")}</div>
      <div class="cx-fx"><b>誰佔優勢（極大優勢）</b>：${esc(e.favored || "（無）")}</div>
      ${e.event ? `<details class="cx-cats"><summary>事件舉例</summary><div class="cx-fx">${esc(e.event)}</div></details>` : ""}
    </div>`;
  }

  function renderList() {
    const st = getState();
    const box = win.querySelector(".cx-list");
    if (ui.tab === "env") {
      const list = CODEX_ENV_ALL.filter((e) => !ui.q || `${e.name}${e.sub ?? ""}${e.desc}${e.effect}${e.countered}${e.favored}`.toLowerCase().includes(ui.q.toLowerCase()));
      box.innerHTML = `<div class="cx-count">關卡詞條 ${list.length} 個</div>${list.map(envRow).join("") || `<div class="cx-empty">沒有符合的詞條。</div>`}`;
      return;
    }
    const who = ui.focusId != null ? st?.samsarites.find((s) => s.id === ui.focusId) : null;
    const mine = new Set(who?.tags ?? []);
    const pinned = who ? CODEX_ALL.filter((t) => mine.has(t.id)) : []; // 開著他的檔案頁：他身上的詞條不受篩選影響，一律置頂
    const rest = CODEX_ALL.filter((t) => !mine.has(t.id) && matches(t));
    box.innerHTML = `${pinned.map((t) => personRow(t, true)).join("")}<div class="cx-count">人物詞條 ${rest.length + pinned.length} 個</div>${rest.map((t) => personRow(t)).join("") || `<div class="cx-empty">沒有符合的詞條，換個篩選看看。</div>`}`;
    const hl = box.querySelector(".hl");
    if (hl) {
      hl.scrollIntoView({ block: "nearest" });
      ui.tagId = null;
    }
  }

  function render() {
    if (!win) return;
    renderTop();
    renderList();
  }

  // ───────── 事件 ─────────

  function onClick(e) {
    const b = e.target.closest("[data-cx]");
    if (!b) return;
    const v = b.dataset.v;
    switch (b.dataset.cx) {
      case "close":
        return close();
      case "tab":
        ui.tab = v;
        break;
      case "rar":
        if (ui.rarity.has(v)) ui.rarity.delete(v);
        else ui.rarity.add(v);
        break;
      case "tone":
        ui.tone = v;
        break;
      default:
        return;
    }
    render();
  }

  return { open, close, sync, setFocus, isOpen: () => ui.open, refresh: () => ui.open && render() };
}
