import { buildMonthlyProfile } from "./monthlyJson.js";
import { renderMonthlyTable } from "./monthlyTable.js";
import { buildUsageProfile } from "./json.js";
import { sumTotals } from "../totals.js";
import { fmtUSD, roundCost } from "./format.js";
import { RECONCILE_NOTE, renderTable } from "./table.js";

const profilesTotal = (reports) => {
  return roundCost(sumTotals(reports.map((report) => report.result.total)));
};

function buildProfilesUsage(reports, { byModel, since }) {
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

function buildProfilesMonthly(reports, since) {
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
    skippedUndated: reports.reduce(
      (sum, report) => sum + report.result.skippedUndated,
      0,
    ),
    total: profilesTotal(reports),
  };
}

/**
 * Print one section per profile, then a total across all of them.
 * The reconciliation note is printed once, after the grand total.
 */
export function renderProfileReports(
  reports,
  { byModel, byMonth, since, json },
) {
  if (json) {
    const output = byMonth
      ? buildProfilesMonthly(reports, since)
      : buildProfilesUsage(reports, { byModel, since });

    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
    return;
  }

  for (const { profile, region, pricingFile, result } of reports) {
    const title = `${profile.name} (${profile.configuredDir})`;
    const opts = { since, title, region, pricingFile, showNote: false };

    if (byMonth) {
      renderMonthlyTable(result, opts);
    } else {
      renderTable(result, { ...opts, byModel });
    }
  }

  const total = profilesTotal(reports);

  console.log("");
  console.log(
    `All profiles: ${fmtUSD(total.costUSD)}  (${total.messages} messages)`,
  );
  console.log("");
  console.log(RECONCILE_NOTE);
}
