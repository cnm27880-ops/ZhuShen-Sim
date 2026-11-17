// 自動化中樞兩個模組的名稱與說明（A-3 階段 3）。數字（造價、維護費、故障率、容量）都在 CONFIG.automation.modules。
export const AUTOMATION_ORDER = ["mediate", "recruit"];

export const AUTOMATION_TEXT = {
  mediate: {
    name: "調解中樞",
    icon: "🕊️",
    desc: "每天自動替你調停幾件人際摩擦（成功率比親手調停低；等級 3 的事件、補償、拆開仍要你親自處理）",
  },
  recruit: {
    name: "人力調度處",
    icon: "📋",
    desc: "名冊低於目標人數時，自動抽最便宜的卡池補人（公庫要夠寬裕才抽）",
  },
};
