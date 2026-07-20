import { priceForModel, computeCost } from "./pricing.js";

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
  const zero = () => ({
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    costUSD: 0,
    messages: 0,
  });

  const groups = new Map(); // key -> bucket
  const total = zero();
  const unknownModels = new Set();

  for await (const ev of events) {
    if (since && (!ev.ts || ev.ts < since)) continue;

    const price = priceForModel(pricing, ev.model);
    if (price._unknown) unknownModels.add(ev.model);

    const cost = computeCost(price, ev.usage);
    const key = byModel ? ev.model : "__all__";

    if (!groups.has(key)) groups.set(key, zero());
    const bucket = groups.get(key);

    const u = ev.usage;
    for (const [field, tok] of [
      ["inputTokens", u.input ?? 0],
      ["outputTokens", u.output ?? 0],
      ["cacheWriteTokens", u.cacheWrite ?? 0],
      ["cacheReadTokens", u.cacheRead ?? 0],
    ]) {
      bucket[field] += tok;
      total[field] += tok;
    }
    bucket.costUSD += cost;
    bucket.messages += 1;
    total.costUSD += cost;
    total.messages += 1;
  }

  return {
    groups,
    total,
    unknownModels: [...unknownModels].filter((m) => m && m !== "unknown"),
  };
}
