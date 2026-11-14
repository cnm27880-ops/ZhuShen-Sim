// 副本資料表（Phase 4-A：五章 × 4 關 = 20 個副本）。
// chapter：第幾章（1~5，空間等級 ≥ 章節才解鎖）；boss：true = 本章尾王（首通讓空間升 1 級）。
// rooms：房間陣列，長度必須等於 CONFIG.dungeon.chapters 該章的 rooms（5/7/8/10/12，測試會檢查）；
//   每個房間有「通過」與「失敗」兩種日誌文字，{name} 會被換成受害者名字。
// recommendedPower／reward：Phase 4-A 是基準草稿（露葵 2026-11-14 給的表）；Phase 4-B 依 npm run sim -- --seeds=100 --days=900 校正：
//   尾王 R 倍率 ×1.8／2.4／2.5／2.0／0.65、第 5 章一般關 R ×0.6、各章獎勵 ×1／2.5／4.5／9／8（原基準表見 git 歷史）。
//   校正目標：各章尾王首通中位數約 Day 30／80／165／300／450（見 CLAUDE.md 的 4-B 摘要）。
// Phase 4-C-6：維持費改制＋空投＋副屬性＋英靈碑之後經濟過寬，依 npm run sim -- --seeds=100 --days=900 再校正：
//   獎勵倍率回調（相對 4-B 的值）第 2～5 章 ×1／0.6／0.4／0.4（即相對 4-A 原始表 ×2.5／2.7／3.6／3.2）；
//   R 再乘：第 2 章 ×1.1、第 3 章一般 ×1.6／尾王 ×2.2、第 4 章 ×1.6、第 5 章 ×1.4（積分不再是瓶頸，進度由 R 決定）。
// 第 1 章前 3 關沿用舊的 3 個副本；其他 17 關目前是佔位資料（名字、房間文字、特殊獎勵之後再補，只改這個檔案）。
// Phase 4-D-4：擴編成 30 個世界（每章 5 張常規 + 1 張尾王，id 清單見 data/worlds.js）。第 1 章的 3 個真實世界保留 R／獎勵，
//   其餘常規關由「該章 4-C 校正好的最低 R／獎勵」到「最高 R／獎勵」等比內插成 5 關；尾王維持原 R 與獎勵（bossGate 仍是該章常規關累計 8 次）。
//   舊 id（chN_1～chN_4）的存檔遷移見 data/worlds.js 的 LEGACY_WORLD_IDS 與 engine/core.js deserialize。
// 全部是原創世界觀。

import { CONFIG } from "./config.js";
import { WORLD_LIST } from "./worlds.js";

// 佔位房間：n 間通用文字，最後一間是首領房
function placeholderRooms(n) {
  return Array.from({ length: n }, (_, i) => ({
    name: i === n - 1 ? "首領房（待命名）" : `第 ${i + 1} 區（待命名）`,
    pass: "小隊有驚無險地通過了這一區。（佔位文字）",
    fail: "{name}在混亂中被打中了。（佔位文字）",
  }));
}

const PLACEHOLDER_GENRES = ["靈異", "科幻", "奇幻"];

// 佔位副本：世界 id（見 data/worlds.js）、第幾關（1~5 常規，0 = 尾王）、推薦戰力、基礎獎勵
function placeholder(id, chapter, slot, recommendedPower, reward) {
  const boss = slot === 0;
  return {
    id,
    name: boss ? `第 ${chapter} 章尾王（待命名）` : `第 ${chapter} 章・第 ${slot} 關（待命名）`,
    chapter,
    boss,
    genre: PLACEHOLDER_GENRES[(chapter + slot) % PLACEHOLDER_GENRES.length],
    icon: boss ? "👹" : "🌀",
    recommendedPower,
    reward,
    specialRewards: [],
    intro: "（佔位副本，世界觀待補）",
    rooms: placeholderRooms(CONFIG.dungeon.chapters[chapter - 1].rooms),
  };
}

