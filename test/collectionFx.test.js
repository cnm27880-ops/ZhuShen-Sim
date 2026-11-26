// 副本特殊物品效果框架（露葵 2026-11-26）：14 種效果、絕不加通過率、每件物品 1 種效果、加總有上限、各掛鉤生效
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/data/config.js";
import { DUNGEONS, getSpecialReward } from "../src/data/dungeons.js";
import { COLLECTION_FX, FX_KEYS, describeFx } from "../src/data/collectionFx.js";
import { SHOP_ITEMS } from "../src/data/shopItems.js";
import { createNewGame, createSamsarite, endOfDay, upkeepOf, serialize, deserialize } from "../src/engine/core.js";
import { collectionEffects, collectionPassBonus } from "../src/engine/collectionFx.js";
import { rollInsights, rollKarmaDrop } from "../src/engine/growth.js";
import { failSanityLoss } from "../src/engine/squad.js";
import { shopPrice } from "../src/engine/shop.js";
import { slotPrice } from "../src/engine/market.js";
import { startRun } from "../src/engine/dungeon.js";
import { step } from "../src/engine/dispatch.js";
import { getRel } from "../src/engine/relations.js";
import { pairProfile } from "../src/engine/tension.js";

const ALL = DUNGEONS.flatMap((d) => d.specialRewards);

/** 暫時把某件物品的效果換掉（測掛鉤用）；一定要在 fn 之後還原。要在建立 state 之前呼叫（收藏加總依 state 快取） */
function withEffect(id, effect, fn) {
  const r = getSpecialReward(id);
  const old = r.effect;
  r.effect = effect;
  try {
    return fn();
  } finally {
    r.effect = old;
  }
}
const ITEM = "ghost_seal";
const fresh = (n = 2, seed = 11) => {
  const state = createNewGame(seed);
  state.points = 100000;
  state.samsarites = [];
  for (let i = 0; i < n; i++) {
    const s = createSamsarite(state, "C");
    s.tags = [];
    s.stats.power = 99999;
    s.stats.sanity = 60;
    state.samsarites.push(s);
  }
  state.collection = [ITEM];
  return state;
};

test("框架：14 種效果都有名稱與說明、CONFIG 有單件值與上限，沒有通過率類效果", () => {
  assert.equal(FX_KEYS.length, 14);
  for (const k of FX_KEYS) {
    const c = CONFIG.collection.effects[k];
    assert.ok(c && c.unit > 0 && c.cap >= c.unit, k);
    assert.ok(COLLECTION_FX[k].name && COLLECTION_FX[k].icon && describeFx(k, c.unit).length > 4, k);
  }
  assert.deepEqual(Object.keys(CONFIG.collection.effects).sort(), [...FX_KEYS].sort());
  assert.ok(!FX_KEYS.some((k) => /pass|genre|power/i.test(k)), "效果名稱不能含通過率／戰力");
});

test("90 件特殊物品：每件恰好 1 種框架內效果、id 不變、不再有 passBonus／genreBonus", () => {
  assert.equal(ALL.length, 90);
  assert.equal(new Set(ALL.map((r) => r.id)).size, 90);
  for (const id of ["ghost_talisman", "ghost_seal", "yin_yang_eye", "ark_accelerator", "ember_staff", "ch1_02_r1", "ch2_boss_r3", "ch5_boss_r2"]) assert.ok(getSpecialReward(id), `舊 id ${id} 要還在（舊存檔相容）`);
  for (const r of ALL) {
    const keys = Object.keys(r.effect);
    assert.equal(keys.length, 1, r.id);
    assert.ok(FX_KEYS.includes(keys[0]), `${r.id} → ${keys[0]}`);
    assert.ok(r.effect[keys[0]] > 0 && r.desc.length > 4);
  }
});

