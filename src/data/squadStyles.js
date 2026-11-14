// 小隊流派資料表（Phase 4-E-1）。流派不由玩家直接切換，而是依「現任隊長的性格詞條」決定（選人不選流派）。
// 要調整哪個詞條歸哪個流派，只改 TAG_STYLE；加流派要同時在引擎的 style 判斷處補機制（見 engine/squad.js）。
//
// TAG_STYLE：{ 詞條 id: { 流派 id: 分數 } }，隊長身上所有詞條的分數加總，最高分的流派獲勝；
//   全部 0 分（沒有可對應的詞條）或平手時，依 TIE_ORDER 決定，沒有任何詞條對應就歸「共生羈絆流」（中性預設）。

export const SQUAD_STYLES = {
  communal: {
    id: "communal",
    name: "鐵血共產流",
    icon: "☭",
    desc: "大鍋飯互助隊：獎金 100% 絕對均分、戰死者的私房錢全進互助金、老鳥捐錢補貼菜鳥；全隊防禦減傷 +8%。",
  },
  bond: {
    id: "bond",
    name: "共生羈絆流",
    icon: "🤝",
    desc: "正統主角隊：帶傷者分潤 ×1.25；好感夠的夥伴會替你擋致命一刀；通關全隊理智 +4；戰死者的英靈碑加成 ×1.5。",
  },
  farming: {
    id: "farming",
    name: "極端養殖流",
    icon: "🐖",
    desc: "一神帶肉豬：隊長出征獨吞 80% 獎金（留守也抽 35% 保護費）、零階新人維持費減半、肉豬陣亡隊長暴衝；代價是全隊天天恨隊長。",
  },
  elite: {
    id: "elite",
    name: "叢林菁英流",
    icon: "⚔️",
    desc: "惡魔／天神隊：獎金按戰力^1.4 分配，強者吃肉弱者喝湯；打尾王與叛逃 Boss 戰力 +15%；但單房失敗理智扣損加倍。",
  },
  mercenary: {
    id: "mercenary",
    name: "契約傭兵流",
    icon: "💼",
    desc: "利益至上隊：獎金 +18% 商業溢價、按身價比例分帳；黑市再 95 折；低理智內鬥／背刺 -80%，但同行情誼好感減半。",
  },
};

export const STYLE_IDS = Object.keys(SQUAD_STYLES);
export const DEFAULT_STYLE = "bond"; // 沒有可對應詞條的中性隊長
export const TIE_ORDER = ["communal", "farming", "elite", "mercenary", "bond"]; // 平手時的優先順序

// 詞條 → 流派（只用既有的 30 個 MVP 標籤＋獲得標籤，不新增標籤，避免動到抽卡亂數）
export const TAG_STYLE = {
  // 無私／守序／奉獻／熱心 → 鐵血共產
  overwork_reborn: { communal: 2 }, // 過勞死轉生者：奉獻到死
  delivery_pro: { communal: 2 }, // 外送平台五星騎手：守序、準時
  lecturer: { communal: 2 }, // 爹味說教狂：愛管事
  emergency_ration: { communal: 2 }, // 緊急口糧預備役：犧牲奉獻
  // 重情／溫和／守護／熱血 → 共生羈絆
  thick_skin: { bond: 2 }, // 皮糙肉厚：守護者
  mad_matchmaker: { bond: 2 }, // 瘋狂月老：重情
  bgm_carrier: { bond: 2 }, // BGM 自帶者：鼓舞士氣
  gourmet: { bond: 1 }, // 美食家：溫和
  luck_borrower: { bond: 1 },
  flag_architect: { bond: 2 }, // Flag 建築師：熱血
  broken_heart: { bond: 1 }, // 道心破碎：重情的人才會碎
  // 自私／殘忍／支配／野心 → 極端養殖
  light_fingers: { farming: 2 }, // 順手牽羊：自私
  green_tea: { farming: 2 }, // 綠茶：心機支配
  smiling_tiger: { farming: 3 }, // 笑面虎：野心
  backstabber: { farming: 2 }, // 背刺成癮者：殘忍
  horror_fool: { farming: 1 },
  // 慕強／入魔／狂戰／孤傲 → 叢林菁英
  born_strong: { elite: 2 }, // 天生神力：慕強
  demon_path: { elite: 3 }, // 走火入魔：入魔
  pain_convert: { elite: 2 }, // 痛覺轉化：狂戰
  nimble: { elite: 1 },
  crow_mouth: { elite: 1 }, // 烏鴉嘴：孤傲
  schrodinger_courage: { elite: 1 },
  // 精明／商人／冷靜／算計 → 契約傭兵
  salary_thief: { mercenary: 3 }, // 薪水小偷轉世：精明
  scam_lecturer: { mercenary: 2 }, // 詐騙集團首席講師：商人
  keyboard_general: { mercenary: 2 }, // 鍵盤軍事家：算計
  doomsday_hoarder: { mercenary: 2 }, // 末日囤積症：精打細算
  ex_customer_service: { mercenary: 2 }, // 前任客服：冷靜
  indecisive: { mercenary: 1 },
  gym_salesman: { mercenary: 1 }, // 健身房推銷員：商人
};