// 各章「一般關」由最低到最高等比內插成 5 關（4-C 校正好的 R／獎勵錨點：[最低, 最高]）與尾王
const CHAPTER_ANCHOR = {
  1: { r: [90, 185], reward: [95, 165], boss: [468, 230] },
  2: { r: [418, 836], reward: [850, 1500], boss: [2772, 2050] },
  3: { r: [2480, 4960], reward: [3105, 5400], boss: [24200, 7290] },
  4: { r: [10240, 20480], reward: [12960, 23040], boss: [57600, 30960] },
  5: { r: [21840, 43680], reward: [36800, 64000], boss: [65520, 89600] },
};
const spread = ([lo, hi], i) => Math.round(lo * (hi / lo) ** (i / 4));

const REAL_WORLDS = [
  {
    id: "ghost_village",
    name: "霧隱荒村",
    chapter: 1,
    boss: false,
    genre: "靈異",
    icon: "🏚️",
    recommendedPower: 90,
    reward: 95,
    specialRewards: [
      { id: "ghost_talisman", name: "鬼道術法・引魂符", desc: "靈異副本通過率 +8%。", effect: { genreBonus: { 靈異: 0.08 } } },
      { id: "ghost_seal", name: "鬼道術法・封煞咒", desc: "全員受傷時多 10% 機率少受一級。", effect: { injuryShield: 0.1 } },
      { id: "yin_yang_eye", name: "陰陽眼", desc: "所有副本通過率 +3%。", effect: { passBonus: 0.03 } },
    ],
    intro: "終年不散的霧、沒有人上香的祖祠、門口排排站的紙紮人。",
    rooms: [
      { name: "村口牌坊", pass: "小隊屏住呼吸，從紙紮人的隊伍中間穿了過去。", fail: "紙紮人的頭齊刷刷轉了過來，{name}被紙手抓出一道血痕。" },
      { name: "無人曬穀場", pass: "石磨自己在轉，沒有人多看一眼，安全通過。", fail: "{name}多看了石磨一眼，磨盤裡伸出一隻手。" },
      { name: "祖先祠堂", pass: "牌位上的名字一個個亮起，小隊恭敬上香，全身而退。", fail: "{name}發現牌位上寫著自己的名字，當場吐了一口黑血。" },
      { name: "枯井", pass: "井底傳來哭聲，小隊果斷繞路。", fail: "{name}被井繩纏住腳踝拖行了十幾公尺。" },
      { name: "餓鬼宴席", pass: "滿桌酒菜沒有人動筷子，餓鬼們悻悻然散去。", fail: "{name}被餓鬼按在桌上咬了好幾口。" },
    ],
  },
  {
    id: "silent_ark",
    name: "沉默方舟號",
    chapter: 1,
    boss: false,
    genre: "科幻",
    icon: "🚀",
    recommendedPower: 130,
    reward: 125,
    specialRewards: [
      { id: "ark_accelerator", name: "科技改造・神經加速器", desc: "所有副本通過率 +4%。", effect: { passBonus: 0.04 } },
      { id: "ark_prosthetic", name: "義體・強化義肢", desc: "全員受傷時多 15% 機率少受一級。", effect: { injuryShield: 0.15 } },
      { id: "ark_cutter", name: "外星武器・脈衝切割器", desc: "科幻副本通過率 +10%。", effect: { genreBonus: { 科幻: 0.1 } } },
    ],
    intro: "失去動力的殖民船，走廊只剩緊急照明，通風管裡有東西在爬。",
    rooms: [
      { name: "氣閘艙", pass: "手動開啟氣閘，氧氣存量還夠。", fail: "氣閘失壓，{name}被甩到艙壁上。" },
      { name: "冷凍艙", pass: "冷凍艙裡的東西還沒醒，小隊躡手躡腳通過。", fail: "一個冷凍艙從裡面被打開了，{name}首當其衝。" },
      { name: "黑暗主走廊", pass: "靠著緊急照明摸黑前進，沒有驚動任何東西。", fail: "天花板滴下黏液，{name}抬頭的瞬間被拖進通風管又掉了出來。" },
      { name: "反應爐室", pass: "成功重啟一組輔助電源。", fail: "冷卻液外洩，{name}被大面積灼傷。" },
      { name: "艦橋", pass: "鎖死艦橋艙門，把那東西關在了外面。", fail: "那東西早就在艦橋等著了，{name}被利爪貫穿肩膀。" },
    ],
  },
  {
    id: "ember_war",
    name: "燼塔戰爭",
    chapter: 1,
    boss: false,
    genre: "奇幻",
    icon: "🔥",
    recommendedPower: 185,
    reward: 165,
    specialRewards: [
      { id: "ember_firebolt", name: "魔法・火焰箭", desc: "奇幻副本通過率 +10%。", effect: { genreBonus: { 奇幻: 0.1 } } },
      { id: "ember_staff", name: "魔杖・燼木法杖", desc: "所有副本通關積分 +10%。", effect: { rewardPct: 0.1 } },
      { id: "ember_blood", name: "魔法血統・燼裔", desc: "所有副本通過率 +5%。", effect: { passBonus: 0.05 } },
    ],
    intro: "兩座法師塔對轟了三百年，天空下的是火，地上跑的是失控的魔法生物。",
    rooms: [
      { name: "魔法風暴荒原", pass: "抓準風暴的間隙衝過了荒原。", fail: "一道失控的雷鏈掃過，{name}被電得渾身冒煙。" },
      { name: "傀儡哨站", pass: "趁魔像換班，拆掉了哨站的核心。", fail: "魔像一拳砸下，{name}連人帶盾飛了出去。" },
      { name: "燃燒的城堡", pass: "在樑柱倒塌前穿過了大廳。", fail: "燃燒的吊燈砸下來，{name}被壓在下面。" },
      { name: "敵對法師團", pass: "打斷了對方的集體詠唱，法術反噬了他們自己。", fail: "對方詠唱完成，{name}被冰槍釘在牆上。" },
      { name: "塔頂核心", pass: "核心水晶碎裂，三百年的戰爭少了一座塔。", fail: "核心暴走，{name}被魔力洪流正面吞沒。" },
    ],
  },
];

