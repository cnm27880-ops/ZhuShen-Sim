// 畫面層：只負責「把 state 畫出來」跟「把玩家的點擊轉成引擎呼叫」。
// 所有遊戲規則都在 src/engine/，這裡不做任何數值計算以外的決定。

import { CONFIG, RANKS, INJURIES, PAUSE_EVENTS } from "../data/config.js";
import { DUNGEONS, getDungeon } from "../data/dungeons.js";
import {
  createNewGame,
  currentDay,
  getSamsarite,
  upkeepOf,
  upkeepBaseOf,
  debtLimitOf,
  canAfford,
  pullGacha,
  gachaInfo,
  recycle,
  serialize,
  deserialize,
} from "../engine/core.js";
import { roomPassRate, clearChance, partyPower, startRun, hasIntel, rewardTierMult, intelBonus, isUnlocked, bossGateInfo, roomCount, roomsToClear } from "../engine/dungeon.js";
import {
  enhance as enhanceSamsarite,
  breakGene as breakSamsariteGene,
  checkEnhance,
  checkBreakGene,
  enhanceGain,
  enhanceCapOf,
  insightCapOf,
  maxGeneOf,
  geneTierOf,
} from "../engine/growth.js";
import { effectivePower, subStat, defenseChance, speedSaveChance } from "../engine/tags.js";
import { shopTier, nextTierInfo, checkBuy, buyItem, collectionEffects } from "../engine/shop.js";
import { SHOP_ITEMS, SHOP_KIND_LABELS, SHOP_SLOT_LABELS, getShopItem } from "../data/shop.js";
import { getSpecialReward } from "../data/dungeons.js";
import { getTag, getEnvTag } from "../data/tags.js";
import { step, areEnemies } from "../engine/dispatch.js";
import { pendingWishes, wishesOf, checkAccept, acceptWish, refuseWish, wishVars } from "../engine/wishes.js";
import { getWish } from "../data/wishes.js";
import { pendingGodEvent, activeMission, checkResolve, acceptGodEvent, resolveGodEvent, godVars } from "../engine/godEvents.js";
import { getGodEvent } from "../data/godEvents.js";
import { renderTemplate } from "../engine/templates.js";
import { pairSummary, moodOf, partyRelationBonus } from "../engine/relations.js";
import { parentNames } from "../engine/children.js";
import { LEVEL_LABELS, STATUS_LABELS } from "../data/relations.js";

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
let peekRunId = null; // 玩家點右側卡片、手動想看的那一場副本 id（只給畫面用，不存檔）
let lastFollowRunId = null; // 上一次鎖定對象所在的副本 id，用來偵測他進／出副本

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
  const ms = (state.runs.length ? CONFIG.roomMs / CONFIG.roomTicks : CONFIG.tickMs) / state.settings.speed; // 有副本在跑時節奏稍快（房間間隔 ÷ 每房時段數）
  timer = setTimeout(() => {
    step(state);
    afterChange();
  }, ms);
}

