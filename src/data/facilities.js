// 5 座主神空間永久基建的名稱與說明（4-F-3）。數字（等級上限、造價、結晶門檻、每級效果）都在 CONFIG.facility.defs。
export const FACILITY_ORDER = ["gravity", "pods", "stele", "nursery", "radar"];

export const FACILITY_TEXT = {
  gravity: { name: "重力修煉室", icon: "🏋️", desc: "全隊基礎戰力 +3%／級（滿級 +30%）" },
  pods: { name: "生命溫養艙", icon: "🧬", desc: "重傷自然痊癒率 +5%／級、留守每日理智額外 +0.5／級" },
  stele: { name: "法則共鳴碑", icon: "🗿", desc: "開啟基因鎖積分花費 -2%／級（與破鎖耗材加算，總折扣封頂 -45%）" },
  nursery: { name: "萬界育嬰堂", icon: "🍼", desc: "子嗣培育期 -5%／級、出世基礎資質下限 +4%／級" },
  radar: { name: "星界觀測樞", icon: "📡", desc: "副本情報獲取 +10%／級、洲際團戰勝利積分與掉落 +8%／級" },
};
