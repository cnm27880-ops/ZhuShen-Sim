// Phase 4-E-1：隊長冊封、選人不選流派、三軌繼承（和平順延／雙強奪權／主神撤換令）、舊存檔補欄位
import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/data/config.js";
import { createNewGame, createSamsarite, killSamsarite, recycle, serialize, deserialize, setInjury } from "../src/engine/core.js";
import { effectivePower } from "../src/engine/tags.js";
import {
  deriveSquadStyle, candidateStyle, appointCaptain, replaceCaptain, replacePreview, checkReplace, dailySquad,
  captainOf, styleOf, squadUnlocked, failSanityLoss, worthOf,
} from "../src/engine/squad.js";
import { getRel, shiftAffinity, affinity } from "../src/engine/relations.js";

/** n 個無標籤 C 級；level：空間等級。power 可逐人指定 */
function setup(n = 4, { level = 2, seed = 11, powers = [] } = {}) {
  const state = createNewGame(seed);
  state.samsarites = [];
  state.spaceLevel = level;
  state.points = 100000;
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, "C");
    s.tags = [];
    s.stats.power = powers[i] ?? 30;
    s.joinedDay = 1;
    state.samsarites.push(s);
  }
  return state;
}

test("流派映射：詞條 → 流派；中性歸共生羈絆；平手依優先序", () => {
  const mk = (tags) => ({ tags });
  assert.equal(deriveSquadStyle(mk(["lecturer"])), "communal");
  assert.equal(deriveSquadStyle(mk(["mad_matchmaker"])), "bond");
  assert.equal(deriveSquadStyle(mk(["smiling_tiger"])), "farming");
  assert.equal(deriveSquadStyle(mk(["demon_path"])), "elite");
  assert.equal(deriveSquadStyle(mk(["salary_thief"])), "mercenary");
  assert.equal(deriveSquadStyle(mk([])), "bond", "沒有可對應詞條：共生羈絆流（中性預設）");
  assert.equal(deriveSquadStyle(mk(["bad_direction", "blood_allergy"])), "bond");
  // 分數累加：背刺 2 + 笑面虎 3 = 養殖 5，贏過天生神力 2
  assert.equal(deriveSquadStyle(mk(["backstabber", "smiling_tiger", "born_strong"])), "farming");
  // 平手（communal 2 vs elite 2）：依 TIE_ORDER，共產優先
  assert.equal(deriveSquadStyle(mk(["lecturer", "born_strong"])), "communal");
  // 明牌：任命前就能看到會開啟哪個流派
  assert.equal(candidateStyle(mk(["demon_path"])).name, "叢林菁英流");
});

test("空間 Lv.1 隊長系統沒啟用；Lv.2 每日結算自動冊封戰力最高者，隊長 +8% 個人戰力", () => {
  const state = setup(3, { level: 1, powers: [30, 50, 40] });
  assert.equal(squadUnlocked(state), false);
  dailySquad(state);
  assert.equal(state.squad.captainId, null);
  assert.equal(appointCaptain(state, state.samsarites[0].id).ok, false);

  state.spaceLevel = 2;
  const strongest = state.samsarites[1];
  const base = effectivePower(strongest);
  dailySquad(state);
  assert.equal(state.squad.captainId, strongest.id, "自動冊封戰力最高者");
  assert.equal(captainOf(state).id, strongest.id);
  assert.ok(effectivePower(strongest) > base, "隊長戰力加成");
  assert.equal(effectivePower(strongest), Math.round(strongest.stats.power * (1 + CONFIG.squad.captainPowerPct)));
  assert.equal(state.squad.style, "bond", "無詞條 → 共生羈絆流");
  assert.equal(styleOf(state), "bond");
  assert.ok(state.chronicles.length >= 1);
});

test("首次指派免費；已有隊長不能再用 appointCaptain；隊長在隊時單房失敗理智損耗 -1（最少 1）", () => {
  const state = setup(3);
  const [a, b] = state.samsarites;
  const before = state.points;
  assert.equal(appointCaptain(state, a.id).ok, true);
  assert.equal(state.points, before, "免費");
  assert.equal(appointCaptain(state, b.id).ok, false);
  assert.equal(failSanityLoss(state, [a, b], 5), 4);
  assert.equal(failSanityLoss(state, [b], 5), 5, "隊長沒隨隊就不減");
  assert.equal(failSanityLoss(state, [a], 1), 1, "最少扣 1");
});