// 依 WORLD_LIST 順序組成最終的 30 張：有真實內容的（第 1 章前 3 個世界）直接用，其餘產生佔位資料
const REAL = new Map(REAL_WORLDS.map((d) => [d.id, d]));
export const DUNGEONS = WORLD_LIST.map((w) => {
  if (REAL.has(w.id)) return REAL.get(w.id);
  const a = CHAPTER_ANCHOR[w.chapter];
  if (w.boss) return placeholder(w.id, w.chapter, 0, a.boss[0], a.boss[1]);
  const slot = WORLD_LIST.filter((x) => x.chapter === w.chapter && !x.boss).findIndex((x) => x.id === w.id); // 0~4
  return placeholder(w.id, w.chapter, slot + 1, spread(a.r, slot), spread(a.reward, slot));
});

export function getDungeon(id) {
  return DUNGEONS.find((d) => d.id === id);
}

// 副本特殊獎勵（首通掉落，永久生效）。state.collection 存的是獎勵 id。
// effect 欄位：passBonus 所有副本單房通過率、genreBonus { 類型: 加成 }、rewardPct 通關積分加成、injuryShield 全員傷勢減免機率
export function getSpecialReward(id) {
  for (const d of DUNGEONS) {
    const hit = (d.specialRewards ?? []).find((r) => r.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/** 舊存檔的收藏是「名字」，用名字找回獎勵（找不到回傳 undefined） */
export function findSpecialRewardByName(name) {
  for (const d of DUNGEONS) {
    const hit = (d.specialRewards ?? []).find((r) => r.name === name);
    if (hit) return hit;
  }
  return undefined;
}