/** 引擎動過之後一律呼叫：處理事件（自動暫停、結算視窗）、重畫、排下一步 */
function afterChange() {
  // 鎖定的人死了、被回收（不在名單裡了）：自動解除視角鎖定
  if (state.settings.followId != null && !getSamsarite(state, state.settings.followId)) {
    state.settings.followId = null;
    saveGame();
  }
  for (const ev of state.events.splice(0)) {
    if (ev.type === "dayEnd") saveGame();
    if (ev.type === "gameOver") modal = { name: "gameOver" };
    if (state.settings.pauseOn[ev.type]) {
      state.settings.paused = true;
      bannerText = `⏸ 自動暫停：${PAUSE_EVENTS[ev.type].label} —— ${ev.text}`;
    }
  }
  // 副本結算視窗排隊：一次只彈一個，關掉後若還有就接著彈（含重新整理讀檔後還沒看的）。關掉「副本結算」暫停就不彈、清掉佇列
  if (!state.settings.pauseOn.runEnd) state.runReports.length = 0;
  else if (!modal && !state.gameOver && state.runReports.length > 0) {
    state.settings.paused = true;
    modal = { name: "runResult" };
  }
  // 有人許願等回覆：自動暫停並彈窗（包含重新整理讀檔後還沒回覆的）。關掉「許願」暫停就改用 🙏 按鈕手動處理
  if (state.settings.pauseOn.wish && !modal && !state.gameOver && pendingWishes(state).length > 0) {
    state.settings.paused = true;
    modal = { name: "wish", forced: true };
  }
  // 主神搞事等回覆：自動暫停並彈窗。關掉「主神搞事」暫停就改用 👁 按鈕手動處理（不處理的話過期會視同照辦）
  if (state.settings.pauseOn.godEvent && !modal && !state.gameOver && pendingGodEvent(state)) {
    state.settings.paused = true;
    modal = { name: "godEvent", forced: true };
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
  const upkeep = state.samsarites.filter((s) => s.location !== "dungeon").reduce((sum, s) => sum + upkeepOf(s, state), 0);
  $("upkeep").textContent = `-${upkeep} / 天`;
  $("space-level").textContent = `Lv.${state.spaceLevel}`;
  $("karma").textContent = `🔮 ${state.karmaCrystals ?? 0}`;

  $("speed-controls").innerHTML = CONFIG.speeds
    .map((v) => `<button data-action="set-speed" data-value="${v}" class="${v === state.settings.speed ? "active" : ""}">${v}x</button>`)
    .join("");
  document.body.style.setProperty("--speed", state.settings.speed); // 讓小人滑動速度跟著遊戲速度變快
  $("btn-pause").textContent = state.settings.paused ? "▶ 繼續" : "⏸ 暫停";
  $("btn-pause").classList.toggle("active", state.settings.paused);

  $("banner").style.display = state.settings.paused && bannerText ? "block" : "none";
  $("banner").innerHTML = `${bannerText}<button data-action="toggle-pause">▶ 繼續</button>`;

  const waiting = pendingWishes(state).length;
  $("btn-wishes").style.display = waiting > 0 ? "" : "none";
  $("btn-wishes").textContent = `🙏 許願 (${waiting})`;

  const godWaiting = Boolean(pendingGodEvent(state));
  $("btn-god").style.display = godWaiting || activeMission(state) ? "" : "none";
  $("btn-god").textContent = godWaiting ? "👁 主神搞事 (1)" : "🚨 突襲任務";

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
  if (s.location === "pod") return "dorm"; // 催熟艙的嬰兒待在宿舍
  if (s.injury > 0) return Math.random() < 0.8 ? "dorm" : "canteen"; // 受傷的人多半躺在宿舍
  const ids = Object.keys(ROOMS);
  return ids[Math.floor(Math.random() * ids.length)];
}

/** 視角鎖定的人目前所在的那一場副本（沒鎖定或他在家就是 null） */
function followedRun() {
  const id = state.settings.followId;
  return id == null ? null : state.runs.find((r) => r.partyIds.includes(id)) ?? null;
}

/**
 * 主畫面現在要看哪一場副本（null = 主神空間）。
 * 優先順序：玩家點卡片手動看的那場 > 鎖定對象所在的那場。鎖定對象進／出副本時，手動選擇會被清掉，畫面自動跟上。
 */
function viewedRun() {
  const follow = followedRun();
  const followRunId = follow?.id ?? null;
  if (followRunId !== lastFollowRunId) {
    lastFollowRunId = followRunId;
    peekRunId = null;
  }
  const peek = state.runs.find((r) => r.id === peekRunId);
  if (!peek) peekRunId = null;
  return peek ?? follow;
}

function renderStage() {
  // 預設是主神空間；鎖定的人在副本裡、或玩家點了右側卡片時，改顯示那一場副本的路線圖
  const run = viewedRun();
  $("space-map").style.display = run ? "none" : "block";
  $("dungeon-view").style.display = run ? "flex" : "none";
  renderSpace();
  if (run) renderDungeonView(run);
  renderRunList(run);
}

/** 副本路線圖：骨架每場只建一次（這樣小隊的 CSS 滑動才不會被重建打斷），之後只更新節點、位置、隊員 */
function renderDungeonView(run) {
  const view = $("dungeon-view");
  const dungeon = getDungeon(run.dungeonId);
  const n = dungeon.rooms.length;
  const px = (i) => 10 + (i / (n - 1)) * 80; // 節點橫向位置（%）
  if (view.dataset.runId !== String(run.id)) {
    view.dataset.runId = String(run.id);
    view.className = `theme-${dungeon.id}`;
    view.innerHTML = `<h3>${dungeon.icon} ${dungeon.name} <small></small></h3>
      <div class="dungeon-intro">${dungeon.intro ?? ""}</div>
      <div class="route ${n > 6 ? "dense" : ""}">
        <div class="route-line"></div><div class="route-progress"></div>
        ${dungeon.rooms
          .map((r, i) => `<div class="route-node" style="left:${px(i)}%" title="${r.name}">${i + 1}</div><div class="route-node-label" style="left:${px(i)}%;transform:translateX(-50%)">${r.name}</div>`)
          .join("")}
        <div class="route-party"></div>
      </div>
      <div class="dungeon-status"></div>
      <div class="dungeon-back"></div>`;
    view.dataset.party = "";
  }
  const party = run.partyIds.map((id) => getSamsarite(state, id)).filter(Boolean);
  const env = getEnvTag(run.envId);
  view.querySelector("h3 small").textContent = env ? `環境：${env.name}` : "";

  view.querySelectorAll(".route-node").forEach((el, i) => {
    const r = run.results[i];
    el.className = `route-node ${r === true ? "pass" : r === false ? "fail" : i === run.roomIndex ? "current" : ""}`;
  });
  // 小隊位置：第 i 個房間開場時剛好站在第 i 個節點上；走完最後一個節點後停住等結算
  const frac = Math.min(1, Math.max(0, (state.tick - run.startTick) / (CONFIG.roomTicks * (n - 1))));
  view.querySelector(".route-progress").style.width = `${10 + frac * 80}%`;
  view.querySelector(".route-party").style.left = `${10 + frac * 80}%`;

  const partyKey = party.map((s) => `${s.id}:${s.injury}:${s.id === state.settings.followId ? 1 : 0}`).join(",");
  if (view.dataset.party !== partyKey) {
    view.dataset.party = partyKey;
    view.querySelector(".route-party").innerHTML = party
      .map((s) => `<div class="mini">${miniHtml(s, s.id === state.settings.followId ? "👁️" : s.injury > 0 ? "🩹" : "🔦")}</div>`)
      .join("");
  }

  const rate = party.length ? Math.round(roomPassRate(state, party, dungeon, env, 0, run.intel) * 100) : 0;
  const done = Math.min(run.roomIndex, n);
  const roomName = n > 6 && done < n ? `・下一間：${dungeon.rooms[done].name}` : ""; // 房間多時節點下方不放名字，改寫在這裡
  view.querySelector(".dungeon-status").textContent = `已走完 ${done}/${n} 間${roomName}・存活 ${party.length} 人・房間通過率 ${rate}%${party.length ? "" : "（全滅，等時間到結算）"}`;
  const follow = getSamsarite(state, state.settings.followId);
  view.querySelector(".dungeon-back").innerHTML =
    peekRunId != null
      ? `<button data-action="peek-run" data-run-id="${run.id}">⬅ 返回${followedRun() ? "跟隨視角" : "主神空間"}</button>`
      : follow
        ? `<small>👁️ 跟隨中：${follow.name}（到名冊或詳情按 👁 可取消）</small>`
        : "";
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
    const mood = moodOf(state, s); // 有戀人 ❤️、在家有仇人 😡
    const emoji = s.location === "pod" ? "🍼" : s.injury > 0 ? "🩹" : s.locked ? "🔒" : mood === "love" ? "❤️" : mood === "anger" ? "😡" : ROOMS[mini.room].emoji;
    mini.el.querySelector(".mini-emoji").textContent = emoji;
    mini.el.classList.toggle("injured", s.injury > 0);
    mini.el.classList.toggle("followed", s.id === state.settings.followId);
  }
}

