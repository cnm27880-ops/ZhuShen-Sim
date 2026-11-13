// 畫面層：只負責「把 state 畫出來」跟「把玩家的點擊轉成引擎呼叫」。
// 所有遊戲規則都在 src/engine/，這裡不做任何數值計算以外的決定。

import { CONFIG, RANKS, INJURIES, GACHA_POOLS, PAUSE_EVENTS } from "../data/config.js";
import { DUNGEONS, getDungeon } from "../data/dungeons.js";
import {
  createNewGame,
  currentDay,
  getSamsarite,
  upkeepOf,
  canAfford,
  pullGacha,
  recycle,
  serialize,
  deserialize,
} from "../engine/core.js";
import { roomPassRate, clearChance, partyPower, startRun } from "../engine/dungeon.js";
import { step } from "../engine/dispatch.js";

const SAVE_KEY = "zhushen-sim-save-v1";
const $ = (id) => document.getElementById(id);

// 房間在俯視圖上的位置（百分比）與待在裡面時頭頂的 emoji
const ROOMS = {
  dorm: { label: "宿舍", x: 3, y: 5, w: 44, h: 42, emoji: "💤", decor: [["🛏️", 22, 24], ["🛏️", 42, 24], ["🛏️", 62, 24], ["🛏️", 82, 24], ["🪴", 92, 88]] },
  canteen: { label: "餐廳", x: 53, y: 5, w: 44, h: 42, emoji: "🍜", decor: [["🍳", 40, 22], ["🍲", 58, 22], ["🥤", 76, 22], ["🪑", 90, 24], ["🍽️", 8, 88]] },
  training: { label: "訓練場", x: 3, y: 53, w: 30, h: 42, emoji: "💪", decor: [["🏋️", 52, 24], ["🥊", 80, 24], ["🎯", 90, 86]] },
  shop: { label: "商店", x: 36, y: 53, w: 28, h: 42, emoji: "🛒", decor: [["🧪", 50, 24], ["⚔️", 72, 24], ["🛡️", 90, 24], ["💰", 10, 86]] },
  portal: { label: "傳送門", x: 67, y: 53, w: 30, h: 42, emoji: "🌀", decor: [], portal: true },
};

let state = loadGame() ?? createNewGame();
let timer = null;
let modal = null; // 目前開著的彈出視窗：{ name, ...參數 }
let bannerText = "";
const minis = new Map(); // 輪迴者 id → { el, room }
const dispatchPick = { dungeonId: DUNGEONS[0].id, party: new Set() };

// ───────── 存檔 ─────────

function loadGame() {
  try {
    const json = localStorage.getItem(SAVE_KEY);
    return json ? deserialize(json) : null;
  } catch {
    return null; // 存檔壞掉或瀏覽器不給用 localStorage：直接開新局
  }
}

function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, serialize(state));
  } catch {
    /* 存不了就算了，遊戲照常進行 */
  }
}

// ───────── 主迴圈 ─────────

function schedule() {
  clearTimeout(timer);
  if (state.settings.paused || state.gameOver || modal) return;
  const ms = (state.run ? CONFIG.roomMs : CONFIG.tickMs) / state.settings.speed;
  timer = setTimeout(() => {
    step(state);
    afterChange();
  }, ms);
}

/** 引擎動過之後一律呼叫：處理事件（自動暫停、結算視窗）、重畫、排下一步 */
function afterChange() {
  for (const ev of state.events.splice(0)) {
    if (ev.type === "dayEnd") saveGame();
    if (ev.type === "gameOver") modal = { name: "gameOver" };
    if (state.settings.pauseOn[ev.type]) {
      state.settings.paused = true;
      bannerText = `⏸ 自動暫停：${PAUSE_EVENTS[ev.type].label} —— ${ev.text}`;
      if (ev.type === "runEnd" && !modal) modal = { name: "runResult" };
    }
  }
  render();
  schedule();
}

// ───────── 畫面 ─────────

function render() {
  renderTopbar();
  renderStage();
  renderLog();
  renderRoster();
  renderModal();
}

