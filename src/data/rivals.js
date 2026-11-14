// 八大洲際宿敵隊（4-F-1／2）。全部是原創、去版權化的設定。
// 每支隊伍是一份 RivalSquadSnapshot：{ id, name, factionStyle, rMult, rewardMult, mortalityMod, specialRule, source, roster }
//   source: 'npc'（內建隊伍）| 'cloud_snapshot'（Phase 5 真人雲端快照預留；引擎只認這個結構，不管來源）
//   roster：成員清單 [{ name, role }]；我方被拐跑的人會以 { name, role: "defector", snapshot } 附加在 state.rivals.squads[id].roster
// rMult 對標我方當前主線進度錨點（baseRivalR × rMult）。inferno 的 1.25 是硬鎖（lockedR：任何削弱都不能讓它低於 1.25）。
// 數字（獎勵倍率、致死率、機率）：這裡放隊伍本身的特色倍率，其餘全域數字在 CONFIG.rival。

export const RIVAL_ID = "rival_clash";

export const RIVAL_SQUADS = [
  {
    id: "polaris", name: "北極星洲隊", icon: "⭐", factionStyle: "bond", rMult: 1.0, rewardMult: 1.0, mortalityMod: 0, specialRule: "relic",
    intro: "均衡的主角團，每個人都帶著一點奇怪的天命。",
    desc: "戰勝額外掉落 1 件未擁有奇物（奇物已全收集則轉高額積分）",
    roster: [{ name: "北辰", role: "隊長" }, { name: "星緲", role: "副手" }, { name: "天樞", role: "打手" }],
  },
  {
    id: "zhonghuang", name: "中皇天命隊", icon: "☯️", factionStyle: "elite", rMult: 1.1, rewardMult: 1.35, mortalityMod: 0, specialRule: "shield",
    intro: "正統修真強隊，每個人身上都纏著一層護體靈光。",
    desc: "敵方自帶護體（我方每房通過率下修）；戰勝獎勵 ×1.35 並掉落侵蝕結晶",
    roster: [{ name: "玄機子", role: "隊長" }, { name: "清虛", role: "副手" }, { name: "紫霄", role: "打手" }],
  },
  {
    id: "dongying", name: "東櫻百鬼隊", icon: "👹", factionStyle: "farming", rMult: 0.95, rewardMult: 1.0, mortalityMod: 0, specialRule: "pigRevolt",
    intro: "菁英壓榨底層的百鬼夜行，底層新人早就受夠了。",
    desc: "遇到時有機會觸發「肉豬策反」：敵方 R 下降，戰後收編 1 名高潛力新人",
    roster: [{ name: "酒吞", role: "隊長" }, { name: "雪女", role: "副手" }, { name: "小豆洗", role: "新人" }],
  },
  {
    id: "inferno", name: "煉獄惡魔隊", icon: "😈", factionStyle: "elite", rMult: 1.25, lockedR: true, rewardMult: 1.8, mortalityMod: 0, specialRule: "loot",
    intro: "複製體狂戰團，每個惡魔都是同一份殺意的拷貝。",
    desc: "高危硬仗（R ×1.25 硬鎖）；戰勝獎勵 ×1.8，必掉 T4/T5 黑貨或侵蝕結晶",
    roster: [{ name: "拷貝一號", role: "隊長" }, { name: "拷貝二號", role: "副手" }, { name: "拷貝三號", role: "打手" }],
  },
  {
    id: "golden", name: "黃金財團隊", icon: "💰", factionStyle: "mercenary", rMult: 1.0, rewardMult: 1.0, mortalityMod: 0, specialRule: "wallet",
    intro: "氪金武裝流，連匕首柄上都鑲著金鑽。",
    desc: "戰勝爆出大量全隊私房錢分潤與高階消耗品",
    roster: [{ name: "金萬貫", role: "隊長" }, { name: "錢多多", role: "副手" }, { name: "鑽石保鑣", role: "打手" }],
  },
  {
    id: "joyous", name: "合歡粉紅隊", icon: "💗", factionStyle: "bond", rMult: 0.85, rewardMult: 1.0, mortalityMod: -0.7, specialRule: "romance",
    intro: "魅惑雙修流，打架的時候比談戀愛更像在談戀愛。",
    desc: "雙方致死率 -70%；極高機率觸發「跨隊春風一度」",
    roster: [{ name: "夢鸞", role: "隊長" }, { name: "紅綃", role: "副手" }, { name: "醉蝶", role: "打手" }],
  },
  {
    id: "mech", name: "機械飛昇隊", icon: "🤖", factionStyle: "elite", rMult: 1.05, rewardMult: 1.5, mortalityMod: 0, specialRule: "mental",
    intro: "智械改造流，用鋼鐵取代了所有會痛的東西。",
    desc: "免疫精神類加成（我方關係／心情正向加成失效）；戰勝必得大量裝備強化與公庫積分",
    roster: [{ name: "Unit-零", role: "隊長" }, { name: "Unit-七", role: "副手" }, { name: "Unit-十三", role: "打手" }],
  },
  {
    id: "retire", name: "萬年養老隊", icon: "🍵", factionStyle: "communal", rMult: 0.8, rewardMult: 1.0, mortalityMod: -0.5, specialRule: "welfare",
    intro: "苟道種田流，隊長的興趣是曬太陽跟收租。",
    desc: "低殺意福利局（致死率 -50%）；戰勝輕鬆拿買路財積分與療傷（全體傷勢 -1 級）",
    roster: [{ name: "田老頭", role: "隊長" }, { name: "茶姨", role: "副手" }, { name: "躺平哥", role: "打手" }],
  },
];

export const getRivalSquad = (id) => RIVAL_SQUADS.find((q) => q.id === id);

// 房間（5 間，過 3）：{rival} 會換成宿敵隊名，{name} 是我方受害者
export const RIVAL_ROOMS = [
  { name: "前哨交鋒", pass: "我方前鋒壓過了{rival}的先遣，開局就拿下氣勢。", fail: "{name}被{rival}的先遣隊抓到空檔，狠狠挨了一擊。" },
  { name: "側翼包抄", pass: "小隊識破了{rival}的包抄路線，反手切斷了他們的後援。", fail: "{name}被{rival}從側翼繞過來的人影打得一個踉蹌。" },
  { name: "主力對轟", pass: "雙方主力正面對轟，我方硬是多撐了一口氣。", fail: "{rival}的主力轟出一輪齊射，{name}被衝擊波掀飛。" },
  { name: "副手對決", pass: "我方擊潰了{rival}的副手，對面陣腳亂了。", fail: "{rival}的副手一個閃身，{name}被反手撂倒。" },
  { name: "隊長決戰", pass: "隊長對隊長，我方用一個漂亮的收尾奪下了最後一局。", fail: "{rival}的隊長親自出手，{name}正面吃下致命一擊。" },
];

// 我方叛逃者再度登場的互嗆文本：{A} = 叛逃者、{B} = 我方隊長（或在場的某人）
export const RIVAL_TAUNTS = [
  "「{A}」站在{squad}陣前冷笑：「在你們那邊的日子，我一天也不想再過。」",
  "{A}換上了{squad}的臂章：「別怪我，是你們先逼我走的。」",
  "{squad}的打手群裡出現了熟悉的臉孔——{A}。「這次，輪到我來教你們規矩。」",
];
