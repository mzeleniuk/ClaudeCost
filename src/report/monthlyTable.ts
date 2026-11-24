import { sortedMonths } from "../aggregate.ts";
import { bold, byCostDesc, dim, fmtNum, fmtUSD, renderGrid } from "./format.ts";
import { EMPTY_LINE, INDENT, archiveLines, headingLines, noteLines, scopeLine, warningLines } from "./table.ts";
import type { MonthlyResult, ReportOptions } from "../types.ts";

// "2025-01" as "January 2025".
function monthName(key: string) {
  const [year, month] = key.split("-").map(Number);

  return new Date(year, month - 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
}

// Text report for `aggregateByMonth` results: one table per month.
export function renderMonthlyTable(
  result: MonthlyResult,
  { since, title, subtitle, region, pricingFile, showNote = true }: ReportOptions,
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

  lines.push(...archiveLines(result));
  lines.push(...warningLines(result, { region, pricingFile }));

  if (showNote) lines.push(...noteLines());
  return lines.join("\n");
}