test("加總：全收藏的每一種效果都不超過上限；沒有收藏全為 0；collectionPassBonus 永遠 0", () => {
  const state = createNewGame(1);
  assert.ok(FX_KEYS.every((k) => collectionEffects(state)[k] === 0));
  state.collection = ALL.map((r) => r.id);
  const fx = collectionEffects(state);
  for (const k of FX_KEYS) assert.ok(fx[k] <= CONFIG.collection.effects[k].cap + 1e-9, k);
  assert.equal(collectionPassBonus(state, DUNGEONS[0]), 0);
  // 把所有物品都換成同一種效果：驗證上限真的會擋
  const olds = ALL.map((r) => r.effect);
  try {
    for (const r of ALL) r.effect = { upkeepCut: 0.5 };
    const s2 = createNewGame(2);
    s2.collection = ALL.map((r) => r.id);
    assert.equal(collectionEffects(s2).upkeepCut, CONFIG.collection.effects.upkeepCut.cap);
  } finally {
    ALL.forEach((r, i) => (r.effect = olds[i]));
  }
});

test("insightChance：頓悟機率 +（擲骰次數不變）", () => {
  const prev = CONFIG.insight.chance;
  CONFIG.insight.chance = 0;
  try {
    const none = fresh();
    assert.equal(rollInsights(none, none.samsarites).length, 0);
    withEffect(ITEM, { insightChance: 0.1 }, () => {
      let hits = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const st = fresh(2, seed);
        hits += rollInsights(st, st.samsarites).length;
      }
      CONFIG.insight.chance = 0.9; // 0.9 + 0.1 = 1：必中
      const st = fresh();
      assert.equal(rollInsights(st, st.samsarites).length, 2);
      assert.ok(hits > 0, "機率 10% 抽 120 次要有命中");
    });
  } finally {
    CONFIG.insight.chance = prev;
  }
});

test("karmaDrop：只加在原本就有機率掉的章節", () => {
  const prevRoll = { ...CONFIG.karma.chapterRoll };
  CONFIG.karma.chapterRoll[4] = 0.9;
  delete CONFIG.karma.chapterRoll[1];
  try {
    withEffect(ITEM, { karmaDrop: 0.1 }, () => {
      const st = fresh();
      const ch4 = DUNGEONS.find((d) => d.chapter === 4);
      const ch1 = DUNGEONS.find((d) => d.chapter === 1);
      for (let i = 0; i < 40; i++) assert.ok(rollKarmaDrop(st, ch4, 1, false) >= 1, "0.9 + 0.1 = 必掉");
      for (let i = 0; i < 40; i++) assert.equal(rollKarmaDrop(st, ch1, 1, false), 0, "沒有基礎機率的章節不加");
    });
  } finally {
    Object.assign(CONFIG.karma.chapterRoll, prevRoll);
  }
});

test("sanityGuard：單房失敗理智損耗 -（合計取整、最少仍扣 1）", () => {
  const st = fresh();
  const base = failSanityLoss(st, st.samsarites, 5);
  withEffect(ITEM, { sanityGuard: 2 }, () => {
    const s2 = fresh();
    assert.equal(failSanityLoss(s2, s2.samsarites, 5), base - 2);
    assert.equal(failSanityLoss(s2, s2.samsarites, 1), 1, "最少仍扣 1");
  });
});

test("upkeepCut／shopDiscount：維持費與商店／黑市價格打折，沒收藏時與原本相同", () => {
  const st = fresh();
  const s = st.samsarites[0];
  const upkeep = upkeepOf(s, st);
  const item = SHOP_ITEMS.find((i) => i.price >= 100);
  const slot = { itemId: item.id };
  const price = shopPrice(st, item);
  const mprice = slotPrice(st, slot).price;
  assert.equal(price, item.price);
  const prevCap = CONFIG.collection.effects.upkeepCut.cap;
  CONFIG.collection.effects.upkeepCut.cap = 0.5; // 測試用：放寬上限才看得出明顯折扣
  try {
    withEffect(ITEM, { upkeepCut: 0.5 }, () => {
      const s2 = fresh();
      assert.ok(upkeepOf(s2.samsarites[0], s2) <= Math.round(upkeep * 0.5) + 1);
      assert.ok(upkeepOf(s2.samsarites[0], s2) < upkeep);
    });
  } finally {
    CONFIG.collection.effects.upkeepCut.cap = prevCap;
  }
  withEffect(ITEM, { shopDiscount: 0.1 }, () => {
    const s2 = fresh();
    assert.equal(shopPrice(s2, item), Math.round(item.price * 0.9));
    assert.equal(slotPrice(s2, slot).price, Math.round(mprice * 0.9));
  });
});

