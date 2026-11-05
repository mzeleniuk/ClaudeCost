import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_REGION, regionMultiplier, regionOffers } from "./regions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PRICING_PATH = path.join(__dirname, "..", "pricing.config.json");

const PRICE_FIELDS = [
  "input",
  "output",
  "cacheWrite",
  "cacheWrite1h",
  "cacheRead",
];

function validateRates(rates, label, filePath) {
  for (const field of PRICE_FIELDS) {
    const value = rates[field];

    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(
        `invalid pricing entry for ${label} in ${filePath}: "${field}" must be a number`,
      );
    }
  }
}

function validatePricing(pricing, filePath) {
  if (
    pricing == null ||
    typeof pricing !== "object" ||
    Array.isArray(pricing)
  ) {
    throw new Error(`invalid pricing file (expected object): ${filePath}`);
  }

  for (const [model, rates] of Object.entries(pricing)) {
    if (model.startsWith("_")) continue;
    if (rates == null || typeof rates !== "object" || Array.isArray(rates)) {
      throw new Error(
        `invalid pricing entry for "${model}" in ${filePath}: expected object`,
      );
    }
    validateRates(rates, `"${model}"`, filePath);

    if (rates.longContext !== undefined) {
      const tier = rates.longContext;
      const label = `"${model}" longContext`;

      if (tier == null || typeof tier !== "object" || Array.isArray(tier)) {
        throw new Error(
          `invalid pricing entry for ${label} in ${filePath}: expected object`,
        );
      }

      if (!Number.isInteger(tier.threshold) || tier.threshold <= 0) {
        throw new Error(
          `invalid pricing entry for ${label} in ${filePath}: "threshold" must be a positive integer`,
        );
      }

      validateRates(tier, label, filePath);
    }
  }
}

function scaleRates(rates, multiplier) {
  const scaled = { ...rates };
  for (const field of PRICE_FIELDS) scaled[field] = rates[field] * multiplier;

  return scaled;
}

/**
 * Convert global-endpoint prices to the given Vertex endpoint's prices.
 * Entries the endpoint does not list are still priced, and are marked
 * `_notInRegion` so reports can flag a likely wrong region setting.
 */
export function applyRegion(pricing, region = DEFAULT_REGION) {
  const multiplier = regionMultiplier(region);
  const result = {};

  for (const [key, rates] of Object.entries(pricing)) {
    if (key.startsWith("_")) {
      result[key] = rates;
      continue;
    }

    const entry = scaleRates(rates, multiplier);

    if (rates.longContext) {
      entry.longContext = scaleRates(rates.longContext, multiplier);
    }

    if (!regionOffers(region, key)) entry._notInRegion = true;
    result[key] = entry;
  }

  return result;
}

/**
 * Loads the pricing table. Prices are USD per 1,000,000 tokens at the global
 * endpoint, converted to `region`'s prices.
 * Users can override by editing pricing.config.json or passing --pricing.
 */
export function loadPricing(customPath, region = DEFAULT_REGION) {
  const p = customPath || DEFAULT_PRICING_PATH;
  const raw = fs.readFileSync(p, "utf8");
  const pricing = JSON.parse(raw);
  validatePricing(pricing, p);

  return applyRegion(pricing, region);
}

// Treat "." and "-" as the same so "claude-opus-5.5" matches the key "claude-opus-5-5".
function normalizeModelId(value) {
  return value.replaceAll(".", "-");
}

// After a key, a model ID may end, or continue with "@", "[", ":", an
// 8-digit date ("-20250514") or a word ("-v1", "-latest"). A digit that
// continues the version ("-9" in "claude-opus-4-9") is not a match.
const KEY_SUFFIX = String.raw`(?=$|[^a-z0-9-]|-(?:\d{8}(?!\d)|[a-z]))`;

const UNKNOWN_PRICE = Object.freeze({
  _unknown: true,
  cacheRead: 0,
  cacheWrite: 0,
  cacheWrite1h: 0,
  input: 0,
  output: 0,
});

// Per pricing table: key matchers (longest first) and resolved models.
const matcherCache = new WeakMap();

function matchersFor(pricing) {
  let entry = matcherCache.get(pricing);

  if (!entry) {
    const matchers = Object.keys(pricing)
      .filter((k) => !k.startsWith("_"))
      .map((key) => {
        const id = normalizeModelId(key);
        const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return { key, id, re: new RegExp(escaped + KEY_SUFFIX, "i") };
      })
      .sort((a, b) => b.id.length - a.id.length);

    entry = { matchers, resolved: new Map() };
    matcherCache.set(pricing, entry);
  }

  return entry;
}

/**
 * Resolve the price entry for a model name.
 * Vertex model IDs vary (e.g. "claude-sonnet-4-5@20250929", "claude-opus-5-5"),
 * so a key matches anywhere in the ID, dots and hyphens are equivalent, and
 * the key must end on a version boundary. Longest key wins so
 * "claude-opus-5-5" is not priced as "claude-opus-5", and an unlisted
 * "claude-sonnet-5-6" is reported as unknown instead of priced as "claude-sonnet-5".
 */
export function priceForModel(pricing, model = "") {
  const { matchers, resolved } = matchersFor(pricing);
  if (resolved.has(model)) return resolved.get(model);

  const normalizedModel = normalizeModelId(model);
  const match = matchers.find(({ re }) => re.test(normalizedModel));
  const price = match ? pricing[match.key] : UNKNOWN_PRICE;

  resolved.set(model, price);
  return price;
}

const PER_MILLION = 1_000_000;

/** Tokens in a request's prompt: uncached input plus cache reads and writes. */
export function promptTokens(usage = {}) {
  return (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
}

/**
 * Compute USD cost for a single normalized usage record.
 * When the price has a longContext tier and the prompt is over its threshold,
 * every token in the request is billed at the long-context rates.
 * @param {object} price  - { input, output, cacheWrite, cacheWrite1h, cacheRead, longContext? }
 * @param {object} usage  - normalized usage from parse.normalizeUsage
 */
export function computeCost(price, usage = {}) {
  const rates =
    price.longContext && promptTokens(usage) > price.longContext.threshold
      ? price.longContext
      : price;

  const input = usage.input ?? 0;
  const output = usage.output ?? 0;
  const cacheRead = usage.cacheRead ?? 0;

  let cacheCost;

  if (usage.hasCacheBreakdown) {
    cacheCost =
      (usage.cacheWrite5m ?? 0) * rates.cacheWrite +
      (usage.cacheWrite1h ?? 0) * rates.cacheWrite1h;
  } else {
    cacheCost = (usage.cacheWrite ?? 0) * rates.cacheWrite;
  }

  return (
    (input * rates.input +
      output * rates.output +
      cacheCost +
      cacheRead * rates.cacheRead) /
    PER_MILLION
  );
}
