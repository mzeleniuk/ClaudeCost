// @ts-check
import { sortedMonths } from "../aggregate.js";
import { formatJson, roundCost } from "./format.js";

/** @import { MonthlyResult, Totals } from "../types.js" */

/**
 * Monthly totals for one scan, without the report envelope.
 *
 * @param {MonthlyResult} result
 */
export function buildMonthlyProfile({
  archivedTranscripts,
  months,
  notInRegion,
  skippedUndated,
  total,
  unknownModels,
}) {
  /** @type {Record<string, { models: Record<string, Totals>, total: Totals }>} */
  const byMonth = {};

  for (const [key, month] of sortedMonths(months)) {
    byMonth[key] = {
      models: Object.fromEntries(
        [...month.models].map(([model, totals]) => [model, roundCost(totals)]),
      ),
      total: roundCost(month.total),
    };
  }

  return {
    archivedTranscripts,
    byMonth,
    notInRegion,
    skippedUndated,
    total: roundCost(total),
    unknownModels,
  };
}

/**
 * JSON report for `aggregateByMonth` results.
 *
 * @param {MonthlyResult} result
 * @param {{ since: Date | null, region?: string }} opts
 */
export function renderMonthlyJson(result, { since, region }) {
  const profile = buildMonthlyProfile(result);

  return formatJson({
    archivedTranscripts: profile.archivedTranscripts,
    byMonth: profile.byMonth,
    generatedAt: new Date().toISOString(),
    groupedBy: "month-model",
    notInRegion: profile.notInRegion,
    region,
    since: since ? since.toISOString() : null,
    skippedUndated: profile.skippedUndated,
    total: profile.total,
    unknownModels: profile.unknownModels,
  });
}