test("和平順延：隊長陣亡 → 依原流派標準提拔（共產／羈絆看資歷＋好感）", () => {
  const state = setup(4, { powers: [60, 30, 30, 30] });
  const [cap, old, mid, rookie] = state.samsarites;
  cap.tags = ["lecturer"]; // 共產流
  old.joinedDay = -200; // 資歷最深（天數差遠超過好感影響）
  appointCaptain(state, cap.id);
  assert.equal(state.squad.style, "communal");
  killSamsarite(state, cap, "測試", null);
  assert.equal(captainOf(state), null, "暴斃後到結算前沒有隊長");
  dailySquad(state);
  assert.equal(state.squad.captainId, old.id, "資歷最深者接任");
  assert.equal(state.squad.captainSeq, 2);
});

test("和平順延：養殖／菁英看最高戰力；傭兵看私房錢＋裝備身價", () => {
  const a = setup(4, { powers: [60, 30, 30, 40] });
  a.samsarites[0].tags = ["smiling_tiger"];
  appointCaptain(a, a.samsarites[0].id);
  assert.equal(a.squad.style, "farming");
  const [, , , strong] = a.samsarites;
  killSamsarite(a, a.samsarites[0], "測試", null);
  dailySquad(a);
  assert.equal(a.squad.captainId, strong.id, "戰力最高者接任");

  const m = setup(4, { powers: [60, 30, 30, 30] });
  m.samsarites[0].tags = ["salary_thief"]; // 傭兵流
  appointCaptain(m, m.samsarites[0].id);
  assert.equal(m.squad.style, "mercenary");
  const rich = m.samsarites[2];
  rich.wallet = 800;
  rich.gear = { weapon: "weapon_club" };
  assert.ok(worthOf(rich) > 0);
  killSamsarite(m, m.samsarites[0], "測試", null);
  dailySquad(m);
  assert.equal(m.squad.captainId, rich.id, "最有錢的接任");
});

test("隊長被回收也一樣走順延", () => {
  const state = setup(3);
  appointCaptain(state, state.samsarites[0].id);
  const first = state.samsarites[0].id;
  assert.equal(recycle(state, first), true);
  dailySquad(state);
  assert.ok(state.squad.captainId && state.squad.captainId !== first);
  assert.equal(state.squad.captainSeq, 2);
});

test("雙強奪權：戰力前兩名差距 < 15% 且流派不同 → 隊長印記爭奪戰，敗者 injury+1、理智 -10", () => {
  const state = setup(4, { powers: [80, 100, 118, 20] });
  const [cap, a, b] = state.samsarites; // a 菁英 +8% = 108、b 傭兵 -10% 但 118 → 106（差距 < 15%）
  a.tags = ["demon_path"]; // 菁英
  b.tags = ["salary_thief"]; // 傭兵 → 流派不同
  appointCaptain(state, cap.id);
  killSamsarite(state, cap, "測試", null);
  dailySquad(state);
  const winner = captainOf(state);
  assert.ok([a.id, b.id].includes(winner.id));
  const loser = winner.id === a.id ? b : a;
  assert.equal(loser.injury, 1);
  assert.equal(loser.stats.sanity, 100 - CONFIG.squad.coupLoserSanity);
  assert.equal(state.squad.style, deriveSquadStyle(winner), "流派瞬間變天");
  assert.ok(state.chronicles.some((c) => c.kind === "coup"));
});

test("雙強奪權：差距太大或流派相同又無宿怨 → 不奪權（和平順延）；有宿怨則奪權", () => {
  // 差距 > 15%：不奪權
  const s1 = setup(4, { powers: [80, 100, 60, 20] });
  s1.samsarites[1].tags = ["demon_path"];
  s1.samsarites[2].tags = ["salary_thief"];
  appointCaptain(s1, s1.samsarites[0].id);
  killSamsarite(s1, s1.samsarites[0], "測試", null);
  dailySquad(s1);
  assert.equal(s1.chronicles.filter((c) => c.kind === "coup").length, 0);
  assert.equal(s1.samsarites.every((s) => s.injury === 0), true);

  // 差距 < 15%、流派相同（都無詞條 → 都是羈絆）、沒宿怨 → 不奪權
  const s2 = setup(4, { powers: [80, 100, 95, 20] });
  appointCaptain(s2, s2.samsarites[0].id);
  killSamsarite(s2, s2.samsarites[0], "測試", null);
  dailySquad(s2);
  assert.equal(s2.chronicles.filter((c) => c.kind === "coup").length, 0);

  // 同流派但雙方淨好感都 < -15 → 奪權
  const s3 = setup(4, { powers: [80, 100, 95, 20] });
  const [c3, x, y] = s3.samsarites;
  appointCaptain(s3, c3.id);
  shiftAffinity(s3, x, y, -30);
  shiftAffinity(s3, y, x, -30);
  assert.ok(affinity(s3, x, y) < -15);
  killSamsarite(s3, c3, "測試", null);
  dailySquad(s3);
  assert.equal(s3.chronicles.filter((c) => c.kind === "coup").length, 1);
});

