// 個性事件資料表 v1a：10 個單人事件（每條軸兩端各至少一個）。加事件只改這裡與 data/logs.js 的 trait_* 句子。
// 欄位：id／axis／sign（+1 或 -1：那條軸的哪一端才會發生）／weight（乘上該軸絕對值當權重）／
//       target（null＝沒有對象、"random"＝隨機一位同在空間的同伴、"needy"＝最需要幫助的同伴、"rich"＝私房錢夠多的同伴；對象一律排除隊長）／
//       fx（效果，全部很小）：sanity 自己理智 Δ、targetSanity 對象理智 Δ、give 自己給對象私房錢、take 向對象收私房錢、
//       targetLove／targetHate 對象「對他」的好感／仇恨增加。
// 日誌句：LOGS["trait_" + id]，可用 {A}（本人）與 {B}（對象）。
// 鐵則：不動戰力與通過率、不動對隊長的好感（隊長當 A 時，有 targetHate 的事件不會發生，避免推高私奔）。

export const TRAIT_EVENTS = [
  { id: "shareMed", axis: "altruism", sign: 1, weight: 1, target: "needy", fx: { give: 10, targetSanity: 2, targetLove: 3 } },
  { id: "fee", axis: "altruism", sign: -1, weight: 1, target: "rich", fx: { take: 8, sanity: 1 } },
  { id: "scheme", axis: "ambition", sign: 1, weight: 1, target: "random", fx: {} },
  { id: "slack", axis: "ambition", sign: -1, weight: 1, target: null, fx: { sanity: 2 } },
  { id: "dare", axis: "courage", sign: 1, weight: 1, target: "random", fx: { targetLove: 2 } },
  { id: "timid", axis: "courage", sign: -1, weight: 1, target: null, fx: {} },
  { id: "invite", axis: "social", sign: 1, weight: 1, target: "random", fx: { give: 8, sanity: 1, targetSanity: 2, targetLove: 3 } },
  { id: "hermit", axis: "social", sign: -1, weight: 1, target: null, fx: { sanity: 2 } },
  { id: "overtime", axis: "obedience", sign: 1, weight: 1, target: null, fx: {} },
  { id: "talkback", axis: "obedience", sign: -1, weight: 1, target: null, fx: { sanity: 1 } },
];

export const getTraitEvent = (id) => TRAIT_EVENTS.find((e) => e.id === id);
