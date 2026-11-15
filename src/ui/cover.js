// 封面（同時是登入畫面與宣傳頁）：標題、Google 登入、訪客模式、Discord、排行榜預覽、遊戲介紹。

import { CLOUD } from "../data/config.js";
import { LOGIN_URL } from "./cloud.js";
import { previewHtml } from "./leaderboard.js";

const GOOGLE_G = `<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;

const ICON = (d) => `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const FEATURES = [
  { cls: "f-cream", color: "#92400e", title: "管理輪迴者", text: "用積分抽新的輪迴者進空間，安排他們吃飯、訓練、休息——還有盯著他們的理智值，別讓人瘋在你手上。", d: `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>` },
  { cls: "f-coral", color: "#c2410c", title: "派遣下副本", text: "組隊、算戰力、估通關率，把人送進一個個原創副本。通關帶積分回來，失敗——人可能就回不來了。", d: `<circle cx="12" cy="12" r="9"/><path d="M12 3a15 15 0 0 1 0 18"/><path d="M12 3a15 15 0 0 0 0 18"/><path d="M3.5 9h17M3.5 15h17"/>` },
  { cls: "f-mint", color: "#047857", title: "談戀愛、生小孩", text: "輪迴者在空間裡待久了會自己看對眼、談戀愛、結婚生小孩。好感夠高，組隊通關率還會跟著漲。", d: `<path d="M19.5 12.6 12 20l-7.5-7.4A5 5 0 1 1 12 6.2a5 5 0 1 1 7.5 6.4z"/>` },
  { cls: "f-lav", color: "#6d28d9", title: "被主神壓榨", text: "主神會定期派任務催你交績效，每天還要扣維持費。積分不夠？主神很樂意借你——高利貸的那種樂意。", d: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>` },
];
const DISCORD_SVG = `<svg width="32" height="32" viewBox="0 0 24 24" fill="#ffffff" aria-hidden="true"><path d="M20.32 4.37a19.8 19.8 0 0 0-4.93-1.51 13.8 13.8 0 0 0-.64 1.28 18.3 18.3 0 0 0-5.5 0 12.6 12.6 0 0 0-.64-1.28h-.05A19.7 19.7 0 0 0 3.64 4.37C.53 9.04-.32 13.58.1 18.06a19.9 19.9 0 0 0 6.07 3.03c.49-.66.93-1.37 1.3-2.1a12.9 12.9 0 0 1-2.05-.98c.17-.12.34-.25.5-.38a14.2 14.2 0 0 0 12.16 0c.16.13.33.26.5.38-.65.39-1.34.72-2.05.98.37.73.81 1.44 1.3 2.1a19.8 19.8 0 0 0 6.07-3.03c.5-5.18-.84-9.68-3.58-13.69ZM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.95-2.42 2.16-2.42 1.21 0 2.18 1.09 2.16 2.42 0 1.34-.95 2.42-2.16 2.42Zm7.96 0c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.95-2.42 2.16-2.42 1.21 0 2.18 1.09 2.16 2.42 0 1.34-.94 2.42-2.16 2.42Z"/></svg>`;
const CHECK = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2e7d52" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;
const LOCK = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#767d88" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>`;

/** loading = 還在問後端你登入了沒；available = 這個網站有雲端後端 */
export function coverHtml({ loading, available, loginReady, board, boardData }) {
  if (loading) return `<div class="cover-card"><div class="cover-orb"></div><p class="cover-tag">載入中…</p></div>`;
  const google = available && loginReady
    ? `<a class="g-btn" href="${LOGIN_URL}">${GOOGLE_G}<span>使用 Google 帳號登入</span></a>
       <div class="cover-note">${CHECK}<span>登入後開啟<strong>雲端存檔</strong>：換手機、換電腦，打開就能接著管你的空間。</span></div>`
    : `<button class="g-btn" disabled>${GOOGLE_G}<span>使用 Google 帳號登入</span></button><p class="cover-hint">${available ? "Google 登入還在設定中，先用訪客模式玩。" : "雲端功能尚未啟用，先用訪客模式玩。"}</p>`;
  const boardName = CLOUD.boards.find(([id]) => id === board)?.[1] ?? "";
  const boardCard = available && boardData?.ok
    ? `<section class="cover-panel" aria-label="排行榜"><h2>主管排行榜 <small>${boardName}</small></h2><p class="cover-sub">積分最高的幾位主管——你的名字，以後也可能在這裡。</p>${previewHtml(boardData, board)}<p class="cover-foot">訪客模式的成績只留在自己裝置裡，不列入排名。</p></section>`
    : "";
  return `<div class="cover-wrap">
    <div class="cover-top"><span class="cover-brand"><span class="cover-dot"></span>ZHUSHEN SPACE</span></div>
    <header class="cover-hero">
      <div class="orb-stage" aria-hidden="true">
        <div class="orb-halo"></div><div class="orb-ring r1"></div>
        <div class="orb-ring r2"><span class="satellite"></span></div>
        <div class="orb"></div><div class="orb-shadow"></div>
      </div>
      <p class="orb-caption">主 神 空 間</p>
      <h1>主神空間<span class="gold">打工</span>日記</h1>
      <p class="cover-tagline">「<strong>你被主神抓來當主管了。</strong>」</p>
      <p class="cover-herosub">沒有英雄開局，只有一間白色空間、一顆什麼都不肯多說的光球，還有一群等著你養的輪迴者。</p>
      <section class="login-card" aria-label="登入">
        <h2>主管報到</h2>
        <p class="cover-hint">登入後，你的主神空間會跟著帳號走。</p>
        ${google}
        <div class="cover-divider" aria-hidden="true">或</div>
        <button class="btn-guest" data-action="cover-guest">不登入，以訪客模式開始</button>
        <div class="cover-note">${LOCK}<span>訪客模式不用帳號、馬上就能玩，但<strong>存檔只留在這台裝置</strong>，清除瀏覽器資料或換裝置就會不見。</span></div>
      </section>
    </header>
    <div class="cover-grid${boardCard ? "" : " single"}">
      <section class="cover-panel" aria-label="遊戲介紹">
        <h2>這份工作，在做什麼？</h2>
        <p class="cover-sub">說是主管，其實是主神空間裡最底層的那個人。</p>
        <div class="cover-features">${FEATURES.map((f) => `<div class="feature ${f.cls}"><div class="f-icon" style="stroke:${f.color}">${ICON(f.d)}</div><h3>${f.title}</h3><p>${f.text}</p></div>`).join("")}</div>
      </section>
      ${boardCard}
    </div>
    <section class="cover-discord" aria-label="Discord 社群">
      <div class="d-icon" aria-hidden="true">${DISCORD_SVG}</div>
      <div class="d-text"><h2>主管們的休息室</h2><p>加入 Discord，跟其他主管一起玩——曬你的輪迴者、抱怨主神的任務、交換哪個副本最划算。</p></div>
      <a class="discord-btn" href="${CLOUD.discordUrl}" target="_blank" rel="noopener noreferrer">加入 Discord</a>
    </section>
    <footer class="cover-footer"><p>主神空間打工日記</p></footer>
  </div>`;
}
