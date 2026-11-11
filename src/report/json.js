// @ts-check
import { formatJson, roundCost } from "./format.js";

/** @import { AggregateResult } from "../types.js" */

/**
 * Totals for one scan, without the report envelope.
 *
 * @param {AggregateResult} result
 * @param {{ byModel: boolean }} opts
 */
export function buildUsageProfile(
  { archivedTranscripts, groups, notInRegion, total, unknownModels },
  { byModel },
) {
  return {
    archivedTranscripts,
    notInRegion,
    total: roundCost(total),
    unknownModels,
    ...(byModel && {
      byModel: Object.fromEntries(
        [...groups].map(([model, totals]) => [model, roundCost(totals)]),
      ),
    }),
  };
}

/**
 * JSON report for `aggregate` results.
 *
 * @param {AggregateResult} result
 * @param {{ byModel: boolean, since: Date | null, region?: string }} opts
 */
export function renderJson(result, { byModel, since, region }) {
  const profile = buildUsageProfile(result, { byModel });

  return formatJson({
    archivedTranscripts: profile.archivedTranscripts,
    generatedAt: new Date().toISOString(),
    groupedBy: byModel ? "model" : "none",
    notInRegion: profile.notInRegion,
    region,
    since: since ? since.toISOString() : null,
    total: profile.total,
    unknownModels: profile.unknownModels,
    ...(byModel && { byModel: profile.byModel }),
  });
}
