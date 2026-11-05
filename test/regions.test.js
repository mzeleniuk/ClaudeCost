import { test } from "node:test";
import assert from "node:assert/strict";

import { loadPricing, priceForModel, computeCost } from "../src/pricing.js";
import {
  REGIONS,
  REGION_MODELS,
  describeRegion,
  regionMultiplier,
  regionOffers,
  validateRegion,
} from "../src/regions.js";

const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test("region lists only name models in pricing.config.json, and cover all of them", () => {
  const keys = Object.keys(loadPricing()).filter((k) => !k.startsWith("_"));
  const listed = new Set(Object.values(REGION_MODELS).flat());

  for (const key of listed) assert.ok(keys.includes(key), key);
  for (const key of keys) assert.ok(listed.has(key), key);
});

test("global costs list price; every other endpoint costs 10% more", () => {
  assert.equal(regionMultiplier("global"), 1);
  for (const region of REGIONS.filter((r) => r !== "global")) {
    assert.equal(regionMultiplier(region), 1.1, region);
  }
});

test("validateRegion rejects unknown endpoints", () => {
  assert.equal(validateRegion("us-east5", "--region"), "us-east5");
  assert.throws(
    () => validateRegion("us-central1", "--region"),
    /unknown region "us-central1" in --region\. Use one of: global, us, eu/,
  );
});

test("regionOffers follows the Vertex model lists", () => {
  assert.equal(regionOffers("global", "claude-opus-5-5"), true);
  assert.equal(regionOffers("us", "claude-opus-5-5"), true);
  assert.equal(regionOffers("us-east5", "claude-opus-5-5"), false);
  assert.equal(regionOffers("asia-east1", "claude-haiku-4-5"), true);
  assert.equal(regionOffers("asia-east1", "claude-sonnet-4-5"), false);
  // Keys from a custom pricing file are not checked
  assert.equal(regionOffers("asia-east1", "my-private-model"), true);
});

test("describeRegion shows the premium for non-global endpoints", () => {
  assert.equal(describeRegion("global"), "global");
  assert.equal(describeRegion("eu"), "eu (+10% over global)");
});

test("loadPricing scales every rate, including long-context rates", () => {
  const global = loadPricing();
  const us = loadPricing(undefined, "us");

  // Vertex US multi-region: Opus 5.5 is $4.40 input, $22 output, $0.22 cache hit
  const opus = priceForModel(us, "claude-opus-5-5");
  close(opus.input, 4.4);
  close(opus.output, 22);
  close(opus.cacheWrite, 5.5);
  close(opus.cacheWrite1h, 8.8);
  close(opus.cacheRead, 0.22);

  // Haiku 5.5 over 100K: $0.55 input, $2.75 output; threshold unchanged
  const haiku = priceForModel(us, "claude-haiku-5-5");
  close(haiku.longContext.input, 0.55);
  close(haiku.longContext.output, 2.75);
  assert.equal(haiku.longContext.threshold, 100_000);

  // The global table is not modified
  assert.equal(priceForModel(global, "claude-opus-5-5").input, 4);
});

test("cost at a regional endpoint is 1.1x the global cost", () => {
  const usage = {
    cacheRead: 500_000,
    cacheWrite: 0,
    hasCacheBreakdown: false,
    input: 200_000,
    output: 100_000,
  };
  const model = "claude-sonnet-4-5@20250929";
  const global = computeCost(priceForModel(loadPricing(), model), usage);
  const regional = computeCost(
    priceForModel(loadPricing(undefined, "europe-west1"), model),
    usage,
  );

  close(regional, global * 1.1);
});

test("models an endpoint does not offer are priced and marked", () => {
  const pricing = loadPricing(undefined, "us-east5");

  assert.equal(priceForModel(pricing, "claude-opus-5-5")._notInRegion, true);
  close(priceForModel(pricing, "claude-opus-5-5").input, 4.4);
  assert.equal(
    priceForModel(pricing, "claude-sonnet-4-5")._notInRegion,
    undefined,
  );
  assert.equal(priceForModel(pricing, "claude-opus-4-9")._unknown, true);
});
