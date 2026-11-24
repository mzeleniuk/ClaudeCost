import { formatJson, roundCost } from "./format.ts";
import type { AggregateResult } from "../types.ts";

// Totals for one scan, without the report envelope.
export function buildUsageProfile(
  { archivedTranscripts, groups, notInRegion, total, unknownModels }: AggregateResult,
  { byModel }: { byModel: boolean },
) {
  return {
    archivedTranscripts,
    notInRegion,
    total: roundCost(total),
    unknownModels,
    ...(byModel && {
      byModel: Object.fromEntries([...groups].map(([model, totals]) => [model, roundCost(totals)])),
    }),
  };
}

// JSON report for `aggregate` results.
export function renderJson(
  result: AggregateResult,
  { byModel, since, region }: { byModel: boolean; since: Date | null; region?: string },
) {
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
