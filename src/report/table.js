import { formatLocalDateTime } from "../since.js";

const fmtUSD = (n) => `$${n.toFixed(4)}`;
const fmtNum = (n) => n.toLocaleString("en-US");

export function renderTable(
  { groups, total, unknownModels },
  { byModel, since },
) {
  const lines = [];

  if (byModel) {
    const rows = {};
    for (const [model, b] of groups) {
      rows[model] = {
        input: fmtNum(b.inputTokens),
        output: fmtNum(b.outputTokens),
        cacheRead: fmtNum(b.cacheReadTokens),
        cacheWrite: fmtNum(b.cacheWriteTokens),
        msgs: b.messages,
        cost: fmtUSD(b.costUSD),
      };
    }
    console.table(rows);
  } else {
    console.table({
      input: fmtNum(total.inputTokens),
      output: fmtNum(total.outputTokens),
      cacheRead: fmtNum(total.cacheReadTokens),
      cacheWrite: fmtNum(total.cacheWriteTokens),
      messages: total.messages,
      cost: fmtUSD(total.costUSD),
    });
  }

  lines.push("");

  if (since) lines.push(`Since:  ${formatLocalDateTime(since)} (local)`);

  lines.push(
    `Total estimated cost: ${fmtUSD(total.costUSD)}  (${total.messages} messages)`,
  );

  if (unknownModels.length) {
    lines.push("");
    lines.push(
      "⚠ Unknown models (priced at $0 — add them to pricing.config.json):",
    );
    for (const m of unknownModels) lines.push(`   - ${m}`);
  }

  lines.push("");
  lines.push("Note: approximate. Reconcile with your GCP Billing export.");
  console.log(lines.join("\n"));
}
