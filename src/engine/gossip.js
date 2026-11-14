// 《主神八卦日報》資料整理（Phase 4-F-4）。純規則，不碰 DOM／Canvas：把 state 整理成圖卡要畫的內容，畫圖在 src/ui/gossipCard.js。
// 只讀不寫 state，也不消耗任何亂數。數字：CONFIG.gossip。
//
// buildGossip(state) → {
//   header   { day, level, captain, style, facilityTotal, maxErosion, children, seed }
//   headline { kind, title, sub }      頭版頭條：雙強政變／跨隊私奔／逆襲煉獄惡魔隊／單人多胎家族／壯烈擋刀，沒有則最新尾王首通
//   graph    { nodes: [{ id, name, rank, power }], edges: [{ a, b, kind }] }   kind：love 粉紅實線／hate 血紅虛線／rift 紫線
//   steles   [{ name, rank, line }]    英靈碑精選
// }

import { CONFIG } from "../data/config.js";
import { SQUAD_STYLES } from "../data/squadStyles.js";
import { currentDay } from "./core.js";
import { effectivePower } from "./tags.js";
import { getRel, pairStatus, affinity } from "./relations.js";
import { captainOf, styleOf } from "./squad.js";
import { facilityTotal } from "./facilities.js";

/** 頭條候選的編年史種類與標題（越前面同天平手時越優先） */
const HEADLINES = [
  { kind: "coup", title: "雙強政變！隊長寶座當場易主" },
  { kind: "elope", title: "跨隊私奔！自家輪迴者跳槽敵營" },
  { kind: "inferno", title: "逆襲斬殺煉獄惡魔隊！" },
  { kind: "guard", title: "壯烈擋刀，以命換命" },
];


/** 單人多胎家族：活著的人裡，名下子嗣（parents 含他）>= 3 的最多者 */
function bigFamily(state) {
  let best = null;
  for (const s of state.samsarites) {
    const kids = state.samsarites.filter((k) => (k.parents ?? []).includes(s.id));
    if (kids.length >= 3 && (!best || kids.length > best.kids.length)) best = { s, kids };
  }
  return best;
}

export function pickHeadline(state) {
  const chron = state.chronicles ?? [];
  const cands = [];
  for (const [rank, h] of HEADLINES.entries()) {
    for (const c of chron) if (c.kind === h.kind) cands.push({ day: c.day, rank, title: h.title, sub: c.text, kind: h.kind });
  }
  const fam = bigFamily(state);
  if (fam) {
    const day = Math.max(...fam.kids.map((k) => k.joinedDay ?? 0));
    cands.push({ day, rank: 4, kind: "family", title: `「${fam.s.name}」家族人丁興旺！`, sub: `膝下已有 ${fam.kids.length} 位子嗣：${fam.kids.map((k) => k.name).join("、")}。主神空間的育嬰堂都要排隊了。` });
  }
  if (cands.length > 0) {
    cands.sort((a, b) => b.day - a.day || a.rank - b.rank);
    return { kind: cands[0].kind, title: cands[0].title, sub: cands[0].sub };
  }
  const boss = [...chron].reverse().find((c) => c.kind === "boss");
  if (boss) return { kind: "boss", title: "尾王首通！主神空間再度擴建", sub: boss.text };
  return { kind: "calm", title: "風平浪靜：今日無大事", sub: "主神空間一片祥和——主神表示，這很可疑。" };
}

/** 兩人之間最「戲劇」的邊：love 粉紅（戀人／靈魂伴侶，或雙向好感都高）、hate 血紅（死敵，或雙向仇恨高）、rift 紫（單箭頭修羅場、混血子嗣血緣） */
export function pairEdge(state, a, b) {
  const st = pairStatus(state, a, b);
  const ab = getRel(state, a, b);
  const ba = getRel(state, b, a);
  if (st === "lover" || st === "soulmate" || (ab.love >= 70 && ba.love >= 70)) return { kind: "love", weight: 4 };
  if (st === "nemesis" || (ab.hate >= 60 && ba.hate >= 60)) return { kind: "hate", weight: 4 };
  if ((a.hybridOrigin && (a.parents ?? []).includes(b.id)) || (b.hybridOrigin && (b.parents ?? []).includes(a.id))) return { kind: "rift", weight: 3 };
  if ((ab.love >= 60 && affinity(state, b, a) <= -20) || (ba.love >= 60 && affinity(state, a, b) <= -20)) return { kind: "rift", weight: 3 }; // 單箭頭修羅場
  if (ab.hate >= 60 || ba.hate >= 60) return { kind: "hate", weight: 2 };
  return null;
}

export function buildGraph(state) {
  const people = state.samsarites.filter((s) => s.location !== "pod");
  const edges = [];
  const score = new Map(people.map((s) => [s.id, 0]));
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const e = pairEdge(state, people[i], people[j]);
      if (!e) continue;
      edges.push({ a: people[i].id, b: people[j].id, ...e });
      score.set(people[i].id, score.get(people[i].id) + e.weight);
      score.set(people[j].id, score.get(people[j].id) + e.weight);
    }
  }
  const chosen = [...people].sort((x, y) => score.get(y.id) - score.get(x.id) || effectivePower(y) - effectivePower(x) || x.id - y.id).slice(0, CONFIG.gossip.nodes);
  const ids = new Set(chosen.map((s) => s.id));
  return {
    nodes: chosen.map((s) => ({ id: s.id, name: s.name, rank: s.rank, power: effectivePower(s) })),
    edges: edges.filter((e) => ids.has(e.a) && ids.has(e.b)).map(({ a, b, kind }) => ({ a, b, kind })),
  };
}

const EPITAPHS = ["他把背影留給了敵人，把名字留給了石碑。", "沒有人記得他最後說了什麼，但大家都記得那一刀。", "碑文很短，因為他這輩子沒什麼閒話可說。", "生前被主神壓榨，死後被主神紀念，主神：「這很公平。」"];

export function steleDigest(state) {
  return (state.memorialStele ?? []).slice(0, CONFIG.gossip.steles).map((e, i) => ({
    name: e.name,
    rank: e.rank,
    line: `${e.rank} 級・基因鎖 ${e.geneLock} 階・出征 ${e.runs} 場・第 ${e.day} 天${e.cause}。${EPITAPHS[(e.day + e.runs + i) % EPITAPHS.length]}`,
  }));
}

export function buildGossip(state) {
  const cap = captainOf(state);
  const style = styleOf(state);
  return {
    header: {
      day: currentDay(state),
      level: state.spaceLevel ?? 1,
      captain: cap?.name ?? "（隊長缺位）",
      style: style ? `${SQUAD_STYLES[style].icon}${SQUAD_STYLES[style].name}` : "—",
      facilityTotal: facilityTotal(state),
      maxErosion: state.maxErosion ?? 0,
      children: state.samsarites.filter((s) => (s.generation ?? 1) > 1 || s.location === "pod").length,
      seed: state.seed == null ? "（舊存檔無種子碼）" : String(state.seed),
    },
    headline: pickHeadline(state),
    graph: buildGraph(state),
    steles: steleDigest(state),
  };
}
