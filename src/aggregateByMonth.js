import { priceForModel, computeCost } from "./pricing.js";
import { monthKey } from "./since.js";

const zero = () => ({
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUSD: 0,
  inputTokens: 0,
  messages: 0,
  outputTokens: 0,
});

function accumulate(bucket, usage, cost) {
  bucket.cacheReadTokens += usage.cacheRead ?? 0;
  bucket.cacheWriteTokens += usage.cacheWrite ?? 0;
  bucket.costUSD += cost;
  bucket.inputTokens += usage.input ?? 0;
  bucket.messages += 1;
  bucket.outputTokens += usage.output ?? 0;
}

/**
 * Aggregate usage events into per-month, per-model totals.
 *
 * @param {AsyncIterable|Iterable} events
 * @param {object} opts
 *   - pricing: pricing table
 *   - since: Date|null lower bound (inclusive); events without a timestamp are excluded
 */
export async function aggregateByMonth(events, { pricing, since = null }) {
  const months = new Map();
  const notInRegion = new Set();
  const total = zero();
  const unknownModels = new Set();
  let skippedUndated = 0;

  for await (const ev of events) {
    if (since && (!ev.ts || ev.ts < since)) continue;

    if (!ev.ts) {
      skippedUndated += 1;
      continue;
    }

    const key = monthKey(ev.ts);

    if (!key) {
      skippedUndated += 1;
      continue;
    }

    const price = priceForModel(pricing, ev.model);

    if (price._unknown) unknownModels.add(ev.model);
    if (price._notInRegion) notInRegion.add(ev.model);

    const cost = computeCost(price, ev.usage);

    if (!months.has(key)) {
      months.set(key, { models: new Map(), total: zero() });
    }

    const month = months.get(key);

    if (!month.models.has(ev.model)) {
      month.models.set(ev.model, zero());
    }

    const modelBucket = month.models.get(ev.model);

    accumulate(modelBucket, ev.usage, cost);
    accumulate(month.total, ev.usage, cost);
    accumulate(total, ev.usage, cost);
  }

  return {
    months,
    notInRegion: [...notInRegion],
    skippedUndated,
    total,
    unknownModels: [...unknownModels].filter((m) => m && m !== "unknown"),
  };
}

export function sortedMonthKeys(months) {
  return [...months.keys()].sort();
}
