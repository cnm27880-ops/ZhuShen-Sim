// 關係系統的資料表（Phase 2-B）。要加互動／陰謀種類，只要在這裡加一筆，引擎不用改。
// 文字先用固定句子；Phase 2-C 會換成 Mad Libs 模板（{A}、{B} 會被換成名字）。

// 關係等級的顯示名稱
export const LEVEL_LABELS = {
  soulmate: "💞 靈魂伴侶",
  adore: "❤️ 愛慕",
  like: "🙂 喜歡",
  neutral: "普通",
  dislike: "😒 討厭",
  hate: "😡 仇恨",
  nemesis: "⚔️ 死敵",
};
export const STATUS_LABELS = { lover: "💕 戀人", soulmate: "💞 靈魂伴侶", nemesis: "⚔️ 死敵" };

// 主神空間裡的日常互動。A 是發起人、B 是對象。
//   weight：基礎權重
//   minLove / maxHate / minHate：A 對 B 的好感／仇恨要符合才會抽到
//   needStatus：只有這個關係狀態才抽得到（"lover" 包含靈魂伴侶）
//   tagWeight：A 有這個標籤時，權重乘上幾倍
//   hateWeight：A 對 B 的仇恨每 10 點，權重額外乘 (1 + 這個數字)（吵架越有仇越常發生）
//   dLove / dHate：[A 對 B, B 對 A] 的變化
//   special：特別處理（confess 告白、steal 偷東西）
export const SOCIAL_EVENTS = [
  { id: "meal", weight: 30, maxHate: 49, dLove: [15, 15], dHate: [0, 0], text: "🍜 {A} 和 {B} 在餐廳一起吃飯，聊得還不錯。" },
  { id: "train", weight: 20, maxHate: 49, dLove: [12, 12], dHate: [0, 0], text: "💪 {A} 約 {B} 到訓練場對練，兩個人都流了不少汗。" },
  { id: "date", weight: 40, needStatus: "lover", dLove: [6, 6], dHate: [0, 0], text: "🌙 {A} 和 {B} 偷偷溜到傳送門旁邊看星星（主神：「我都看得到。」）。" },
  { id: "quarrel", weight: 15, hateWeight: 0.5, dLove: [-4, -4], dHate: [14, 14], text: "💢 {A} 和 {B} 在餐廳為了最後一塊肉吵了起來。" },
  { id: "snatch", weight: 10, tagWeight: { light_fingers: 2, backstabber: 2 }, dLove: [0, -5], dHate: [3, 14], text: "😤 {A} 趁 {B} 不注意搶走了他的配給，{B} 氣得牙癢癢。" },
  { id: "steal", weight: 6, minHate: 30, tagWeight: { light_fingers: 5 }, dLove: [0, -6], dHate: [0, 18], text: "🫳 {B} 發現自己的東西不見了，罪魁禍首八成是 {A}。" },
  { id: "confess", weight: 14, minLove: 50, noStatus: true, tagWeight: { mad_matchmaker: 2 }, special: "confess", dLove: [0, 0], dHate: [0, 0], text: "" },
];

// 陰謀（借刀殺人，計畫 6.6）。A 對 B 仇恨 ≥ schemeHate 才會動手腳；主神空間裡不敢直接動手。
//   tagWeight：A 有這個標籤時權重乘上幾倍
export const SCHEMES = [
  { id: "frame", weight: 30, tagWeight: { scam_lecturer: 2 }, text: "🕵️ {A} 偷偷改了監控紀錄，讓主神以為 {B} 犯了錯。{B} 被電得外焦內嫩。" },
  { id: "sabotage", weight: 30, tagWeight: { backstabber: 2 }, text: "🔧 {A} 趁夜動了 {B} 的裝備。下次出征，{B} 大概會很驚喜。" },
  { id: "poison", weight: 15, text: "☠️ {B} 吃完飯突然腹痛不止。{A}：「欸，食物不乾淨吧？」" },
  { id: "rumor", weight: 25, tagWeight: { green_tea: 3 }, text: "🗣️ {A} 到處散播 {B} 的謠言，宿舍的氣氛變得很微妙。" },
];

// 被識破時的補充日誌
export const DISCOVER_TEXT = "👀 {B} 查到是 {A} 搞的鬼！兩個人的梁子結大了。";

// 標籤製造的特殊事件（計畫 6.5）：綠茶製造修羅場、月老亂點鴛鴦
export const TAG_SPECIALS = [
  { tag: "green_tea", text: "🍵 {A} 在 {B} 和 {C} 之間說了幾句「不小心」的話，兩個人從此互看不順眼。", dLove: -6, dHate: 12 },
  { tag: "mad_matchmaker", text: "🎯 {A} 硬是把 {B} 和 {C} 湊成一桌吃飯，氣氛……居然還不錯？", dLove: 10, dHate: 0 },
];

// 死亡連鎖的結果文字
export const MOURN_TEXT = {
  breakthrough: "🔥 {B} 悲憤交加，在痛苦中頓悟突破（全屬性 +30%）。",
  broken: "💔 {B} 道心破碎，一蹶不振（全屬性 -20%，獲得【道心破碎】）。",
  demon: "👿 {B} 走火入魔，眼神變得不太對勁（獲得【走火入魔】）。",
};
