import { sortedMonthKeys } from "../aggregateByMonth.js";
import { formatLocalDateTime } from "../since.js";
import { fmtUSD, RECONCILE_NOTE, regionLines, warningLines } from "./table.js";

const fmtNum = (n) => n.toLocaleString("en-US");

function modelRows(models) {
  const rows = {};

  for (const [model, b] of models) {
    rows[model] = {
      cacheRead: fmtNum(b.cacheReadTokens),
      cacheWrite: fmtNum(b.cacheWriteTokens),
      cost: fmtUSD(b.costUSD),
      input: fmtNum(b.inputTokens),
      msgs: b.messages,
      output: fmtNum(b.outputTokens),
    };
  }

  return rows;
}

export function renderMonthlyTable(
  result,
  { since, title, region, pricingFile, showNote = true },
) {
  const { months, total, skippedUndated } = result;
  const lines = [];

  if (title) console.log(`\n======== ${title} ========`);

  for (const key of sortedMonthKeys(months)) {
    const month = months.get(key);

    console.log(`\n=== ${key} (local) ===`);
    console.table(modelRows(month.models));
    console.log(
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

  if (showNote) {
    lines.push("");
    lines.push(RECONCILE_NOTE);
  }

  console.log(lines.join("\n"));
}
