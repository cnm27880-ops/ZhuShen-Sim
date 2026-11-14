// 《主神八卦日報》Canvas 圖卡繪製（Phase 4-F-4）。純原生 Canvas 2D API，不載入任何外部圖片（避免 CORS 污染 canvas 導致無法匯出 PNG）。
// 資料由 engine/gossip.js 的 buildGossip(state) 整理好；這裡只負責畫。尺寸：邏輯 900 × 1260，依裝置像素比放大（最高 2 倍）以支援高 DPI。

import { CONFIG } from "../data/config.js";

const W = () => CONFIG.gossip.width;
const H = () => CONFIG.gossip.height;
const SERIF = "'Noto Serif TC','Source Han Serif TC','PMingLiU','Songti TC','Noto Sans CJK TC',serif";
const SANS = "'Noto Sans TC','Microsoft JhengHei','PingFang TC','Noto Sans CJK TC',sans-serif";
const INK = "#2a2118";
const PAPER = "#f4ecd6";
const EDGE_STYLE = { love: { color: "#e0457b", width: 5, dash: [] }, hate: { color: "#b3122b", width: 4, dash: [14, 9] }, rift: { color: "#7b3fb3", width: 4, dash: [] } };
const RANK_COLOR = { C: "#8a8a8a", B: "#3b82c4", A: "#b8860b", S: "#c0392b" };

/** 依實際寬度把字串切成多行（逐字量測，適合中文）；超過 maxLines 的尾端加 … */
export function wrapText(ctx, text, maxWidth, maxLines = 99) {
  const lines = [];
  let cur = "";
  for (const ch of String(text)) {
    if (ctx.measureText(cur + ch).width > maxWidth && cur) {
      lines.push(cur);
      cur = ch;
    } else cur += ch;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  return lines;
}

/** 單行截斷（超寬就加 …） */
export function fitText(ctx, text, maxWidth) {
  let t = String(text);
  if (ctx.measureText(t).width <= maxWidth) return t;
  while (t && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

function drawLines(ctx, lines, x, y, lineHeight) {
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
  return y + lines.length * lineHeight;
}

function rule(ctx, y, x1 = 40, x2 = W() - 40, w = 2) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
}

function drawMasthead(ctx, h) {
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.font = `bold 86px ${SERIF}`;
  ctx.fillText("主神八卦日報", W() / 2, 120);
  ctx.font = `20px ${SERIF}`;
  ctx.fillText("MAIN GOD GOSSIP DAILY　・　專挖輪迴者的恩怨情仇　・　主神獨家授權", W() / 2, 156);
  rule(ctx, 174, 40, W() - 40, 4);
  rule(ctx, 180, 40, W() - 40, 1);
  ctx.font = `bold 24px ${SANS}`;
  const hd = h.header;
  ctx.fillText(fitText(ctx, `第 ${hd.day} 天　主神空間 Lv.${hd.level}　隊長：${hd.captain}（${hd.style}）`, W() - 80), W() / 2, 216);
  ctx.font = `22px ${SANS}`;
  ctx.fillText(`🏗️ 基建總等級 ${hd.facilityTotal}　🌌 最高侵蝕 ${hd.maxErosion}★　🍼 子嗣 ${hd.children} 人`, W() / 2, 250);
  rule(ctx, 268, 40, W() - 40, 2);
}

function drawHeadline(ctx, h) {
  const top = 290;
  ctx.textAlign = "left";
  ctx.fillStyle = "#b3122b";
  ctx.font = `bold 22px ${SANS}`;
  ctx.fillText("▌頭版頭條", 50, top + 6);
  ctx.fillStyle = INK;
  ctx.font = `bold 52px ${SERIF}`;
  let y = drawLines(ctx, wrapText(ctx, h.headline.title, W() - 100, 2), 50, top + 66, 62);
  ctx.font = `26px ${SERIF}`;
  y = drawLines(ctx, wrapText(ctx, h.headline.sub, W() - 100, 4), 50, y + 8, 38);
  rule(ctx, 540, 40, W() - 40, 2);
}

function drawGraph(ctx, h) {
  const top = 560;
  ctx.textAlign = "left";
  ctx.fillStyle = "#b3122b";
  ctx.font = `bold 22px ${SANS}`;
  ctx.fillText("▌核心愛恨修羅場", 50, top + 6);
  const { nodes, edges } = h.graph;
  const cx = W() / 2;
  const cy = top + 230;
  const R = 150;
  const pos = new Map();
  nodes.forEach((n, i) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, nodes.length);
    pos.set(n.id, { x: cx + R * Math.cos(ang) * 1.45, y: cy + R * Math.sin(ang) });
  });
  for (const e of edges) {
    const a = pos.get(e.a);
    const b = pos.get(e.b);
    if (!a || !b) continue;
    const st = EDGE_STYLE[e.kind];
    ctx.strokeStyle = st.color;
    ctx.lineWidth = st.width;
    ctx.setLineDash(st.dash);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.textAlign = "center";
  for (const n of nodes) {
    const p = pos.get(n.id);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 38, 0, Math.PI * 2);
    ctx.fillStyle = "#fffaf0";
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = RANK_COLOR[n.rank] ?? INK;
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = `bold 20px ${SANS}`;
    ctx.fillText(fitText(ctx, n.name, 66), p.x, p.y + 2);
    ctx.font = `16px ${SANS}`;
    ctx.fillText(`${n.rank}・${n.power}`, p.x, p.y + 24);
  }
  if (edges.length === 0) {
    ctx.fillStyle = "#6b5d4a";
    ctx.font = `24px ${SERIF}`;
    ctx.fillText("目前一片祥和——沒有明顯的愛恨糾葛。", cx, cy + 4);
  }
  // 圖例
  ctx.textAlign = "left";
  ctx.font = `18px ${SANS}`;
  let lx = 50;
  for (const [kind, label] of [["love", "粉紅實線：雙向真愛／伴侶"], ["hate", "血紅虛線：仇恨死敵"], ["rift", "紫線：跨隊／催生修羅場"]]) {
    const st = EDGE_STYLE[kind];
    ctx.strokeStyle = st.color;
    ctx.lineWidth = st.width;
    ctx.setLineDash(st.dash);
    ctx.beginPath();
    ctx.moveTo(lx, top + 438);
    ctx.lineTo(lx + 34, top + 438);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = INK;
    ctx.fillText(label, lx + 42, top + 444);
    lx += 42 + ctx.measureText(label).width + 22;
  }
  rule(ctx, 1008, 40, W() - 40, 2);
}

