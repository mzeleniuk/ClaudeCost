// @ts-check

/**
 * Vertex AI endpoints that serve Claude, and the pricing keys each one offers.
 * Source: https://cloud.google.com/model-garden/partner-models/pricing
 * (checked 2026-11-05). The global endpoint offers every model.
 *
 * Multi-region ("us", "eu") and regional endpoints cost 10% more than global
 * for Claude 4.5 and later, which covers every model in pricing.config.json.
 * The premium applies to every rate, including long-context rates.
 */
export const DEFAULT_REGION = "global";

const REGIONAL_MULTIPLIER = 1.1;

/** @type {Record<string, string[]>} */
export const REGION_MODELS = {
  us: [
    "claude-haiku-5-5",
    "claude-sonnet-5-5",
    "claude-opus-5-5",
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-fable-5-1",
    "claude-fable-5",
    "claude-opus-4-8",
    "claude-opus-4-7",
  ],
  eu: [
    "claude-haiku-5-5",
    "claude-sonnet-5-5",
    "claude-opus-5-5",
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-fable-5-1",
    "claude-fable-5",
    "claude-opus-4-8",
    "claude-opus-4-7",
  ],
  "us-east5": [
    "claude-opus-4-6",
    "claude-opus-4-5",
    "claude-sonnet-4-6",
    "claude-sonnet-4-5",
    "claude-haiku-4-5",
  ],
  "europe-west1": [
    "claude-haiku-5-5",
    "claude-opus-4-6",
    "claude-opus-4-5",
    "claude-sonnet-4-6",
    "claude-sonnet-4-5",
    "claude-haiku-4-5",
  ],
  "asia-southeast1": [
    "claude-haiku-5-5",
    "claude-opus-4-6",
    "claude-opus-4-5",
    "claude-sonnet-4-6",
    "claude-sonnet-4-5",
  ],
  "asia-east1": ["claude-haiku-4-5"],
};

export const REGIONS = [DEFAULT_REGION, ...Object.keys(REGION_MODELS)];

// Every key some endpoint lists. Keys outside this set come from a custom
// pricing file, and we cannot tell where Vertex offers them.
const LISTED_KEYS = new Set(Object.values(REGION_MODELS).flat());

/**
 * Throw unless `region` is a known endpoint. `source` names where it came from.
 *
 * @param {string} region
 * @param {string} source
 */
export function validateRegion(region, source) {
  if (!REGIONS.includes(region)) {
    throw new Error(
      `unknown region "${region}" in ${source}. Use one of: ${REGIONS.join(", ")}.`,
    );
  }

  return region;
}

/** @param {string} region */
export function regionMultiplier(region) {
  return region === DEFAULT_REGION ? 1 : REGIONAL_MULTIPLIER;
}

/**
 * False when Vertex does not list the pricing key at this endpoint.
 *
 * @param {string} region
 * @param {string} key
 */
export function regionOffers(region, key) {
  if (region === DEFAULT_REGION || !LISTED_KEYS.has(key)) return true;
  return REGION_MODELS[region].includes(key);
}

/**
 * Short label for reports, e.g. "us (+10% over global)".
 *
 * @param {string} region
 */
export function describeRegion(region) {
  const premium = Math.round((regionMultiplier(region) - 1) * 100);
  return premium > 0 ? `${region} (+${premium}% over global)` : region;
}
