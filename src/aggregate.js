// @ts-check
import { priceForModel, computeCost } from "./pricing.js";
import { monthKey } from "./since.js";
import { addUsage, emptyTotals } from "./totals.js";

/**
 * @import {
 *   AggregateResult,
 *   MonthTotals,
 *   MonthlyResult,
 *   PricingSummary,
 *   PricingTable,
 *   Totals,
 *   UsageEvent,
 * } from "./types.js"
 */

/** @typedef {AsyncIterable<UsageEvent> | Iterable<UsageEvent>} Events */

/**
 * The value at `key`, created with `init` on first access.
 *
 * @template K, V
 * @param {Map<K, V>} map
 * @param {K} key
 * @param {() => V} init
 * @returns {V}
 */
function getOrInit(map, key, init) {
  let value = map.get(key);

  if (value === undefined) {
    value = init();
    map.set(key, value);
  }

  return value;
}

/**
 * Price every event at or after `since` and add it to the grand total and to
 * the buckets `bucketsFor` returns. Events without a timestamp are excluded
 * when `since` is set. When `bucketsFor` returns null the event is skipped.
 *
 * @param {Events} events
 * @param {{ pricing: PricingTable, since: Date | null }} opts
 * @param {(event: UsageEvent) => Totals[] | null} bucketsFor
 * @returns {Promise<PricingSummary>}
 */
async function sumEvents(events, { pricing, since }, bucketsFor) {
  const total = emptyTotals();
  const notInRegion = new Set();
  const unknownModels = new Set();

  for await (const event of events) {
    if (since && (!event.ts || event.ts < since)) continue;

    const buckets = bucketsFor(event);
    if (!buckets) continue;

    const price = priceForModel(pricing, event.model);

    if (price._unknown) unknownModels.add(event.model);
    if (price._notInRegion) notInRegion.add(event.model);

    const cost = computeCost(price, event.usage);

    for (const bucket of buckets) addUsage(bucket, event.usage, cost);
    addUsage(total, event.usage, cost);
  }

  return {
    notInRegion: [...notInRegion],
    total,
    unknownModels: [...unknownModels].filter((m) => m && m !== "unknown"),
  };
}

/**
 * Aggregate usage events into totals, optionally grouped by model.
 *
 * @param {Events} events Normalized events from readUsageEvents or dedupeEvents.
 * @param {object} opts
 * @param {PricingTable} opts.pricing
 * @param {Date | null} [opts.since] Inclusive lower bound.
 * @param {boolean} [opts.byModel]
 * @returns {Promise<AggregateResult>}
 */
export async function aggregate(
  events,
  { pricing, since = null, byModel = false },
) {
  /** @type {Map<string, Totals>} */
  const groups = new Map();
  const summary = await sumEvents(events, { pricing, since }, (event) =>
    byModel ? [getOrInit(groups, event.model, emptyTotals)] : [],
  );

  return { groups, ...summary };
}

/**
 * Aggregate usage events into per-month, per-model totals. Months are local
 * "YYYY-MM" keys. Events without a timestamp are counted in `skippedUndated`.
 *
 * @param {Events} events
 * @param {object} opts
 * @param {PricingTable} opts.pricing
 * @param {Date | null} [opts.since] Inclusive lower bound.
 * @returns {Promise<MonthlyResult>}
 */
export async function aggregateByMonth(events, { pricing, since = null }) {
  /** @type {Map<string, MonthTotals>} */
  const months = new Map();
  let skippedUndated = 0;

  const summary = await sumEvents(events, { pricing, since }, (event) => {
    const key = monthKey(event.ts);

    if (!key) {
      skippedUndated += 1;
      return null;
    }

    const month = getOrInit(months, key, () => ({
      models: new Map(),
      total: emptyTotals(),
    }));

    return [getOrInit(month.models, event.model, emptyTotals), month.total];
  });

  return { months, skippedUndated, ...summary };
}

/**
 * Month entries in ascending "YYYY-MM" order.
 *
 * @template T
 * @param {Map<string, T>} months
 * @returns {[string, T][]}
 */
export function sortedMonths(months) {
  return [...months].sort(([a], [b]) => a.localeCompare(b));
}
