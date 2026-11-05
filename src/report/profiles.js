import { buildMonthlyProfile } from "./monthlyJson.js";
import { renderMonthlyTable } from "./monthlyTable.js";
import { buildUsageProfile } from "./json.js";
import { fmtUSD, RECONCILE_NOTE, renderTable } from "./table.js";

function sumBuckets(buckets) {
  const keys = Object.keys(buckets[0]);
  const total = {};

  for (const key of keys) total[key] = 0;
  for (const bucket of buckets) {
    for (const key of keys) total[key] += bucket[key] ?? 0;
  }

  total.costUSD = Number(total.costUSD.toFixed(6));
  return total;
}

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
    total: sumBuckets(reports.map((report) => report.result.total)),
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
    total: sumBuckets(reports.map((report) => report.result.total)),
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

  for (const { profile, region, result } of reports) {
    const title = `${profile.name} (${profile.configuredDir})`;

    if (byMonth) {
      renderMonthlyTable(result, { since, title, region, showNote: false });
    } else {
      renderTable(result, { byModel, since, title, region, showNote: false });
    }
  }

  const total = sumBuckets(reports.map((report) => report.result.total));

  console.log("");
  console.log(
    `All profiles: ${fmtUSD(total.costUSD)}  (${total.messages} messages)`,
  );
  console.log("");
  console.log(RECONCILE_NOTE);
}