test("sanityRegen／healBoost：日結多回理智、傷勢多降一級", () => {
  const run = () => {
    const st = fresh(1);
    const s = st.samsarites[0];
    s.stats.sanity = 40;
    s.injury = 2;
    s.restDaysLeft = 3;
    endOfDay(st);
    return { sanity: s.stats.sanity, injury: s.injury };
  };
  const base = run();
  withEffect(ITEM, { sanityRegen: 3 }, () => {
    assert.equal(run().sanity, base.sanity + 3);
  });
  const prevCap = CONFIG.collection.effects.healBoost.cap;
  CONFIG.collection.effects.healBoost.cap = 1; // 測試用：放寬上限變成 100%
  try {
    withEffect(ITEM, { healBoost: 1 }, () => {
      assert.equal(run().injury, base.injury - 1, "機率 100% 每日多降 1 級");
    });
  } finally {
    CONFIG.collection.effects.healBoost.cap = prevCap;
  }
});

test("bondLove：通關後同行情誼好感更高", () => {
  const love = () => {
    const st = fresh(2, 21);
    CONFIG.dungeonEvent.enabled = false;
    try {
      const d = DUNGEONS[0];
      const r = startRun(st, d.id, st.samsarites.map((s) => s.id));
      assert.equal(r.ok, true, r.reason);
      let guard = 0;
      while (st.runs.length && guard++ < 200) step(st);
      assert.ok(st.lastRun.success, "99999 戰力應該通關");
      return getRel(st, st.samsarites[0], st.samsarites[1]).love;
    } finally {
      CONFIG.dungeonEvent.enabled = true;
    }
  };
  const base = love();
  withEffect(ITEM, { bondLove: 2 }, () => {
    assert.ok(love() > base);
  });
});

test("intelGain／hiddenRoom：情報條與貪婪隱藏房", () => {
  const intelAfter = () => {
    const st = fresh(2, 31);
    CONFIG.dungeonEvent.enabled = false;
    try {
      const d = DUNGEONS[0];
      startRun(st, d.id, st.samsarites.map((s) => s.id));
      let guard = 0;
      while (st.runs.length && guard++ < 200) step(st);
      return st.dungeonStats[d.id].intel;
    } finally {
      CONFIG.dungeonEvent.enabled = true;
    }
  };
  const base = intelAfter();
  withEffect(ITEM, { intelGain: 0.5 }, () => {
    assert.ok(intelAfter() > base);
  });
  // 貪婪探索：基礎機率 0.9 + 收藏 0.1 = 必開隱藏房
  const prev = CONFIG.relic.greedyChance;
  CONFIG.relic.greedyChance = 0.9;
  try {
    withEffect(ITEM, { hiddenRoom: 0.1 }, () => {
      const st = fresh(2, 41);
      const d = DUNGEONS[0];
      st.dungeonStats[d.id] = { attempts: 1, clears: 1, intel: CONFIG.dungeon.intel.max };
      const r = startRun(st, d.id, st.samsarites.map((s) => s.id), { greedy: true });
      assert.equal(r.ok, true, r.reason);
      let guard = 0;
      while (st.runs.length && guard++ < 200) step(st);
      assert.ok(st.lastRun.hidden, "隱藏房一定要開");
    });
  } finally {
    CONFIG.relic.greedyChance = prev;
  }
});

test("tensionEase：張力事件產生率 -%", () => {
  const st = fresh(2);
  const [a, b] = st.samsarites;
  const base = pairProfile(st, a, b).p;
  withEffect(ITEM, { tensionEase: 0.1 }, () => {
    const s2 = fresh(2);
    const p2 = pairProfile(s2, s2.samsarites[0], s2.samsarites[1]).p;
    assert.ok(Math.abs(p2 - base * 0.9) < 1e-12);
  });
});

test("存檔往返：收藏 id 不變、效果由資料表算出（舊存檔打開就套用新效果）", () => {
  const st = createNewGame(3);
  st.collection = ["ghost_talisman", "ch1_02_r1", "ch2_boss_r2"];
  const loaded = deserialize(serialize(st));
  assert.deepEqual(loaded.collection, st.collection);
  const fx = collectionEffects(loaded);
  assert.ok(FX_KEYS.some((k) => fx[k] > 0));
});