function drawSteles(ctx, h) {
  const top = 1026;
  ctx.textAlign = "left";
  ctx.fillStyle = "#b3122b";
  ctx.font = `bold 22px ${SANS}`;
  ctx.fillText("▌英靈碑精選", 50, top + 6);
  ctx.fillStyle = INK;
  if (h.steles.length === 0) {
    ctx.font = `22px ${SERIF}`;
    ctx.fillText("碑上還沒有名字——主神：「這很正常，你們才剛開始。」", 50, top + 52);
  }
  let y = top + 42;
  for (const s of h.steles) {
    ctx.font = `bold 22px ${SERIF}`;
    ctx.fillText(`🪦 ${fitText(ctx, s.name, 200)}`, 50, y);
    ctx.font = `18px ${SERIF}`;
    y = drawLines(ctx, wrapText(ctx, s.line, W() - 110, 2), 70, y + 24, 24) + 6;
  }
}

function drawFooter(ctx, h) {
  rule(ctx, H() - 96, 40, W() - 40, 3);
  ctx.textAlign = "center";
  ctx.fillStyle = INK;
  ctx.font = `bold 30px ui-monospace,Consolas,monospace`;
  ctx.fillText(fitText(ctx, `本局種子碼 SEED：${h.header.seed}`, W() - 80), W() / 2, H() - 58);
  ctx.font = `15px ${SANS}`;
  ctx.fillText("用同一組種子碼開新局，可以重現同樣的開局與卡池", W() / 2, H() - 36);
}

/** 把整份日報畫到 canvas 上（會依 devicePixelRatio 放大，上限 2）。回傳實際縮放倍率 */
export function drawGossipCard(canvas, h, dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1) {
  const ratio = Math.max(1, Math.min(2, dpr));
  canvas.width = W() * ratio;
  canvas.height = H() * ratio;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W(), H());
  // 紙張暈邊
  const g = ctx.createRadialGradient(W() / 2, H() / 2, H() * 0.35, W() / 2, H() / 2, H() * 0.75);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(120,90,40,0.22)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W(), H());
  ctx.strokeStyle = INK;
  ctx.lineWidth = 6;
  ctx.strokeRect(14, 14, W() - 28, H() - 28);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(24, 24, W() - 48, H() - 48);
  ctx.textBaseline = "alphabetic";
  drawMasthead(ctx, h);
  drawHeadline(ctx, h);
  drawGraph(ctx, h);
  drawSteles(ctx, h);
  drawFooter(ctx, h);
  return ratio;
}

/** 匯出 PNG（觸發瀏覽器下載）。回傳 Promise<boolean> */
export function downloadGossipPng(canvas, filename) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) return resolve(false);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      resolve(true);
    }, "image/png");
  });
}

/** 複製文字到剪貼簿（clipboard API 不可用時退回 textarea + execCommand） */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}
