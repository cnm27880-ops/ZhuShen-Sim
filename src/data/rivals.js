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
  { name: "前哨交鋒", pass: "我方前鋒不講武德直接偷襲，把{rival}的探路先遣隊揍得措手不及。", fail: "{name}還在擺登場姿勢，就被{rival}的先遣隊一悶棍敲在腦門上。" },
  { name: "側翼包抄", pass: "小隊提前在暗巷埋好陷阱，順手截胡了{rival}運過來的補給箱。", fail: "{rival}從死角殺出，{name}閃避不及，肋骨被狠狠踹中一腳。" },
  { name: "主力對轟", pass: "雙方火力全開正面互砸，我方硬是憑著不要命的打法把{rival}逼退半條街。", fail: "{rival}集火轟出一波殺招，{name}當場被炸飛出去撞穿兩堵牆。" },
  { name: "副手對決", pass: "我方精準圍毆{rival}的副手，對面指揮鏈瞬間斷線亂成一鍋粥。", fail: "{rival}的副手冷笑著抓到破綻，反手一刀在{name}身上留下深可見骨的血口。" },
  { name: "隊長決戰", pass: "王牌對王牌！我方在最後關頭硬破對手底牌，把{rival}全隊按在地上結算買路財。", fail: "{rival}的隊長展現恐怖壓制力，{name}正面吃下必殺技，整個人血染當場。" },
];

// 我方叛逃／私奔者再度登場的互嗆文本：{A} = 叛逃者、{squad} = 宿敵隊名
export const RIVAL_TAUNTS = [
  "「{A}」站在{squad}陣前晃著新武器冷笑：「前輩，別怪我現實，人家給的底薪跟撫卹金真的太多了。」",
  "{A}換上了{squad}的制服，居高臨下睨著老東家：「在你們那間血汗工廠當牛做馬的日子，我一天都受夠了！」",
  "{squad}的打手群裡走出熟悉的身影——{A}聳聳肩：「不好意思啊各位，良禽擇木而棲，今天只好拿你們刷績效了。」",
  "「喲，這不是我那摳門的老隊伍嗎？」{A}躲在{squad}隊長身後笑得超欠揍：「還沒團滅呢？命真硬啊。」",
  "{A}把以前隊裡發的破舊徽章丟在地上踩碎，替{squad}拔刀指向前隊友：「當初沒分我好裝備，現在連本帶利討回來！」",
  "看到前隊友的瞬間，披著{squad}披風的{A}眼神閃過一絲心虛，隨即惡狠狠地吼道：「看什麼看！不跳槽難道留在那裡陪你們等死嗎！」",
  "{A}挽著{squad}成員的手臂招搖過市：「順便通知一聲，我在這邊不用被抽重稅，伙食還天天有肉喔～」",
  "「別用那種抓叛徒的眼神看我，」{squad}陣中的{A}冷冷舉起武器，「主神空間裡，活得爽的人才是對的。」",
  "{A}熟門熟路地向{squad}報出我方每個人的弱點：「左邊那個怕痛、右邊那個路痴——先砍哪個隨你們挑！」",
  "「真巧啊各位前同事，」{A}代表{squad}上前叫陣，「今天把你們打殘了，應該不算違反競業條款吧？」",
];
