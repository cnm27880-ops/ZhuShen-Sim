// 主神搞事的事件種類資料表（Phase 3-E）。數字（權重、金額、期限）在 src/data/config.js 的 CONFIG.godEvent.kinds，
// 日誌句子在 src/data/logs.js（key 格式：godAsk_種類id、godDone_種類id、godResolve_種類id …）。
//
// mode（機制種類，引擎 src/engine/godEvents.js 依它處理）：
//   tax      全體：直接扣積分（金額抽自 kinds[id].loss）
//   shock    點名一人：理智下降
//   checkup  點名一人：骰結果（受傷／拿積分／回理智）
//   raid     點名一人：限時去指定副本通關，做到有獎、做不到受罰（唯一會留下「進行中任務」的種類）
// target："none" 沒有特定對象；"one" 會點名一位留在主神空間的輪迴者（{A}）
// acceptDesc：彈窗裡「照辦」的後果；payDesc：花積分化解的說明；ignoreDesc：沒回覆（超過期限）的後果
// 說明文字可用的欄位：{A}{loss}{san}{cost}{days}{dungeon}{reward}{penalty}{level}

export const GOD_EVENTS = [
  {
    id: "tax",
    mode: "tax",
    target: "none",
    name: "臨時開銷稅",
    icon: "💸",
    acceptDesc: "照辦：主神直接從帳上扣 {loss} 分",
    payDesc: "花 {cost} 分打點主神，但全體留守者要陪笑臉、理智各 -{extra}，這筆稅才免得掉",
    ignoreDesc: "視同照辦，直接扣 {loss} 分",
  },
  {
    id: "shock",
    mode: "shock",
    target: "one",
    name: "電擊抽查",
    icon: "⚡",
    acceptDesc: "照辦：{A} 被電，理智 -{san}",
    payDesc: "花 {cost} 分替 {A} 疏通，這次不電了",
    ignoreDesc: "視同照辦，{A} 理智 -{san}",
  },
  {
    id: "checkup",
    mode: "checkup",
    target: "one",
    name: "強制健檢",
    icon: "🩺",
    acceptDesc: "照辦：{A} 被抓去做實驗，可能受傷，也可能拿到一點補償",
    payDesc: "花 {cost} 分替 {A} 免檢（不受傷，也沒有補償）",
    ignoreDesc: "視同照辦，{A} 被抓去做實驗",
  },
  {
    id: "raid",
    mode: "raid",
    target: "one",
    name: "突襲任務",
    icon: "🚨",
    acceptDesc: "接下：{days} 天內派 {A} 去「{dungeon}」並通關，成功 +{reward} 分",
    payDesc: "花 {cost} 分把任務推掉（不用做，也沒有懲罰）",
    ignoreDesc: "視同抗命，扣 {penalty} 分，{A} 被牽連而不爽",
  },
];

export function getGodEvent(id) {
  return GOD_EVENTS.find((e) => e.id === id);
}
