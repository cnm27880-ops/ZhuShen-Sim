// Phase 2-C：日誌 Mad Libs 模板的測試
import { test } from "node:test";
import assert from "node:assert/strict";
import { LOGS, REACTIONS } from "../src/data/logs.js";
import { SOCIAL_EVENTS, SCHEMES, TAG_SPECIALS, DISCOVER_TEXTS } from "../src/data/relations.js";
import { renderTemplate, logText } from "../src/engine/templates.js";
import { createNewGame } from "../src/engine/core.js";

const person = (name, tags = []) => ({ name, tags });
// 替模板用到的每個欄位都塞假資料（A~D 給人，其他給字串）
function dummyVars(template) {
  const vars = {};
  for (const [, key] of template.matchAll(/\{([\w:]+)\}/g)) {
    if (key.startsWith("react:")) continue;
    vars[key] = /^[A-D]$/.test(key) ? person(`人${key}`) : `值${key}`;
  }
  for (const k of ["A", "B", "C", "D"]) vars[k] ??= person(`人${k}`);
  return vars;
}
function allTemplates() {
  const list = [];
  for (const [key, arr] of Object.entries(LOGS)) arr.forEach((t) => list.push([key, t]));
  for (const ev of [...SOCIAL_EVENTS, ...SCHEMES, ...TAG_SPECIALS]) ev.texts.forEach((t) => list.push([ev.id ?? ev.tag, t]));
  DISCOVER_TEXTS.forEach((t) => list.push(["discover", t]));
  return list.filter(([, t]) => t !== ""); // 告白事件本身沒有文字（由 confessOk/confessFail 負責）
}

test("所有模板都能填滿：沒有殘留的 {欄位} 或 ?", () => {
  for (const [key, t] of allTemplates()) {
    const out = renderTemplate(t, dummyVars(t), "seed");
    assert.ok(!/[{}?]/.test(out), `模板 ${key} 填完還有問題：${out}`);
  }
});

test("每個日誌 key 至少有 2 個版本，事件資料表也是", () => {
  for (const [key, arr] of Object.entries(LOGS)) assert.ok(arr.length >= 2, `${key} 版本太少`);
  for (const ev of [...SOCIAL_EVENTS.filter((e) => e.id !== "confess"), ...SCHEMES, ...TAG_SPECIALS]) {
    assert.ok(ev.texts.length >= 3, `${ev.id ?? ev.tag} 版本太少`);
  }
  assert.ok(DISCOVER_TEXTS.length >= 3);
});

test("反應池：每個池都有 default，標籤對應的句子真的會被用到", () => {
  for (const [pool, table] of Object.entries(REACTIONS)) assert.ok(table.default?.length > 0, `${pool} 缺 default`);
  const tagged = person("小綠", ["green_tea"]);
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(renderTemplate("{react:angry:A}", { A: tagged }, `s${i}`));
  assert.ok([...seen].every((x) => REACTIONS.angry.green_tea.includes(x)));
  assert.equal(renderTemplate("{react:angry:A}", { A: person("路人") }, "x") !== "?", true);
});

test("同樣的操作順序 → 同樣的文字（可重現）", () => {
  const run = () => {
    const s = createNewGame(123);
    return Array.from({ length: 12 }, () => logText(s, "dayEnd", { day: 1, home: 3, cost: 30 }));
  };
  assert.deepEqual(run(), run());
});

test("抽版本不消耗主亂數，也會抽到不同版本", () => {
  const s = createNewGame(7);
  const before = s.rngState;
  const seen = new Set();
  for (let i = 0; i < 30; i++) seen.add(logText(s, "dayEnd", { day: 1, home: 3, cost: 30 }));
  assert.equal(s.rngState, before);
  assert.ok(seen.size >= 2, "30 次都抽到同一個版本");
});

test("找不到模板會丟錯，缺欄位會顯示 ?", () => {
  const s = createNewGame(1);
  assert.throws(() => logText(s, "不存在的key"));
  assert.equal(renderTemplate("{X}", {}), "?");
});
