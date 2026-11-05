import { priceForModel, computeCost } from "./pricing.js";
import { addUsage, emptyTotals } from "./totals.js";

/**
 * Aggregate usage events into totals, optionally grouped by model.
 *
 * @param {AsyncIterable|Iterable} events  - normalized events from readUsageEvents / dedupeEvents
 * @param {object} opts
 *   - pricing: pricing table
 *   - since: Date|null lower bound (inclusive); events without a timestamp are excluded
 *   - byModel: boolean
 */
export async function aggregate(
  events,
  { pricing, since = null, byModel = false },
) {
  const groups = new Map();
  const notInRegion = new Set();
  const total = emptyTotals();
  const unknownModels = new Set();

  for await (const ev of events) {
    if (since && (!ev.ts || ev.ts < since)) continue;

    const price = priceForModel(pricing, ev.model);

    if (price._unknown) unknownModels.add(ev.model);
    if (price._notInRegion) notInRegion.add(ev.model);

    const cost = computeCost(price, ev.usage);
    const key = byModel ? ev.model : "__all__";

    if (!groups.has(key)) groups.set(key, emptyTotals());

    addUsage(groups.get(key), ev.usage, cost);
    addUsage(total, ev.usage, cost);
  }

  return {
    groups,
    notInRegion: [...notInRegion],
    total,
    unknownModels: [...unknownModels].filter((m) => m && m !== "unknown"),
  };
}
