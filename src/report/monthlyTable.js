// @ts-check
import { sortedMonths } from "../aggregate.js";
import { formatLocalDateTime } from "../since.js";
import { fmtUSD, formatTable, modelRows } from "./format.js";
import {
  RECONCILE_NOTE,
  regionLines,
  titleLines,
  warningLines,
} from "./table.js";

/** @import { MonthlyResult, ReportOptions } from "../types.js" */

/**
 * Text report for `aggregateByMonth` results: one table per month.
 *
 * @param {MonthlyResult} result
 * @param {ReportOptions} opts
 */
export function renderMonthlyTable(
  result,
  { since, title, region, pricingFile, showNote = true },
) {
  const { months, total, skippedUndated } = result;
  const lines = titleLines(title);

  for (const [key, month] of sortedMonths(months)) {
    lines.push(
      `\n=== ${key} (local) ===`,
      formatTable(modelRows(month.models)),
      `Month total: ${fmtUSD(month.total.costUSD)} (${month.total.messages} messages)`,
    );
  }

  if (since) lines.push(`Since: ${formatLocalDateTime(since)} (local)`);
  lines.push(...regionLines(region));

  lines.push(
    `\nGrand total: ${fmtUSD(total.costUSD)}  (${total.messages} messages)`,
  );

  if (skippedUndated > 0) {
    lines.push(
      `Skipped ${skippedUndated} message(s) without a timestamp (not included in monthly breakdown).`,
    );
  }

  lines.push(...warningLines(result, { region, pricingFile }));

  if (showNote) lines.push("", RECONCILE_NOTE);

  return lines.join("\n");
}
