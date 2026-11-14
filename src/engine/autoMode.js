// 自動小幫手三種模式（功能 4）：一次設好自動派遣開關、派遣策略與自動暫停清單。純規則，不碰畫面。
// 模式定義在 CONFIG 同檔的 AUTO_MODES；這裡不存「現在是哪個模式」，而是每次比對目前設定算出來，所以玩家用進階自訂改過就會顯示「自訂」。

import { AUTO_MODES, PAUSE_EVENTS } from "../data/config.js";

/** 這個模式要暫停的事件清單 → { 事件種類: true/false }（涵蓋 PAUSE_EVENTS 全部種類） */
export function pauseSetOf(mode) {
  const out = {};
  for (const [key, def] of Object.entries(PAUSE_EVENTS)) {
    out[key] = mode.pause === "all" ? true : mode.pause === "major" ? def.default : mode.pause.includes(key);
  }
  return out;
}

/** 套用模式。回傳套用後的模式 id；id 不存在回 null */
export function applyAutoMode(state, id) {
  const mode = AUTO_MODES[id];
  if (!mode) return null;
  state.settings.autoDispatch = mode.autoDispatch;
  if (mode.strategy) state.autoStrategy = mode.strategy;
  state.settings.pauseOn = { ...state.settings.pauseOn, ...pauseSetOf(mode) };
  return id;
}

/** 目前設定符合哪個模式？都不符合就是 "custom"（進階自訂過） */
export function currentAutoMode(state) {
  for (const [id, mode] of Object.entries(AUTO_MODES)) {
    if (state.settings.autoDispatch !== mode.autoDispatch) continue;
    if (mode.strategy && (state.autoStrategy ?? "balanced") !== mode.strategy) continue;
    const want = pauseSetOf(mode);
    if (Object.entries(want).every(([k, v]) => !!state.settings.pauseOn[k] === v)) return id;
  }
  return "custom";
}
