import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { priceForModel, computeCost, loadPricing } from "../src/pricing.js";

const PRICING = {
  "claude-sonnet-4": {
    input: 3.0,
    output: 15.0,
    cacheWrite: 3.75,
    cacheWrite1h: 6.0,
    cacheRead: 0.3,
  },
};

test("matches model by substring", () => {
  const p = priceForModel(PRICING, "claude-sonnet-4@20250514");
  assert.equal(p.input, 3.0);
});

test("flags unknown models", () => {
  const p = priceForModel(PRICING, "gpt-4");
  assert.equal(p._unknown, true);
  assert.equal(p.cacheWrite1h, 0);
});

test("computes cost correctly", () => {
  const p = priceForModel(PRICING, "claude-sonnet-4");
  const cost = computeCost(p, {
    cacheRead: 0,
    cacheWrite: 0,
    hasCacheBreakdown: false,
    input: 1_000_000,
    output: 1_000_000,
  });
  assert.equal(cost, 18.0); // 3 + 15
});

test("prefers longest matching key regardless of key order", () => {
  const pricing = {
    "claude-sonnet-4": {
      cacheRead: 0,
      cacheWrite: 0,
      cacheWrite1h: 0,
      input: 1.0,
      output: 1.0,
    },
    "claude-sonnet-4.5": {
      cacheRead: 0,
      cacheWrite: 0,
      cacheWrite1h: 0,
      input: 2.0,
      output: 2.0,
    },
  };
  const p = priceForModel(pricing, "claude-sonnet-4.5@20250514");
  assert.equal(p.input, 2.0);
});

test("loadPricing rejects invalid price fields", () => {
  const invalid = new URL("./fixtures/invalid-pricing.json", import.meta.url);
  assert.throws(
    () => loadPricing(fileURLToPath(invalid)),
    /"output" must be a number/,
  );
});

test("flat cache write uses cacheWrite rate", () => {
  const p = priceForModel(PRICING, "claude-sonnet-4");
  const cost = computeCost(p, {
    cacheRead: 1_000_000,
    cacheWrite: 1_000_000,
    hasCacheBreakdown: false,
    input: 0,
    output: 0,
  });
  assert.equal(cost, 4.05); // 3.75 + 0.30
});

test("breakdown prices 5m and 1h separately", () => {
  const p = priceForModel(PRICING, "claude-sonnet-4");
  const cost = computeCost(p, {
    cacheRead: 0,
    cacheWrite: 2_000_000,
    cacheWrite1h: 1_000_000,
    cacheWrite5m: 1_000_000,
    hasCacheBreakdown: true,
    input: 0,
    output: 0,
  });
  assert.equal(cost, 9.75); // 3.75 + 6.0
});
