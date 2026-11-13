// 許願種類資料表（Phase 3-B）。數字（權重、期限、價錢範圍）在 src/data/config.js 的 CONFIG.wish.kinds，
// 日誌句子在 src/data/logs.js（key 的格式：wishAsk_種類id、wishDone_種類id）。
//
// mode（機制種類，引擎 src/engine/wishes.js 依它處理）：
//   pay      答應當下扣積分（金額抽自 kinds[id].cost），立刻完成。想新增「花錢型」許願：加一筆 mode: "pay" + CONFIG + 日誌即可
//   rest     答應後休假 N 天（kinds[id].restDays），不能派遣、維持費照付，休完算完成
//   dungeon  指定副本；期限內派他去並通關算完成
//   gear     指定商店裝備；期限內幫他買下算完成
// costDesc：彈窗裡「答應的代價」說明（{cost}{days} 等由引擎填）；doneDesc：「完成條件」說明

export const WISHES = [
  { id: "eat", mode: "pay", name: "想吃好的", icon: "🍖", costDesc: "答應：花 {cost} 分", doneDesc: "答應當下就完成" },
  { id: "vacation", mode: "rest", name: "想放假", icon: "🏖️", costDesc: "答應：休息 {rest} 天（期間不能派遣，維持費照付）", doneDesc: "休完假就完成" },
  { id: "dungeon", mode: "dungeon", name: "想去副本", icon: "🚪", costDesc: "答應：期限內派他去「{dungeon}」", doneDesc: "跟隊通關「{dungeon}」才算完成" },
  { id: "gear", mode: "gear", name: "想要裝備", icon: "🎁", costDesc: "答應：期限內到商店買「{item}」（{price} 分）給他", doneDesc: "買下「{item}」穿在他身上才算完成" },
];

export function getWish(id) {
  return WISHES.find((w) => w.id === id);
}
