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

test("prices hyphenated sonnet 5.5 separately from sonnet 5", () => {
  const pricing = loadPricing();
  const sonnet55 = priceForModel(pricing, "claude-sonnet-5-5");

  assert.equal(sonnet55, pricing["claude-sonnet-5-5"]);
  assert.equal(sonnet55.input, 2);
  assert.equal(sonnet55.output, 10);
  assert.equal(sonnet55.cacheWrite, 2.5);
  assert.equal(sonnet55.cacheWrite1h, 4);
  assert.equal(sonnet55.cacheRead, 0.1);
  assert.equal(
    priceForModel(pricing, "claude-sonnet-5.5@20260928"),
    pricing["claude-sonnet-5-5"],
  );
  assert.equal(
    priceForModel(pricing, "claude-sonnet-5@20260630"),
    pricing["claude-sonnet-5"],
  );
});

test("prices hyphenated haiku 5.5 separately from haiku 4.5", () => {
  const pricing = loadPricing();
  const haiku55 = priceForModel(pricing, "claude-haiku-5-5");

  assert.equal(haiku55, pricing["claude-haiku-5-5"]);
  assert.equal(haiku55.input, 0.1);
  assert.equal(haiku55.output, 0.5);
  assert.equal(haiku55.cacheWrite, 0.125);
  assert.equal(haiku55.cacheWrite1h, 0.2);
  assert.equal(haiku55.cacheRead, 0.01);
  assert.equal(
    priceForModel(pricing, "claude-haiku-5.5@20261007"),
    pricing["claude-haiku-5-5"],
  );
  assert.equal(
    priceForModel(pricing, "claude-haiku-4-5@20251015").input,
    1,
  );
});

test("prices hyphenated opus 5.5 separately from opus 5", () => {
  const pricing = loadPricing();
  const opus55 = priceForModel(pricing, "claude-opus-5-5");

  assert.equal(opus55.input, 4);
  assert.equal(opus55.output, 20);
  assert.equal(opus55.cacheWrite, 5);
  assert.equal(opus55.cacheWrite1h, 8);
  assert.equal(opus55.cacheRead, 0.2);
  assert.equal(priceForModel(pricing, "claude-opus-5.5").input, 4);
  assert.equal(priceForModel(pricing, "claude-opus-5").input, 5);
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
    "claude-sonnet-4-5": {
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
