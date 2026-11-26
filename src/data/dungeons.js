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
import { buildWorldRewards } from "./worldRewards.js";
import { describeFx } from "./collectionFx.js";
import { HAJIMI_ROOMS } from "./worldRooms.js";

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
// 4-F-3 校正：5 座永久基建（重力修煉室 +30% 戰力…）與位面侵蝕結晶讓後期成長更快（未校正時 900 天自然演化的第 4／5 章尾王約 Day 219／318），
// 所以第 4、5 章 R 再乘這組倍率（常規關與尾王；第 1～3 章維持既有節奏）。實測（npm run sim -- --seeds=50 --days=900）：
//   ×1.6／1.7 → 尾王首通中位數 Day 333／485；×1.9／3.1 → 354／717（第 5 章只剩 40% 局能在 900 天內通關，太慢）。
// A1（主線節奏）：讓 R 曲線單調——每章尾王 ≈ 該章最高一般關 × 1.5～2.3，下一章第 1 關 > 上一章尾王（原本第 3 章第 1 關 < 第 2 章尾王、第 5 章第 1 關 < 第 4 章尾王，尾王有 3～5 倍的斷崖）。
// 一般關／尾王各一組倍率（疊在 E8 × F 之後）。實測（npm run sim -- --seeds=10 --days=700）：尾王首通中位數 Day 34／113／219／298／380，遊戲結束 0%。
const A1_REG_MULT = [1, 2.5, 3.4, 1.2, 1.15];
const A1_BOSS_MULT = [1, 1.5, 1, 0.7, 1];
const F_R_MULT = [1, 1, 0.85, 1.6, 1.7]; // 第 3 章 ×0.85（第三批決策 2：商店改綁章節後第 3 章尾王偏慢 Day 148 → 201。×0.95 實測仍 Day 212，×0.855 → 185、×0.76 → 185、×0.67 → 154，取 0.85）
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
      { id: "ghost_talisman", name: "破局者手札", desc: describeFx("intelGain", 0.03), effect: { intelGain: 0.03 } },
      { id: "ghost_seal", name: "防爆機關護具", desc: describeFx("injuryShield", 0.03), effect: { injuryShield: 0.03 } },
      { id: "yin_yang_eye", name: "洞悉死門之眼", desc: describeFx("hiddenRoom", 0.01), effect: { hiddenRoom: 0.01 } },
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
      { id: "ark_accelerator", name: "符紙灰", desc: describeFx("sanityGuard", 0.1), effect: { sanityGuard: 0.1 } },
      { id: "ark_prosthetic", name: "桃木釘", desc: describeFx("insightChance", 0.01), effect: { insightChance: 0.01 } },
      { id: "ark_cutter", name: "破銅鈴", desc: describeFx("tensionEase", 0.01), effect: { tensionEase: 0.01 } },
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
      { id: "ember_firebolt", name: "凍黑麵包", desc: describeFx("upkeepCut", 0.005), effect: { upkeepCut: 0.005 } },
      { id: "ember_staff", name: "劣質烈酒", desc: describeFx("bondLove", 0.1), effect: { bondLove: 0.1 } },
      { id: "ember_blood", name: "列車長帽", desc: describeFx("shopDiscount", 0.005), effect: { shopDiscount: 0.005 } },
    ],
    intro: "兩座法師塔對轟了三百年，天空下的是火，地上跑的是失控的魔法生物。",
    rooms: [
      { name: "尾節車廂", pass: "擠滿凍瘡難民的臭氣車廂裡，小隊直接亮出武器鎮壓了暴動的搶食者，順手徵收了他們藏在床底的劣質伏特加取暖。", fail: "難民群起哄搶小隊的乾糧，混亂中 {name} 被人用凍硬的黑麵包狠狠砸中後腦勺，腫了一個大包還丟了半袋補給。" },
      { name: "冰軌車頂", pass: "頂著零下七十度的刮骨暴風雪，小隊踩著結冰的車頂鐵皮一路狂奔，趕在隧道撞擊前全員滑進了前段天窗。", fail: "車頂結冰太滑，狂風呼嘯而過時 {name} 腳底打滑差點被吹飛，雖然死死抱住排氣管保住一命，但雙手已被凍傷脫皮。" },
      { name: "鍋爐房", pass: "面對揮舞燒紅鐵鏟的瘋狂鍋爐工，小隊乾脆利落地把領頭者踹進煤渣堆，成功搶下通往貴族區的門禁磁卡。", fail: "交戰中不小心打爆了老舊的洩壓閥，滾燙的蒸氣瞬間噴了 {name} 一臉，全隊只能頂著滿身水泡狼狽逃竄。" },
      { name: "頭等餐車", pass: "衣冠楚楚的貴族們還在舉杯暢飲紅酒，小隊直接掀翻長桌、一槍打爆了保安隊長的機械義眼，在尖叫聲中大搖大擺地穿堂而過。", fail: "藏在水晶吊燈上的自動防禦砲塔突然開火，{name} 閃避不及被電擊彈打得渾身焦黑抽搐，差點成了餐桌上的熟肉。" },
      { name: "引擎室", pass: "在列車長啟動自爆程序的前一刻，小隊合力將他釘死在主控台前，一刀斬斷失控的永動核心線路，奪下了整列火車的控制權。", fail: "列車長狂笑著拉下超載拉桿，劇烈的剎車慣性讓 {name} 被甩飛出去重重撞在發紅的引擎外殼上，當場斷了兩根肋骨。" },
    ],
  },
];

