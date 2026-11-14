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
// Phase 4-D-6：雙錢包（輪迴者私房錢自己換裝／強化）、血統、奇物（全隊 +最多 25%）讓後期變強太快，依 npm run sim -- --seeds=30 --days=900 把
//   第 2～5 章 R 再乘（常規／尾王）：第 2 章 ×1.3／1.5、第 3 章 ×0.9／0.9、第 4 章 ×1.4／1.5、第 5 章 ×1.8／2.4；
//   獎勵再乘第 3～5 章 ×0.85／0.5／0.45（讓公庫期末不再堆積上千萬，約 3 百萬；第 1、2 章不動，見下方 CHAPTER_ANCHOR）。
// Phase 4-D-4：擴編成 30 個世界（每章 5 張常規 + 1 張尾王，id 清單見 data/worlds.js）。第 1 章的 3 個真實世界保留 R／獎勵，
//   其餘常規關由「該章 4-C 校正好的最低 R／獎勵」到「最高 R／獎勵」等比內插成 5 關；尾王維持原 R 與獎勵（bossGate 仍是該章常規關累計 8 次）。
//   舊 id（chN_1～chN_4）的存檔遷移見 data/worlds.js 的 LEGACY_WORLD_IDS 與 engine/core.js deserialize。
// 全部是原創世界觀。

import { CONFIG } from "./config.js";
import { WORLD_LIST, WORLD_NAME_INTRO } from "./worlds.js";

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
  2: { r: [543, 1087], reward: [850, 1500], boss: [4158, 2050] }, // R：4-C 錨點 [418, 836]／尾王 2772 × 1.3／1.5（4-D-6 依 sim 校正）
  3: { r: [2232, 4464], reward: [2639, 4590], boss: [21780, 6197] }, // R ×0.9；獎勵 ×0.85
  4: { r: [14336, 28672], reward: [6480, 11520], boss: [86400, 15480] }, // R ×1.4／1.5；獎勵 ×0.5
  5: { r: [39312, 78624], reward: [16560, 28800], boss: [157248, 40320] }, // R ×1.8／2.4；獎勵 ×0.45
};
const spread = ([lo, hi], i) => Math.round(lo * (hi / lo) ** (i / 4));

