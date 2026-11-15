// 排行榜成績：從遊戲狀態算出要送給後端的資料。純函式，不碰畫面與網路。
//   level  空間等級
//   roster 目前輪迴者人數
//   clears 副本通關數（所有副本累計成功通關次數，含重打）
//   power  最強輪迴者：活著的人（現有有效戰力）與墓園裡的人（死亡當下的戰力）之中最高的一位
//   life   最長壽輪迴者：存活天數 = 今天（或死亡日）− 加入日，活著與已死的都算

import { currentDay } from "./core.js";
import { effectivePower } from "./tags.js";

const CAP = { power: 1_000_000_000, life: 100_000, roster: 500 }; // 跟 worker/limits.js 的上限一致，避免被後端退件

export function buildScorePayload(state) {
  const today = currentDay(state);
  let power = { v: 0, name: "" };
  let life = { v: 0, name: "" };
  const consider = (p, days, name) => {
    if (p > power.v) power = { v: p, name };
    if (days > life.v) life = { v: days, name };
  };
  for (const s of state.samsarites) consider(effectivePower(s), today - (s.joinedDay ?? 1), s.name);
  for (const g of state.graveyard ?? []) {
    const b = g.bio;
    if (!b) continue;
    consider(b.power ?? 0, (b.deathDay ?? g.day ?? today) - (b.joinedDay ?? 1), g.name);
  }
  const clears = Object.values(state.dungeonStats ?? {}).reduce((n, st) => n + (st.clears ?? 0), 0);
  const int = (v, hi) => Math.max(0, Math.min(hi, Math.floor(v)));
  return {
    level: Math.max(1, Math.min(5, state.spaceLevel ?? 1)),
    roster: int(state.samsarites.length, CAP.roster),
    clears: int(clears, 1_000_000),
    power: int(power.v, CAP.power),
    powerName: power.name,
    life: int(life.v, CAP.life),
    lifeName: life.name,
  };
}