function renderTopbar() {
  $("points").textContent = state.points;
  $("points").classList.toggle("debt", state.points < 0);
  $("day-label").textContent = `第 ${currentDay(state)} 天`;
  $("day-bar-fill").style.width = `${((state.tick % CONFIG.ticksPerDay) / CONFIG.ticksPerDay) * 100}%`;
  const upkeep = state.samsarites.filter((s) => s.location === "space").reduce((sum, s) => sum + upkeepOf(s), 0);
  $("upkeep").textContent = `-${upkeep} / 天`;

  $("speed-controls").innerHTML = CONFIG.speeds
    .map((v) => `<button data-action="set-speed" data-value="${v}" class="${v === state.settings.speed ? "active" : ""}">${v}x</button>`)
    .join("");
  document.body.style.setProperty("--speed", state.settings.speed); // 讓小人滑動速度跟著遊戲速度變快
  $("btn-pause").textContent = state.settings.paused ? "▶ 繼續" : "⏸ 暫停";
  $("btn-pause").classList.toggle("active", state.settings.paused);

  $("banner").style.display = state.settings.paused && bannerText ? "block" : "none";
  $("banner").innerHTML = `${bannerText}<button data-action="toggle-pause">▶ 繼續</button>`;

  $("auto-dispatch").checked = state.settings.autoDispatch;
  $("protect-injured").checked = state.settings.protect.noInjured;
  $("protect-enemies").checked = state.settings.protect.noEnemies;
}

function miniHtml(s, emoji) {
  return `<span class="mini-emoji">${emoji}</span>
    <div class="mini-figure"><div class="mini-head"></div><div class="mini-body"></div></div>
    <div class="mini-shadow"></div><span class="mini-name">${s.name}</span>`;
}

function randomSpot(roomId) {
  const r = ROOMS[roomId];
  return { x: r.x + r.w * (0.15 + Math.random() * 0.7), y: r.y + r.h * (0.45 + Math.random() * 0.4) };
}

function pickRoom(s) {
  if (s.injury > 0) return Math.random() < 0.8 ? "dorm" : "canteen"; // 受傷的人多半躺在宿舍
  const ids = Object.keys(ROOMS);
  return ids[Math.floor(Math.random() * ids.length)];
}

function renderStage() {
  const inDungeon = Boolean(state.run);
  $("space-map").style.display = inDungeon ? "none" : "block";
  $("dungeon-view").style.display = inDungeon ? "flex" : "none";
  if (inDungeon) renderDungeon();
  else renderSpace();
}

function renderSpace() {
  const map = $("space-map");
  if (!map.dataset.built) {
    map.innerHTML = Object.entries(ROOMS)
      .map(([id, r]) => {
        const decor = r.decor.map(([icon, x, y]) => `<span class="decor" style="left:${x}%;top:${y}%">${icon}</span>`).join("");
        const portal = r.portal ? `<div class="portal-glow"></div><div class="portal-ring"></div>` : "";
        return `<div class="room room-${id}" style="left:${r.x}%;top:${r.y}%;width:${r.w}%;height:${r.h}%">
          ${portal}${decor}<span class="room-label">${r.label}</span></div>`;
      })
      .join("");
    map.dataset.built = "1";
  }

  const alive = new Set(state.samsarites.map((s) => s.id));
  for (const [id, mini] of minis) {
    if (!alive.has(id)) {
      mini.el.remove();
      minis.delete(id);
    }
  }

  for (const s of state.samsarites) {
    let mini = minis.get(s.id);
    const isNew = !mini;
    if (isNew) {
      const el = document.createElement("div");
      el.className = "mini";
      el.dataset.action = "open-detail";
      el.dataset.id = s.id;
      el.innerHTML = miniHtml(s, "");
      // 每個小人的呼吸動畫錯開一點，才不會全部同步上下晃
      el.querySelector(".mini-figure").style.animationDelay = `${-Math.random() * 2.4}s`;
      map.appendChild(el);
      mini = { el, room: null };
      minis.set(s.id, mini);
    }
    // 新來的、或每個時段有三成機率：換一個房間（位置一改，CSS transition 就會讓小人滑過去）
    if (isNew || (!state.settings.paused && Math.random() < 0.3)) {
      mini.room = isNew ? "portal" : pickRoom(s);
      const spot = randomSpot(mini.room);
      mini.el.style.left = `${spot.x}%`;
      mini.el.style.top = `${spot.y}%`;
    }
    const emoji = s.injury > 0 ? "🩹" : s.locked ? "🔒" : ROOMS[mini.room].emoji;
    mini.el.querySelector(".mini-emoji").textContent = emoji;
    mini.el.classList.toggle("injured", s.injury > 0);
  }
}

