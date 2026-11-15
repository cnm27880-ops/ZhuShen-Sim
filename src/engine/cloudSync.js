// 雲端存檔同步的決策規則（純函式）：開遊戲、剛登入時，本機存檔與雲端存檔怎麼處理？
// 原則：不確定的時候絕不自己覆蓋，交給玩家選。
//
//   local = { exists, hasProgress }     本機有沒有存檔、有沒有實際進度（第 1 天以後或花過錢）
//   cloud = { updatedAt } | null        雲端有沒有存檔
//   meta  = { uid, base } | null        上次同步的紀錄：哪個帳號、當時雲端版本號
//
// 回傳 action：
//   none          不用做事（已同步，或兩邊都是空的）
//   adopt-cloud   本機沒進度而雲端有：直接載入雲端
//   offer-upload  雲端沒有、本機有進度：問玩家要不要上傳（舊存檔遷移）
//   conflict      兩邊都有而且對不上：問玩家要載入雲端還是覆蓋雲端（reason: first 第一次登入／cloud-newer 雲端被別台更新過）

export function planSync({ userId, local, cloud, meta }) {
  const mine = meta && meta.uid === userId ? meta : null;
  if (!cloud) return { action: local.exists && local.hasProgress ? "offer-upload" : "none" };
  if (mine && mine.base === cloud.updatedAt) return { action: "none" };
  if (!local.exists || !local.hasProgress) return { action: "adopt-cloud" };
  return { action: "conflict", reason: mine ? "cloud-newer" : "first" };
}
