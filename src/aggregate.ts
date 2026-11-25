import { emptyParseStats } from "./parse.ts";
import { priceForModel, computeCost } from "./pricing.ts";
import { monthKey } from "./since.ts";
import { addUsage, emptyTotals } from "./totals.ts";

import type {
  AggregateResult,
  MonthTotals,
  MonthlyResult,
  ParseStats,
  PricingSummary,
  PricingTable,
  Totals,
  UsageEvent,
} from "./types.ts";

export type Events = AsyncIterable<UsageEvent> | Iterable<UsageEvent>;

// The value at `key`, created with `init` on first access.
function getOrInit<K, V>(map: Map<K, V>, key: K, init: () => V): V {
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
 */
async function sumEvents(
  events: Events,
  { pricing, since, parse }: { pricing: PricingTable; since: Date | null; parse: ParseStats },
  bucketsFor: (event: UsageEvent) => Totals[] | null,
): Promise<PricingSummary> {
  const archived = new Set<string>();
  const notInRegion = new Set<string>();
  const total = emptyTotals();
  const unknownModels = new Set<string>();

  for await (const event of events) {
    if (since && (!event.ts || event.ts < since)) continue;

    const buckets = bucketsFor(event);
    if (!buckets) continue;

    const price = priceForModel(pricing, event.model);

    if (event.archived) archived.add(event.file);
    if (price._notInRegion) notInRegion.add(event.model);
    if (price._unknown) unknownModels.add(event.model);

    const cost = computeCost(price, event.usage);

    for (const bucket of buckets) addUsage(bucket, event.usage, cost);
    addUsage(total, event.usage, cost);
  }

  return {
    archivedTranscripts: archived.size,
    notInRegion: [...notInRegion],
    parse,
    total,
    unknownModels: [...unknownModels].filter((m) => m && m !== "unknown"),
  };
}

// Aggregate usage events into totals, optionally grouped by model.
export async function aggregate(
  events: Events,
  {
    pricing,
    since = null,
    byModel = false,
    parse = emptyParseStats(),
  }: { pricing: PricingTable; since?: Date | null; byModel?: boolean; parse?: ParseStats },
): Promise<AggregateResult> {
  const groups: Map<string, Totals> = new Map();
  const summary = await sumEvents(events, { pricing, since, parse }, (event) =>
    byModel ? [getOrInit(groups, event.model, emptyTotals)] : [],
  );

  return { groups, ...summary };
}

/**
 * Aggregate usage events into per-month, per-model totals. Months are local
 * "YYYY-MM" keys. Events without a timestamp are counted in `skippedUndated`.
 * `parse` goes into the result as it is, for the report to show.
 */
export async function aggregateByMonth(
  events: Events,
  {
    pricing,
    since = null,
    parse = emptyParseStats(),
  }: { pricing: PricingTable; since?: Date | null; parse?: ParseStats },
): Promise<MonthlyResult> {
  const months: Map<string, MonthTotals> = new Map();
  let skippedUndated = 0;

  const summary = await sumEvents(events, { pricing, since, parse }, (event) => {
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

// Month entries in ascending "YYYY-MM" order.
export function sortedMonths<T>(months: Map<string, T>): [string, T][] {
  return [...months].sort(([a], [b]) => a.localeCompare(b));
}