function renderDungeon() {
  const run = state.run;
  const dungeon = getDungeon(run.dungeonId);
  const party = run.partyIds.map((id) => getSamsarite(state, id)).filter(Boolean);
  const view = $("dungeon-view");
  const nodeX = (i) => ((i + 1) / CONFIG.dungeon.rooms) * 100;

  if (view.dataset.runKey !== String(state.dungeonStats[run.dungeonId].attempts) + run.dungeonId) {
    view.dataset.runKey = String(state.dungeonStats[run.dungeonId].attempts) + run.dungeonId;
    view.className = `theme-${dungeon.id}`;
    view.innerHTML = `
      <h3>${dungeon.icon} ${dungeon.name} <small>（${dungeon.genre}・${dungeon.difficulty}）</small></h3>
      <div class="dungeon-intro">${dungeon.intro}</div>
      <div class="route">
        <div class="route-line"></div><div class="route-progress"></div>
        ${dungeon.rooms
          .map((room, i) => `<div class="route-node" data-node="${i}" style="left:${nodeX(i)}%"><span class="route-node-mark">${i + 1}</span><span class="route-node-label">${room.name}</span></div>`)
          .join("")}
        <div class="route-party" style="left:0%"></div>
      </div>
      <div class="dungeon-status"></div>`;
  }

  view.querySelectorAll(".route-node").forEach((node, i) => {
    const result = run.results[i];
    node.classList.toggle("pass", result === true);
    node.classList.toggle("fail", result === false);
    node.classList.toggle("current", i === run.roomIndex);
    node.querySelector(".route-node-mark").textContent = result === true ? "✓" : result === false ? "✕" : i + 1;
  });
  view.querySelector(".route-progress").style.width = `${run.roomIndex === 0 ? 0 : nodeX(run.roomIndex - 1)}%`;
  const partyEl = view.querySelector(".route-party");
  partyEl.style.left = `${run.roomIndex === 0 ? 0 : nodeX(run.roomIndex - 1)}%`;
  partyEl.innerHTML = party
    .map((s) => `<div class="mini ${s.injury > 0 ? "injured" : ""}">${miniHtml(s, s.injury > 0 ? "🩹" : "🔦")}</div>`)
    .join("");
  const rate = Math.round(roomPassRate(state, party, dungeon) * 100);
  view.querySelector(".dungeon-status").textContent =
    `進度 ${run.roomIndex}/${CONFIG.dungeon.rooms}・存活 ${party.length} 人・目前每個房間通過率 ${rate}%・主神空間時間暫停中`;
}

function renderLog() {
  const log = $("log");
  log.innerHTML = state.log
    .map((e) => `<div class="log-entry log-${e.type}"><span class="log-day">D${e.day}</span>${e.text}</div>`)
    .join("");
  log.scrollTop = log.scrollHeight;
}

function injuryLabel(s) {
  if (s.injury === 0) return "無傷";
  return `<span class="inj-${s.injury}">${INJURIES[s.injury].name}（還要休 ${s.restDaysLeft} 天）</span>`;
}

function rankBadge(rank) {
  return `<span class="rank rank-${rank}">${rank}</span>`;
}

function renderRoster() {
  if (state.samsarites.length === 0) {
    $("roster").innerHTML = `<div class="empty">你手下一個輪迴者都沒有了。去抽卡吧。</div>`;
    return;
  }
  $("roster").innerHTML = state.samsarites
    .map(
      (s) => `
      <div class="card rank-border-${s.rank} ${s.location === "dungeon" ? "away" : ""}" data-action="open-detail" data-id="${s.id}">
        <div class="card-top">${rankBadge(s.rank)}<span class="grow">${s.name}</span><span>${s.locked ? "🔒" : ""}</span></div>
        <div class="card-meta"><span>⚔️ ${s.stats.power}</span><span>🧠 ${s.stats.sanity}</span><span>💸 ${upkeepOf(s)}/天</span></div>
        <div class="bar ${s.stats.sanity < 40 ? "low" : ""}" title="理智"><i style="width:${s.stats.sanity}%"></i></div>
        <div class="card-status">${s.location === "dungeon" ? "🚪 副本中" : injuryLabel(s)}</div>
      </div>`
    )
    .join("");
}

// ───────── 彈出視窗 ─────────

