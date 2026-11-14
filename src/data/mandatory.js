// 主神強制血腥任務的文字資料（Phase 4-C-4）。數字在 CONFIG.forcedMission；加房間文字只改這裡。
// rooms 必須剛好 CONFIG.forcedMission.rooms 間；fail 句的 {name} 會換成受害者名字。

export const MANDATORY_ID = "mandatory_raid";

export const MANDATORY_DUNGEON = {
  id: MANDATORY_ID,
  name: "主神血腥任務",
  icon: "☠️",
  genre: "血腥",
  intro: "主神心血來潮的強制任務。不能花錢化解，逾期不派人，主神會直接抹殺人。",
  rooms: [
    { name: "歡迎光臨", pass: "入口的陷阱被你們拆了，主神發出失望的嘖聲。", fail: "{name} 踩中了入口的機關，主神在天上鼓掌。" },
    { name: "自助餐廳", pass: "大家搶到了食物，沒人少一根手指。", fail: "{name} 成了餐廳的招牌菜，被端上了桌。" },
    { name: "觀眾席", pass: "觀眾噓聲四起，但隊伍毫髮無傷地穿過了競技場。", fail: "{name} 被推上了競技場中央，全場尖叫。" },
    { name: "二選一", pass: "兩道門都是陷阱，但你們找到了第三條路。", fail: "{name} 選錯了門，門後的東西很不友善。" },
    { name: "謝幕", pass: "最後一幕落下，主神悻悻地拉上了布幕。", fail: "{name} 沒趕上謝幕，被留在了舞台上。" },
  ],
};
