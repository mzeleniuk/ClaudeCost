import { sortedMonths } from "../aggregate.ts";
import { budgetJson } from "./budget.ts";
import { formatJson, roundCost } from "./format.ts";
import { skippedLines } from "./skipped.ts";
import type { BudgetReport, MonthlyResult, Totals } from "../types.ts";

// Monthly totals for one scan, without the report envelope.
export function buildMonthlyProfile({
  archivedTranscripts,
  months,
  notInRegion,
  parse,
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
    skippedLines: skippedLines(parse),
    skippedUndated,
    total: roundCost(total),
    unknownModels,
  };
}

// JSON report for `aggregateByMonth` results.
export function renderMonthlyJson(
  result: MonthlyResult,
  { budget, since, region }: { budget?: BudgetReport | null; since: Date | null; region?: string },
) {
  const profile = buildMonthlyProfile(result);

  return formatJson({
    ...(budget && { budget: budgetJson(budget) }),
    archivedTranscripts: profile.archivedTranscripts,
    byMonth: profile.byMonth,
    generatedAt: new Date().toISOString(),
    groupedBy: "month-model",
    notInRegion: profile.notInRegion,
    region,
    since: since ? since.toISOString() : null,
    skippedLines: profile.skippedLines,
    skippedUndated: profile.skippedUndated,
    total: profile.total,
    unknownModels: profile.unknownModels,
  });
}
