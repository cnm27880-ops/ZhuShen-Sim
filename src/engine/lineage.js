// 跨代子嗣、先人遺物、叛逃野生 Boss 與《空間編年史》（Phase 4-E-4）。純規則，不碰畫面。
// 數字在 CONFIG.lineage／CONFIG.squad；亂數用 state.squadRngState（engine/squad.js 的 squadRng），不動主亂數。
//
//   state.chronicles       《空間編年史》：[{ day, kind, text }]，最多 100 條
//   state.armoryHeirlooms  先人遺物庫：[{ id, itemId, slot, ownerName, ownerId, label, day, friendIds, childIds, … }]，最多 8 件
//   state.rogueBosses      叛逃野生魔王：[{ id, name, rank, geneLock, wallet, day, chapter }]，最多 5 名；戰力不存，遇敵時依「當時章節」動態錨定
//
// 這個檔案也負責「子嗣」：兩人互有高好感就可能孕育下一代（沿用 3-F 的催熟艙機制，見 engine/children.js 的 giveBirth），
// 子嗣的天賦白值加成無論傳承幾代都硬封頂 +25%。

import { CONFIG } from "../data/config.js";
import { DUNGEONS } from "../data/dungeons.js";
import { getShopItem } from "../data/shopItems.js";
import { getTag } from "../data/tags.js";
import { rand, pick } from "./rng.js";
import { emit, currentDay, getSamsarite, spend, canAfford, forgetRelations, setInjury } from "./core.js";
import { cancelWishesOf } from "./wishes.js";
import { cancelGodOf } from "./godEvents.js";
import { effectivePower } from "./tags.js";
import { affinity } from "./relations.js";
import { giveBirth, hatch, podBabies } from "./children.js";
import { popLimit } from "./mandatory.js";
import { squadRng, squadOf, squadUnlocked, captainOf, squadMembers, bump } from "./squad.js";
import { logText } from "./templates.js";

const L = () => CONFIG.lineage;
const CN = ["", "一", "二", "三", "四", "五"];

// ───────── 空間編年史 ─────────

/**
 * 記一條大事紀。kind：boss（尾王首通）／captain（冊封、順延）／coup（政變、奪權）／snub（空降不服）／
 * stele（英靈碑）／birth（二代目誕生）／defect（叛徒出走）／slain（討伐叛徒）／heirloom（先人遺物）／drama（修羅場）。
 * 最多留最近 CONFIG.squad.chronicleMax（100）條。
 */
export function addChronicle(state, kind, text) {
  const list = (state.chronicles ??= []);
  list.push({ day: currentDay(state), kind, text });
  if (list.length > CONFIG.squad.chronicleMax) list.splice(0, list.length - CONFIG.squad.chronicleMax);
}

// ───────── 子嗣：世代、天賦封頂、性格繼承 ─────────

/**
 * 孩子出生後的世代與天賦（giveBirth 呼叫；3-F 戀人生的小孩也一樣）：
 *   generation = max(父, 母) + 1
 *   天賦比例 talentPct = min(25%, 家長平均基因鎖 × 5% + 家長自己天賦比例的平均 × 0.5)
 *   inheritPower = round(孩子基礎戰力 × talentPct)（會吃基因鎖乘區，所以是「基礎屬性加成」）
 *   lineage 為 true（孕育系統生的）時，保證繼承一個家長的性格詞條
 */
export function applyLineage(state, child, parents, rng, lineage = false) {
  child.generation = Math.max(...parents.map((p) => p.generation ?? 1)) + 1;
  const avgGene = parents.reduce((n, p) => n + (p.geneLock ?? 0), 0) / parents.length;
  const avgTalent = parents.reduce((n, p) => n + (p.talentPct ?? 0), 0) / parents.length;
  child.talentPct = Math.round(Math.min(L().talentCap, avgGene * L().talentPerGene + avgTalent * L().talentFromParent) * 10000) / 10000;
  child.inheritPower = Math.round(child.stats.power * child.talentPct);
  if (lineage) {
    const parentTraits = [...new Set(parents.flatMap((p) => p.tags ?? []).filter((t) => getTag(t)?.kind === "trait"))];
    const has = child.tags.some((t) => parentTraits.includes(t));
    if (!has && parentTraits.length > 0) {
      const at = child.tags.findIndex((t) => getTag(t)?.kind === "trait");
      const fresh = parentTraits.filter((t) => !child.tags.includes(t));
      const chosen = pick(rng, fresh.length ? fresh : parentTraits);
      if (at >= 0) child.tags[at] = chosen;
      else child.tags.push(chosen);
      child.inheritedTags = [...new Set([...(child.inheritedTags ?? []), chosen])];
    }
  }
}

