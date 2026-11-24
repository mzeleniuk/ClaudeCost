import { sumTotals } from "../totals.ts";
import { COST_COLUMNS, formatJson, renderGrid, roundCost } from "./format.ts";
import { buildUsageProfile } from "./json.ts";
import { buildMonthlyProfile } from "./monthlyJson.ts";
import { renderMonthlyTable } from "./monthlyTable.ts";
import { INDENT, headingLines, noteLines, renderTable } from "./table.ts";
import type { AggregateResult, MonthlyResult, Profile, PricingSummary } from "../types.ts";

// One profile's scan, ready to print.
export interface ProfileReport<R extends PricingSummary> {
  profile: Profile;
  region: string;
  pricingFile: string;
  result: R;
}

function profilesTotal(reports: ProfileReport<PricingSummary>[]) {
  return roundCost(sumTotals(reports.map((report) => report.result.total)));
}

function buildProfilesUsage(
  reports: ProfileReport<AggregateResult>[],
  { byModel, since }: { byModel: boolean; since: Date | null },
) {
  return {
    generatedAt: new Date().toISOString(),
    since: since ? since.toISOString() : null,
    groupedBy: byModel ? "model" : "none",
    profiles: reports.map(({ profile, region, result }) => ({
      name: profile.name,
      dir: profile.dir,
      region,
      ...buildUsageProfile(result, { byModel }),
    })),
    total: profilesTotal(reports),
  };
}

function buildProfilesMonthly(reports: ProfileReport<MonthlyResult>[], since: Date | null) {
  return {
    generatedAt: new Date().toISOString(),
    groupedBy: "month-model",
    since: since ? since.toISOString() : null,
    profiles: reports.map(({ profile, region, result }) => ({
      name: profile.name,
      dir: profile.dir,
      region,
      ...buildMonthlyProfile(result),
    })),
    skippedUndated: reports.reduce((sum, report) => sum + report.result.skippedUndated, 0),
    total: profilesTotal(reports),
  };
}

/**
 * Every profile's scan. Monthly scans come from `aggregateByMonth`, and the
 * rest from `aggregate`, grouped by model when `byModel` is set.
 */
export type ProfileReports =
  | { byMonth: false; byModel: boolean; reports: ProfileReport<AggregateResult>[] }
  | { byMonth: true; reports: ProfileReport<MonthlyResult>[] };

/**
 * One section per profile, then a total across all of them.
 * The reconciliation note is printed once, after the grand total.
 */
export function renderProfileReports(input: ProfileReports, { since, json }: { since: Date | null; json: boolean }) {
  const { reports } = input;

  if (json) {
    return formatJson(
      input.byMonth
        ? buildProfilesMonthly(input.reports, since)
        : buildProfilesUsage(input.reports, { byModel: input.byModel, since }),
    );
  }

  const sectionOptions = ({ profile, region, pricingFile }: ProfileReport<PricingSummary>) => ({
    since,
    title: profile.name,
    subtitle: profile.configuredDir,
    region,
    pricingFile,
    showNote: false,
  });

  const sections = input.byMonth
    ? input.reports.map((report) => renderMonthlyTable(report.result, sectionOptions(report)))
    : input.reports.map((report) => renderTable(report.result, { ...sectionOptions(report), byModel: input.byModel }));

  const [summary] = renderGrid(
    [
      {
        rows: reports.map(({ profile, result }) => [profile.name, result.total]),
        total: profilesTotal(reports),
      },
    ],
    { label: "profile", columns: COST_COLUMNS },
  );

  return [
    ...sections,
    ...headingLines("All profiles"),
    ...summary.map((line, i) => (i === 0 ? "  ⎿  " : INDENT) + line),
    ...noteLines(),
  ].join("\n");
}
