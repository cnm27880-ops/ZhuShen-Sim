// 封面（同時是登入畫面與宣傳頁）：標題、Google 登入、訪客模式、Discord、排行榜預覽、遊戲介紹。

import { CLOUD } from "../data/config.js";
import { LOGIN_URL } from "./cloud.js";
import { previewHtml } from "./leaderboard.js";

const GOOGLE_G = `<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;

const INTRO = ["管理輪迴者，每個人都有自己的人生", "派他們下副本，賭他們活著回來", "看他們談戀愛、吵架、生小孩", "還有一個每天想搞你的主神"];

/** loading = 還在問後端你登入了沒；available = 這個網站有雲端後端 */
export function coverHtml({ loading, available, board, boardData }) {
  if (loading) return `<div class="cover-card"><div class="cover-orb"></div><p class="cover-tag">載入中…</p></div>`;
  const google = available
    ? `<a class="g-btn" href="${LOGIN_URL}">${GOOGLE_G}<span>使用 Google 登入</span></a>`
    : `<button class="g-btn" disabled>${GOOGLE_G}<span>使用 Google 登入</span></button><p class="cover-hint">雲端功能尚未啟用，先用訪客模式玩。</p>`;
  return `<div class="cover-card">
    <div class="cover-orb"></div>
    <h1>主神空間<span class="gold">打工</span>日記</h1>
    <p class="cover-tag">你被主神抓來當主管了</p>
    <div class="cover-actions">
      ${google}
      <button class="primary big" data-action="cover-guest">訪客模式</button>
      <small>存檔只留在這台裝置</small>
    </div>
    <a class="discord-btn" href="${CLOUD.discordUrl}" target="_blank" rel="noopener noreferrer">加入 Discord，跟其他主管一起玩</a>
    <ul class="cover-intro">${INTRO.map((t) => `<li>${t}</li>`).join("")}</ul>
    ${available && boardData?.ok ? `<h2>排行榜 <small>${CLOUD.boards.find(([id]) => id === board)?.[1] ?? ""}</small></h2>${previewHtml(boardData, board)}` : ""}
  </div>`;
}
