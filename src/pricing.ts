import { PROJECT_ROOT } from "./paths.ts";
import path from "node:path";

import { DEFAULT_REGION, regionMultiplier, regionOffers } from "./regions.ts";
import { isPlainObject, readJsonObject } from "./validate.ts";

import type { Price, PricingTable, Rates, Usage } from "./types.ts";

const DEFAULT_PRICING_PATH = path.join(PROJECT_ROOT, "pricing.config.json");
const PRICE_FIELDS: readonly (keyof Rates)[] = ["input", "output", "cacheWrite", "cacheWrite1h", "cacheRead"];

function validateRates(
  rates: Record<string, unknown>,
  label: string,
  filePath: string,
): asserts rates is Record<string, unknown> & Rates {
  for (const field of PRICE_FIELDS) {
    const value = rates[field];

    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`invalid pricing entry for ${label} in ${filePath}: "${field}" must be a number`);
    }
  }
}

// Check one pricing entry, including its optional long-context tier.
function validatePrice(
  rates: Record<string, unknown>,
  model: string,
  filePath: string,
): asserts rates is Record<string, unknown> & Price {
  validateRates(rates, `"${model}"`, filePath);

  if (rates.longContext !== undefined) {
    const tier = rates.longContext;
    const label = `"${model}" longContext`;

    if (!isPlainObject(tier)) {
      throw new Error(`invalid pricing entry for ${label} in ${filePath}: expected object`);
    }

    if (typeof tier.threshold !== "number" || !Number.isInteger(tier.threshold) || tier.threshold <= 0) {
      throw new Error(`invalid pricing entry for ${label} in ${filePath}: "threshold" must be a positive integer`);
    }

    validateRates(tier, label, filePath);
  }
}

/**
 * Validate a parsed pricing file and return its model entries.
 * Keys starting with "_" are comments and are dropped.
 */
function parsePricing(raw: Record<string, unknown>, filePath: string): PricingTable {
  const pricing: PricingTable = {};

  for (const [model, rates] of Object.entries(raw)) {
    if (model.startsWith("_")) continue;

    if (!isPlainObject(rates)) {
      throw new Error(`invalid pricing entry for "${model}" in ${filePath}: expected object`);
    }

    validatePrice(rates, model, filePath);
    pricing[model] = rates;
  }

  return pricing;
}

// Copy of `rates` with every price field multiplied.
function scaleRates<T extends Rates>(rates: T, multiplier: number): T {
  const scaled = { ...rates };
  for (const field of PRICE_FIELDS) scaled[field] = rates[field] * multiplier;

  return scaled;
}

/**
 * Convert global-endpoint prices to the given Vertex endpoint's prices.
 * Entries the endpoint does not list are still priced, and are marked
 * `_notInRegion` so reports can flag a likely wrong region setting.
 */
function applyRegion(pricing: PricingTable, region: string = DEFAULT_REGION): PricingTable {
  const multiplier = regionMultiplier(region);
  const result: PricingTable = {};

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
 */
export function loadPricing(customPath?: string, region: string = DEFAULT_REGION): PricingTable {
  const filePath = customPath || DEFAULT_PRICING_PATH;
  const pricing = parsePricing(readJsonObject(filePath, "pricing"), filePath);

  return applyRegion(pricing, region);
}

/**
 * Treat "." and "-" as the same so "claude-opus-5.5" matches the key
 * "claude-opus-5-5".
 */
function normalizeModelId(value: string) {
  return value.replaceAll(".", "-");
}

// After a key, a model ID may end, or continue with "@", "[", ":", an
// 8-digit date ("-20250514") or a word ("-v1", "-latest"). A digit that
// continues the version ("-9" in "claude-opus-4-9") is not a match.
const KEY_SUFFIX = String.raw`(?=$|[^a-z0-9-]|-(?:\d{8}(?!\d)|[a-z]))`;

const UNKNOWN_PRICE: Readonly<Price> = Object.freeze({
  _unknown: true,
  cacheRead: 0,
  cacheWrite: 0,
  cacheWrite1h: 0,
  input: 0,
  output: 0,
});

interface Matchers {
  matchers: { key: string; id: string; re: RegExp }[];
  resolved: Map<string, Price>;
}

const matcherCache: WeakMap<PricingTable, Matchers> = new WeakMap();

function matchersFor(pricing: PricingTable) {
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
 */
export function priceForModel(pricing: PricingTable, model: string = ""): Price {
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

/** Tokens in a request's prompt: uncached input plus cache reads and writes. */
function promptTokens(usage: Usage) {
  return usage.input + usage.cacheRead + usage.cacheWrite;
}

/**
 * Charge for each kind of token, in USD per million tokens times tokens.
 * When the price has a longContext tier and the prompt is over its threshold,
 * every token in the request is billed at the long-context rates.
 */
function chargeByKind(price: Price, usage: Usage) {
  const rates = price.longContext && promptTokens(usage) > price.longContext.threshold ? price.longContext : price;

  const cacheWrite = usage.hasCacheBreakdown
    ? (usage.cacheWrite5m ?? 0) * rates.cacheWrite + (usage.cacheWrite1h ?? 0) * rates.cacheWrite1h
    : usage.cacheWrite * rates.cacheWrite;

  return {
    input: usage.input * rates.input,
    output: usage.output * rates.output,
    cacheWrite,
    cacheRead: usage.cacheRead * rates.cacheRead,
  };
}

// Compute USD cost for a single normalized usage record.
export function computeCost(price: Price, usage: Usage) {
  const charge = chargeByKind(price, usage);
  return (charge.input + charge.output + charge.cacheWrite + charge.cacheRead) / PER_MILLION;
}

// The same cost as computeCost, split by kind of token.
export function costBreakdown(price: Price, usage: Usage) {
  const charge = chargeByKind(price, usage);

  return {
    input: charge.input / PER_MILLION,
    output: charge.output / PER_MILLION,
    cacheWrite: charge.cacheWrite / PER_MILLION,
    cacheRead: charge.cacheRead / PER_MILLION,
  };
}