test("淨好感：扣好感先扣 love、扣光轉成 hate", () => {
  const state = setup(2);
  const [a, b] = state.samsarites;
  shiftAffinity(state, a, b, 10);
  assert.equal(getRel(state, a, b).love, 10);
  shiftAffinity(state, a, b, -25);
  assert.equal(getRel(state, a, b).love, 0);
  assert.equal(getRel(state, a, b).hate, 15);
  assert.equal(affinity(state, a, b), -15);
});

test("主神撤換令：花 500×空間等級 ＋ 1 顆結晶；不夠就不行", () => {
  const state = setup(4, { level: 3, powers: [50, 50, 50, 50] });
  const [cap, other] = state.samsarites;
  appointCaptain(state, cap.id);
  assert.equal(checkReplace(state, other.id).ok, false, "沒結晶");
  state.karmaCrystals = 1;
  const before = state.points;
  const r = replaceCaptain(state, other.id);
  assert.equal(r.ok, true);
  assert.equal(state.points, before - 1500);
  assert.equal(state.karmaCrystals, 0);
  assert.equal(state.squad.captainId, other.id);
  assert.equal(replaceCaptain(state, other.id).ok, false, "不能撤換成自己");
  // 積分不夠
  state.karmaCrystals = 1;
  state.points = -4000;
  assert.equal(checkReplace(state, cap.id).ok, false);
});

test("不服空降：新隊長戰力 < 最強老鳥 70% → 比他強的老鳥理智 -15、對他好感 -20；事前預覽看得到", () => {
  const state = setup(4, { powers: [100, 90, 40, 80] });
  const [boss, a, weak, b] = state.samsarites;
  appointCaptain(state, boss.id);
  state.karmaCrystals = 2;
  const pv = replacePreview(state, weak.id);
  assert.deepEqual(pv.snub.map((s) => s.id).sort(), [boss.id, a.id, b.id].sort());
  assert.equal(pv.cost, 1000);
  const r = replaceCaptain(state, weak.id);
  assert.equal(r.ok, true);
  for (const o of [boss, a, b]) {
    assert.equal(o.stats.sanity, 100 - CONFIG.squad.snubSanity);
    assert.equal(affinity(state, o, weak), -CONFIG.squad.snubAffinity);
  }
  assert.ok(state.chronicles.some((c) => c.kind === "snub"));

  // 戰力夠（>= 70%）就不會不服
  const s2 = setup(3, { powers: [100, 80, 78] }); // 隊長自帶 +8% = 108，78 ÷ 108 = 72% ≥ 70%
  appointCaptain(s2, s2.samsarites[0].id);
  s2.karmaCrystals = 1;
  assert.equal(replacePreview(s2, s2.samsarites[2].id).snub.length, 0);
  replaceCaptain(s2, s2.samsarites[2].id);
  assert.equal(s2.samsarites[0].stats.sanity, 100);
});

test("隊長缺位時任命免費；舊存檔載入補齊 squad／編年史／遺物／叛逃 Boss／亂數流", () => {
  const state = setup(3);
  const old = JSON.parse(serialize(state));
  delete old.squadRngState;
  delete old.chronicles;
  delete old.armoryHeirlooms;
  delete old.rogueBosses;
  old.squad = { captainId: null, style: null };
  for (const s of old.samsarites) delete s.generation;
  const loaded = deserialize(JSON.stringify(old));
  assert.equal(typeof loaded.squadRngState, "number");
  assert.deepEqual(loaded.chronicles, []);
  assert.deepEqual(loaded.armoryHeirlooms, []);
  assert.deepEqual(loaded.rogueBosses, []);
  assert.equal(loaded.squad.communalFund, 0);
  assert.equal(loaded.samsarites[0].generation, 1);

  setInjury(loaded.samsarites[0], 0);
  assert.equal(replaceCaptain(loaded, loaded.samsarites[0].id).ok, true, "缺位：走免費任命");
  const reloaded = deserialize(serialize(loaded));
  assert.equal(reloaded.squad.captainId, loaded.samsarites[0].id);
  assert.equal(reloaded.samsarites[0].captainBonus, CONFIG.squad.captainPowerPct, "讀檔後隊長加成重新寫入");
});