// 依 WORLD_LIST 順序組成最終的 30 張：有真實內容的（第 1 章前 3 個世界）直接用，其餘產生佔位資料
const REAL = new Map(REAL_WORLDS.map((d) => [d.id, d]));
export const DUNGEONS = WORLD_LIST.map((w) => {
  const base = buildWorld(w);
  const t = WORLD_NAME_INTRO[w.id]; // 4-E-8：30 世界正式名稱與題材描述（房間文字與首通特殊獎勵沿用原內容）
  const named = t ? { ...base, name: t.name, intro: t.intro } : base;
  const extra = WORLD_ROOMS[w.id] ?? (HAJIMI_ROOMS[w.id] ? { rooms: HAJIMI_ROOMS[w.id] } : {}); // 哈基米的房間文字（worldRooms.js）；沒有稿的世界維持佔位 // 前 3 個世界的房間文字對齊新世界觀（4-E-8 收尾）
  const specialRewards = named.specialRewards?.length ? named.specialRewards : buildWorldRewards(named); // 原本沒有首通獎勵的世界補上（Phase 3-1，見 worldRewards.js）
  return { ...named, ...extra, specialRewards, recommendedPower: Math.round(base.recommendedPower * E8_R_MULT[w.chapter - 1] * F_R_MULT[w.chapter - 1] * (base.boss ? A1_BOSS_MULT : A1_REG_MULT)[w.chapter - 1]) }; // 200 件商店總表（4-E-8）與基建（4-F-3）上線後的 R 校正
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
// effect 欄位：{ 效果key: 數值 }，14 種效果見 data/collectionFx.js（特殊物品絕不加通過率／戰力）
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
  // 第四批改名前的舊名字（猛鬼宿舍、極寒列車的首通獎勵）：用 id 找回
  return getSpecialReward(RENAMED_REWARDS[name]);
}
const RENAMED_REWARDS = {
  夜巡者的警覺: "ark_accelerator",
  辟邪護身符: "ark_prosthetic",
  桃木驅鬼釘: "ark_cutter",
  "魔法・火焰箭": "ember_firebolt",
  "魔杖・燼木法杖": "ember_staff",
  "魔法血統・燼裔": "ember_blood",
};
