// 輪迴者成就（功能 5：人物傳記）。每個成就是一條純函式：ctx = { s（輪迴者或存檔快照）, bio（傳記資料）}，回傳 true 就達成。
// 想加成就只改這裡；條件只用輪迴者身上已有的欄位，不需要改引擎。

export const ACHIEVEMENTS = [
  { id: "rookie", icon: "🚪", name: "初次出征", desc: "第一次踏進副本。", test: ({ s }) => (s.runs ?? 0) >= 1 },
  { id: "veteran", icon: "🎖️", name: "老兵", desc: "出征 10 場。", test: ({ s }) => (s.runs ?? 0) >= 10 },
  { id: "legend", icon: "🏆", name: "百戰", desc: "出征 30 場。", test: ({ s }) => (s.runs ?? 0) >= 30 },
  { id: "bloodied", icon: "🩸", name: "手上沾血", desc: "親手殺死過同伴。", test: ({ s }) => (s.kills ?? 0) >= 1 },
  { id: "bossSlayer", icon: "🐉", name: "弒王者", desc: "參與討伐過章節尾王。", test: ({ s }) => (s.maxBossChapter ?? 0) >= 1 },
  { id: "geneBreaker", icon: "🧬", name: "破鎖者", desc: "基因鎖突破到 2 階以上。", test: ({ s }) => (s.geneLock ?? 0) >= 2 },
  { id: "insight", icon: "💡", name: "頓悟者", desc: "通關頓悟 3 次以上。", test: ({ s }) => (s.insightCount ?? 0) >= 3 },
  { id: "tempered", icon: "💪", name: "千錘百鍊", desc: "個人強化 10 次以上。", test: ({ s }) => (s.enhanceCount ?? 0) >= 10 },
  { id: "inLove", icon: "💞", name: "情有所歸", desc: "有了戀人或靈魂伴侶。", test: ({ bio }) => !!bio.relations.partner },
  { id: "parent", icon: "👶", name: "為人父母", desc: "有了孩子。", test: ({ bio }) => bio.children.length > 0 },
  { id: "rich", icon: "💰", name: "小有積蓄", desc: "私房錢超過 1000。", test: ({ s }) => (s.wallet ?? 0) >= 1000 },
  { id: "survivor", icon: "🛡️", name: "九死一生", desc: "受過致命傷。", test: ({ s }) => !!s.lifeFlags?.survivedFatal },
];
