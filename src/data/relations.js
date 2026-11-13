// 關係系統的資料表（Phase 2-B）。要加互動／陰謀種類，只要在這裡加一筆，引擎不用改。
// 文字是 Mad Libs 模板（Phase 2-C）：texts 有多個版本，{A}{B}{C} 換成名字，{react:池:A} 換成依標籤而異的反應（語法見 src/data/logs.js）。

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
//   texts：文字版本（陣列，執行時抽一個）
//   special：特別處理（confess 告白、steal 偷東西）
export const SOCIAL_EVENTS = [
  { id: "meal", weight: 30, maxHate: 49, dLove: [15, 15], dHate: [0, 0], texts: [
    "🍜 {A} 和 {B} 在餐廳一起吃飯，聊得還不錯。{A}{react:joy:A}。",
    "🍜 {A} 端著餐盤坐到 {B} 對面，兩個人邊吃邊聊。{B}{react:joy:B}。",
    "🍜 {A} 把自己的配給分了一半給 {B}。{B}{react:joy:B}。",
  ] },
  { id: "train", weight: 20, maxHate: 49, dLove: [12, 12], dHate: [0, 0], texts: [
    "💪 {A} 約 {B} 到訓練場對練，兩個人都流了不少汗。",
    "💪 {A} 和 {B} 在訓練場互相過招，打到最後笑著癱在地上。{A}{react:joy:A}。",
    "💪 {B} 被 {A} 拉去訓練場陪練，居然意外地練出了默契。",
  ] },
  { id: "date", weight: 40, needStatus: "lover", dLove: [6, 6], dHate: [0, 0], texts: [
    "🌙 {A} 和 {B} 偷偷溜到傳送門旁邊看星星（主神：「我都看得到。」）。",
    "🌙 {A} 牽著 {B} 的手在走廊上散步，路過的人都假裝沒看見。",
    "🌙 {A} 和 {B} 半夜在餐廳煮了碗泡麵，兩個人分著吃。{B}{react:joy:B}。",
  ] },
  { id: "quarrel", weight: 15, hateWeight: 0.5, dLove: [-4, -4], dHate: [14, 14], texts: [
    "💢 {A} 和 {B} 在餐廳為了最後一塊肉吵了起來。{A}{react:angry:A}，{B}{react:angry:B}。",
    "💢 {A} 嫌 {B} 打呼太大聲，兩人在宿舍吵了一架。{B}{react:angry:B}。",
    "💢 {A} 和 {B} 為了誰該洗碗大吵一架，整個餐廳的人都裝作沒聽見。{A}{react:angry:A}。",
  ] },
  { id: "snatch", weight: 10, tagWeight: { light_fingers: 2, backstabber: 2 }, dLove: [0, -5], dHate: [3, 14], texts: [
    "😤 {A} 趁 {B} 不注意搶走了他的配給。{B}{react:angry:B}。",
    "😤 {A} 一把搶過 {B} 盤子裡的雞腿。{B}{react:angry:B}。",
    "😤 {B} 一轉身，配給就被 {A} 拿走了。{B}{react:angry:B}。",
  ] },
  { id: "steal", weight: 6, minHate: 30, tagWeight: { light_fingers: 5 }, dLove: [0, -6], dHate: [0, 18], texts: [
    "🫳 {B} 發現自己的東西不見了，罪魁禍首八成是 {A}。{B}{react:angry:B}。",
    "🫳 {B} 的抽屜被翻過了，監視器裡只拍到 {A} 的背影。{B}{react:angry:B}。",
    "🫳 {A} 的口袋鼓鼓的，{B} 的私人物品卻不見了。{B}{react:angry:B}。",
  ] },
  { id: "confess", weight: 14, minLove: 50, noStatus: true, tagWeight: { mad_matchmaker: 2 }, special: "confess", dLove: [0, 0], dHate: [0, 0], texts: [""] },
];

// 陰謀（借刀殺人，計畫 6.6）。A 對 B 仇恨 ≥ schemeHate 才會動手腳；主神空間裡不敢直接動手。
//   tagWeight：A 有這個標籤時權重乘上幾倍
export const SCHEMES = [
  { id: "frame", weight: 30, tagWeight: { scam_lecturer: 2 }, texts: [
    "🕵️ {A} 偷偷改了監控紀錄，讓主神以為 {B} 犯了錯。{B} 被電得外焦內嫩。",
    "🕵️ {A} 匿名向主神舉報 {B} 摸魚。{B} 被電得頭髮都直了。",
    "🕵️ {A} 偽造了一份「{B} 的叛逃計畫」交給主神。{B} 在電擊椅上坐了一個下午。",
  ] },
  { id: "sabotage", weight: 30, tagWeight: { backstabber: 2 }, texts: [
    "🔧 {A} 趁夜動了 {B} 的裝備。下次出征，{B} 大概會很驚喜。",
    "🔧 {A} 悄悄鬆了 {B} 護具的螺絲。{B} 還渾然不覺。",
    "🔧 {B} 的武器保養油被 {A} 換成了醬油。下次出征會很精彩。",
  ] },
  { id: "poison", weight: 15, texts: [
    "☠️ {B} 吃完飯突然腹痛不止。{A}：「欸，食物不乾淨吧？」",
    "☠️ {B} 喝了一口湯就倒了下去。{A} 在旁邊關心地說：「是不是太累了？」",
    "☠️ {B} 的杯子裡被加了點東西。{A} 笑著遞上了水：「來，喝點水。」",
  ] },
  { id: "rumor", weight: 25, tagWeight: { green_tea: 3 }, texts: [
    "🗣️ {A} 到處散播 {B} 的謠言，宿舍的氣氛變得很微妙。",
    "🗣️ {A} 壓低聲音跟大家說「你們知道 {B} 的事嗎」，沒人敢再跟 {B} 同桌吃飯。",
    "🗣️ 「聽說 {B} 偷偷跟主神打小報告」——{A} 嘴上說不要傳，結果傳得最快。",
  ] },
];

// 被識破時的補充日誌
export const DISCOVER_TEXTS = [
  "👀 {B} 查到是 {A} 搞的鬼！兩個人的梁子結大了。",
  "👀 {B} 發現了真相，一腳踹開 {A} 的房門：「是你幹的？！」",
  "👀 紙包不住火，{B} 知道是 {A} 動的手腳了。兩人梁子結大了。",
];

// 標籤製造的特殊事件（計畫 6.5）：綠茶製造修羅場、月老亂點鴛鴦
export const TAG_SPECIALS = [
  { tag: "green_tea", dLove: -6, dHate: 12, texts: [
    "🍵 {A} 在 {B} 和 {C} 之間說了幾句「不小心」的話，兩個人從此互看不順眼。",
    "🍵 {A} 對 {B} 說「{C} 好像不太喜歡你」，轉頭又對 {C} 說了同樣的話。修羅場開張。",
    "🍵 {A} 紅著眼眶說「我不想讓你們吵架」，結果 {B} 和 {C} 就吵起來了。",
  ] },
  { tag: "mad_matchmaker", dLove: 10, dHate: 0, texts: [
    "🎯 {A} 硬是把 {B} 和 {C} 湊成一桌吃飯，氣氛……居然還不錯？",
    "🎯 {A} 把 {B} 和 {C} 鎖進了儲藏室：「聊完再出來！」兩個人出來時臉都紅了。",
    "🎯 {A} 偷偷幫 {B} 和 {C} 排了同一個班表，兩個人一起打掃了一整天。",
  ] },
];

// 死亡連鎖的結果文字（現在放在 src/data/logs.js 的 mournBreakthrough / mournBroken / mournDemon）
