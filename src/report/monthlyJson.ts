import { sortedMonths } from "../aggregate.ts";
import { formatJson, roundCost } from "./format.ts";
import type { MonthlyResult, Totals } from "../types.ts";

// Monthly totals for one scan, without the report envelope.
export function buildMonthlyProfile({
  archivedTranscripts,
  months,
  notInRegion,
  skippedUndated,
  total,
  unknownModels,
}: MonthlyResult) {
  const byMonth: Record<string, { models: Record<string, Totals>; total: Totals }> = {};

  for (const [key, month] of sortedMonths(months)) {
    byMonth[key] = {
      models: Object.fromEntries([...month.models].map(([model, totals]) => [model, roundCost(totals)])),
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

// JSON report for `aggregateByMonth` results.
export function renderMonthlyJson(result: MonthlyResult, { since, region }: { since: Date | null; region?: string }) {
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
