// 6 大突變詞綴（Phase 4-D-4）。動態任務榜每個常規槽隨機附帶 1 個。要改數字或加詞綴只改這個檔案（引擎讀欄位）。
// 欄位：weight 抽選權重（總和 100，風平浪靜約 35%）；
//   loveMult     同行好感變動倍率（結算時存活隊員之間的「同行情誼」好感 × 倍率，基礎值 CONFIG.dungeon.bondLove）
//   failSanity   單房失敗，受害者額外失去的理智
//   rewardPct    結算積分加成（乘在遞減與標籤倍率之後）
//   clashMult    副本內內鬥／背刺機率倍率
//   rMult        推薦戰力 R 倍率
//   speedSaveMod 速度「極限閃避鎖血」機率修正（加減）
//   relicChanceMult 貪婪探索追加隱藏房機率倍率
export const MUTATIONS = [
  { id: "bridge_effect", name: "吊橋效應", icon: "🌉", weight: 13, loveMult: 1.5, desc: "同行好感變動 ×1.5。" },
  { id: "blackout", name: "斷電黑夜", icon: "🌑", weight: 13, failSanity: 3, rewardPct: 0.15, desc: "單房失敗額外理智 -3；結算積分 +15%。" },
  { id: "greed_loot", name: "分贓誘惑", icon: "💰", weight: 13, rewardPct: 0.25, clashMult: 1.5, desc: "結算積分 +25%；副本內背刺／內鬥率 ×1.5。" },
  { id: "blood_moon", name: "血月狂躁", icon: "🌕", weight: 13, rMult: 1.15, rewardPct: 0.2, desc: "推薦戰力 ×1.15；結算積分 +20%。" },
  { id: "thick_fog", name: "濃霧走散", icon: "🌫️", weight: 13, speedSaveMod: -0.05, relicChanceMult: 2, desc: "速度鎖血率 -5%；奇物隱藏房觸發率翻倍。" },
  { id: "calm_wind", name: "風平浪靜", icon: "🍃", weight: 35, desc: "沒有任何修正。" },
];

export const getMutation = (id) => MUTATIONS.find((m) => m.id === id) ?? null;
