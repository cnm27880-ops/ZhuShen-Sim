// 副本資料表。之後要加到 20 個副本，只要在這個陣列繼續往下加物件即可。
// rooms：5 個房間，每個房間有「通過」與「失敗」兩種日誌文字。{name} 會被換成受害者名字。
// 全部是原創世界觀。

export const DUNGEONS = [
  {
    id: "ghost_village",
    name: "霧隱荒村",
    genre: "靈異",
    difficulty: "簡單",
    icon: "🏚️",
    recommendedPower: 100,
    reward: 100,
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
    genre: "科幻",
    difficulty: "中等",
    icon: "🚀",
    recommendedPower: 200,
    reward: 200,
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
    genre: "奇幻",
    difficulty: "困難",
    icon: "🔥",
    recommendedPower: 400,
    reward: 400,
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

export function getDungeon(id) {
  return DUNGEONS.find((d) => d.id === id);
}
