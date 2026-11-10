// @ts-check
import path from "node:path";

import { DEFAULT_REGION, regionMultiplier, regionOffers } from "./regions.js";
import { isPlainObject, readJsonObject } from "./validate.js";

/** @import { Price, PricingTable, Rates, Usage } from "./types.js" */

const DEFAULT_PRICING_PATH = path.join(
  import.meta.dirname,
  "..",
  "pricing.config.json",
);

/** @type {readonly (keyof Rates)[]} */
const PRICE_FIELDS = [
  "input",
  "output",
  "cacheWrite",
  "cacheWrite1h",
  "cacheRead",
];

/**
 * @param {Record<string, unknown>} rates
 * @param {string} label
 * @param {string} filePath
 */
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

/**
 * Validate a parsed pricing file and return its model entries.
 * Keys starting with "_" are comments and are dropped.
 *
 * @param {Record<string, unknown>} raw
 * @param {string} filePath
 * @returns {PricingTable}
 */
function parsePricing(raw, filePath) {
  /** @type {PricingTable} */
  const pricing = {};

  for (const [model, rates] of Object.entries(raw)) {
    if (model.startsWith("_")) continue;

    if (!isPlainObject(rates)) {
      throw new Error(
        `invalid pricing entry for "${model}" in ${filePath}: expected object`,
      );
    }

    validateRates(rates, `"${model}"`, filePath);

    if (rates.longContext !== undefined) {
      const tier = rates.longContext;
      const label = `"${model}" longContext`;

      if (!isPlainObject(tier)) {
        throw new Error(
          `invalid pricing entry for ${label} in ${filePath}: expected object`,
        );
      }

      if (
        typeof tier.threshold !== "number" ||
        !Number.isInteger(tier.threshold) ||
        tier.threshold <= 0
      ) {
        throw new Error(
          `invalid pricing entry for ${label} in ${filePath}: "threshold" must be a positive integer`,
        );
      }

      validateRates(tier, label, filePath);
    }

    pricing[model] = /** @type {Price} */ (rates);
  }

  return pricing;
}

/**
 * Copy of `rates` with every price field multiplied.
 *
 * @template {Rates} T
 * @param {T} rates
 * @param {number} multiplier
 * @returns {T}
 */
function scaleRates(rates, multiplier) {
  const scaled = { ...rates };
  for (const field of PRICE_FIELDS) scaled[field] = rates[field] * multiplier;

  return scaled;
}

/**
 * Convert global-endpoint prices to the given Vertex endpoint's prices.
 * Entries the endpoint does not list are still priced, and are marked
 * `_notInRegion` so reports can flag a likely wrong region setting.
 *
 * @param {PricingTable} pricing
 * @param {string} [region]
 * @returns {PricingTable}
 */
export function applyRegion(pricing, region = DEFAULT_REGION) {
  const multiplier = regionMultiplier(region);
  /** @type {PricingTable} */
  const result = {};

  for (const [key, rates] of Object.entries(pricing)) {
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
 * Load the pricing table. Prices are USD per 1,000,000 tokens at the global
 * endpoint, converted to `region`'s prices.
 * Users can override by editing pricing.config.json or passing --pricing.
 *
 * @param {string} [customPath]
 * @param {string} [region]
 * @returns {PricingTable}
 */
export function loadPricing(customPath, region = DEFAULT_REGION) {
  const filePath = customPath || DEFAULT_PRICING_PATH;
  const pricing = parsePricing(readJsonObject(filePath, "pricing"), filePath);

  return applyRegion(pricing, region);
}

/**
 * Treat "." and "-" as the same so "claude-opus-5.5" matches the key
 * "claude-opus-5-5".
 *
 * @param {string} value
 */
function normalizeModelId(value) {
  return value.replaceAll(".", "-");
}

// After a key, a model ID may end, or continue with "@", "[", ":", an
// 8-digit date ("-20250514") or a word ("-v1", "-latest"). A digit that
// continues the version ("-9" in "claude-opus-4-9") is not a match.
const KEY_SUFFIX = String.raw`(?=$|[^a-z0-9-]|-(?:\d{8}(?!\d)|[a-z]))`;

/** @type {Readonly<Price>} */
const UNKNOWN_PRICE = Object.freeze({
  _unknown: true,
  cacheRead: 0,
  cacheWrite: 0,
  cacheWrite1h: 0,
  input: 0,
  output: 0,
});

/**
 * @typedef {object} Matchers
 * @property {{ key: string, id: string, re: RegExp }[]} matchers Longest first.
 * @property {Map<string, Price>} resolved Model ID to price, filled on lookup.
 */

/** @type {WeakMap<PricingTable, Matchers>} */
const matcherCache = new WeakMap();

/** @param {PricingTable} pricing */
function matchersFor(pricing) {
  let entry = matcherCache.get(pricing);

  if (!entry) {
    const matchers = Object.keys(pricing)
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
 *
 * @param {PricingTable} pricing
 * @param {string} [model]
 * @returns {Price}
 */
export function priceForModel(pricing, model = "") {
  const { matchers, resolved } = matchersFor(pricing);
  const cached = resolved.get(model);
  if (cached) return cached;

  const normalizedModel = normalizeModelId(model);
  const match = matchers.find(({ re }) => re.test(normalizedModel));
  const price = match ? pricing[match.key] : UNKNOWN_PRICE;

  resolved.set(model, price);
  return price;
}

const PER_MILLION = 1_000_000;

/**
 * Tokens in a request's prompt: uncached input plus cache reads and writes.
 *
 * @param {Partial<Usage>} [usage]
 */
export function promptTokens(usage = {}) {
  return (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
}

/**
 * Compute USD cost for a single normalized usage record.
 * When the price has a longContext tier and the prompt is over its threshold,
 * every token in the request is billed at the long-context rates.
 *
 * @param {Price} price
 * @param {Partial<Usage>} [usage]
 */
export function computeCost(price, usage = {}) {
  const rates =
    price.longContext && promptTokens(usage) > price.longContext.threshold
      ? price.longContext
      : price;

  const input = usage.input ?? 0;
  const output = usage.output ?? 0;
  const cacheRead = usage.cacheRead ?? 0;

  const cacheCost = usage.hasCacheBreakdown
    ? (usage.cacheWrite5m ?? 0) * rates.cacheWrite +
      (usage.cacheWrite1h ?? 0) * rates.cacheWrite1h
    : (usage.cacheWrite ?? 0) * rates.cacheWrite;

  return (
    (input * rates.input +
      output * rates.output +
      cacheCost +
      cacheRead * rates.cacheRead) /
    PER_MILLION
  );
}
