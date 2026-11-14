// 30 世界骨架清單（Phase 4-D-2 建立，4-D-4 的 dungeons.js 依此展開）：每章 5 張常規副本 + 1 張尾王。
// 這個檔案只放「id／章節／是否尾王」，讓商店特產（src/data/shopItems.js）、奇物（src/data/relics.js）、副本表共用同一份世界名單。
// id 規則：第 1 章前 3 關沿用語意 ID（ghost_village／silent_ark／ember_war），其餘 chN_01～chN_05、chN_boss；
// 順序 = 同章內由易到難（推薦戰力由低到高），尾王排最後。
// 舊存檔／舊測試的 id（chN_1～chN_4）對照見 LEGACY_WORLD_IDS（存檔遷移用）。

export const WORLD_LIST = [
  { id: "ghost_village", chapter: 1 },
  { id: "ch1_02", chapter: 1 },
  { id: "silent_ark", chapter: 1 },
  { id: "ch1_04", chapter: 1 },
  { id: "ember_war", chapter: 1 },
  { id: "ch1_boss", chapter: 1, boss: true },
  ...[2, 3, 4, 5].flatMap((c) => [
    ...[1, 2, 3, 4, 5].map((i) => ({ id: `ch${c}_0${i}`, chapter: c })),
    { id: `ch${c}_boss`, chapter: c, boss: true },
  ]),
];

/** 舊 id → 新 id（4-D-4 前：每章 4 關，第 4 關是尾王；舊第 1／2／3 關對應新第 1／3／5 關，數值等價） */
export const LEGACY_WORLD_IDS = Object.fromEntries(
  [1, 2, 3, 4, 5].flatMap((c) => [
    [`ch${c}_4`, `ch${c}_boss`],
    ...(c === 1 ? [] : [[`ch${c}_1`, `ch${c}_01`], [`ch${c}_2`, `ch${c}_03`], [`ch${c}_3`, `ch${c}_05`]]),
  ])
);
export const migrateWorldId = (id) => LEGACY_WORLD_IDS[id] ?? id;

export const WORLD_IDS = WORLD_LIST.map((w) => w.id);
