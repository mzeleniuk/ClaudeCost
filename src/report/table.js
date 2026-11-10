// @ts-check
import { DEFAULT_REGION, describeRegion } from "../regions.js";
import { formatLocalDateTime } from "../since.js";
import { fmtNum, fmtUSD, formatTable, modelRows } from "./format.js";

/** @import { AggregateResult, PricingSummary, ReportOptions } from "../types.js" */

export const RECONCILE_NOTE =
  "Note: approximate. Reconcile with your GCP Billing export.";

/**
 * "Region: ..." line, or nothing for the default global endpoint.
 *
 * @param {string} [region]
 * @returns {string[]}
 */
export function regionLines(region) {
  if (!region || region === DEFAULT_REGION) return [];
  return [`Region: ${describeRegion(region)}`];
}

/**
 * Warnings printed under a report's total.
 * `pricingFile` names the pricing file the report used.
 *
 * @param {Pick<PricingSummary, "unknownModels"> & { notInRegion?: string[] }} result
 * @param {{ region?: string, pricingFile?: string }} [opts]
 * @returns {string[]}
 */
export function warningLines(
  { unknownModels, notInRegion = [] },
  { region, pricingFile = "pricing.config.json" } = {},
) {
  const lines = [];

  if (unknownModels.length) {
    lines.push("");
    lines.push(`⚠ Unknown models (priced at $0 — add them to ${pricingFile}):`);

    for (const m of unknownModels) lines.push(`   - ${m}`);
  }

  if (notInRegion.length) {
    lines.push("");
    lines.push(
      `⚠ Not offered at the ${region} endpoint (priced at ${region} rates anyway, so check your region setting):`,
    );

    for (const m of notInRegion) lines.push(`   - ${m}`);
  }

  return lines;
}

/**
 * Section heading used when several reports are printed together.
 *
 * @param {string | undefined} title
 * @returns {string[]}
 */
export function titleLines(title) {
  return title ? [`\n======== ${title} ========`] : [];
}

/**
 * Text report for `aggregate` results.
 *
 * @param {AggregateResult} result
 * @param {ReportOptions & { byModel: boolean }} opts
 */
export function renderTable(
  result,
  { byModel, since, title, region, pricingFile, showNote = true },
) {
  const { groups, total } = result;
  const rows = byModel
    ? modelRows(groups)
    : {
        input: fmtNum(total.inputTokens),
        output: fmtNum(total.outputTokens),
        cacheRead: fmtNum(total.cacheReadTokens),
        cacheWrite: fmtNum(total.cacheWriteTokens),
        messages: total.messages,
        cost: fmtUSD(total.costUSD),
      };

  const lines = [...titleLines(title), formatTable(rows), ""];

  if (since) lines.push(`Since:  ${formatLocalDateTime(since)} (local)`);
  lines.push(...regionLines(region));

  lines.push(
    `Total estimated cost: ${fmtUSD(total.costUSD)}  (${total.messages} messages)`,
  );

  lines.push(...warningLines(result, { region, pricingFile }));

  if (showNote) lines.push("", RECONCILE_NOTE);

  return lines.join("\n");
}
