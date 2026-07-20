import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PRICING_PATH = path.join(__dirname, "..", "pricing.config.json");

const PRICE_FIELDS = [
  "input",
  "output",
  "cacheWrite",
  "cacheWrite1h",
  "cacheRead",
];

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
    for (const field of PRICE_FIELDS) {
      const value = rates[field];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(
          `invalid pricing entry for "${model}" in ${filePath}: "${field}" must be a number`,
        );
      }
    }
  }
}

/**
 * Loads the pricing table. Prices are USD per 1,000,000 tokens.
 * Users can override by editing pricing.config.json or passing --pricing.
 */
export function loadPricing(customPath) {
  const p = customPath || DEFAULT_PRICING_PATH;
  const raw = fs.readFileSync(p, "utf8");
  const pricing = JSON.parse(raw);
  validatePricing(pricing, p);
  return pricing;
}

/**
 * Resolve the price entry for a model name using a substring match.
 * Vertex model IDs vary (e.g. "claude-sonnet-4@20250514"), so we match loosely.
 * Longest key wins so "claude-sonnet-4.5" is not priced as "claude-sonnet-4".
 */
export function priceForModel(pricing, model = "") {
  const keys = Object.keys(pricing)
    .filter((k) => !k.startsWith("_"))
    .sort((a, b) => b.length - a.length);
  const key = keys.find((k) => model.includes(k));
  return key
    ? pricing[key]
    : {
        _unknown: true,
        cacheRead: 0,
        cacheWrite: 0,
        cacheWrite1h: 0,
        input: 0,
        output: 0,
      };
}

const PER_MILLION = 1_000_000;

/**
 * Compute USD cost for a single normalized usage record.
 * @param {object} price  - { input, output, cacheWrite, cacheWrite1h, cacheRead }
 * @param {object} usage  - normalized usage from parse.normalizeUsage
 */
export function computeCost(price, usage = {}) {
  const input = usage.input ?? 0;
  const output = usage.output ?? 0;
  const cacheRead = usage.cacheRead ?? 0;

  let cacheCost;
  if (usage.hasCacheBreakdown) {
    cacheCost =
      (usage.cacheWrite5m ?? 0) * price.cacheWrite +
      (usage.cacheWrite1h ?? 0) * price.cacheWrite1h;
  } else {
    cacheCost = (usage.cacheWrite ?? 0) * price.cacheWrite;
  }

  return (
    (input * price.input +
      output * price.output +
      cacheCost +
      cacheRead * price.cacheRead) /
    PER_MILLION
  );
}
