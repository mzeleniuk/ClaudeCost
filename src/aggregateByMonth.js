import { priceForModel, computeCost } from "./pricing.js";
import { monthKey } from "./since.js";
import { addUsage, emptyTotals } from "./totals.js";

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
  const total = emptyTotals();
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
      months.set(key, { models: new Map(), total: emptyTotals() });
    }

    const month = months.get(key);

    if (!month.models.has(ev.model)) {
      month.models.set(ev.model, emptyTotals());
    }

    const modelBucket = month.models.get(ev.model);

    addUsage(modelBucket, ev.usage, cost);
    addUsage(month.total, ev.usage, cost);
    addUsage(total, ev.usage, cost);
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