function openModal(next) {
  modal = next;
  render();
  schedule(); // 視窗開著時 schedule 會直接 return，等於暫停
}

function closeModal() {
  modal = null;
  render();
  schedule();
}

function renderModal() {
  $("modal-backdrop").style.display = modal ? "flex" : "none";
  if (!modal) return;
  const builders = { dispatch, gacha, detail, settings, runResult, gameOver, confirmRecycle };
  $("modal").innerHTML = builders[modal.name]();
}

const closeButton = `<button data-action="close-modal">關閉</button>`;

function dispatch() {
  const dungeon = getDungeon(dispatchPick.dungeonId);
  const home = state.samsarites.filter((s) => s.location === "space");
  for (const id of [...dispatchPick.party]) if (!home.some((s) => s.id === id)) dispatchPick.party.delete(id);
  const party = home.filter((s) => dispatchPick.party.has(s.id));
  const injured = party.filter((s) => s.injury > 0);

  const dungeonOptions = DUNGEONS.map((d) => {
    const st = state.dungeonStats[d.id] ?? { attempts: 0, clears: 0 };
    return `<div class="option ${d.id === dungeon.id ? "selected" : ""}" data-action="pick-dungeon" data-id="${d.id}">
      <span class="option-icon">${d.icon}</span>
      <span class="grow"><b>${d.name}</b> <small>${d.genre}・${d.difficulty}</small><br /><small>${d.intro}</small></span>
      <small>推薦戰力 ${d.recommendedPower}<br />獎勵 ${d.reward} 分<br />通關 ${st.clears}/${st.attempts}</small>
    </div>`;
  }).join("");

  const memberOptions = home.length
    ? home
        .map(
          (s) => `<div class="option ${dispatchPick.party.has(s.id) ? "selected" : ""}" data-action="toggle-member" data-id="${s.id}">
            ${rankBadge(s.rank)}<span class="grow">${s.name} ${s.locked ? "🔒" : ""}</span>
            <small>戰力 ${s.stats.power}・${injuryLabel(s)}</small>
          </div>`
        )
        .join("")
    : `<div class="empty">主神空間裡沒有人可以派。</div>`;

  let summary = "請至少選一個人。";
  if (party.length > 0) {
    const rate = Math.round(roomPassRate(state, party, dungeon) * 100);
    const chance = Math.round(clearChance(state, party, dungeon) * 100);
    const cls = chance >= 75 ? "good" : chance >= 50 ? "warn" : "bad";
    summary = `小隊總戰力 <b>${partyPower(party)}</b> / 推薦 ${dungeon.recommendedPower}<br />
      每個房間通過率 <b>${rate}%</b>，${CONFIG.dungeon.rooms} 個房間通過 ${CONFIG.dungeon.roomsToClear} 個以上才算通關<br />
      預估通關率 <b class="${cls}">${chance}%</b>`;
    if (injured.length > 0) {
      summary += `<br /><span class="bad">⚠ 帶傷出征：${injured
        .map((s) => `${s.name}（被打中時 ${Math.round(INJURIES[s.injury].deathBonus * 100)}% 直接死亡）`)
        .join("、")}</span>`;
    }
  }

  return `<h3>🚪 派遣</h3>
    <div class="option-list">${dungeonOptions}</div>
    <h3 style="margin-top:14px">選擇隊員（最多 ${CONFIG.partyMax} 人，已選 ${party.length}）</h3>
    <div class="option-list">${memberOptions}</div>
    <div class="summary">${summary}</div>
    <div class="modal-actions">${closeButton}
      <button class="primary" data-action="confirm-dispatch" ${party.length === 0 ? "disabled" : ""}>出發（耗時 1 天）</button>
    </div>`;
}

function gacha() {
  const pools = GACHA_POOLS.map((p) => {
    const total = p.odds.reduce((sum, o) => sum + o.weight, 0);
    const odds = p.odds.map((o) => `${Math.round((o.weight / total) * 100)}% ${o.rank}`).join("、");
    return `<div class="option">
      <span class="grow"><b>${p.name}</b><br /><small>${odds}・純隨機不保底</small></span>
      <button class="primary" data-action="pull" data-id="${p.id}" ${canAfford(state, p.cost) ? "" : "disabled"}>抽一次（${p.cost} 分）</button>
    </div>`;
  }).join("");
  const last = modal.lastId ? getSamsarite(state, modal.lastId) : null;
  const result = last
    ? `<div class="summary gacha-result" style="--rank-color:var(--rank-${last.rank})">${rankBadge(last.rank)}
        <b>${last.name}</b>戰力 ${last.stats.power}・維持費 ${upkeepOf(last)} / 天</div>`
    : "";
  const debtNote = state.points < 0 ? `<span class="bad">（負債中）</span>` : "";
  return `<h3>🎴 抽卡</h3>
    <p>目前積分：<b>${state.points}</b> ${debtNote}。積分不夠時可以向主神借，最多借到 ${CONFIG.debtLimit} 分。</p>
    <div class="option-list">${pools}</div>${result}
    <div class="modal-actions">${closeButton}</div>`;
}

