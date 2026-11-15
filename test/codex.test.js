// 2026-11 試玩回饋：詞條庫好壞判定、關卡克制關係、日誌分類、自訂分類存檔
import { test } from "node:test";
import assert from "node:assert/strict";
import { PERSON_TAGS, ENV_LIST, toneOf, envRelations, TONE_LABEL } from "../src/data/tagCodex.js";
import { LOG_CATEGORIES, categoryOf } from "../src/data/logCategories.js";
import { createNewGame, serialize, deserialize } from "../src/engine/core.js";

test("每個人物詞條都有描述與合法的好壞標示", () => {
  assert.ok(PERSON_TAGS.length >= 32);
  for (const t of PERSON_TAGS) {
    assert.ok(t.desc, `${t.id} 沒有描述`);
    assert.ok(TONE_LABEL[toneOf(t)], `${t.id} 好壞不合法`);
  }
});

test("好壞判定：只有正面＝好、只有負面＝壞、正負都有＝看情況、沒數值＝中性；tone 欄位優先", () => {
  assert.equal(toneOf({ powerPct: 0.1 }), "good");
  assert.equal(toneOf({ passBonus: -0.03 }), "bad");
  assert.equal(toneOf({ powerPct: 0.1, injuryShield: -0.15 }), "mixed");
  assert.equal(toneOf({ swing: 0.2 }), "mixed");
  assert.equal(toneOf({}), "neutral");
  assert.equal(toneOf({ powerPct: 0.1, tone: "bad" }), "bad");
});

test("關卡詞條：有克制資料的環境，克制與被克制各自列出", () => {
  for (const e of ENV_LIST) {
    const rel = envRelations(e.id);
    assert.ok(Array.isArray(rel.victims) && Array.isArray(rel.counters));
  }
  assert.ok(envRelations("mirror_world").victims.some((x) => x.tag.id === "bad_direction"));
});

test("日誌分類：七類篩選齊全，未知種類歸日常", () => {
  assert.deepEqual(LOG_CATEGORIES.map(([id]) => id), ["all", "drama", "battle", "death", "daily", "wish", "god"]);
  assert.equal(categoryOf("social"), "drama");
  assert.equal(categoryOf("death"), "death");
  assert.equal(categoryOf("wishDone"), "wish");
  assert.equal(categoryOf("godEvent"), "god");
  assert.equal(categoryOf("不存在的種類"), "daily");
});

test("詞條庫自訂分類跟著存檔走，舊存檔補預設", () => {
  const st = createNewGame(5);
  st.codex.categories.push({ id: "c1", name: "愛用", tags: ["born_strong"] });
  const back = deserialize(serialize(st));
  assert.deepEqual(back.codex.categories, [{ id: "c1", name: "愛用", tags: ["born_strong"] }]);
  const old = JSON.parse(serialize(createNewGame(6)));
  delete old.codex;
  assert.deepEqual(deserialize(JSON.stringify(old)).codex, { categories: [] });
});

test("日誌不寫入的種類：每日結算、商店等級、錢包、市集、自動閒置、保底；事件照常，舊存檔清掉", async () => {
  const { CONFIG } = await import("../src/data/config.js");
  const { emit } = await import("../src/engine/core.js");
  const hidden = ["dayEnd", "shopTier", "wallet", "market", "autoIdle", "gachaPity"];
  assert.deepEqual([...CONFIG.logHiddenTypes].sort(), [...hidden].sort());
  const st = createNewGame(9);
  st.log = [];
  for (const t of hidden) emit(st, t, `測試 ${t}`);
  emit(st, "social", "留下來");
  assert.deepEqual(st.log.map((e) => e.type), ["social"]);
  assert.equal(st.events.filter((e) => hidden.includes(e.type)).length, hidden.length);
  const old = JSON.parse(serialize(st));
  old.log.push({ day: 1, type: "dayEnd", text: "舊的每日結算" });
  assert.deepEqual(deserialize(JSON.stringify(old)).log.map((e) => e.type), ["social"]);
});

test("哈基米標籤庫：171 個人物詞條＋22 個關卡詞條齊全，每個都有描述、稀有度與好壞", async () => {
  const { CODEX_PEOPLE, CODEX_ENVS } = await import("../src/data/codexTags.js");
  const { CODEX_ALL, CODEX_ENV_ALL } = await import("../src/data/tagCodex.js");
  const { TAGS } = await import("../src/data/tags.js");
  assert.equal(CODEX_PEOPLE.length, 171);
  assert.equal(new Set(CODEX_PEOPLE.map((p) => p.no)).size, 171, "編號不重複");
  assert.equal(new Set(CODEX_ALL.map((p) => p.id)).size, CODEX_ALL.length, "詞條 id 不重複（自訂分類靠它）");
  for (const p of CODEX_PEOPLE) {
    assert.ok(p.desc && p.effect, `${p.no}.${p.name} 缺描述或效果`);
    assert.ok(["N", "R", "SR", "SSR", "UR"].includes(p.rarity), `${p.name} 稀有度`);
    assert.ok(["good", "mixed", "bad"].includes(p.tone), `${p.name} 好壞`);
  }
  assert.equal(CODEX_ENVS.length, 22);
  for (const e of CODEX_ENV_ALL) assert.ok(e.desc && e.effect && e.countered && e.favored, `${e.name} 欄位不全`);
  // 遊戲內已實裝的 30 個抽卡標籤都要對得上，詞條庫才能顯示「實際效果」與小人對照置頂
  for (const t of TAGS) assert.ok(CODEX_PEOPLE.some((p) => p.gameId === t.id), `${t.name} 沒對應到詞條庫`);
});

test("詞條庫：好壞只有三類（好／壞／中性），名稱沒有現實商標，效果文字沒有殘留的設計稿註記", async () => {
  const { CODEX_PEOPLE } = await import("../src/data/codexTags.js");
  const { TONE_LABEL: TL } = await import("../src/data/tagCodex.js");
  assert.deepEqual([...new Set(Object.values(TL))].sort(), ["中性", "壞", "好"].sort());
  for (const p of CODEX_PEOPLE) {
    assert.ok(!/拼多多|Wi-?Fi/i.test(`${p.name}${p.fullName ?? ""}`), `${p.name} 有現實商標字樣`);
    assert.equal(p.summary, undefined, `${p.name} 不該再有 summary（跟 effect 重複又容易不一致）`);
  }
});
