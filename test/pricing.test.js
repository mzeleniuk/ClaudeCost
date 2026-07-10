import { test } from "node:test";
import assert from "node:assert/strict";
import { priceForModel, computeCost, loadPricing } from "../src/pricing.js";
import { fileURLToPath } from "node:url";

const PRICING = {
  "claude-sonnet-4": {
    input: 3.0,
    output: 15.0,
    cacheWrite: 3.75,
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
});

test("computes cost correctly", () => {
  const p = priceForModel(PRICING, "claude-sonnet-4");
  const cost = computeCost(p, {
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
  });
  assert.equal(cost, 18.0); // 3 + 15
});

test("prefers longest matching key regardless of key order", () => {
  const pricing = {
    "claude-sonnet-4": {
      input: 1.0,
      output: 1.0,
      cacheWrite: 0,
      cacheRead: 0,
    },
    "claude-sonnet-4.5": {
      input: 2.0,
      output: 2.0,
      cacheWrite: 0,
      cacheRead: 0,
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

test("includes cache tokens", () => {
  const p = priceForModel(PRICING, "claude-sonnet-4");
  const cost = computeCost(p, {
    cache_read_input_tokens: 1_000_000,
    cache_creation_input_tokens: 1_000_000,
  });
  assert.equal(cost, 4.05); // 0.30 + 3.75
});
