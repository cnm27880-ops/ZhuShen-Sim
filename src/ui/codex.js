// 詞條庫（懸浮球圖鑑，2026-11 試玩回饋第 9 項）：
//   · 一顆永遠在最上層的懸浮球，點開是可拖曳、可調整大小的視窗；關視窗後懸浮球還在
//   · 兩個分頁：人物詞條／關卡詞條；篩選（稀有度／好壞／類別／自訂分類）＋搜尋
//   · 自訂分類存在 state.codex.categories，跟著存檔走
//   · 從小人檔案頁開啟時（openFor）：這個小人身上的詞條置頂
// 好壞標示由 data/tagCodex.js 依數值機械判定。

import { esc } from "./html.js";
import { PERSON_TAGS, ENV_LIST, toneOf, TONE_LABEL, KIND_LABEL, RARITIES, envRelations } from "../data/tagCodex.js";

const POS_KEY = "zhushen-codex-win";
const pct = (v) => `${v >= 0 ? "+" : ""}${Math.round(v * 1000) / 10}%`;

export function createCodex({ getState, describeTag, onSave }) {
  const ui = { open: false, tab: "person", rarity: new Set(), tone: "all", kind: "all", cat: "all", q: "", sid: null, tagId: null };
  let win = null;
  let orb = null;

  const cats = () => {
    const st = getState();
    if (!st) return [];
    st.codex ??= { categories: [] };
    return st.codex.categories;
  };

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
    win.addEventListener("change", onChange);
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
    if ("samsariteId" in opts) ui.sid = opts.samsariteId ?? null;
    if (opts.tagId) ui.tagId = opts.tagId;
    if (opts.tab) ui.tab = opts.tab;
    if (opts.samsariteId != null) ui.tab = "person";
    ui.open = true;
    win.style.display = "flex";
    render();
  }
  function close() {
    ui.open = false;
    if (win) win.style.display = "none";
  }

  /** 每次畫面更新時呼叫：遊戲還沒載入（封面）時藏起懸浮球；視窗開著且小人在變時跟著更新置頂區 */
  function sync(visible) {
    if (!orb) build();
    orb.style.display = visible ? "" : "none";
    if (!visible && ui.open) close();
  }

  // ───────── 內容 ─────────

  function matches(t, kind) {
    if (ui.rarity.size && !ui.rarity.has(t.rarity)) return false;
    if (ui.tone !== "all" && toneOf(t) !== ui.tone) return false;
    if (ui.kind !== "all" && t.kind !== ui.kind) return false;
    if (ui.cat !== "all") {
      const c = cats().find((x) => x.id === ui.cat);
      if (!c || !c.tags.includes(t.id)) return false;
    }
    if (ui.q && !(`${t.name}${t.desc}`.toLowerCase().includes(ui.q.toLowerCase()))) return false;
    return true;
  }

  const chip = (label, attr, on) => `<button type="button" class="cx-chip ${on ? "on" : ""}" ${attr}>${label}</button>`;

  function renderTop() {
    const st = getState();
    const top = win.querySelector(".cx-top");
    const tabs = `<div class="cx-tabs">${chip("人物詞條", 'data-cx="tab" data-v="person"', ui.tab === "person")}${chip("關卡詞條", 'data-cx="tab" data-v="env"', ui.tab === "env")}</div>`;
    const search = `<input type="search" class="cx-q" data-cx-q placeholder="搜尋詞條名稱或說明" value="${esc(ui.q)}" />`;
    let filters = "";
    if (ui.tab === "person") {
      const rar = RARITIES.map((r) => chip(r, `data-cx="rar" data-v="${r}"`, ui.rarity.has(r))).join("");
      const tone = [["all", "全部好壞"], ["good", "好"], ["bad", "壞"], ["mixed", "看情況"], ["neutral", "中性"]].map(([v, l]) => chip(l, `data-cx="tone" data-v="${v}"`, ui.tone === v)).join("");
      const kind = [["all", "全部類別"], ["stat", "基礎"], ["trait", "人格"], ["soul", "靈魂核心"], ["acquired", "事件獲得"]].map(([v, l]) => chip(l, `data-cx="kind" data-v="${v}"`, ui.kind === v)).join("");
      const mine = cats()
        .map((c) => `<span class="cx-catchip">${chip(esc(c.name), `data-cx="cat" data-v="${esc(c.id)}"`, ui.cat === c.id)}<button type="button" class="cx-del" data-cx="delcat" data-v="${esc(c.id)}" title="刪除分類「${esc(c.name)}」">×</button></span>`)
        .join("");
      const cat = `<div class="cx-row-f">${chip("全部分類", 'data-cx="cat" data-v="all"', ui.cat === "all")}${mine}<button type="button" class="cx-chip add" data-cx="newcat">＋ 新分類</button></div>`;
      filters = `<div class="cx-row-f">${rar}</div><div class="cx-row-f">${tone}</div><div class="cx-row-f">${kind}</div>${cat}`;
    }
    const who = ui.sid != null ? st?.samsarites.find((s) => s.id === ui.sid) : null;
    const pin = who ? `<div class="cx-pin">對照：<b>${esc(who.name)}</b>（他身上的詞條置頂）<button type="button" class="cx-chip" data-cx="clearsid">取消對照</button></div>` : "";
    top.innerHTML = `${tabs}${pin}${search}${filters}`;
  }

  function catMenu(t) {
    const list = cats();
    if (!list.length) return "";
    return `<details class="cx-cats"><summary>分類</summary>${list.map((c) => `<label><input type="checkbox" data-ct="${esc(c.id)}|${t.id}" ${c.tags.includes(t.id) ? "checked" : ""} /> ${esc(c.name)}</label>`).join("")}</details>`;
  }

  function personRow(t) {
    const tone = toneOf(t);
    return `<div class="cx-item ${ui.tagId === t.id ? "hl" : ""}" data-tag="${t.id}">
      <div class="cx-head"><span class="tag-chip tag-${t.rarity}">${t.rarity}｜${esc(t.name)}</span><span class="cx-tone tone-${tone}">${TONE_LABEL[tone]}</span><small>${KIND_LABEL[t.kind] ?? ""}</small></div>
      <div class="cx-desc">${esc(t.desc)}</div>
      <div class="cx-fx">效果：${esc(describeTag(t).effects)}</div>
      ${catMenu(t)}
    </div>`;
  }

  function envRow(e) {
    const rel = envRelations(e.id);
    const names = (arr) => arr.map((x) => `${esc(x.tag.name)}（${pct(x.value)}）`).join("、");
    const fx = [e.passMod ? `全隊通過率 ${pct(e.passMod)}` : "", e.rewardMult && e.rewardMult !== 1 ? `通關積分 ×${e.rewardMult}` : ""].filter(Boolean).join("；") || "沒有直接數值（影響特定詞條）";
    const tone = (e.passMod ?? 0) < 0 && !(e.rewardMult > 1) ? "bad" : (e.passMod ?? 0) > 0 && !(e.rewardMult < 1) ? "good" : (e.passMod ?? 0) !== 0 || e.rewardMult > 1 ? "mixed" : "neutral";
    return `<div class="cx-item" data-env="${e.id}">
      <div class="cx-head"><b>${esc(e.name)}</b><span class="cx-tone tone-${tone}">${TONE_LABEL[tone]}</span></div>
      <div class="cx-desc">${esc(e.desc)}</div>
      <div class="cx-fx">效果：${esc(fx)}</div>
      <div class="cx-fx">它克誰：${rel.victims.length ? names(rel.victims) : "（目前沒有資料）"}</div>
      <div class="cx-fx">誰克它：${rel.counters.length ? names(rel.counters) : "（目前沒有資料）"}</div>
    </div>`;
  }

  function renderList() {
    const st = getState();
    const box = win.querySelector(".cx-list");
    if (ui.tab === "env") {
      const list = ENV_LIST.filter((e) => !ui.q || `${e.name}${e.desc}`.toLowerCase().includes(ui.q.toLowerCase()));
      box.innerHTML = `<div class="cx-count">關卡詞條共 ${list.length} 個（每次進副本隨機抽 1 個）</div>${list.map(envRow).join("") || `<div class="cx-empty">沒有符合的詞條。</div>`}`;
      return;
    }
    const who = ui.sid != null ? st?.samsarites.find((s) => s.id === ui.sid) : null;
    const mineIds = new Set(who?.tags ?? []);
    const pinned = who ? PERSON_TAGS.filter((t) => mineIds.has(t.id)) : [];
    const rest = PERSON_TAGS.filter((t) => !mineIds.has(t.id) && matches(t));
    box.innerHTML =
      (who ? `<div class="cx-sec">這個小人的詞條（${esc(who.name)}）</div>${pinned.map(personRow).join("") || `<div class="cx-empty">他沒有詞條。</div>`}<div class="cx-sec">其他詞條</div>` : "") +
      `<div class="cx-count">人物詞條 ${rest.length} 個符合${who ? "（不含他身上的）" : ""}</div>` +
      (rest.map(personRow).join("") || `<div class="cx-empty">沒有符合的詞條，換個篩選看看。</div>`);
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
      case "kind":
        ui.kind = v;
        break;
      case "cat":
        ui.cat = v;
        break;
      case "clearsid":
        ui.sid = null;
        break;
      case "newcat": {
        const name = (window.prompt("新分類的名稱（例如：愛用、要小心、拿來當隊長）", "") ?? "").trim().slice(0, 12);
        if (!name) return;
        cats().push({ id: `c${Date.now().toString(36)}`, name, tags: [] });
        onSave();
        break;
      }
      case "delcat": {
        const c = cats().find((x) => x.id === v);
        if (!c || !window.confirm(`刪除分類「${c.name}」？（詞條本身不會被刪掉）`)) return;
        const st = getState();
        st.codex.categories = st.codex.categories.filter((x) => x.id !== v);
        if (ui.cat === v) ui.cat = "all";
        onSave();
        break;
      }
      default:
        return;
    }
    render();
  }

  function onChange(e) {
    const cb = e.target.closest("[data-ct]");
    if (!cb) return;
    const [catId, tagId] = cb.dataset.ct.split("|");
    const c = cats().find((x) => x.id === catId);
    if (!c) return;
    c.tags = cb.checked ? [...new Set([...c.tags, tagId])] : c.tags.filter((x) => x !== tagId);
    onSave();
  }

  return { open, close, sync, isOpen: () => ui.open, refresh: () => ui.open && render() };
}