function detail() {
  const s = getSamsarite(state, modal.id);
  if (!s) return `<h3>查無此人</h3><p>這個人已經不在了。</p><div class="modal-actions">${closeButton}</div>`;
  const home = s.location === "space";
  return `<h3>${rankBadge(s.rank)} ${s.name}</h3>
    <table class="stats">
      <tr><td>狀態</td><td>${home ? "主神空間" : "副本中"}・${injuryLabel(s)}</td></tr>
      <tr><td>生命</td><td>${s.stats.hp}</td></tr>
      <tr><td>戰力</td><td>${s.stats.power}</td></tr>
      <tr><td>防禦</td><td>${s.stats.defense}</td></tr>
      <tr><td>速度</td><td>${s.stats.speed}</td></tr>
      <tr><td>理智</td><td>${s.stats.sanity}</td></tr>
      <tr><td>運氣</td><td>${s.stats.luck}</td></tr>
      <tr><td>維持費</td><td>${upkeepOf(s)} 分 / 天（基礎 ${CONFIG.upkeepBase} + 階級 ${RANKS[s.rank].upkeep} + 傷勢 ${INJURIES[s.injury].upkeep}）</td></tr>
      <tr><td>資歷</td><td>第 ${s.joinedDay} 天加入・出征 ${s.runs} 次</td></tr>
      <tr><td>標籤</td><td>（Phase 2 開放）</td></tr>
    </table>
    <div class="modal-actions">
      <button class="danger" data-action="ask-recycle" data-id="${s.id}" ${home ? "" : "disabled"}>♻️ 推進回收爐（+${CONFIG.recycle.points} 分）</button>
      <button data-action="toggle-lock" data-id="${s.id}">${s.locked ? "🔓 解除鎖定" : "🔒 鎖定（不參與自動派遣）"}</button>
      ${closeButton}
    </div>`;
}

function confirmRecycle() {
  const s = getSamsarite(state, modal.id);
  return `<h3>♻️ 主神回收爐</h3>
    <p>確定要把 <b>${s.name}</b> 推進回收爐嗎？<span class="bad">這個人會永久消失。</span></p>
    <p>你會拿到 ${CONFIG.recycle.points} 分，並省下之後的維持費；但其他所有輪迴者理智 -${CONFIG.recycle.sanityLoss}。</p>
    <div class="modal-actions">
      <button data-action="open-detail" data-id="${s.id}">算了</button>
      <button class="danger" data-action="confirm-recycle" data-id="${s.id}">推進去</button>
    </div>`;
}

function settings() {
  const toggles = Object.entries(PAUSE_EVENTS)
    .map(
      ([key, def]) => `<label class="option"><input type="checkbox" data-pause-key="${key}" ${state.settings.pauseOn[key] ? "checked" : ""} />
        <span class="grow">${def.label}</span></label>`
    )
    .join("");
  const graves = state.graveyard.length
    ? state.graveyard.map((g) => `<div>第 ${g.day} 天・${rankBadge(g.rank)} ${g.name}・${g.cause}</div>`).join("")
    : "（還沒有人死）";
  return `<h3>⚙️ 設定</h3>
    <p>遇到下列事件時自動暫停：</p>
    <div class="option-list">${toggles}</div>
    <h3 style="margin-top:14px">🪦 死亡名單</h3>
    <div class="summary">${graves}</div>
    <div class="modal-actions">
      <button class="danger" data-action="reset-game">刪除存檔並重新開始</button>
      ${closeButton}
    </div>`;
}

