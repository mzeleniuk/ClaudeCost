// @ts-check
import { DEFAULT_REGION, describeRegion } from "../regions.js";
import { formatLocalDateTime } from "../since.js";
import { bold, byCostDesc, dim, renderGrid, warn } from "./format.js";

/** @import { AggregateResult, PricingSummary, ReportOptions } from "../types.js" */

export const RECONCILE_NOTE =
  "Approximate. Reconcile with your GCP Billing export.";

// Section bodies sit under the "  ⎿  " branch.
export const INDENT = "     ";

/**
 * Report heading in the style of a Claude Code tool call.
 *
 * @param {string} [title]
 * @param {string} [subtitle] Printed dim after the title.
 * @returns {string[]}
 */
export function headingLines(title = "Claude Code usage", subtitle) {
  return ["", `⏺ ${bold(title)}${subtitle ? ` ${dim(subtitle)}` : ""}`];
}

/**
 * What the report covers: the time range, plus the region when it is not
 * the default global endpoint.
 *
 * @param {Date | null} since
 * @param {string} [region]
 */
export function scopeLine(since, region) {
  const parts = [
    since ? `Since ${formatLocalDateTime(since)} local` : "All history",
  ];

  if (region && region !== DEFAULT_REGION) {
    parts.push(`region ${describeRegion(region)}`);
  }

  return `  ⎿  ${dim(parts.join(", "))}`;
}

/**
 * Warnings printed under a report's table.
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
    lines.push(
      "",
      `${INDENT}${warn("⚠")} Unknown models, priced at $0. Add them to ${pricingFile}`,
      ...unknownModels.map((m) => `${INDENT}  ${dim(m)}`),
    );
  }

  if (notInRegion.length) {
    lines.push(
      "",
      `${INDENT}${warn("⚠")} Not offered at the ${region} endpoint. Priced at ${region} rates anyway, so check your region setting`,
      ...notInRegion.map((m) => `${INDENT}  ${dim(m)}`),
    );
  }

  return lines;
}

export const EMPTY_LINE = `${INDENT}${dim("No activity in this period.")}`;

/** @param {string} text */
export const noteLines = (text = RECONCILE_NOTE) => ["", `  ${dim(text)}`];

/**
 * Text report for `aggregate` results.
 *
 * @param {AggregateResult} result
 * @param {ReportOptions & { byModel: boolean }} opts
 */
export function renderTable(
  result,
  { byModel, since, title, subtitle, region, pricingFile, showNote = true },
) {
  const { groups, total } = result;
  const [grid] = renderGrid([
    byModel
      ? { rows: byCostDesc([...groups]), total }
      : { rows: [["all models", total]] },
  ]);

  const lines = [
    ...headingLines(title, subtitle),
    scopeLine(since, region),
    "",
    ...(total.messages ? grid.map((line) => INDENT + line) : [EMPTY_LINE]),
    ...warningLines(result, { region, pricingFile }),
  ];

  if (showNote) lines.push(...noteLines());
  return lines.join("\n");
}
