// @ts-check
import { sortedMonths } from "../aggregate.js";
import { bold, byCostDesc, dim, fmtNum, fmtUSD, renderGrid } from "./format.js";
import {
  EMPTY_LINE,
  INDENT,
  headingLines,
  noteLines,
  scopeLine,
  warningLines,
} from "./table.js";

/** @import { MonthlyResult, ReportOptions } from "../types.js" */

/**
 * "2025-01" as "January 2025".
 *
 * @param {string} key
 */
function monthName(key) {
  const [year, month] = key.split("-").map(Number);

  return new Date(year, month - 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
}

/**
 * Text report for `aggregateByMonth` results: one table per month.
 *
 * @param {MonthlyResult} result
 * @param {ReportOptions} opts
 */
export function renderMonthlyTable(
  result,
  { since, title, subtitle, region, pricingFile, showNote = true },
) {
  const { months, total, skippedUndated } = result;
  const grids = renderGrid(
    sortedMonths(months).map(([key, month]) => ({
      title: monthName(key),
      rows: byCostDesc([...month.models]),
      total: month.total,
    })),
  );

  const lines = [...headingLines(title, subtitle), scopeLine(since, region)];

  if (!grids.length) lines.push("", EMPTY_LINE);

  for (const grid of grids) {
    lines.push("", ...grid.map((line) => INDENT + line));
  }

  if (grids.length)
    lines.push(
      "",
      `${INDENT}${bold(`All months  ${fmtUSD(total.costUSD)}`)}  ${dim(`${fmtNum(total.messages)} messages`)}`,
    );

  if (skippedUndated > 0) {
    lines.push(
      `${INDENT}${dim(`Skipped ${skippedUndated} message(s) without a timestamp. They are not in any total.`)}`,
    );
  }

  lines.push(...warningLines(result, { region, pricingFile }));

  if (showNote) lines.push(...noteLines());
  return lines.join("\n");
}
