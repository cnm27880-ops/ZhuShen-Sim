// 自動暫停的新警報（問題 5）：有人重傷／致命傷、理智低於 20。
// 不掛在每個扣血／扣理智的地方（呼叫點太多），而是每一步掃一次名冊；
// 每人每種警報只在「剛跨過門檻」時提醒一次，恢復到門檻之外才會重新武裝（旗標存在輪迴者身上，舊存檔沒有就當 false）。

import { ALERT_LEVELS, INJURIES } from "../data/config.js";
import { emit } from "./core.js";
import { addLifeOnce } from "./life.js";
import { logText } from "./templates.js";

export function checkAlerts(state) {
  for (const s of state.samsarites) {
    if (s.location === "pod") continue;
    if (s.injury > 0) addLifeOnce(state, s, "firstInjury", "injury", `第一次受傷（${INJURIES[s.injury].name}）。`); // 一生大事記（功能 5）
    if (s.injury >= 3) s.lifeFlags = { ...(s.lifeFlags ?? {}), survivedFatal: true };
    const severe = s.injury >= ALERT_LEVELS.severeInjury;
    if (severe && !s.alertInjury) emit(state, "injurySevere", logText(state, "injurySevere", { A: s, inj: INJURIES[s.injury].name }));
    s.alertInjury = severe;
    const low = s.stats.sanity < ALERT_LEVELS.lowSanity;
    if (low && !s.alertSanity) emit(state, "lowSanity", logText(state, "lowSanity", { A: s, san: Math.round(s.stats.sanity) }));
    s.alertSanity = low;
  }
}
