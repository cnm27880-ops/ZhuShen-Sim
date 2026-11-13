// 可重現的亂數產生器（mulberry32）。
// 亂數狀態存在 state.rngState 裡，所以「同一個種子 + 同樣的操作」一定得到同樣的結果，
// 這讓測試可以穩定重現，也讓存檔讀回來後亂數序列能接續下去。

export function rand(state) {
  let t = (state.rngState = (state.rngState + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** 回傳 min~max（含頭尾）的整數 */
export function randInt(state, min, max) {
  return min + Math.floor(rand(state) * (max - min + 1));
}

export function pick(state, arr) {
  return arr[Math.floor(rand(state) * arr.length)];
}

/** 依 weight 欄位加權抽一個 */
export function weighted(state, items) {
  const total = items.reduce((sum, it) => sum + it.weight, 0);
  let roll = rand(state) * total;
  for (const it of items) {
    roll -= it.weight;
    if (roll < 0) return it;
  }
  return items[items.length - 1];
}
