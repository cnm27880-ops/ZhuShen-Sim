// 標籤資料表（Phase 2）。要加標籤只要在 TAGS 陣列繼續加物件，引擎不用改。
// 欄位說明：
//   id / name / rarity（N R SR SSR UR）
//   kind：stat 基礎數值 / trait 性格機制 / soul 靈魂核心
//   desc：給玩家看的說明
//   powerPct：戰力加成（0.1 = +10%）
//   passBonus：全隊單房通過率加成（每個成員各算一次，總和會被 CONFIG.tags.tagBonusCap 限制）
//   genreBonus：在特定類型副本（靈異／科幻／奇幻）的額外通過率加成
//   envBonus：遇到特定環境標籤時的額外通過率加成（key 是環境標籤 id）
//   rewardPct：通關積分加成（每個成員各算一次）
//   injuryShield：受傷時「少受一級傷」的機率；負數代表有機率「多受一級傷」
//   dodge：被點名受傷時直接閃過的機率
//   swing：每個房間的通過率隨機浮動 ±swing（烏鴉嘴、Flag 之類的賭徒標籤）
//   pending：這個標籤原本設計的事件效果還沒做，目前只有簡化效果（Phase 2-B 之後已沒有標籤用到）

export const TAGS = [
  // ───── N（8）─────
  { id: "born_strong", name: "天生神力", rarity: "N", kind: "stat", desc: "力氣大到不講道理。", powerPct: 0.15 },
  { id: "thick_skin", name: "皮糙肉厚", rarity: "N", kind: "stat", desc: "挨打是日常。", powerPct: 0.05, injuryShield: 0.25 },
  { id: "nimble", name: "身輕如燕", rarity: "N", kind: "stat", desc: "跑得比壞消息還快。", powerPct: 0.05, dodge: 0.2 },
  { id: "overwork_reborn", name: "過勞死轉生者", rarity: "N", kind: "trait", desc: "上輩子做到死，這輩子還在做。", powerPct: 0.08 },
  { id: "delivery_pro", name: "外送平台五星騎手", rarity: "N", kind: "trait", desc: "準時送達是職業道德，連副本也不例外。", passBonus: 0.03 },
  { id: "gym_salesman", name: "健身房推銷員", rarity: "N", kind: "trait", desc: "體格不錯，嘴更厲害。", powerPct: 0.05, passBonus: 0.01 },
  { id: "bad_direction", name: "路痴", rarity: "N", kind: "trait", desc: "走廊永遠有三條路，他永遠選錯。", passBonus: -0.03, genreBonus: { 科幻: -0.05 }, envBonus: { mirror_world: -0.15 } },
  { id: "light_fingers", name: "順手牽羊", rarity: "N", kind: "trait", desc: "路過的東西都會順手帶走。", rewardPct: 0.05 },

  // ───── R（7）─────
  { id: "schrodinger_courage", name: "薛丁格的勇氣", rarity: "R", kind: "trait", desc: "不打開箱子，就不知道他會不會逃跑。", swing: 0.15, envBonus: { live_show: -0.1 } },
  { id: "doomsday_hoarder", name: "末日囤積症", rarity: "R", kind: "trait", desc: "背包永遠比別人多裝三天份。", genreBonus: { 科幻: 0.1 } },
  { id: "keyboard_general", name: "鍵盤軍事家", rarity: "R", kind: "trait", desc: "紙上談兵，偶爾真的有用。", passBonus: -0.02, genreBonus: { 科幻: 0.1 } },
  { id: "salary_thief", name: "薪水小偷轉世", rarity: "R", kind: "trait", desc: "上班摸魚，但抽成永遠算得很精。", powerPct: -0.1, rewardPct: 0.08 },
  { id: "blood_allergy", name: "血液過敏症", rarity: "R", kind: "trait", desc: "看到血就手軟。", injuryShield: -0.25, genreBonus: { 靈異: -0.05 } },
  { id: "indecisive", name: "選擇困難症晚期", rarity: "R", kind: "trait", desc: "左轉還是右轉？再想想。", passBonus: -0.03, envBonus: { mind_link: -0.1 } },
  { id: "lecturer", name: "爹味說教狂", rarity: "R", kind: "trait", desc: "一路碎碎念，隊友的士氣竟然莫名提升。", passBonus: 0.02 },

  // ───── SR（11）─────
  { id: "horror_fool", name: "恐怖片作死專家", rarity: "SR", kind: "trait", desc: "「我去看看外面」是他的口頭禪。", genreBonus: { 靈異: 0.15 }, injuryShield: -0.15 },
  { id: "smiling_tiger", name: "功德無量笑面虎", rarity: "SR", kind: "trait", desc: "笑著把死者的遺產收進口袋。", rewardPct: 0.1 },
  { id: "haunted_sleeper", name: "凶宅試睡員", rarity: "SR", kind: "trait", desc: "睡過的凶宅比你住過的房子還多。", genreBonus: { 靈異: 0.12 } },
  { id: "scam_lecturer", name: "詐騙集團首席講師", rarity: "SR", kind: "trait", desc: "連副本 NPC 都能被他說服。", passBonus: 0.03, rewardPct: 0.1 },
  { id: "pain_convert", name: "痛覺轉化", rarity: "SR", kind: "soul", desc: "越痛越強。", powerPct: 0.1, injuryShield: 0.3 },
  { id: "green_tea", name: "綠茶／心機蓮花", rarity: "SR", kind: "trait", desc: "笑得很甜，專門製造修羅場。", passBonus: -0.03 },
  { id: "mad_matchmaker", name: "瘋狂月老", rarity: "SR", kind: "trait", desc: "看誰都想湊成一對。", passBonus: 0.02 },
  { id: "emergency_ration", name: "緊急口糧預備役", rarity: "SR", kind: "soul", desc: "隊友看他的眼神總是帶著一點食慾，反而讓他活得更久。", passBonus: 0.02, injuryShield: 0.2 },
  { id: "backstabber", name: "背刺成癮者", rarity: "SR", kind: "trait", desc: "不背刺隊友渾身不對勁。", powerPct: 0.1, passBonus: -0.03 },
  { id: "bgm_carrier", name: "BGM 自帶者", rarity: "SR", kind: "soul", desc: "走到哪都有配樂，鼓舞士氣，但潛行就別想了。", passBonus: 0.03, envBonus: { live_show: 0.1, absolute_silence: -0.2 } },
  { id: "gourmet", name: "美食家", rarity: "SR", kind: "trait", desc: "連怪物的肉都要品評一番。", passBonus: 0.02, rewardPct: 0.05 },

  // ───── SSR（4）─────
  { id: "ex_customer_service", name: "前任主神空間客服", rarity: "SSR", kind: "soul", desc: "知道主神的後台，連主神都要賣他三分面子。", passBonus: 0.04, envBonus: { god_watching: 0.15 } },
  { id: "crow_mouth", name: "烏鴉嘴", rarity: "SSR", kind: "soul", desc: "說好事會壞，說壞事會成真。", swing: 0.25 },
  { id: "luck_borrower", name: "借運人", rarity: "SSR", kind: "soul", desc: "把別人的運氣借來用，從不還。", powerPct: 0.1, passBonus: 0.04 },
  { id: "flag_architect", name: "Flag 建築師", rarity: "SSR", kind: "soul", desc: "每一句「打完這仗我就回家」都在蓋樓。", passBonus: 0.05, genreBonus: { 奇幻: 0.1 }, swing: 0.1 },
];

