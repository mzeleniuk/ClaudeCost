import { sortedMonthKeys } from "../aggregateByMonth.js";
import { formatLocalDateTime } from "../since.js";
import { fmtUSD, RECONCILE_NOTE } from "./table.js";

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
  { months, total, unknownModels, skippedUndated },
  { since, title, showNote = true },
) {
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

  lines.push(
    `\nGrand total: ${fmtUSD(total.costUSD)}  (${total.messages} messages)`,
  );

  if (skippedUndated > 0) {
    lines.push(
      `Skipped ${skippedUndated} message(s) without a timestamp (not included in monthly breakdown).`,
    );
  }

  if (unknownModels.length) {
    lines.push("");
    lines.push(
      "⚠ Unknown models (priced at $0 — add them to pricing.config.json):",
    );

    for (const m of unknownModels) lines.push(`   - ${m}`);
  }

  if (showNote) {
    lines.push("");
    lines.push(RECONCILE_NOTE);
  }

  console.log(lines.join("\n"));
}