function runResult() {
  const r = state.lastRun;
  const rooms = r.results.map((ok) => (ok ? "✅" : "❌")).join(" ");
  const survivors = r.survivors.length
    ? r.survivors.map((s) => `${s.name}（${INJURIES[s.injury].name}）`).join("、")
    : "無";
  return `<h3>${r.success ? "🏆 通關" : "💀 失敗"}：${r.dungeonName}</h3>
    <div class="summary">
      <span class="result-rooms">${rooms}</span><br />房間通過 ${r.passedCount}/${CONFIG.dungeon.rooms}<br />
      獎勵：<b class="${r.success ? "good" : "bad"}">+${r.reward} 分</b><br />
      生還：${survivors}<br />
      死亡：<span class="${r.deaths.length ? "bad" : ""}">${r.deaths.length ? r.deaths.join("、") : "無"}</span>
    </div>
    <div class="modal-actions"><button class="primary" data-action="close-modal">知道了</button></div>`;
}

function gameOver() {
  return `<h3>🕳️ 你被主神換掉了</h3>
    <p>手下沒有任何輪迴者，也借不到積分。撐了 ${currentDay(state)} 天，送走了 ${state.graveyard.length} 個人。</p>
    <div class="modal-actions"><button class="primary" data-action="reset-game">重新開始</button></div>`;
}

// ───────── 玩家操作 ─────────

const actions = {
  "toggle-pause"() {
    state.settings.paused = !state.settings.paused;
    bannerText = "";
  },
  "set-speed"(el) {
    state.settings.speed = Number(el.dataset.value);
  },
  "open-dispatch"() {
    if (state.run) return;
    modal = { name: "dispatch" };
  },
  "open-gacha"() {
    modal = { name: "gacha" };
  },
  "open-settings"() {
    modal = { name: "settings" };
  },
  "open-detail"(el) {
    modal = { name: "detail", id: Number(el.dataset.id) };
  },
  "close-modal"() {
    modal = null;
  },
  "pick-dungeon"(el) {
    dispatchPick.dungeonId = el.dataset.id;
  },
  "toggle-member"(el) {
    const id = Number(el.dataset.id);
    if (dispatchPick.party.has(id)) dispatchPick.party.delete(id);
    else if (dispatchPick.party.size < CONFIG.partyMax) dispatchPick.party.add(id);
  },
  "confirm-dispatch"() {
    const result = startRun(state, dispatchPick.dungeonId, [...dispatchPick.party]);
    if (!result.ok) return alert(result.reason);
    dispatchPick.party.clear();
    modal = null;
    state.settings.paused = false;
    bannerText = "";
  },
  pull(el) {
    const s = pullGacha(state, el.dataset.id);
    modal = { name: "gacha", lastId: s?.id };
    saveGame();
  },
  "toggle-lock"(el) {
    const s = getSamsarite(state, Number(el.dataset.id));
    if (s) s.locked = !s.locked;
  },
  "ask-recycle"(el) {
    modal = { name: "confirmRecycle", id: Number(el.dataset.id) };
  },
  "confirm-recycle"(el) {
    recycle(state, Number(el.dataset.id));
    modal = null;
    saveGame();
  },
  "reset-game"() {
    if (!state.gameOver && !confirm("確定要刪除存檔、重新開始嗎？")) return;
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* 忽略 */
    }
    for (const mini of minis.values()) mini.el.remove();
    minis.clear();
    state = createNewGame();
    modal = null;
    bannerText = "";
  },
};

document.addEventListener("click", (event) => {
  // 點到視窗外面的暗色區域 = 關閉（遊戲結束視窗除外）
  if (event.target.id === "modal-backdrop" && modal?.name !== "gameOver") return closeModal();
  const el = event.target.closest("[data-action]");
  if (!el || el.disabled) return;
  actions[el.dataset.action]?.(el);
  afterChange();
});

document.addEventListener("change", (event) => {
  const el = event.target;
  if (el.id === "auto-dispatch") state.settings.autoDispatch = el.checked;
  else if (el.id === "protect-injured") state.settings.protect.noInjured = el.checked;
  else if (el.id === "protect-enemies") state.settings.protect.noEnemies = el.checked;
  else if (el.dataset.pauseKey) state.settings.pauseOn[el.dataset.pauseKey] = el.checked;
  else return;
  saveGame();
});

// 給除錯與自動化測試用：在瀏覽器主控台輸入 zhushen.state 可以看到整個遊戲狀態
window.zhushen = {
  get state() {
    return state;
  },
};

afterChange();