const pairKey = (a, b) => (a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`);

/** 這一對現在能不能孕育？回傳 null（可以）或原因 */
export function lineageBlock(state, a, b) {
  if (a.location !== "space" || b.location !== "space") return "雙方都要在主神空間";
  if (a.injury >= 2 || b.injury >= 2) return "有人重傷以上";
  if (affinity(state, a, b) < L().pairAffinity || affinity(state, b, a) < L().pairAffinity) return `雙向淨好感要 >= ${L().pairAffinity}`;
  if ((state.cooldowns?.[`birth:${pairKey(a, b)}`] ?? 0) > currentDay(state)) return "這一對還在冷卻";
  if (podBabies(state).length >= CONFIG.child.maxInPod) return "催熟艙滿了";
  if (squadMembers(state).length >= popLimit(state)) return "空間人數已達上限";
  return null;
}

/** 孕育道具／黑貨的接口：跳過機率直接受孕（仍受條件限制，除非 opts.force）。回傳孩子或 null */
export function inducePregnancy(state, a, b, opts = {}) {
  if (!opts.force && lineageBlock(state, a, b)) return null;
  bump(state, "birth");
  return giveBirth(state, a, b, { rng: squadRng(state), podDays: L().podDays, cooldownDays: L().cooldownDays, lineage: true });
}

/** 加速培育：每剩 1 天花公庫 60 × 空間等級；立刻出艙 */
export function speedUpCost(state, baby) {
  return Math.max(0, baby.podDaysLeft) * L().speedUpCostPerDay * (state.spaceLevel ?? 1);
}
export function speedUpPod(state, babyId) {
  const baby = getSamsarite(state, babyId);
  if (!baby || baby.location !== "pod") return { ok: false, reason: "他不在催熟艙" };
  const cost = speedUpCost(state, baby);
  if (!canAfford(state, cost)) return { ok: false, reason: "積分不夠（已達高利貸上限）", cost };
  spend(state, cost);
  emit(state, "social", logText(state, "lineageSpeed", { A: baby, cost }));
  hatch(state, baby);
  return { ok: true, cost };
}

// ───────── 先人遺物 ─────────

/** 戰死前身上最高階的武器或防具（階層高者優先，再看戰力白值）。沒有裝備回 null */
function bestGear(s) {
  let best = null;
  for (const slot of ["weapon", "armor"]) {
    const item = getShopItem(s.gear?.[slot]);
    if (!item) continue;
    const key = item.tier * 100000 + (item.effect?.power ?? 0);
    if (!best || key > best.key) best = { key, item, slot };
  }
  return best;
}

function heirloomLabel(s) {
  const role = s.captainNo ? (s.captainNo === 1 ? "初代隊長" : `第 ${s.captainNo} 任隊長`) : (s.generation ?? 1) > 1 ? `第 ${s.generation} 代老兵` : "元老";
  const deeds = (s.maxBossChapter ?? 0) > 0 ? `曾討伐${CN[s.maxBossChapter]}章尾王` : `出征 ${s.runs ?? 0} 場`;
  return `「${role}・${s.name}遺留（${deeds}）」`;
}

/**
 * 副本戰死時（core.killSamsarite 在把人移出名單「之前」呼叫）：geneLock >= 2 的老鳥或現任隊長，
 * 身上最高階的 1 件武器或防具不會消失，刻上履歷收進遺物庫（最多 8 件，滿了丟最舊的）。
 */
export function leaveHeirloom(state, s) {
  const isCaptain = squadOf(state).captainId === s.id;
  if ((s.geneLock ?? 0) < L().heirloomMinGene && !isCaptain) return null;
  const g = bestGear(s);
  if (!g) return null;
  const entry = {
    id: `hl_${s.id}_${state.tick}`,
    itemId: g.item.id,
    slot: g.slot,
    ownerName: s.name,
    ownerId: s.id,
    wasHeirloom: !!s.heirloomSlots?.[g.slot],
    label: heirloomLabel(s),
    day: currentDay(state),
    friendIds: state.samsarites.filter((o) => o.id !== s.id && affinity(state, o, s) >= L().heirloomFriendAffinity).map((o) => o.id),
    childIds: state.samsarites.filter((o) => (o.parents ?? []).includes(s.id)).map((o) => o.id),
  };
  const list = (state.armoryHeirlooms ??= []);
  list.push(entry);
  if (list.length > L().heirloomKeep) list.splice(0, list.length - L().heirloomKeep);
  delete s.gear[g.slot];
  const text = logText(state, "heirloomLeft", { A: s, item: g.item.name, label: entry.label });
  emit(state, "social", text);
  addChronicle(state, "heirloom", text);
  bump(state, "heirloom");
  return entry;
}

/** 這件遺物的繼承人候選（UI 排序用）：子嗣優先 → 高好感摯友 → 其他在空間的人 */
export function heirloomHeirs(state, h) {
  const home = state.samsarites.filter((s) => s.location === "space");
  const rel = (s) => ((h.childIds ?? []).includes(s.id) || (s.parents ?? []).includes(h.ownerId) ? 0 : (h.friendIds ?? []).includes(s.id) ? 1 : 2);
  return home.map((s) => ({ s, kind: ["child", "friend", "other"][rel(s)], order: rel(s) })).sort((a, b) => a.order - b.order || effectivePower(b.s) - effectivePower(a.s));
}

/** 賞賜遺物：免費，裝備上去後綁定；穿戴者是原主子嗣或好感 >= 60 的摯友，緬懷：理智 +10 */
export function bestowHeirloom(state, heirloomId, samsariteId) {
  const list = state.armoryHeirlooms ?? [];
  const h = list.find((x) => x.id === heirloomId);
  const s = getSamsarite(state, samsariteId);
  if (!h) return { ok: false, reason: "遺物庫沒有這件東西" };
  if (!s || s.location !== "space") return { ok: false, reason: "要在主神空間的人才能接手" };
  const item = getShopItem(h.itemId);
  s.gear ??= {};
  s.gear[h.slot] = h.itemId;
  (s.heirloomSlots ??= {})[h.slot] = true;
  (s.soulbound ??= {})[h.slot] = true;
  state.armoryHeirlooms = list.filter((x) => x.id !== heirloomId);
  emit(state, "shop", logText(state, "heirloomEquip", { A: s, item: item.name, label: h.label }), { samsariteId: s.id });
  const kin = (h.childIds ?? []).includes(s.id) || (s.parents ?? []).includes(h.ownerId);
  const friend = (h.friendIds ?? []).includes(s.id);
  if (kin || friend) {
    s.stats.sanity = Math.min(100, s.stats.sanity + L().heirloomSanity);
    emit(state, "social", logText(state, "heirloomMourn", { A: s, B: { name: h.ownerName }, item: item.name, san: L().heirloomSanity }));
  }
  return { ok: true, mourned: kin || friend };
}

// ───────── 叛逃野生魔王 ─────────

/** 100% 免疫叛逃：現任隊長、對隊長淨好感 > 0、身上穿有主神賞賜綁定裝、帶 customProfile 標記者 */
export function isDefectImmune(state, s) {
  const cap = captainOf(state);
  if (!cap || cap.id === s.id) return true;
  if (affinity(state, s, cap) > 0) return true;
  if (Object.entries(s.soulbound ?? {}).some(([slot, v]) => v && s.gear?.[slot])) return true;
  return !!s.customProfile;
}

/** 長期壓榨：對隊長淨好感 <= -55 且理智 < 25 */
export const defectEligible = (state, s) => {
  const cap = captainOf(state);
  return !!cap && s.location === "space" && affinity(state, s, cap) <= L().rogueAffinity && s.stats.sanity < L().rogueSanity;
};

/** 叛逃：帶著私房錢離開空間，轉化成野生 Boss（不進墳場、不入碑） */
export function defect(state, s) {
  const boss = { id: `rb${s.id}_${state.tick}`, name: s.name, rank: s.rank, geneLock: s.geneLock ?? 0, wallet: s.wallet ?? 0, day: currentDay(state), chapter: Math.min(CONFIG.space.maxLevel, state.spaceLevel ?? 1) };
  state.samsarites = state.samsarites.filter((x) => x.id !== s.id);
  cancelWishesOf(state, s.id);
  cancelGodOf(state, s.id);
  forgetRelations(state, s.id);
  (state.rogueBosses ??= []).push(boss);
  const text = logText(state, "rogueDefect", { A: s, wallet: boss.wallet });
  emit(state, "relation", text, { samsariteId: s.id });
  addChronicle(state, "defect", text);
  bump(state, "defect");
  return boss;
}

/** 每日結算掛鉤（advanceTick，隊長結算之後）：叛逃判定、孕育判定。條件不符的人不消耗亂數 */
export function dailyLineage(state) {
  if (state.gameOver || !squadUnlocked(state)) return;
  const rng = squadRng(state);
  // 叛逃（上限 5 名）
  if ((state.rogueBosses ?? []).length < L().rogueMax) {
    for (const s of [...state.samsarites].sort((a, b) => a.id - b.id)) {
      if (state.rogueBosses.length >= L().rogueMax) break;
      if (!state.samsarites.includes(s) || !defectEligible(state, s) || isDefectImmune(state, s)) continue;
      if (rand(rng) < L().rogueChance) defect(state, s);
    }
  }
  // 孕育：雙向淨好感 >= 75 且都沒重傷
  const home = state.samsarites.filter((s) => s.location === "space").sort((a, b) => a.id - b.id);
  for (let i = 0; i < home.length; i++) {
    for (let j = i + 1; j < home.length; j++) {
      const [a, b] = [home[i], home[j]];
      if (lineageBlock(state, a, b)) continue;
      if (rand(rng) < L().birthChance) inducePregnancy(state, a, b, { force: true });
    }
  }
}

/** 目前章節的叛逃 Boss 戰力錨點：該章常規關平均 R × rogueRMult，獎勵取該章常規關平均獎勵 */
export function rogueDungeon(state) {
  const ch = Math.min(CONFIG.space.maxLevel, state.spaceLevel ?? 1);
  const pool = DUNGEONS.filter((d) => d.chapter === ch && !d.boss);
  const avg = (k) => pool.reduce((n, d) => n + d[k], 0) / Math.max(1, pool.length);
  return { id: "rogue_boss", name: "叛逃的野生魔王", chapter: ch, boss: true, genre: "", rooms: [], recommendedPower: Math.round(avg("recommendedPower") * L().rogueRMult), reward: Math.round(avg("reward") * L().rogueBountyPct) };
}

/** 常規副本出發時擲「遭遇叛逃 Boss」：有野生 Boss 才擲（10%），回傳要亂入的 Boss id 或 null */
export function rollRogueEncounter(state) {
  const list = state.rogueBosses ?? [];
  if (list.length === 0) return null;
  const rng = squadRng(state);
  return rand(rng) < L().rogueEncounter ? pick(rng, list).id : null;
}
export const rogueBossOf = (state, id) => (state.rogueBosses ?? []).find((b) => b.id === id) ?? null;

/**
 * 結算最後一房的叛逃 Boss 對決（dungeon.finishRun 算好 win 之後呼叫）：
 *   擊敗 → 回傳賞金（該章一般關平均獎勵 × 50% + 他帶走的私房錢），機率掉 1 顆因果結晶，Boss 消失；
 *   不敵 → 全員 injury +1（最高致命傷），小隊撤退（呼叫端把這場算失敗）。
 */
export function resolveRogueFight(state, boss, survivors, win) {
  if (win) {
    const bounty = rogueDungeon(state).reward + boss.wallet;
    const crystal = rand(squadRng(state)) < L().rogueCrystalChance;
    if (crystal) state.karmaCrystals = (state.karmaCrystals ?? 0) + 1;
    state.rogueBosses = state.rogueBosses.filter((b) => b.id !== boss.id);
    const text = logText(state, "rogueSlain", { A: { name: boss.name }, bounty, crystal: crystal ? "，還掉出 1 顆因果結晶" : "" });
    emit(state, "social", text);
    addChronicle(state, "slain", text);
    bump(state, "slain");
    return { name: boss.name, win: true, bounty, crystal };
  }
  for (const s of survivors) setInjury(s, Math.min(3, s.injury + 1));
  emit(state, "social", logText(state, "rogueAppear", { A: { name: boss.name } }));
  emit(state, "social", logText(state, "rogueRetreat", { A: { name: boss.name } }));
  return { name: boss.name, win: false, bounty: 0, crystal: false };
}
