// 副本資料表（Phase 4-A：五章 × 4 關 = 20 個副本）。
// chapter：第幾章（1~5，空間等級 ≥ 章節才解鎖）；boss：true = 本章尾王（首通讓空間升 1 級）。
// rooms：房間陣列，長度必須等於 CONFIG.dungeon.chapters 該章的 rooms（5/7/8/10/12，測試會檢查）；
//   每個房間有「通過」與「失敗」兩種日誌文字，{name} 會被換成受害者名字。
// recommendedPower／reward：基準草稿（露葵 2026-11-14 給的表，待 npm run sim 驗證）。
// 第 1 章前 3 關沿用舊的 3 個副本；其他 17 關目前是佔位資料（名字、房間文字、特殊獎勵之後再補，只改這個檔案）。
// 全部是原創世界觀。

import { CONFIG } from "./config.js";

// 佔位房間：n 間通用文字，最後一間是首領房
function placeholderRooms(n) {
  return Array.from({ length: n }, (_, i) => ({
    name: i === n - 1 ? "首領房（待命名）" : `第 ${i + 1} 區（待命名）`,
    pass: "小隊有驚無險地通過了這一區。（佔位文字）",
    fail: "{name}在混亂中被打中了。（佔位文字）",
  }));
}

const PLACEHOLDER_GENRES = ["靈異", "科幻", "奇幻"];

// 佔位副本：章節、第幾關（1~4，第 4 關是尾王）、推薦戰力、基礎獎勵
function placeholder(chapter, slot, recommendedPower, reward) {
  const boss = slot === 4;
  return {
    id: `ch${chapter}_${slot}`,
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

export const DUNGEONS = [
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
  placeholder(1, 4, 260, 230),
  placeholder(2, 1, 380, 340),
  placeholder(2, 2, 540, 450),
  placeholder(2, 3, 760, 600),
  placeholder(2, 4, 1050, 820),
  placeholder(3, 1, 1550, 1150),
  placeholder(3, 2, 2200, 1500),
  placeholder(3, 3, 3100, 2000),
  placeholder(3, 4, 4400, 2700),
  placeholder(4, 1, 6400, 3600),
  placeholder(4, 2, 9100, 4800),
  placeholder(4, 3, 12800, 6400),
  placeholder(4, 4, 18000, 8600),
  placeholder(5, 1, 26000, 11500),
  placeholder(5, 2, 37000, 15000),
  placeholder(5, 3, 52000, 20000),
  placeholder(5, 4, 72000, 28000),
];

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
