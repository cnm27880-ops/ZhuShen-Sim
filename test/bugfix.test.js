// Bug 修復清單（2026-11-14）的回歸測試：每個 Bug 一組，依編號累積
import test from "node:test";
import assert from "node:assert/strict";

import { chanceDisplay } from "../src/engine/dungeon.js";

test("問題 6：通關率顯示最高 99%，並附失敗機率", () => {
  assert.deepEqual(chanceDisplay(0.9), { pct: 90, failPct: 10 });
  assert.deepEqual(chanceDisplay(0.9996), { pct: 99, failPct: 1 }, "99.96% 不能顯示成 100%");
  assert.deepEqual(chanceDisplay(1), { pct: 99, failPct: 1 });
  assert.deepEqual(chanceDisplay(0), { pct: 0, failPct: 100 });
  assert.equal(chanceDisplay(0.756).pct, 75, "向下取整，不樂觀進位");
});