// 副本環境標籤：每次進副本隨機抽一個。
// passMod：全隊通過率修正；rewardMult：通關積分倍率
export const ENV_TAGS = [
  { id: "absolute_silence", name: "絕對靜音領域", desc: "聲音傳不出去，也聽不到任何提示。", passMod: -0.03 },
  { id: "mirror_world", name: "鏡像反轉世界", desc: "左右顛倒，連方向感都被反轉。", passMod: 0 },
  { id: "live_show", name: "強制直播秀", desc: "有觀眾在看，膽小的人更膽小，愛表現的人更賣力。", passMod: 0 },
  { id: "mind_link", name: "精神共享網絡", desc: "所有人的念頭混在一起，猶豫的人特別痛苦。", passMod: 0.02 },
  { id: "god_watching", name: "主神親自督戰", desc: "主神在旁邊看，難度更高，獎勵也更好。", passMod: -0.05, rewardMult: 1.2 },
];

// 事件獲得的標籤（死亡連鎖等）：不會被抽卡抽到，所以不放在 TAGS（MVP 標籤維持 30 個）
export const ACQUIRED_TAGS = [
  { id: "broken_heart", name: "道心破碎", rarity: "R", kind: "acquired", desc: "失去重要的人之後，再也提不起勁。", passBonus: -0.03 },
  { id: "demon_path", name: "走火入魔", rarity: "SR", kind: "acquired", desc: "力量變強了，人也變得不太穩定，別人更難喜歡上他。", powerPct: 0.08, loveGainMult: 0.5 }, // 4-C-2：戰力 +8%、別人對他的好感獲取減半（取代舊的 +15%／通過率 -4%／受傷減免 -20%）
];

export function getTag(id) {
  return TAGS.find((t) => t.id === id) ?? ACQUIRED_TAGS.find((t) => t.id === id);
}
export function getEnvTag(id) {
  return ENV_TAGS.find((t) => t.id === id);
}
