import { budgetJson } from "./budget.ts";
import { compareJson } from "./compare.ts";
import { formatJson, roundCost } from "./format.ts";
import { skippedLines } from "./skipped.ts";
import type { AggregateResult, BudgetReport, CompareReport } from "../types.ts";

// Totals for one scan, without the report envelope.
export function buildUsageProfile(
  { archivedTranscripts, groups, notInRegion, parse, total, unknownModels }: AggregateResult,
  { byModel }: { byModel: boolean },
) {
  return {
    archivedTranscripts,
    notInRegion,
    skippedLines: skippedLines(parse),
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
  {
    budget,
    compare,
    byModel,
    since,
    region,
  }: {
    budget?: BudgetReport | null;
    compare?: CompareReport | null;
    byModel: boolean;
    since: Date | null;
    region?: string;
  },
) {
  const profile = buildUsageProfile(result, { byModel });

  return formatJson({
    ...(budget && { budget: budgetJson(budget) }),
    ...(compare && { compare: compareJson(compare) }),
    archivedTranscripts: profile.archivedTranscripts,
    generatedAt: new Date().toISOString(),
    groupedBy: byModel ? "model" : "none",
    notInRegion: profile.notInRegion,
    region,
    since: since ? since.toISOString() : null,
    skippedLines: profile.skippedLines,
    total: profile.total,
    unknownModels: profile.unknownModels,
    ...(byModel && { byModel: profile.byModel }),
  });
}