/** 進行中副本卡片：每場一張（副本名、環境、5 個房間進度、隊員、目前通過率） */
function renderRunList(viewing = null) {
  const box = $("run-list");
  box.style.display = state.runs.length ? "flex" : "none";
  box.innerHTML = state.runs
    .map((run) => {
      const dungeon = getDungeon(run.dungeonId);
      const party = run.partyIds.map((id) => getSamsarite(state, id)).filter(Boolean);
      const env = getEnvTag(run.envId);
      const nodes = dungeon.rooms
        .map((_, i) => {
          const r = run.results[i];
          const cls = r === true ? "pass" : r === false ? "fail" : i === run.roomIndex ? "current" : "";
          return `<span class="run-node ${cls}">${r === true ? "✓" : r === false ? "✕" : i + 1}</span>`;
        })
        .join("");
      const rate = party.length ? Math.round(roomPassRate(state, party, dungeon, env, 0, run.intel) * 100) : 0;
      const names = party.map((s) => `${s.injury > 0 ? "🩹" : "🔦"}${s.name}`).join("、") || "全滅";
      return `<div class="run-card theme-${dungeon.id} ${viewing?.id === run.id ? "viewing" : ""}" data-action="peek-run" data-run-id="${run.id}" title="點一下在主畫面查看這一場">
        <div class="run-title">${dungeon.icon} <b>${dungeon.name}</b> <small>${env ? env.name : ""}</small></div>
        <div class="run-nodes">${nodes}</div>
        <div class="run-party">${names}</div>
        <small class="run-rate">存活 ${party.length} 人・房間通過率 ${rate}%</small>
      </div>`;
    })
    .join("");
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

/** 心情、休假、許願中的小標示 */
function moodLabel(s) {
  const m = CONFIG.wish.moods[s.mood?.kind];
  return m ? `${m.icon} ${m.label}（${s.mood.daysLeft} 天）` : "";
}

function statusExtras(s) {
  const parts = [];
  if (s.vacationDays > 0) parts.push(`🏖️ 休假中（${s.vacationDays} 天）`);
  const mood = moodLabel(s);
  if (mood) parts.push(mood);
  const wish = wishesOf(state, s.id)[0];
  if (wish) parts.push(`🙏 ${getWish(wish.kind).name}${wish.status === "pending" ? "（等你回覆）" : "（進行中）"}`);
  return parts.length ? `<br /><small>${parts.join("・")}</small>` : "";
}

/** 名冊卡片的位置／傷勢文字：副本中、催熟艙、或在家的傷勢 */
function locationLabel(s) {
  if (s.location === "dungeon") return "🚪 副本中";
  if (s.location === "pod") return `🍼 催熟艙（${s.podDaysLeft} 天）`;
  return injuryLabel(s);
}

function rankBadge(rank) {
  return `<span class="rank rank-${rank}">${rank}</span>`;
}

function tagChips(s) {
  return (s.tags ?? [])
    .map(getTag)
    .filter(Boolean)
    .map((t) => `<span class="tag-chip tag-${t.rarity}" title="${t.desc}">${t.name}</span>`)
    .join("");
}

function renderRoster() {
  if (state.samsarites.length === 0) {
    $("roster").innerHTML = `<div class="empty">你手下一個輪迴者都沒有了。去抽卡吧。</div>`;
    return;
  }
  $("roster").innerHTML = state.samsarites
    .map(
      (s) => `
      <div class="card rank-border-${s.rank} ${s.location === "dungeon" ? "away" : s.location === "pod" ? "pod" : ""}" data-action="open-detail" data-id="${s.id}">
        <div class="card-top">${rankBadge(s.rank)}<span class="grow">${s.name}</span><span>${s.locked ? "🔒" : ""}</span><span class="follow-btn ${s.id === state.settings.followId ? "on" : ""}" data-action="toggle-follow" data-id="${s.id}" title="${s.id === state.settings.followId ? "取消鎖定視角" : "鎖定視角（他下副本時畫面跟著切）"}">👁</span></div>
        <div class="card-meta"><span>⚔️ ${effectivePower(s)}</span><span>🧠 ${s.stats.sanity}</span><span>💸 ${upkeepOf(s, state)}/天</span></div>
        <div class="tags">${tagChips(s)}</div>
        <div class="bar ${s.stats.sanity < 40 ? "low" : ""}" title="理智"><i style="width:${s.stats.sanity}%"></i></div>
        <div class="card-status">${locationLabel(s)}${statusExtras(s)}</div>
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
  const builders = { dispatch, gacha, shop, detail, settings, runResult, gameOver, confirmRecycle, relations, wish, godEvent };
  $("modal").innerHTML = builders[modal.name]();
}

const closeButton = `<button data-action="close-modal">關閉</button>`;

function dispatch() {
  const dungeon = getDungeon(dispatchPick.dungeonId);
  const home = state.samsarites.filter((s) => s.location === "space");
  for (const id of [...dispatchPick.party]) if (!home.some((s) => s.id === id)) dispatchPick.party.delete(id);
  const party = home.filter((s) => dispatchPick.party.has(s.id));
  const injured = party.filter((s) => s.injury > 0);

  const pct = (v) => `${v >= 0 ? "+" : ""}${Math.round(v * 1000) / 10}%`;
  // 尾王守門提示：章節已解鎖、但前 3 關通關次數還不夠
  const gateNote = (d) => {
    const gate = bossGateInfo(state, d);
    return d.chapter <= state.spaceLevel && !gate.open
      ? `<br /><small class="bad">🔒 尾王未開放：本章前 3 關合計通關 ${gate.have}/${gate.need} 次</small>`
      : "";
  };
  // 只列出已解鎖的章節＋下一章（鎖住、預告用），其餘不顯示
  const dungeonOptions = DUNGEONS.filter((d) => d.chapter <= state.spaceLevel + 1).map((d) => {
    const st = state.dungeonStats[d.id] ?? { attempts: 0, clears: 0 };
    const open = isUnlocked(state, d);
    const head = d === DUNGEONS.find((x) => x.chapter === d.chapter) ? `<h4 class="chapter-head">第 ${d.chapter} 章${open ? "" : `（🔒 首通第 ${d.chapter - 1} 章尾王解鎖）`}・${roomCount(d)} 房過 ${roomsToClear(d)}</h4>` : "";
    return `${head}<div class="option ${d.id === dungeon.id ? "selected" : ""} ${open ? "" : "locked"}" style="${open ? "" : "opacity:.45"}" data-action="pick-dungeon" data-id="${d.id}">
      <span class="option-icon">${d.icon}</span>
      <span class="grow"><b>${d.name}</b> <small>${d.genre}${d.boss ? "・👑 尾王" : ""}</small><br /><small>${d.intro}</small>${gateNote(d)}</span>
      <small>推薦戰力 ${d.recommendedPower}<br />獎勵 ${d.reward} 分 ×${rewardTierMult(state, d)}${hasIntel(state, d) ? "" : "（首通 +" + Math.round(d.reward * CONFIG.dungeon.firstClearBonusPct) + "）"}<br />${hasIntel(state, d) ? "🗺️ 已通關" : "❓ 首次開荒"}・情報 ${pct(intelBonus(state, d))}・通關 ${st.clears}/${st.attempts}</small>
    </div>`;
  }).join("");

  const memberOptions = home.length
    ? home
        .map(
          (s) => `<div class="option ${dispatchPick.party.has(s.id) ? "selected" : ""}" data-action="toggle-member" data-id="${s.id}">
            ${rankBadge(s.rank)}<span class="grow">${s.name} ${s.locked ? "🔒" : ""}</span>
            <small>戰力 ${effectivePower(s)}・${injuryLabel(s)}${s.vacationDays > 0 ? "・🏖️ 休假中" : ""}${s.mood ? "・" + moodLabel(s) : ""}</small>
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
      每個房間通過率 <b>${rate}%</b>（含情報 ${pct(intelBonus(state, dungeon))}），${roomCount(dungeon)} 個房間通過 ${roomsToClear(dungeon)} 個以上才算通關（約 ${(roomCount(dungeon) * CONFIG.roomTicks) / CONFIG.ticksPerDay} 天）<br />
      預估通關率 <b class="${cls}">${chance}%</b>（進副本時才會抽環境標籤，實際會再浮動）`;
    const relBonus = Math.round(partyRelationBonus(state, party) * 100);
    if (relBonus !== 0) {
      summary += `<br />隊員關係加成 <b class="${relBonus > 0 ? "good" : "bad"}">${relBonus > 0 ? "+" : ""}${relBonus}%</b>（已含在每房間通過率）`;
    }
    const enemyPairs = [];
    for (let i = 0; i < party.length; i++) {
      for (let j = i + 1; j < party.length; j++) if (areEnemies(state, party[i], party[j])) enemyPairs.push(`${party[i].name} × ${party[j].name}`);
    }
    if (enemyPairs.length > 0) {
      summary += `<br /><span class="bad">⚔️ 隊內有仇人：${enemyPairs.join("、")}（每個房間有機率先打起來）</span>`;
    }
    if (!hasIntel(state, dungeon)) {
      summary += `<br /><span class="warn">❓ 首次開荒：傷勢更重；首通有額外 ${Math.round(dungeon.reward * CONFIG.dungeon.firstClearBonusPct)} 分${dungeon.specialRewards?.length ? "與特殊獎勵" : ""}${dungeon.boss ? (dungeon.chapter >= CONFIG.space.maxLevel ? "，並完成主線" : "，並讓主神空間升級、解鎖下一章") : ""}。</span>`;
    }
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
  const pools = gachaInfo(state)
    .map((info) => {
      const p = info.pool;
      const odds = ["C", "B", "A", "S"]
        .filter((r) => p.odds[r] > 0)
        .map((r) => `${p.odds[r]}% ${r}`)
        .join("、");
      const pity = p.pity ? `・保底：第 ${p.pity.every} 抽必出 ${p.pity.minRank} 以上（目前 ${info.pity}/${p.pity.every - 1}）` : "・無保底";
      const price = `${info.cost} 分${p.crystal ? ` + ${p.crystal} 顆結晶` : ""}`;
      const locked = (state.spaceLevel ?? 1) < p.spaceLevel;
      return `<div class="option">
        <span class="grow"><b>${p.name}</b><br /><small>${odds}${pity}・本週已抽 ${info.pulls} 次（每抽 +${p.step} 分）</small>${
          locked ? `<br /><small class="bad">🔒 ${info.reason}</small>` : ""
        }</span>
        <button class="primary" data-action="pull" data-id="${p.id}" ${info.ok ? "" : "disabled"} ${info.ok || locked ? "" : `title="${info.reason}"`}>抽一次（${price}）</button>
      </div>`;
    })
    .join("");
  const last = modal.lastId ? getSamsarite(state, modal.lastId) : null;
  const result = last
    ? `<div class="summary gacha-result" style="--rank-color:var(--rank-${last.rank})">${rankBadge(last.rank)}
        <b>${last.name}</b>戰力 ${last.stats.power}・維持費 ${upkeepOf(last, state)} / 天</div>`
    : "";
  const debtNote = state.points < 0 ? `<span class="bad">（負債中）</span>` : "";
  return `<h3>🎴 抽卡</h3>
    <p>目前積分：<b>${state.points}</b> ${debtNote}。積分不夠時可以向主神借，最多借到 ${debtLimitOf(state)} 分。
      持有因果結晶：<b>${state.karmaCrystals ?? 0}</b> 顆（神級池每抽消耗 1 顆）。每 ${CONFIG.gacha.resetDays} 天重置「本週抽數」與漲價；保底計數不會重置。</p>
    <div class="option-list">${pools}</div>${result}
    <div class="modal-actions">${closeButton}</div>`;
}

/** 商店：選人 → 買東西。Tier 還沒解鎖的商品會灰掉並顯示解鎖條件 */
function shop() {
  const tier = shopTier(state);
  const next = nextTierInfo(state);
  const home = state.samsarites.filter((s) => s.location === "space");
  if (!home.some((s) => s.id === modal.targetId)) modal.targetId = home[0]?.id ?? null;
  const target = getSamsarite(state, modal.targetId);

  const people = home.length
    ? home
        .map((s) => `<div class="option ${s.id === modal.targetId ? "selected" : ""}" data-action="shop-target" data-id="${s.id}">
          ${rankBadge(s.rank)}<span class="grow">${s.name}</span>
          <small>戰力 ${effectivePower(s)}・${injuryLabel(s)}・理智 ${s.stats.sanity}</small></div>`)
        .join("")
    : `<div class="empty">主神空間裡沒有人可以用。</div>`;

  const gearLine = target
    ? Object.entries(SHOP_SLOT_LABELS)
        .map(([slot, label]) => `${label}：${getShopItem(target.gear?.[slot])?.name ?? "（空）"}`)
        .join("・")
    : "";

  const itemRow = (item) => {
    const locked = item.tier > tier;
    const check = locked ? { ok: false, reason: "" } : checkBuy(state, item, target);
    const owned = "";
    const slot = item.kind === "gear" ? `・${SHOP_SLOT_LABELS[item.slot]}` : "";
    const why = !locked && !check.ok ? `<br /><small class="bad">${check.reason}</small>` : "";
    return `<div class="option ${locked ? "locked" : ""}" style="${locked ? "opacity:.45" : ""}">
      <span class="option-icon">${item.icon}</span>
      <span class="grow"><b>${item.name}</b> <small>${SHOP_KIND_LABELS[item.kind]}${slot}${owned}</small><br /><small>${item.desc}</small>${why}</span>
      <button class="primary" data-action="buy" data-id="${item.id}" ${check.ok ? "" : "disabled"}>${locked ? "🔒" : item.price + " 分"}</button>
    </div>`;
  };
  const sections = CONFIG.shopTierUnlock.map((_, i) => i + 1)
    .map((t) => {
      const need = CONFIG.shopTierUnlock[t - 1];
      const head = t <= tier ? `Tier ${t}` : `🔒 Tier ${t}（累積花費 ${need} 分解鎖）`;
      return `<h3 style="margin-top:14px">${head}</h3><div class="option-list">${SHOP_ITEMS.filter((i) => i.tier === t).map(itemRow).join("")}</div>`;
    })
    .join("");

  const fx = collectionEffects(state);
  const collection = state.collection.length
    ? state.collection
        .map(getSpecialReward)
        .filter(Boolean)
        .map((r) => `<div>🎁 <b>${r.name}</b>：${r.desc}</div>`)
        .join("")
    : "（還沒有。首次通關副本會掉特殊獎勵，永久生效。）";
  const progress = next
    ? `累積花費 <b>${state.totalSpent}</b> 分，再花 <b>${next.remaining}</b> 分解鎖 Tier ${next.tier}`
    : `累積花費 <b>${state.totalSpent}</b> 分，商店已全部解鎖`;
  const shield = Math.round(fx.injuryShield * 100);
  return `<h3>🛒 商店 <small>（目前 Tier ${tier}）</small></h3>
    <p>積分：<b>${state.points}</b>。${progress}。抽卡的花費也算累積花費。</p>
    <h3 style="margin-top:10px">要給誰用？${target ? `<small>（${gearLine}）</small>` : ""}</h3>
    <div class="option-list">${people}</div>
    ${sections}
    <h3 style="margin-top:14px">🎁 副本特殊獎勵（永久生效）</h3>
    <div class="summary">${collection}${shield ? `<div><small>全員傷勢減免合計 +${shield}%</small></div>` : ""}</div>
    <div class="modal-actions">${closeButton}</div>`;
}

function detail() {
  const s = getSamsarite(state, modal.id);
  if (!s) return `<h3>查無此人</h3><p>這個人已經不在了。</p><div class="modal-actions">${closeButton}</div>`;
  const home = s.location === "space";
  const gene = geneTierOf(s);
  const gain = enhanceGain(s);
  const enh = checkEnhance(state, s.id);
  const brk = checkBreakGene(state, s.id);
  return `<h3>${rankBadge(s.rank)} ${s.name}</h3>
    <table class="stats">
      <tr><td>狀態</td><td>${s.location === "pod" ? `🍼 催熟艙（還要 ${s.podDaysLeft} 天）` : `${home ? "主神空間" : "副本中"}・${injuryLabel(s)}`}</td></tr>
      ${s.parents ? `<tr><td>家長</td><td>${parentNames(state, s).join("、") || "（已不在世）"}${s.inheritedTags?.length ? `<br /><small>繼承標籤：${s.inheritedTags.map((id) => getTag(id)?.name ?? id).join("、")}</small>` : ""}</td></tr>` : ""}
      ${s.mood || s.vacationDays > 0 || wishesOf(state, s.id).length ? `<tr><td>心情／許願</td><td>${statusExtras(s).replace("<br />", "")}</td></tr>` : ""}
      <tr><td>生命</td><td>${subStat(s, "hp")}（超過 100 的部分幫助養傷；≥ ${CONFIG.combat.hpHalfPenalty} 傷勢戰力懲罰減半）</td></tr>
      <tr><td>戰力</td><td>${effectivePower(s)}（本體 ${s.stats.power + (s.inheritPower ?? 0)} × 基因鎖 ×${gene.powerMult}，再加裝備白值、乘標籤與心情）</td></tr>
      <tr><td>基因鎖</td><td>第 ${s.geneLock ?? 0} 階【${gene.name}】・${s.rank} 級最高第 ${maxGeneOf(s)} 階</td></tr>
      <tr><td>強化</td><td>${s.enhanceCount ?? 0}/${enhanceCapOf(s)} 次・成長倍率 ×${RANKS[s.rank].growthMult}<br /><small>每次：戰力 +${gain.power}、生命 +${gain.hp}、防禦／速度／運氣各 +${gain.defense}</small></td></tr>
      <tr><td>頓悟</td><td>${s.insightCount ?? 0}/${insightCapOf(s)} 次<br /><small>副本通關時每位存活隊員 ${Math.round(CONFIG.insight.chance * 100)}% 機率頓悟（戰力 +${Math.round(CONFIG.insight.gainPower * RANKS[s.rank].growthMult)}、再隨機一項副屬性）</small></td></tr>
      <tr><td>防禦</td><td>${subStat(s, "defense")}（受傷時 ${Math.round(defenseChance(s) * 100)}% 機率少 1 級）</td></tr>
      <tr><td>速度</td><td>${subStat(s, "speed")}（副本戰死時 ${Math.round(speedSaveChance(s) * 100)}% 機率鎖血改致命傷）</td></tr>
      <tr><td>理智</td><td>${s.stats.sanity}</td></tr>
      <tr><td>運氣</td><td>${subStat(s, "luck")}（每點 +${CONFIG.combat.luckReward.perPoint * 100}% 通關積分，看隊伍平均）</td></tr>
      <tr><td>維持費</td><td>${upkeepOf(s, state)} 分 / 天${s.location === "pod" ? "（催熟艙固定費用）" : `（基礎 ${upkeepBaseOf(state)} ×（1 + 階級 ${Math.round(RANKS[s.rank].upkeepPct * 100)}% + 傷勢 ${Math.round(INJURIES[s.injury].upkeepPct * 100)}%））`}</td></tr>
      <tr><td>資歷</td><td>第 ${s.joinedDay} 天加入・出征 ${s.runs} 次</td></tr>
      <tr><td>裝備</td><td>${Object.entries(SHOP_SLOT_LABELS).map(([slot, label]) => `${label}：${getShopItem(s.gear?.[slot])?.name ?? "（空）"}`).join("・")}</td></tr>
      <tr><td>標籤</td><td>${(s.tags ?? [])
        .map(getTag)
        .filter(Boolean)
        .map((t) => `<div><span class="tag-chip tag-${t.rarity}">${t.rarity}・${t.name}</span> <small>${t.desc}${t.pending ? `<br /><i>（${t.pending}）</i>` : ""}</small></div>`)
        .join("")}</td></tr>
    </table>
    <h3 style="margin-top:12px">💞 人際關係</h3>
    <div class="rel-list">${relationRows(s)}</div>
    <p style="margin-top:12px"><small>💪 強化：${enh.ok ? `可以強化（${enh.cost} 分）` : enh.reason}<br />🧬 基因鎖：${brk.ok ? `可以突破到第 ${brk.next} 階（${brk.cost} 分）` : brk.reason}</small></p>
    <div class="modal-actions">
      <button class="primary" data-action="enhance" data-id="${s.id}" ${enh.ok ? "" : "disabled"} title="${enh.ok ? "" : enh.reason}">💪 強化${enh.cost ? `（${enh.cost} 分）` : ""}</button>
      <button class="primary" data-action="break-gene" data-id="${s.id}" ${brk.ok ? "" : "disabled"} title="${brk.ok ? "" : brk.reason}">🧬 突破基因鎖${brk.cost ? `（${brk.cost} 分）` : ""}</button>
    </div>
    <div class="modal-actions">
      <button class="danger" data-action="ask-recycle" data-id="${s.id}" ${home ? "" : "disabled"}>♻️ 推進回收爐（+${CONFIG.recycle.points} 分）</button>
      <button data-action="toggle-follow" data-id="${s.id}">${s.id === state.settings.followId ? "👁️ 取消鎖定視角" : "👁 鎖定視角"}</button>
      <button data-action="toggle-lock" data-id="${s.id}">${s.locked ? "🔓 解除鎖定" : "🔒 鎖定（不參與自動派遣）"}</button>
      ${closeButton}
    </div>`;
}

/** 一對關係的文字：等級／狀態、雙向好感、雙向仇恨 */
function relationLine(a, b) {
  const p = pairSummary(state, a, b);
  const label = p.status ? STATUS_LABELS[p.status] : LEVEL_LABELS[p.level];
  const nums = [];
  if (p.loveAB || p.loveBA) nums.push(`好感 ${p.loveAB}／${p.loveBA}`);
  if (p.hateAB || p.hateBA) nums.push(`恨意 ${p.hateAB}／${p.hateBA}`);
  const revenge = p.revenge ? ` <span class="bad">🩸 復仇鎖定</span>` : "";
  return { p, html: `<span class="rel-label">${label}</span>${nums.join("・")}${revenge}` };
}

function relationRows(s) {
  const rows = state.samsarites
    .filter((o) => o.id !== s.id)
    .map((o) => ({ o, ...relationLine(s, o) }))
    .filter(({ p }) => p.level !== "neutral" || p.status || p.loveAB + p.loveBA + p.hateAB + p.hateBA >= 10);
  if (rows.length === 0) return `<div class="empty">還沒有什麼交情或恩怨。</div>`;
  return rows
    .sort((x, y) => relationRank(y.p) - relationRank(x.p))
    .map(({ o, html }) => `<div class="rel-row"><b>${o.name}</b>${html}<small>（我→他／他→我）</small></div>`)
    .join("");
}

const relationRank = (p) => (p.status ? 100 : 0) + Math.max(p.loveAB, p.loveBA, p.hateAB, p.hateBA);

/** 關係總覽：所有有交情或恩怨的配對 */
function relations() {
  const list = state.samsarites;
  const pairs = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const { p, html } = relationLine(list[i], list[j]);
      if (p.level === "neutral" && !p.status && p.loveAB + p.loveBA + p.hateAB + p.hateBA < 10) continue;
      pairs.push({ a: list[i], b: list[j], p, html });
    }
  }
  pairs.sort((x, y) => relationRank(y.p) - relationRank(x.p));
  const body = pairs.length
    ? pairs.map(({ a, b, html }) => `<div class="rel-row"><b>${a.name}</b> ↔ <b>${b.name}</b>${html}</div>`).join("")
    : `<div class="empty">大家還不熟。等他們在主神空間待久一點，八卦就來了。</div>`;
  const bonus = Object.entries(CONFIG.relations.passBonus)
    .map(([k, v]) => `${LEVEL_LABELS[k]} ${v > 0 ? "+" : ""}${Math.round(v * 100)}%`)
    .join("・");
  return `<h3>💞 關係總覽</h3>
    <p><small>一起出戰的單房通過率：${bonus}（上限 ±${Math.round(CONFIG.relations.bonusCap * 100)}%）。數字是「甲→乙／乙→甲」的好感與仇恨。</small></p>
    <div class="rel-list">${body}</div>
    <div class="modal-actions">${closeButton}</div>`;
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
    ? state.graveyard.map((g) => `<div>第 ${g.day} 天・${rankBadge(g.rank)} ${g.name}・${g.cause}${g.killer ? `（兇手：${g.killer}）` : ""}</div>`).join("")
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
  const r = state.runReports[0];
  if (!r) return `<h3>副本結算</h3><p>沒有待看的結算。</p><div class="modal-actions">${closeButton}</div>`;
  const waiting = state.runReports.length - 1;
  const rooms = r.results.map((ok) => (ok ? "✅" : "❌")).join(" ");
  const survivors = r.survivors.length
    ? r.survivors.map((s) => `${s.name}（${INJURIES[s.injury].name}）`).join("、")
    : "無";
  return `<h3>${r.success ? "🏆 通關" : "💀 失敗"}：${r.dungeonName}</h3>
    <div class="summary">
      <span class="result-rooms">${rooms}</span><br />房間通過 ${r.passedCount}/${r.rooms ?? r.results.length}<br />
      ${r.envName ? `環境：${r.envName}<br />` : ""}獎勵：<b class="${r.success ? "good" : "bad"}">+${r.reward} 分</b>${r.firstClear ? "（含首通加成）" : ""}<br />
      ${r.levelUp ? `🏛️ <b class="good">主神空間升到 Lv.${r.levelUp}，第 ${r.levelUp} 章解鎖！</b><br />` : ""}
      ${r.specialReward ? `🎁 特殊獎勵：<b class="good">${r.specialReward}</b>（已永久生效）<br />` : ""}
      ${r.karma ? `🔮 因果結晶 <b class="good">+${r.karma}</b> 顆（持有 ${state.karmaCrystals ?? 0} 顆）<br />` : ""}
      ${r.insights?.length ? `💡 頓悟：<b class="good">${r.insights.map((i) => `${i.name}（戰力 +${i.power}）`).join("、")}</b><br />` : ""}
      生還：${survivors}<br />
      死亡：<span class="${r.deaths.length ? "bad" : ""}">${r.deaths.length ? r.deaths.join("、") : "無"}</span>
      ${waiting > 0 ? `<br /><small>還有 ${waiting} 場副本結算排隊中</small>` : ""}
    </div>
    <div class="modal-actions"><button class="primary" data-action="close-run-report">${waiting > 0 ? "下一場" : "知道了"}</button></div>`;
}

function wish() {
  const list = pendingWishes(state);
  const w = list[0];
  if (!w) return `<h3>🙏 許願</h3><p>目前沒有等你回覆的許願。</p><div class="modal-actions">${closeButton}</div>`;
  const s = getSamsarite(state, w.samsariteId);
  const def = getWish(w.kind);
  const vars = wishVars(state, w);
  const check = checkAccept(state, w);
  const left = w.deadlineDay - currentDay(state);
  const mh = CONFIG.wish.moods.happy;
  const mu = CONFIG.wish.moods.upset;
  return `<h3>${def.icon} ${s.name} 的願望：${def.name}</h3>
    <p>${w.text}</p>
    <div class="summary">
      ${renderTemplate(def.costDesc, vars)}<br />
      完成條件：${renderTemplate(def.doneDesc, vars)}<br />
      期限：第 ${w.deadlineDay} 天前（還剩 ${left} 天，超時算失敗）<br />
      <span class="good">完成 → ${mh.icon} ${mh.label} ${mh.days} 天（隊伍通過率 +${Math.round(mh.passBonus * 100)}%／人）</span><br />
      <span class="bad">拒絕或超時 → ${mu.icon} ${mu.label} ${mu.days} 天（戰力 ${Math.round(mu.powerPct * 100)}%、理智 -${mu.sanityLoss}）</span>
      ${check.ok ? "" : `<br /><span class="bad">現在答應不了：${check.reason}</span>`}
      ${list.length > 1 ? `<br /><small>還有 ${list.length - 1} 個許願排隊中</small>` : ""}
    </div>
    <div class="modal-actions">
      <button class="danger" data-action="refuse-wish" data-id="${w.id}">拒絕</button>
      <button class="primary" data-action="accept-wish" data-id="${w.id}" ${check.ok ? "" : "disabled"}>答應</button>
      ${modal.forced ? "" : closeButton}
    </div>`;
}

function godEvent() {
  const ev = pendingGodEvent(state);
  if (!ev) {
    const m = activeMission(state);
    if (!m) return `<h3>👁 主神搞事</h3><p>主神暫時沒有新花樣。</p><div class="modal-actions">${closeButton}</div>`;
    const s = getSamsarite(state, m.samsariteId);
    return `<h3>🚨 突襲任務進行中</h3>
      <div class="summary">
        對象：${s.name}<br />
        目標：通關「${getDungeon(m.dungeonId).name}」<br />
        期限：第 ${m.deadlineDay} 天前（還剩 ${m.deadlineDay - currentDay(state)} 天）<br />
        <span class="good">完成 → +${m.reward} 分，${s.name} 高興</span><br />
        <span class="bad">逾期 → 扣 ${CONFIG.godEvent.kinds.raid.penaltyPoints} 分，${s.name} 不爽</span>
      </div>
      <div class="modal-actions">${closeButton}</div>`;
  }
  const def = getGodEvent(ev.kind);
  const vars = godVars(state, ev);
  const check = checkResolve(state);
  const left = ev.deadlineDay - currentDay(state);
  return `<h3>${def.icon} 主神搞事：${def.name}</h3>
    <p>${ev.text}</p>
    <div class="summary">
      ${renderTemplate(def.acceptDesc, vars)}<br />
      ${renderTemplate(def.payDesc, vars)}<br />
      <span class="bad">${left} 天內沒回覆 → ${renderTemplate(def.ignoreDesc, vars)}</span>
      ${check.ok ? "" : `<br /><span class="bad">現在花不起積分化解：${check.reason}</span>`}
    </div>
    <div class="modal-actions">
      <button class="danger" data-action="accept-god">${ev.mode === "raid" ? "接下任務" : "照辦"}</button>
      <button class="primary" data-action="resolve-god" ${check.ok ? "" : "disabled"}>花 ${vars.cost} 分化解</button>
      ${modal.forced ? "" : closeButton}
    </div>`;
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
    modal = { name: "dispatch" };
  },
  "open-gacha"() {
    modal = { name: "gacha" };
  },
  "open-shop"() {
    modal = { name: "shop", targetId: modal?.targetId ?? null };
  },
  "shop-target"(el) {
    modal.targetId = Number(el.dataset.id);
  },
  buy(el) {
    const result = buyItem(state, el.dataset.id, modal.targetId);
    if (!result.ok) alert(result.reason);
    saveGame();
  },
  "open-wishes"() {
    modal = { name: "wish", forced: false };
  },
  "accept-wish"(el) {
    const result = acceptWish(state, Number(el.dataset.id));
    if (!result.ok) alert(result.reason);
    if (pendingWishes(state).length === 0) modal = null;
    saveGame();
  },
  "refuse-wish"(el) {
    refuseWish(state, Number(el.dataset.id));
    if (pendingWishes(state).length === 0) modal = null;
    saveGame();
  },
  "open-god"() {
    modal = { name: "godEvent", forced: false };
  },
  "accept-god"() {
    const result = acceptGodEvent(state);
    if (!result.ok) alert(result.reason);
    modal = null;
    saveGame();
  },
  "resolve-god"() {
    const result = resolveGodEvent(state);
    if (!result.ok) alert(result.reason);
    else modal = null;
    saveGame();
  },
  "open-settings"() {
    modal = { name: "settings" };
  },
  "open-relations"() {
    modal = { name: "relations" };
  },
  "open-detail"(el) {
    modal = { name: "detail", id: Number(el.dataset.id) };
  },
  "close-modal"() {
    modal = null;
  },
  "close-run-report"() {
    state.runReports.shift();
    modal = null; // afterChange 會自動接著彈下一場
  },
  "pick-dungeon"(el) {
    if (!isUnlocked(state, getDungeon(el.dataset.id))) return; // 還沒解鎖的章節只能看不能選
    dispatchPick.dungeonId = el.dataset.id;
  },
  "toggle-member"(el) {
    const id = Number(el.dataset.id);
    if (getSamsarite(state, id)?.vacationDays > 0) return; // 放假中不能派
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
  enhance(el) {
    const r = enhanceSamsarite(state, Number(el.dataset.id));
    if (!r.ok) alert(r.reason);
    saveGame();
  },
  "break-gene"(el) {
    const r = breakSamsariteGene(state, Number(el.dataset.id));
    if (!r.ok) alert(r.reason);
    saveGame();
  },
  "toggle-lock"(el) {
    const s = getSamsarite(state, Number(el.dataset.id));
    if (s) s.locked = !s.locked;
  },
  "toggle-follow"(el) {
    // 同時只能鎖定一個人；再按一次同一個人 = 取消
    const id = Number(el.dataset.id);
    state.settings.followId = state.settings.followId === id ? null : id;
    peekRunId = null;
    saveGame();
  },
  "peek-run"(el) {
    const id = Number(el.dataset.runId);
    peekRunId = peekRunId === id ? null : id;
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
  if (event.target.id === "modal-backdrop" && modal?.name !== "gameOver" && !modal?.forced) return closeModal();
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
