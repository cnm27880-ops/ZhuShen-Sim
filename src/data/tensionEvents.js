// 人際張力事件種類（A-3 階段 2）。引擎 engine/tension.js 依一對人的處境挑種類；數字在 CONFIG.tension；
// 日誌句在 data/logs.js 的 `tension_<id>`（每種 ≥3 個版本）。要加種類：這裡加一列、logs.js 加對應句子、tension.js 的 kindOf 加判斷。
//   id     種類 id（對應日誌 key tension_<id>）
//   name   麻煩清單顯示的名字
//   icon   圖示
//   hint   一句話說明（UI 與測試用）
export const TENSION_KINDS = [
  { id: "quarrel", name: "口角摩擦", icon: "💢", hint: "兩個人處不來，小事吵成大事。" },
  { id: "rivalry", name: "爭功奪位", icon: "⚔️", hint: "兩個都想當老大的人互不相讓。" },
  { id: "exploit", name: "吃虧不平", icon: "😤", hint: "老實人被占便宜，心裡的帳越記越多。" },
  { id: "jealousy", name: "爭風吃醋", icon: "💔", hint: "兩個人看上了同一個人。" },
  { id: "captain", name: "對隊長不滿", icon: "🪖", hint: "有人不服隊長的安排。" },
];

export const TENSION_KIND_IDS = TENSION_KINDS.map((k) => k.id);
export const getTensionKind = (id) => TENSION_KINDS.find((k) => k.id === id) ?? TENSION_KINDS[0];

/** 空間氣氛：依全空間最高怨氣分三級（CONFIG.tension.climate 的兩條線） */
export const CLIMATE_LEVELS = [
  { id: "calm", name: "平靜", icon: "🌤️" },
  { id: "brewing", name: "暗流", icon: "⛅" },
  { id: "volatile", name: "一觸即發", icon: "⛈️" },
];
