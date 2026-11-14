// 畫面層：只負責「把 state 畫出來」跟「把玩家的點擊轉成引擎呼叫」。
// 所有遊戲規則都在 src/engine/，這裡不做任何數值計算以外的決定。

import { CONFIG, RANKS, INJURIES, PAUSE_EVENTS } from "../data/config.js";
import { DUNGEONS, getDungeon } from "../data/dungeons.js";
import {
  createNewGame,
  currentDay,
  getSamsarite,
  upkeepOf,
  upkeepPartsOf,
  debtLimitOf,
  canAfford,
  pullGacha,
  gachaInfo,
  recycle,
  serialize,
  deserialize,
} from "../engine/core.js";
import { roomPassRate, clearChance, chanceAtLeast, partyPower, startRun, hasIntel, rewardTierMult, intelBonus, isUnlocked, bossGateInfo, roomCount, roomsToClear, dungeonOfRun } from "../engine/dungeon.js";
import { boardTargets, boardOf } from "../engine/board.js";
import { marketInfo, manualRefresh, lockSlot, buyMarketSlot, checkMarketBuy, intelFull } from "../engine/market.js";
import { relicInfo } from "../engine/relics.js";
import { setTaxRate, taxRateOf } from "../engine/wallet.js";
import { steleBonusOf } from "../engine/memorial.js";
import { MANDATORY_ID, pendingMandatory, buildMandatoryDungeon } from "../engine/mandatory.js";
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
import { shopTier, nextTierInfo, checkBuy, buyItem, collectionEffects, shopItemsOfTier } from "../engine/shop.js";
import { SHOP_KIND_LABELS, SHOP_CATEGORY_LABELS, SHOP_SLOT_LABELS, getShopItem } from "../data/shopItems.js";
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
const dispatchPick = { dungeonId: null, slotId: null, party: new Set(), greedy: false }; // slotId：任務榜的槽（尾王／指定任務／強制任務為 null）
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
  // 新局第 1 天首次進入：自動彈出上崗手冊（讀過就記住，不重複打擾）
  if (!state.settings.guideSeen && !modal && !state.gameOver && currentDay(state) <= 1 && state.log.length <= 2) {
    state.settings.guideSeen = true;
    modal = { name: "guide" };
    saveGame();
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
  $("btn-guide").classList.toggle("pulse", !state.settings.guideSeen);
  $("tax-rate").textContent = `${Math.round(taxRateOf(state) * 100)}%`;
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
  const steleTotal = Math.round(steleBonusOf(state) * 100);
  $("btn-stele").textContent = `🪦 英靈碑${steleTotal > 0 ? ` +${steleTotal}%` : ""}`;
  const mand = pendingMandatory(state);
  $("btn-mandatory").style.display = mand ? "" : "none";
  if (mand) $("btn-mandatory").textContent = `☠️ 強制任務（第 ${mand.deadlineDay} 天前）`;
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
  const dungeon = dungeonOfRun(run);
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
      const dungeon = dungeonOfRun(run);
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

/** 需要警告的人：重傷以上，或理智低於 30（帶出去戰力大減、極易戰死） */
const isRisky = (s) => s.injury >= 2 || (s.stats.sanity ?? 100) < 30;

/** 風險警告文案（list 裡有人危險才顯示） */
function riskWarning(list) {
  const risky = list.filter(isRisky);
  if (risky.length === 0) return "";
  return `<div class="risk-warning">⚠️ <b>${risky.map((s) => `${s.name}（${s.injury >= 2 ? INJURIES[s.injury].name : ""}${s.injury >= 2 && s.stats.sanity < 30 ? "＋" : ""}${s.stats.sanity < 30 ? `理智 ${s.stats.sanity}` : ""}）`).join("、")}</b>
    帶重傷（戰力 -20%／-40%）或低理智（戰力 -25%、隊內更容易內鬥）出征，會大幅折損戰力、極易陣亡（帶傷被打中還有直接死亡機率）。<b>拒絕或讓他輪休養傷、吃藥才是安全做法。</b></div>`;
}

/** 隊員迷你狀態摘要（折疊區）：姓名、戰力、傷勢、理智；危險的人標紅 */
function statusPanel(list, title = "👥 目前在空間的隊員狀態") {
  if (list.length === 0) return "";
  const rows = list
    .map((s) => `<div class="status-row ${isRisky(s) ? "risky" : ""}">${rankBadge(s.rank)}<span class="grow">${s.name}${isRisky(s) ? " ⚠️" : ""}</span><span>⚔️ ${effectivePower(s)}</span><span>${injuryLabel(s)}</span><span>🧠 ${s.stats.sanity}</span></div>`)
    .join("");
  return `<details class="status-panel" ${list.some(isRisky) ? "open" : ""}><summary>${title}</summary>${rows}</details>${riskWarning(list)}`;
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
        <div class="card-meta"><span>⚔️ ${effectivePower(s)}</span><span>🧠 ${s.stats.sanity}</span><span>💸 ${upkeepOf(s, state)}/天</span><span title="私房錢">💰 ${s.wallet ?? 0}</span></div>
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
  const builders = { guide, dispatch, gacha, shop, detail, stele, settings, runResult, gameOver, confirmRecycle, relations, wish, godEvent };
  $("modal").innerHTML = builders[modal.name]();
}

const closeButton = `<button data-action="close-modal">關閉</button>`;

/** 派遣用的副本定義：強制任務是動態副本（依當下名冊算 R），其他查資料表 */
function dungeonById(id) {
  return id === MANDATORY_ID ? buildMandatoryDungeon(state) : getDungeon(id);
}

/** 主神突襲任務、許願「想去副本」指定的副本：不在任務榜上也要能派（不附突變詞綴） */
function requestedDungeonIds() {
  const ids = new Set();
  const m = activeMission(state);
  if (m?.dungeonId) ids.add(m.dungeonId);
  for (const w of state.wishes ?? []) if (w.mode === "dungeon" && w.status === "active" && w.params?.dungeonId) ids.add(w.params.dungeonId);
  return [...ids];
}

function dispatch() {
  const mand = pendingMandatory(state);
  const targets = boardTargets(state); // 任務榜三個槽：{ slot, dungeon（已套 R 倍率）, mutation }
  const bosses = DUNGEONS.filter((d) => d.boss && d.chapter <= state.spaceLevel + 1);
  const extraIds = requestedDungeonIds().filter((id) => !targets.some((t) => t.slot.dungeonId === id));

  // 選擇狀態：強制任務／任務榜槽（slotId）／尾王與指定副本（slotId = null）。目標消失就重選
  let pickedTarget = dispatchPick.slotId != null ? targets.find((t) => t.slot.id === dispatchPick.slotId && !t.slot.running) : null;
  if (dispatchPick.dungeonId === MANDATORY_ID && !mand) dispatchPick.dungeonId = null;
  if (dispatchPick.slotId != null && !pickedTarget) dispatchPick.slotId = dispatchPick.dungeonId = null;
  if (!dispatchPick.dungeonId) {
    const first = targets.find((t) => !t.slot.running);
    if (first) Object.assign(dispatchPick, { dungeonId: first.slot.dungeonId, slotId: first.slot.id });
    else Object.assign(dispatchPick, { dungeonId: bosses.find((d) => isUnlocked(state, d))?.id ?? DUNGEONS[0].id, slotId: null });
    pickedTarget = dispatchPick.slotId != null ? targets.find((t) => t.slot.id === dispatchPick.slotId) : null;
  }
  const isMand = dispatchPick.dungeonId === MANDATORY_ID;
  const mutation = pickedTarget?.mutation ?? null;
  const dungeon = pickedTarget ? pickedTarget.dungeon : dungeonById(dispatchPick.dungeonId);
  const canGreedy = !isMand && intelFull(state, dungeon.id);
  if (!canGreedy) dispatchPick.greedy = false;

  const home = state.samsarites.filter((s) => s.location === "space");
  for (const id of [...dispatchPick.party]) if (!home.some((s) => s.id === id)) dispatchPick.party.delete(id);
  const party = home.filter((s) => dispatchPick.party.has(s.id));
  const injured = party.filter((s) => s.injury > 0);

  const pct = (v) => `${v >= 0 ? "+" : ""}${Math.round(v * 1000) / 10}%`;
  // 尾王守門提示：章節已解鎖、但該章常規關通關次數還不夠
  const gateNote = (d) => {
    const gate = bossGateInfo(state, d);
    return d.chapter <= state.spaceLevel && !gate.open
      ? `<br /><small class="bad">🔒 尾王未開放：本章任一常規關合計通關 ${gate.have}/${gate.need} 次</small>`
      : "";
  };
  const statLine = (d, mut) => {
    const st = state.dungeonStats[d.id] ?? { attempts: 0, clears: 0 };
    const rewardPct = mut?.rewardPct ?? 0;
    return `推薦戰力 ${d.recommendedPower}<br />獎勵 ${Math.round(d.reward * (1 + rewardPct))} 分 ×${rewardTierMult(state, d)}${hasIntel(state, d) ? "" : "（首通 +" + Math.round(d.reward * CONFIG.dungeon.firstClearBonusPct) + "）"}<br />${hasIntel(state, d) ? "🗺️ 已通關" : "❓ 首次開荒"}・情報 ${pct(intelBonus(state, d))}${intelFull(state, d.id) ? "（滿格✨）" : ""}・通關 ${st.clears}/${st.attempts}`;
  };
  const mutChip = (mut) => (mut ? `<span class="mut-chip ${mut.id}" title="${mut.desc}">${mut.icon} ${mut.name}</span>` : "");

  const mandatoryOption = mand
    ? `<h4 class="chapter-head">☠️ 主神強制任務（限時，不能化解）</h4><div class="option ${isMand ? "selected" : ""}" data-action="pick-dungeon" data-id="${MANDATORY_ID}">
      <span class="option-icon">${dungeonById(MANDATORY_ID).icon}</span>
      <span class="grow"><b>${dungeonById(MANDATORY_ID).name}</b> <small class="bad">第 ${mand.deadlineDay} 天前要派隊，逾時主神隨機抹殺 ${CONFIG.forcedMission.purgeMin}～${CONFIG.forcedMission.purgeMax} 人、全員理智 -${CONFIG.forcedMission.purgeSanityLoss}</small><br /><small>${dungeonById(MANDATORY_ID).intro}</small></span>
      <small>推薦戰力 ${dungeonById(MANDATORY_ID).recommendedPower}<br />獎勵 ${dungeonById(MANDATORY_ID).reward} 分（每戰死 1 人 +${Math.round(CONFIG.forcedMission.deathRewardPct * 100)}%）<br />${roomCount(dungeonById(MANDATORY_ID))} 房過 ${roomsToClear(dungeonById(MANDATORY_ID))}・單房上限 ${Math.round(CONFIG.forcedMission.passCap * 100)}%</small>
    </div>
    ${statusPanel(home, "☠️ 可出征隊員狀態（強制任務不能化解，但帶重傷出去更容易死）")}`
    : "";

  const daysToRotate = Math.max(0, boardOf(state).nextRotateDay - currentDay(state));
  const boardOptions = targets
    .map(({ slot, dungeon: d, mutation: mut }) => {
      const sel = dispatchPick.slotId === slot.id;
      return `<div class="option ${sel ? "selected" : ""}" style="${slot.running ? "opacity:.5" : ""}" data-action="pick-slot" data-id="${slot.id}">
        <span class="option-icon">${d.icon}</span>
        <span class="grow"><b>${d.name}</b> <small>第 ${d.chapter} 章・${d.genre}・${roomCount(d)} 房過 ${roomsToClear(d)}</small> ${mutChip(mut)}<br /><small>${mut ? mut.desc : ""}</small>${slot.running ? `<br /><small class="warn">🚪 已有隊伍出發中（結算後補新任務）</small>` : ""}</span>
        <small>${statLine(d, mut)}</small>
      </div>`;
    })
    .join("");

  const fixedOption = (d, tag) => {
    const open = isUnlocked(state, d);
    return `<div class="option ${!dispatchPick.slotId && d.id === dungeon.id ? "selected" : ""}" style="${open ? "" : "opacity:.45"}" data-action="pick-dungeon" data-id="${d.id}">
      <span class="option-icon">${d.icon}</span>
      <span class="grow"><b>${d.name}</b> <small>第 ${d.chapter} 章・${d.genre}${tag}・${roomCount(d)} 房過 ${roomsToClear(d)}</small>${d.chapter > state.spaceLevel ? `<small>（🔒 首通第 ${d.chapter - 1} 章尾王解鎖）</small>` : ""}<br /><small>${d.intro}</small>${gateNote(d)}</span>
      <small>${statLine(d, null)}</small>
    </div>`;
  };
  const bossOptions = bosses.map((d) => fixedOption(d, "・👑 尾王")).join("");
  const extraOptions = extraIds.map((id) => fixedOption(getDungeon(id), "・📌 指定任務")).join("");

  const memberOptions = home.length
    ? home
        .map(
          (s) => `<div class="option ${dispatchPick.party.has(s.id) ? "selected" : ""}" data-action="toggle-member" data-id="${s.id}">
            ${rankBadge(s.rank)}<span class="grow">${s.name} ${s.locked ? "🔒" : ""}</span>
            <small>戰力 ${effectivePower(s)}・${injuryLabel(s)}${s.vacationDays > 0 ? "・🏖️ 休假中" : ""}${s.podLockDays > 0 ? `・🛏️ 休眠艙（${s.podLockDays} 天）` : ""}${s.mood ? "・" + moodLabel(s) : ""}</small>
          </div>`
        )
        .join("")
    : `<div class="empty">主神空間裡沒有人可以派。</div>`;

  let summary = "請至少選一個人。";
  if (party.length > 0) {
    const rate = Math.round(roomPassRate(state, party, dungeon, null, 0, isMand ? 0 : null) * 100);
    const chance = Math.round((isMand ? chanceAtLeast(roomCount(dungeon), roomsToClear(dungeon), roomPassRate(state, party, dungeon, null, 0, 0)) : clearChance(state, party, dungeon)) * 100);
    const cls = chance >= 75 ? "good" : chance >= 50 ? "warn" : "bad";
    summary = `小隊總戰力 <b>${partyPower(party)}</b> / 推薦 ${dungeon.recommendedPower}<br />
      每個房間通過率 <b>${rate}%</b>（${isMand ? "不吃情報加成" : "含情報 " + pct(intelBonus(state, dungeon))}），${roomCount(dungeon)} 個房間通過 ${roomsToClear(dungeon)} 個以上才算通關（約 ${(roomCount(dungeon) * CONFIG.roomTicks) / CONFIG.ticksPerDay} 天）<br />
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
    if (!isMand && !hasIntel(state, dungeon)) {
      summary += `<br /><span class="warn">❓ 首次開荒：傷勢更重；首通有額外 ${Math.round(dungeon.reward * CONFIG.dungeon.firstClearBonusPct)} 分${dungeon.specialRewards?.length ? "與特殊獎勵" : ""}、一件首通奇物${dungeon.boss ? (dungeon.chapter >= CONFIG.space.maxLevel ? "，並完成主線" : "，並讓主神空間升級、解鎖下一章") : ""}。</span>`;
    }
    if (injured.length > 0) {
      summary += `<br /><span class="bad">⚠ 帶傷出征：${injured
        .map((s) => `${s.name}（被打中時 ${Math.round(INJURIES[s.injury].deathBonus * 100)}% 直接死亡）`)
        .join("、")}</span>`;
    }
    summary += riskWarning(party);
    const stocked = party.filter((s) => s.consumables?.length);
    if (stocked.length > 0) summary += `<br /><small>🎒 出征耗材會一起生效：${stocked.map((s) => `${s.name} ×${s.consumables.length}`).join("、")}</small>`;
  }
  if (mutation) summary += `<br />${mutChip(mutation)} <small>${mutation.desc}</small>`;
  const greedyBox = canGreedy
    ? `<label class="toggle"><input type="checkbox" data-greedy ${dispatchPick.greedy ? "checked" : ""} /> 🔍 貪婪探索：通關最後一房後有 ${Math.round(CONFIG.relic.greedyChance * (mutation?.relicChanceMult ?? 1) * 100)}% 機率追加一間 R×${CONFIG.relic.hiddenRMult} 的高危隱藏房（通過掉隱藏奇物，多耗 ${(CONFIG.roomTicks / CONFIG.ticksPerDay).toFixed(1)} 天）</label>`
    : isMand
      ? ""
      : `<small>🔍 這個副本情報滿格（${Math.round(CONFIG.dungeon.intel.max * 100)}%）後可勾選「貪婪探索」。</small>`;

  return `<h3>🚪 派遣</h3>
    <div class="option-list">${mandatoryOption}
      <h4 class="chapter-head">📋 任務榜（${CONFIG.board.slots} 槽・每 ${CONFIG.board.rotateDays} 天輪換，下次輪換還有 ${daysToRotate} 天）</h4>${boardOptions}
      <h4 class="chapter-head">👑 尾王挑戰區（常駐）</h4>${bossOptions}
      ${extraOptions ? `<h4 class="chapter-head">📌 指定任務（主神突襲／許願，沒有突變詞綴）</h4>${extraOptions}` : ""}
    </div>
    <h3 style="margin-top:14px">選擇隊員（最多 ${CONFIG.partyMax} 人，已選 ${party.length}）</h3>
    <div class="option-list">${memberOptions}</div>
    <div class="summary">${summary}<div style="margin-top:6px">${greedyBox}</div></div>
    <div class="modal-actions">${closeButton}
      <button class="primary" data-action="confirm-dispatch" ${party.length === 0 ? "disabled" : ""}>出發（耗時約 ${(roomCount(dungeon) * CONFIG.roomTicks) / CONFIG.ticksPerDay} 天）</button>
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

/** 商店：三個分頁——常駐制式商店／8 格分槽黑市／奇物圖鑑。商店與黑市都要先選「給誰用」 */
function shop() {
  const tab = modal.tab ?? "shop";
  const tier = shopTier(state);
  const next = nextTierInfo(state);
  const home = state.samsarites.filter((s) => s.location === "space");
  if (!home.some((s) => s.id === modal.targetId)) modal.targetId = home[0]?.id ?? null;
  const target = getSamsarite(state, modal.targetId);
  if (!home.some((s) => s.id === modal.victimId && s.id !== modal.targetId)) modal.victimId = home.find((s) => s.id !== modal.targetId)?.id ?? null;
  const progress = next
    ? `累積花費 <b>${state.totalSpent}</b> 分，再花 <b>${next.remaining}</b> 分解鎖 Tier ${next.tier}`
    : `累積花費 <b>${state.totalSpent}</b> 分，商店已全部解鎖`;

  const tabs = [["shop", "🛒 常駐制式商店"], ["market", "🕶️ 8 格黑市"], ["relics", `🏺 奇物圖鑑 ${relicInfo(state).owned}/${relicInfo(state).total}`]]
    .map(([id, label]) => `<button data-action="shop-tab" data-id="${id}" class="${tab === id ? "active" : ""}">${label}</button>`)
    .join("");

  const gearLine = (s) =>
    Object.entries(SHOP_SLOT_LABELS)
      .map(([slot, label]) => `${label}：${getShopItem(s.gear?.[slot])?.name ?? "（空）"}${s.soulbound?.[slot] ? "🔒" : ""}`)
      .join("・");
  const people = home.length
    ? home
        .map((s) => `<div class="option ${s.id === modal.targetId ? "selected" : ""}" data-action="shop-target" data-id="${s.id}">
          ${rankBadge(s.rank)}<span class="grow">${s.name}</span>
          <small>戰力 ${effectivePower(s)}・${injuryLabel(s)}・理智 ${s.stats.sanity}・💰 ${s.wallet ?? 0}</small></div>`)
        .join("")
    : `<div class="empty">主神空間裡沒有人可以用。</div>`;
  const picker = `<h3 style="margin-top:10px">要給誰用？${target ? `<small>（${gearLine(target)}）</small>` : ""}</h3>
    <div class="option-list">${people}</div>
    <p><small>公庫（積分 <b>${state.points}</b>）買裝備＝「賞賜」：綁定（輪迴者自己逛街時不會換掉）、理智 +${CONFIG.wallet.giftSanity}。輪迴者也會用自己的私房錢逛街，所以花費一律累加進累積花費。</small></p>`;

  let body = "";
  if (tab === "shop") body = shopStandardTab(tier, target);
  else if (tab === "market") body = shopMarketTab(home, target);
  else body = shopRelicTab();

  return `<h3>🛒 商店 <small>（目前 Tier ${tier}）</small></h3>
    <p>主神公庫：<b>${state.points}</b>。${progress}。抽卡的花費也算累積花費。</p>
    <div class="tabs">${tabs}</div>
    ${tab === "relics" ? "" : picker}
    ${body}
    <div class="modal-actions">${closeButton}</div>`;
}

function shopStandardTab(tier, target) {
  const itemRow = (item) => {
    const locked = item.tier > tier;
    const check = locked ? { ok: false, reason: "" } : checkBuy(state, item, target);
    const slot = item.kind === "gear" ? `・${SHOP_SLOT_LABELS[item.slot]}` : "";
    const why = !locked && !check.ok ? `<br /><small class="bad">${check.reason}</small>` : "";
    return `<div class="option ${locked ? "locked" : ""}" style="${locked ? "opacity:.45" : ""}">
      <span class="option-icon">${item.icon}</span>
      <span class="grow"><b>${item.name}</b> <small>${SHOP_CATEGORY_LABELS[item.category]}・${SHOP_KIND_LABELS[item.kind]}${slot}</small><br /><small>${item.desc}</small>${why}</span>
      <button class="primary" data-action="buy" data-id="${item.id}" ${check.ok ? "" : "disabled"}>${locked ? "🔒" : item.price + " 分"}</button>
    </div>`;
  };
  const sections = CONFIG.shopTierUnlock
    .map((_, i) => i + 1)
    .map((t) => {
      const need = CONFIG.shopTierUnlock[t - 1];
      const head = t <= tier ? `Tier ${t}` : `🔒 Tier ${t}（累積花費 ${need} 分解鎖）`;
      return `<h3 style="margin-top:14px">${head}</h3><div class="option-list">${shopItemsOfTier(t).map(itemRow).join("")}</div>`;
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
  const shield = Math.round(fx.injuryShield * 100);
  return `<p><small>常駐商店只賣制式武防與常備藥；世界特產、血統、耗材、黑貨請到「黑市」。</small></p>${sections}
    <h3 style="margin-top:14px">🎁 副本特殊獎勵（永久生效）</h3>
    <div class="summary">${collection}${shield ? `<div><small>全員傷勢減免合計 +${shield}%</small></div>` : ""}</div>`;
}

function shopMarketTab(home, target) {
  const info = marketInfo(state);
  const hasContra = info.slots.some((s) => s.item?.kind === "contraband" && !s.sold);
  const victims = home.filter((s) => s.id !== modal.targetId);
  const victimPicker = hasContra
    ? `<h4 class="chapter-head">狗血黑貨的對象（使用者 = 上面選的人）</h4><div class="option-list">${
        victims.length
          ? victims.map((s) => `<div class="option ${s.id === modal.victimId ? "selected" : ""}" data-action="market-victim" data-id="${s.id}">${rankBadge(s.rank)}<span class="grow">${s.name}</span></div>`).join("")
          : `<div class="empty">沒有其他人可以當對象。</div>`
      }</div>`
    : "";
  const cards = info.slots
    .map((slot) => {
      const item = slot.item;
      if (!item) return `<div class="slot sold"><small>（這格沒有貨）</small></div>`;
      const check = slot.sold ? { ok: false, reason: "已售罄" } : checkMarketBuy(state, slot.index, modal.targetId, { victimId: modal.victimId });
      const world = item.worldId ? `<br /><small>🌐 綁定世界：${getDungeon(item.worldId)?.name ?? item.worldId}${slot.discounted ? " <b class=\"good\">・情報滿格 85 折</b>" : ""}</small>` : "";
      const priceHtml = slot.discounted ? `<s>${item.price}</s> <b class="good">${slot.price}</b> 分` : `${slot.price} 分`;
      return `<div class="slot ${slot.sold ? "sold" : ""} ${slot.locked ? "locked-slot" : ""}">
        <div class="slot-head"><span class="option-icon">${item.icon}</span><span class="grow"><b>${item.name}</b><br /><small>${SHOP_CATEGORY_LABELS[item.category]}・T${item.tier}${item.kind === "gear" ? "・" + SHOP_SLOT_LABELS[item.slot] : ""}</small></span>${slot.locked ? "🔒" : ""}</div>
        <small>${item.desc}</small>${world}
        ${!slot.sold && !check.ok ? `<small class="bad">${check.reason}</small>` : ""}
        <div class="slot-actions">
          <button data-action="market-lock" data-id="${slot.index}" ${slot.sold ? "disabled" : ""}>${slot.locked ? "🔓 解除鎖定" : "🔒 鎖定"}</button>
          <button class="primary" data-action="market-buy" data-id="${slot.index}" ${check.ok ? "" : "disabled"}>${slot.sold ? "售罄" : priceHtml}</button>
        </div>
      </div>`;
    })
    .join("");
  return `<div class="summary">⏳ 下次自動換貨：<b>${info.daysLeft}</b> 天後（每 ${CONFIG.market.refreshDays} 天；3 特產武防＋2 特產血統＋2 耗材＋1 黑貨，每格限購 1 次）。
    可鎖定 ${info.lockLimit} 格不被洗掉。
    <button data-action="market-refresh" ${canAfford(state, info.manualCost) ? "" : "disabled"}>🔄 手動刷新（公庫 ${info.manualCost} 分，同日遞增）</button></div>
    ${victimPicker}
    <div class="slot-grid" style="margin-top:10px">${cards}</div>
    ${target ? "" : ""}`;
}

function shopRelicTab() {
  const r = relicInfo(state);
  const byChapter = [1, 2, 3, 4, 5].map((c) => {
    const items = r.list.filter((x) => x.chapter === c);
    return `<h4 class="chapter-head">第 ${c} 章（${items.filter((x) => x.have).length}/${items.length}）</h4><div class="relic-grid">${items
      .map((x) => `<div class="relic ${x.have ? "have" : ""}" title="${x.desc}">${x.icon} <b>${x.name}</b><br /><small>${getDungeon(x.worldId)?.name ?? x.worldId}・${x.kind === "first" ? "首通" : "隱藏房"}</small><br /><small>${x.have ? "+" + (x.powerPct * 100).toFixed(2) + "%" : "？？？"}</small></div>`)
      .join("")}</div>`;
  });
  return `<div class="summary">奇物收集 <b>${r.owned} / ${r.total}</b>・全隊有效戰力加成 <b class="good">+${(r.bonus * 100).toFixed(2)}%</b>（原始 +${(r.raw * 100).toFixed(2)}%，硬封頂 +${r.cap * 100}%）。<br />
    首通每張副本必得「首通奇物」；情報滿格後勾選貪婪探索，通關後有機率打開隱藏房，通過掉「隱藏奇物」（重複則轉為額外積分）。</div>${byChapter.join("")}`;
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
      <tr><td>維持費</td><td>${upkeepOf(s, state)} 分 / 天${s.location === "pod" ? "（催熟艙固定費用）" : `（（基因鎖 ${upkeepPartsOf(s, state).gene} + 空間 ${upkeepPartsOf(s, state).space}）×（1 + 階級 ${Math.round(RANKS[s.rank].upkeepPct * 100)}% + 傷勢 ${Math.round(INJURIES[s.injury].upkeepPct * 100)}%））`}</td></tr>
      <tr><td>資歷</td><td>第 ${s.joinedDay} 天加入・出征 ${s.runs} 次</td></tr>
      <tr><td>私房錢</td><td>💰 <b>${s.wallet ?? 0}</b> 分<br /><small>副本結算先抽 ${Math.round(taxRateOf(state) * 100)}% 稅入公庫，其餘由存活隊員平分；他會自己逛街、強化（戰死 ${Math.round(CONFIG.wallet.deathForfeitPct * 100)}% 充公，回收 100% 歸公庫）</small></td></tr>
      <tr><td>裝備</td><td>${Object.entries(SHOP_SLOT_LABELS).map(([slot, label]) => `${label}：${getShopItem(s.gear?.[slot])?.name ?? "（空）"}${s.soulbound?.[slot] ? ' <span class="badge-bound">🔒綁定</span>' : ""}`).join("<br />")}${s.consumables?.length ? `<br />🎒 出征耗材：${s.consumables.map((id) => getShopItem(id)?.name ?? id).join("、")}` : ""}${s.podLockDays > 0 ? `<br />🛏️ 被鎖在私人休眠艙（還要 ${s.podLockDays} 天）` : ""}</td></tr>
      <tr><td>自主購買</td><td class="shop-log">${s.shopLog?.length ? s.shopLog.slice().reverse().map((l) => `第 ${l.day} 天：${l.text}`).join("<br />") : "（還沒有）"}</td></tr>
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
      <button class="danger" data-action="ask-recycle" data-id="${s.id}" ${home ? "" : "disabled"}>♻️ 推進回收爐（+${RANKS[s.rank].recycleRefund} 分）</button>
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
    <p>你會拿到 ${RANKS[s.rank].recycleRefund} 分，並省下之後的維持費；但其他所有輪迴者理智 -${CONFIG.recycle.sanityLoss}。</p>
    <div class="modal-actions">
      <button data-action="open-detail" data-id="${s.id}">算了</button>
      <button class="danger" data-action="confirm-recycle" data-id="${s.id}">推進去</button>
    </div>`;
}

/** 英靈碑：名單與目前的全隊戰力加成（只有前 N 名生效） */
function stele() {
  const list = state.memorialStele ?? [];
  const top = CONFIG.stele.topN;
  const rows = list.length
    ? list
        .map(
          (e, i) => `<div class="option ${i < top ? "selected" : ""}">${rankBadge(e.rank)}<span class="grow">${e.name}
            <small>基因鎖 ${e.geneLock} 階・出征 ${e.runs} 場・第 ${e.day} 天・${e.cause}</small></span>
            <b>${i < top ? "✅ " : "💤 "}+${Math.round(e.bonus * 100)}%</b></div>`
        )
        .join("")
    : `<div class="empty">還沒有人入碑。基因鎖 ${CONFIG.stele.minGene} 階以上、或出征滿 ${CONFIG.stele.minRuns} 場的輪迴者，戰死在副本或被主神抹殺時才會刻上去。</div>`;
  return `<h3>🪦 英靈碑</h3>
    <p>目前全隊有效戰力 <b class="good">+${Math.round(steleBonusOf(state) * 100)}%</b>（碑上加成最高的前 ${top} 名生效，依生前基因鎖 0～4 階各 ${CONFIG.stele.bonusByGene.map((b) => Math.round(b * 100)).join("／")}%，最多 +${Math.round(CONFIG.stele.bonusByGene[4] * top * 100)}%）。</p>
    <div class="option-list">${rows}</div>
    <div class="modal-actions">${closeButton}</div>`;
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
      ${r.envName ? `環境：${r.envName}<br />` : ""}${r.mutation ? `突變詞綴：<b>${r.mutation.icon} ${r.mutation.name}</b><br />` : ""}獎勵：<b class="${r.success ? "good" : "bad"}">+${r.reward} 分</b>${r.firstClear ? "（含首通加成）" : ""}${r.success ? `　<small>入公庫 ${r.tax}、存活隊員各分 ${r.share} 私房錢</small>` : ""}<br />
      ${r.hidden ? `🔍 貪婪探索：隱藏房 <b class="${r.hidden === "passed" ? "good" : "bad"}">${r.hidden === "passed" ? "闖過了" : "失敗"}</b><br />` : r.greedy ? "🔍 貪婪探索：這次沒有開出隱藏房<br />" : ""}
      ${r.relics?.length ? `🏺 奇物：<b class="good">${r.relics.map((x) => `${x.name}（${x.kind === "first" ? "首通" : "隱藏"}${x.dup ? "・已擁有，轉為積分" : ""}）`).join("、")}</b><br />` : ""}
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
  const home = state.samsarites.filter((s) => s.location === "space");
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
    ${statusPanel([s, ...home.filter((x) => x.id !== s.id)].filter((x) => x.location === "space"))}
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
    ${statusPanel(state.samsarites.filter((x) => x.location === "space"))}
    <div class="modal-actions">
      <button class="danger" data-action="accept-god">${ev.mode === "raid" ? "接下任務" : "照辦"}</button>
      <button class="primary" data-action="resolve-god" ${check.ok ? "" : "disabled"}>花 ${vars.cost} 分化解</button>
      ${modal.forced ? "" : closeButton}
    </div>`;
}

/** 新任主神上崗手冊（4-D-7）：5 張規則卡片 */
function guide() {
  const cards = [
    ["🎯 核心目標", `你是被主神壓榨的主神空間主管：每天要從<b>主神公庫</b>扣「維持費」（在空間裡的人才扣，副本中不扣）。積分可以向主神借，最多借到破產線；頂到線全員被電擊、理智大跌；人全死光時主神會空投新人救援。穩住收支，推進並擊敗<b>五章尾王</b>（首通尾王讓空間升級、解鎖下一章）。`],
    ["⚔️ 派遣與傷亡紅線", `派遣前看<b>推薦戰力</b>與任務的<b>突變詞綴</b>（例如血月狂躁 R ×1.15）。角色受傷（尤其重傷、致命傷）或理智過低（< 30）時，請留在空間休養、吃藥，<b>硬派出去極易戰死、名字刻上英靈碑</b>。彈窗和派遣畫面會用紅字警告。`],
    ["💰 雙錢包與稅率", `副本獎金依<b>稅率</b>（頂欄可調 20%～80%）分流：一部分進「主神公庫」，其餘由存活隊員平分成「私房錢」。隊員每天日結會自己逛街買藥、換裝、強化、突破；你用公庫賞賜的裝備會🔒綁定，不會被他們自己換掉。稅率太高（≥60%）每天掉理智，太低（≤30%）會加理智但公庫變瘦。`],
    ["🕶️ 情報、黑市與奇物", `同一個副本刷越多次，<b>情報</b>越高（滿格 +9%）：滿格後解鎖黑市「特產 85 折」與派遣時的<b>貪婪探索</b>（通關後有機率打開隱藏房，掉隱藏奇物）。每章<b>常規副本累計通關 8 次</b>才開放該章尾王。奇物永久收集（最多 +25% 全隊戰力），首通必得首通奇物。`],
    ["🧬 基因鎖與因果結晶", `強化點滿後才能<b>突破基因鎖</b>（戰力乘區大幅提升，上限看階級 C／B／A／S）。高階副本與尾王會掉<b>因果結晶</b>🔮，是抽「神級池」的必要材料（每抽 1 顆）。想變強：招募高階角色、突破基因鎖、搭配裝備與血統。`],
  ];
  return `<h3>❓ 新任主神上崗手冊</h3>
    ${cards.map(([title, body]) => `<div class="guide-card"><h4>${title}</h4>${body}</div>`).join("")}
    <div class="modal-actions"><button class="primary" data-action="close-modal">我知道了，開始上班</button></div>`;
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
  "open-mandatory"() {
    dispatchPick.dungeonId = MANDATORY_ID; // 直接跳到強制任務的派遣畫面
    dispatchPick.slotId = null;
    modal = { name: "dispatch" };
  },
  "open-guide"() {
    modal = { name: "guide" };
    state.settings.guideSeen = true; // 讀過就記住，不再自動彈出
    saveGame();
  },
  "open-gacha"() {
    modal = { name: "gacha" };
  },
  "open-shop"() {
    modal = { name: "shop", tab: modal?.tab ?? "shop", targetId: modal?.targetId ?? null, victimId: modal?.victimId ?? null };
  },
  "shop-tab"(el) {
    modal.tab = el.dataset.id;
  },
  "market-victim"(el) {
    modal.victimId = Number(el.dataset.id);
  },
  "market-buy"(el) {
    const r = buyMarketSlot(state, Number(el.dataset.id), modal.targetId, { victimId: modal.victimId });
    if (!r.ok) alert(r.reason);
    saveGame();
  },
  "market-lock"(el) {
    const idx = Number(el.dataset.id);
    const r = lockSlot(state, idx, !marketInfo(state).slots[idx]?.locked);
    if (!r.ok) alert(r.reason);
    saveGame();
  },
  "market-refresh"() {
    const r = manualRefresh(state);
    if (!r.ok) alert(r.reason);
    saveGame();
  },
  "tax-up"() {
    setTaxRate(state, taxRateOf(state) + CONFIG.tax.step);
    saveGame();
  },
  "tax-down"() {
    setTaxRate(state, taxRateOf(state) - CONFIG.tax.step);
    saveGame();
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
  "open-stele"() {
    modal = { name: "stele" };
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
    if (el.dataset.id !== MANDATORY_ID && !isUnlocked(state, getDungeon(el.dataset.id))) return; // 還沒解鎖的章節只能看不能選
    dispatchPick.dungeonId = el.dataset.id;
    dispatchPick.slotId = null;
  },
  "pick-slot"(el) {
    const slot = boardOf(state).slots.find((s) => s.id === Number(el.dataset.id));
    if (!slot || slot.running) return; // 已經有隊伍出發的槽不能再接
    dispatchPick.dungeonId = slot.dungeonId;
    dispatchPick.slotId = slot.id;
  },
  "toggle-member"(el) {
    const id = Number(el.dataset.id);
    if (getSamsarite(state, id)?.vacationDays > 0) return; // 放假中不能派
    if (dispatchPick.party.has(id)) dispatchPick.party.delete(id);
    else if (dispatchPick.party.size < CONFIG.partyMax) dispatchPick.party.add(id);
  },
  "confirm-dispatch"() {
    const result = startRun(state, dispatchPick.dungeonId, [...dispatchPick.party], { slotId: dispatchPick.slotId, greedy: dispatchPick.greedy });
    if (!result.ok) return alert(result.reason);
    dispatchPick.party.clear();
    dispatchPick.dungeonId = dispatchPick.slotId = null; // 那一槽出發了，下次開派遣畫面重選
    dispatchPick.greedy = false;
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
  else if ("greedy" in el.dataset) {
    dispatchPick.greedy = el.checked;
    render();
    return;
  } else return;
  saveGame();
});

// 給除錯與自動化測試用：在瀏覽器主控台輸入 zhushen.state 可以看到整個遊戲狀態
window.zhushen = {
  get state() {
    return state;
  },
};

afterChange();
