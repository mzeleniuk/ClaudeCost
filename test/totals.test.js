import { test } from "node:test";
import assert from "node:assert/strict";

import { addUsage, emptyTotals, sumTotals } from "../src/totals.js";
import { roundCost } from "../src/report/format.js";

test("addUsage adds tokens, cost and one message", () => {
  const totals = emptyTotals();
  addUsage(totals, { input: 1, output: 2, cacheWrite: 3, cacheRead: 4 }, 0.5);
  addUsage(totals, { input: 10 }, 0.25);

  assert.deepEqual(totals, {
    inputTokens: 11,
    outputTokens: 2,
    cacheWriteTokens: 3,
    cacheReadTokens: 4,
    costUSD: 0.75,
    messages: 2,
  });
});

test("sumTotals adds totals field by field", () => {
  const a = emptyTotals();
  const b = emptyTotals();
  addUsage(a, { input: 5, output: 1 }, 0.1);
  addUsage(b, { cacheRead: 7 }, 0.2);

  const sum = sumTotals([a, b]);
  assert.equal(sum.inputTokens, 5);
  assert.equal(sum.cacheReadTokens, 7);
  assert.equal(sum.messages, 2);
  assert.equal(roundCost(sum).costUSD, 0.3);
});
