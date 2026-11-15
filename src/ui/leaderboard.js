// 排行榜畫面（封面預覽與遊戲內面板共用）。所有來自後端的文字都用 esc() 處理。

import { CLOUD } from "../data/config.js";
import { esc } from "./html.js";

const BOARD_NAME = Object.fromEntries(CLOUD.boards);

/** 這個榜單的主要數字與副標題（最強／最長壽輪迴者的副標題是那位輪迴者的名字） */
export function boardValue(e, board) {
  if (board === "level") return { main: `Lv.${e.level}`, sub: `${e.roster} 位輪迴者` };
  if (board === "clears") return { main: `${e.clears} 個副本`, sub: `Lv.${e.level}` };
  if (board === "power") return { main: String(e.power), sub: e.powerName };
  return { main: `${e.life} 天`, sub: e.lifeName };
}

const medal = (rank) => (rank <= 3 ? ` medal-${["gold", "silver", "bronze"][rank - 1]}` : "");

function changeHtml(change) {
  if (change == null) return "";
  if (change > 0) return `<span class="lb-up">↑${change}</span>`;
  if (change < 0) return `<span class="lb-down">↓${-change}</span>`;
  return `<span class="lb-flat">—</span>`;
}

function avatarHtml(picture, name) {
  return typeof picture === "string" && picture.startsWith("https://")
    ? `<img class="lb-avatar" src="${esc(picture)}" alt="" referrerpolicy="no-referrer" loading="lazy" />`
    : `<span class="lb-avatar lb-initial">${esc(String(name).slice(0, 1))}</span>`;
}

function rowHtml(e, board, extraClass = "") {
  const v = boardValue(e, board);
  return `<div class="lb-row${e.me ? " me" : ""}${extraClass}">
    <span class="lb-rank${medal(e.rank)}">${e.rank}</span>
    ${avatarHtml(e.picture, e.name)}
    <span class="lb-name" data-keep-emoji><b>${esc(e.name)}</b>${v.sub ? `<small>${esc(v.sub)}</small>` : ""}</span>
    <span class="lb-change">${changeHtml(e.change)}</span>
    <span class="lb-value">${esc(v.main)}</span>
  </div>`;
}

/** 封面用：前幾名的精簡列表 */
export function previewHtml(data, board) {
  if (!data?.entries?.length) return `<div class="lb-empty">還沒有人上榜。成為第一個吧。</div>`;
  return `<div class="lb-list">${data.entries.slice(0, CLOUD.previewTop).map((e) => rowHtml({ ...e, me: false }, board)).join("")}</div>`;
}

/** 遊戲內排行榜面板：榜單分頁＋前 20 名＋自己的名次（就算不在前 20 名也要看得到） */
export function leaderboardHtml({ board, data, loading, available, loggedIn, hidden }) {
  const tabs = CLOUD.boards.map(([id, label]) => `<button data-action="lb-tab" data-id="${id}" class="${board === id ? "active" : ""}">${label}</button>`).join("");
  let body;
  if (!available) body = `<div class="lb-empty">這個版本還沒有連上雲端，排行榜暫時不能用。</div>`;
  else if (loading) body = `<div class="lb-empty">載入中…</div>`;
  else if (!data?.ok) body = `<div class="lb-empty">排行榜載入失敗，請稍後再試。</div>`;
  else {
    const rows = data.entries.map((e) => rowHtml(e, board)).join("") || `<div class="lb-empty">還沒有人上榜。</div>`;
    const inTop = data.entries.some((e) => e.me);
    const mine = !loggedIn
      ? `<div class="lb-note">登入後才能上榜。</div>`
      : hidden
        ? `<div class="lb-note">你設定了「不上排行榜」，所以榜上沒有你。</div>`
        : data.me && !inTop
          ? rowHtml({ ...data.me, name: "你", picture: null, me: true }, board, " lb-mine")
          : !data.me
            ? `<div class="lb-note">你還沒有成績，繼續玩一陣子再回來看。</div>`
            : "";
    body = `<div class="lb-list">${rows}</div>${data.me && !inTop ? `<div class="lb-you">你是第 <b>${data.me.rank}</b> 名</div>` : ""}${mine}`;
  }
  return `<h3>排行榜 <small>${esc(BOARD_NAME[board] ?? "")}</small></h3>
    <div class="tabs lb-tabs">${tabs}</div>
    ${body}
    <div class="modal-actions">${`<button data-action="close-modal">關閉</button>`}</div>`;
}
