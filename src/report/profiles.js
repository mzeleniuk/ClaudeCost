// @ts-check
import { sumTotals } from "../totals.js";
import { fmtUSD, formatJson, roundCost } from "./format.js";
import { buildUsageProfile } from "./json.js";
import { buildMonthlyProfile } from "./monthlyJson.js";
import { renderMonthlyTable } from "./monthlyTable.js";
import { RECONCILE_NOTE, renderTable } from "./table.js";

/**
 * @import {
 *   AggregateResult,
 *   MonthlyResult,
 *   Profile,
 *   PricingSummary,
 * } from "../types.js"
 */

/**
 * One profile's scan, ready to print.
 *
 * @template {PricingSummary} R
 * @typedef {object} ProfileReport
 * @property {Profile} profile
 * @property {string} region
 * @property {string} pricingFile
 * @property {R} result
 */

/** @param {ProfileReport<PricingSummary>[]} reports */
function profilesTotal(reports) {
  return roundCost(sumTotals(reports.map((report) => report.result.total)));
}

/**
 * @param {ProfileReport<AggregateResult>[]} reports
 * @param {{ byModel: boolean, since: Date | null }} opts
 */
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

/**
 * @param {ProfileReport<MonthlyResult>[]} reports
 * @param {Date | null} since
 */
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
 * One section per profile, then a total across all of them.
 * The reconciliation note is printed once, after the grand total.
 * With `byMonth`, every result must come from `aggregateByMonth`.
 *
 * @param {ProfileReport<AggregateResult | MonthlyResult>[]} reports
 * @param {{ byModel: boolean, byMonth: boolean, since: Date | null, json: boolean }} opts
 */
export function renderProfileReports(
  reports,
  { byModel, byMonth, since, json },
) {
  if (json) {
    return formatJson(
      byMonth
        ? buildProfilesMonthly(
            /** @type {ProfileReport<MonthlyResult>[]} */ (reports),
            since,
          )
        : buildProfilesUsage(
            /** @type {ProfileReport<AggregateResult>[]} */ (reports),
            { byModel, since },
          ),
    );
  }

  const sections = reports.map(({ profile, region, pricingFile, result }) => {
    const title = `${profile.name} (${profile.configuredDir})`;
    const opts = { since, title, region, pricingFile, showNote: false };

    return byMonth
      ? renderMonthlyTable(/** @type {MonthlyResult} */ (result), opts)
      : renderTable(/** @type {AggregateResult} */ (result), {
          ...opts,
          byModel,
        });
  });

  const total = profilesTotal(reports);

  return [
    ...sections,
    "",
    `All profiles: ${fmtUSD(total.costUSD)}  (${total.messages} messages)`,
    "",
    RECONCILE_NOTE,
  ].join("\n");
}
