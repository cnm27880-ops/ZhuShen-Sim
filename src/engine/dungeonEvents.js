// 副本特殊事件引擎（露葵 2026-11-26 拍板，第 1 章試點；資料 data/dungeonEvents.js，數字 CONFIG.dungeonEvent）。
// 規則：每場副本開場（startRun）若該世界有登錄事件，就用獨立亂數流 state.dungeonEventRngState 擲 1 次決定 3 選 1；
// 走到事件房間、該房結算完（stepRun 的 results.push 之後、roomIndex += 1 之前）觸發，點到 1 名存活隊員；
// 目標選擇不擲骰；一場最多 1 次；沒有選項；不動通過率、戰力、獎勵與首通判定。
// 強制任務、洲際碰撞、位面侵蝕（星級 > 0）不觸發（貪婪隱藏房不在事件房間序號上，自然不觸發）。
import { CONFIG } from "../data/config.js";
import { DUNGEON_EVENTS } from "../data/dungeonEvents.js";
import { worldIdOf } from "../data/worlds.js";
import { getTag } from "../data/tags.js";
import { rand } from "./rng.js";
import { emit, setInjury } from "./core.js";
import { addLove, addHate } from "./relations.js";
import { setMood } from "./wishes.js";
import { logText } from "./templates.js";

const C = () => CONFIG.dungeonEvent;

/** 副本 id（引擎用的，第 1 章 1／3／5 關是語意 id）→ 該世界的事件清單；做一次快取 */
let BY_DUNGEON = null;
export function eventsOf(dungeonId) {
  if (!BY_DUNGEON) {
    BY_DUNGEON = {};
    for (const e of DUNGEON_EVENTS) (BY_DUNGEON[worldIdOf(e.world)] ??= []).push(e);
  }
  return BY_DUNGEON[dungeonId] ?? [];
}

export const getRunEvent = (id) => DUNGEON_EVENTS.find((e) => e.id === id) ?? null;

/** 獨立亂數流：把 state.dungeonEventRngState 包成 rand() 吃得下的物件 */
function eventRng(state) {
  return {
    get rngState() {
      return state.dungeonEventRngState;
    },
    set rngState(v) {
      state.dungeonEventRngState = v;
    },
  };
}

export function newDungeonEventState() {
  return { seen: {} }; // { 事件id: 遇到次數 }，第 4 步收集冊直接讀
}

/** 這場副本能不能有事件（開關、章節、動態副本、侵蝕） */
function eligible(dungeon, run) {
  const c = C();
  return c.enabled && !run.mandatory && !run.rival && !(run.erosion > 0) && c.chapters.includes(dungeon.chapter);
}

/** 開場擲 1 次決定這場的事件，回傳事件 id 或 null。沒登錄事件的副本不擲，所以不消耗亂數 */
export function rollRunEvent(state, dungeon, run) {
  if (!eligible(dungeon, run)) return null;
  const list = eventsOf(run.dungeonId);
  if (list.length === 0) return null;
  state.dungeonEventRngState ??= (state.rngState ^ 0xdee7) | 0;
  return list[Math.floor(rand(eventRng(state)) * list.length)].id;
}

const byId = (a, b) => (typeof a.id === "number" && typeof b.id === "number" ? a.id - b.id : String(a.id).localeCompare(String(b.id)));
const hasTag = (s, name) => (s.tags ?? []).some((id) => getTag(id)?.name === name);

/** 目標選擇（不擲骰）：有指定詞條就選身上有的人（id 最小）；否則 id 最小的存活隊員。
 *  「治好輕傷」事件例外：優先選真的有輕傷可治的人（詞條持有者優先），否則急救包會白白浪費 */
export function pickTarget(ev, party) {
  const alive = [...party].sort(byId);
  if (alive.length === 0) return null;
  const tagged = ev.tag ? alive.filter((s) => hasTag(s, ev.tag)) : [];
  if (ev.fx.kind === "injury" && ev.fx.mode === "heal") {
    const hurtTagged = tagged.find((s) => s.injury === 1);
    if (hurtTagged) return hurtTagged;
    const hurtAny = alive.find((s) => s.injury === 1);
    if (hurtAny) return hurtAny;
  }
  return tagged[0] ?? alive[0];
}

/** 套效果，回傳這次有沒有真的改到東西 */
function applyFx(state, ev, target, party, dungeon) {
  const c = C();
  const fx = ev.fx;
  switch (fx.kind) {
    case "sanity": {
      const v = Math.max(c.sanityMin, Math.min(c.sanityMax, fx.value));
      const cur = target.stats.sanity;
      const next = v < 0 ? Math.min(cur, Math.max(c.sanityFloor, cur + v)) : Math.min(100, cur + v);
      target.stats.sanity = next;
      return next !== cur;
    }
    case "injury": {
      if (fx.mode === "hurt" && target.injury === 0) return setInjury(target, 1), true;
      if (fx.mode === "heal" && target.injury === 1) return setInjury(target, 0), true;
      return false;
    }
    case "points": {
      const delta = Math.round(fx.value * (c.chapterMult[dungeon.chapter - 1] ?? 1));
      const cur = state.points;
      state.points = delta < 0 ? Math.min(cur, Math.max(0, cur + delta)) : cur + delta; // 直接動公庫：不經 distributeLoot、不記考核營收、不算累積花費、扣款不低於 0
      return state.points !== cur;
    }
    case "relation": {
      const other = [...party].sort(byId).find((s) => s.id !== target.id);
      if (!other) return false;
      const add = fx.mode === "hate" ? addHate : addLove;
      add(state, target, other, fx.value);
      if (c.relationBothWays) add(state, other, target, fx.value);
      return true;
    }
    case "mood":
      setMood(state, target, fx.value);
      return true;
    default:
      throw new Error(`未知的副本事件效果：${fx.kind}`);
  }
}

/** stepRun 在房間結算完、roomIndex 還沒 +1 時呼叫（run.roomIndex = 剛結算完的房間序號）。party = 此刻仍在名冊的隊員 */
export function maybeFireRunEvent(state, run, dungeon, party) {
  if (!run.eventId || run.eventFired) return;
  const ev = getRunEvent(run.eventId);
  if (!ev || run.roomIndex !== ev.room) return;
  const target = pickTarget(ev, party);
  if (!target) return; // 隊伍已經沒人了：不觸發、不記錄
  run.eventFired = true;
  const applied = applyFx(state, ev, target, party, dungeon);
  const fill = (t) => t.replaceAll("{name}", target.name);
  const line = applied ? fill(ev.log) : logText(state, "runDungeonEventNoop", { A: target, dungeon: dungeon.name, event: ev.name });
  (run.events ??= []).push({ id: ev.id, name: ev.name, targetId: target.id, targetName: target.name, text: fill(ev.text), line, applied, kind: ev.fx.kind });
  const seen = ((state.dungeonEvents ??= newDungeonEventState()).seen ??= {});
  seen[ev.id] = (seen[ev.id] ?? 0) + 1;
  emit(state, "dungeonEvent", `✨ [${dungeon.name}・${ev.name}] ${line}`, { eventId: ev.id, applied });
}