// 4-E-8 校正：200 件商店總表（每人 4 個穿戴欄的白值）讓全隊戰力約為 4-D 的 2 倍，所以各章推薦戰力 R（一般關與尾王、含前 3 個真實世界）再乘這組倍率。
// 實測（npm run sim -- --seeds=100 --days=900）：未校正時尾王首通中位數 Day 21／59／119／198／250（-30%～-44%），乘上 ×1.4／1.5／1.5／1.65／2.2 後回到 ±25% 內。
/** 第 1 章第 2 關（喪屍危城）原本是佔位房間，這裡補上正式房間文字 */
const WORLD_ROOMS = {
  ch1_02: {
    icon: "🧟",
    rooms: [
      { name: "封鎖街區", pass: "小隊貼著牆根溜過警戒線，屍群剛好被另一頭的警報吸走。", fail: "{name}踢翻了路障，幾十雙灰白的眼睛同時轉了過來，被撲倒時手臂已經見血。" },
      { name: "超市廢墟", pass: "貨架間安靜得出奇，小隊拿到補給後原路摸了出來。", fail: "{name}伸手去拿罐頭，貨架後面的東西更早伸出手，咬住了他的小腿。" },
      { name: "地下停車場", pass: "引擎聲引開屍潮的瞬間，小隊從另一側出口衝了出去。", fail: "警報器突然尖叫，{name}被蜂擁而來的屍群逼到牆角，肩膀被撕下一塊肉。" },
      { name: "醫院頂樓", pass: "封死樓梯間的鐵門，小隊在屋頂喘了一口真正的氣。", fail: "鐵門被撞開了，{name}斷後時被屍群壓倒，好不容易才掙脫。" },
      { name: "病毒源頭", pass: "找到零號病患的實驗室，毀掉了培養槽，遠處的嘶吼聲一時低了下去。", fail: "培養槽爆裂，{name}被噴了一身帶病毒的液體，高燒當場襲來。" },
    ],
  },
};
const E8_R_MULT = [1.4, 1.5, 1.5, 1.65, 2.2];
const REAL_WORLDS = [
  {
    id: "ghost_village",
    name: "霧隱荒村",
    chapter: 1,
    boss: false,
    genre: "靈異",
    icon: "⚙️",
    recommendedPower: 90,
    reward: 95,
    specialRewards: [
      { id: "ghost_talisman", name: "破局者手札", desc: "靈異副本通過率 +8%。", effect: { genreBonus: { 靈異: 0.08 } } },
      { id: "ghost_seal", name: "防爆機關護具", desc: "全員受傷時多 10% 機率少受一級。", effect: { injuryShield: 0.1 } },
      { id: "yin_yang_eye", name: "洞悉死門之眼", desc: "所有副本通過率 +3%。", effect: { passBonus: 0.03 } },
    ],
    intro: "終年不散的霧、沒有人上香的祖祠、門口排排站的紙紮人。",
    rooms: [
      { name: "齒輪走廊", pass: "小隊踩著齒輪的節拍一步步通過，連一片衣角都沒被捲進去。", fail: "{name}慢了半拍，被齒輪咬掉一塊衣料連帶一塊皮。" },
      { name: "雷射網格", pass: "彎腰、翻滾、屏息，小隊像一串柔軟的影子穿過了紅光。", fail: "{name}的鞋跟蹭到雷射，警報大作，一道灼線劃過手臂。" },
      { name: "毒氣暗房", pass: "找到通風閥門，在毒氣漫上來之前關死了源頭。", fail: "{name}吸進一口淡綠的氣體，眼前發黑，被拖出房間時嘴唇已經發紫。" },
      { name: "謎題石室", pass: "三個數字對上的瞬間，石門緩緩升起，小隊一語不發地走了過去。", fail: "{name}按錯了機關，天花板開始往下壓，勉強滾出來時肋骨斷了兩根。" },
      { name: "殺陣核心", pass: "拆掉最後一組連動機關，整座迷宮的運轉聲戛然而止。", fail: "核心的連鎖陷阱同時啟動，{name}被一排鋼釘擦過，血濺了一地。" },
    ],
  },
  {
    id: "silent_ark",
    name: "沉默方舟號",
    chapter: 1,
    boss: false,
    genre: "科幻",
    icon: "👻",
    recommendedPower: 130,
    reward: 125,
    specialRewards: [
      { id: "ark_accelerator", name: "夜巡者的警覺", desc: "所有副本通過率 +4%。", effect: { passBonus: 0.04 } },
      { id: "ark_prosthetic", name: "辟邪護身符", desc: "全員受傷時多 15% 機率少受一級。", effect: { injuryShield: 0.15 } },
      { id: "ark_cutter", name: "桃木驅鬼釘", desc: "科幻副本通過率 +10%。", effect: { genreBonus: { 科幻: 0.1 } } },
    ],
    intro: "失去動力的殖民船，走廊只剩緊急照明，通風管裡有東西在爬。",
    rooms: [
      { name: "宿舍大門", pass: "小隊在門禁鈴響之前簽完了名，沒人回頭看值班室的窗戶。", fail: "{name}回頭看了一眼值班室，窗後的人臉沒有五官，冷汗瞬間濕透背脊。" },
      { name: "午夜走廊", pass: "腳步聲在身後響起時，小隊集體停步、不回頭，等它自己遠去。", fail: "{name}忍不住回頭，走廊盡頭站著一道白影，一陣陰風把他整個人掀翻。" },
      { name: "公共浴室", pass: "水龍頭自己滴了三聲，小隊安靜地數完，水聲才停。", fail: "{name}聽見有人叫自己的名字，鏡子裡伸出一隻濕漉漉的手把他拽了進去又吐了出來。" },
      { name: "舍監室", pass: "翻出舊名冊，把該燒的那一頁燒了，滿屋怨氣散去大半。", fail: "{name}翻開名冊，發現最後一頁寫著自己的死期，當場吐出一口寒氣。" },
      { name: "第十三寢室", pass: "小隊在床底下找到那具遺骨，替她唸完名字，怨靈終於安靜下來。", fail: "怨靈撲面而來，{name}被冰冷的頭髮纏住喉嚨，掙脫時臉色鐵青。" },
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
  const base = buildWorld(w);
  const t = WORLD_NAME_INTRO[w.id]; // 4-E-8：30 世界正式名稱與題材描述（房間文字與首通特殊獎勵沿用原內容）
  const named = t ? { ...base, name: t.name, intro: t.intro } : base;
  const extra = WORLD_ROOMS[w.id] ?? {}; // 前 3 個世界的房間文字對齊新世界觀（4-E-8 收尾）
  return { ...named, ...extra, recommendedPower: Math.round(base.recommendedPower * E8_R_MULT[w.chapter - 1]) }; // 200 件商店總表上線後的 R 校正
});
function buildWorld(w) {
  if (REAL.has(w.id)) return REAL.get(w.id);
  const a = CHAPTER_ANCHOR[w.chapter];
  if (w.boss) return placeholder(w.id, w.chapter, 0, a.boss[0], a.boss[1]);
  const slot = WORLD_LIST.filter((x) => x.chapter === w.chapter && !x.boss).findIndex((x) => x.id === w.id); // 0~4
  return placeholder(w.id, w.chapter, slot + 1, spread(a.r, slot), spread(a.reward, slot));
}

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
