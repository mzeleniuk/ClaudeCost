import { DEFAULT_REGION, describeRegion } from "../regions.js";
import { formatLocalDateTime } from "../since.js";

export const fmtUSD = (n) => `$${n.toFixed(4)}`;
const fmtNum = (n) => n.toLocaleString("en-US");

export const RECONCILE_NOTE =
  "Note: approximate. Reconcile with your GCP Billing export.";

/** "Region: ..." line, or nothing for the default global endpoint. */
export function regionLines(region) {
  if (!region || region === DEFAULT_REGION) return [];
  return [`Region: ${describeRegion(region)}`];
}

/**
 * Warnings printed under a report's total.
 * `pricingFile` names the pricing file the report used.
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

export function renderTable(
  result,
  { byModel, since, title, region, pricingFile, showNote = true },
) {
  const { groups, total } = result;
  const lines = [];

  if (title) console.log(`\n======== ${title} ========`);

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
  lines.push(...regionLines(region));

  lines.push(
    `Total estimated cost: ${fmtUSD(total.costUSD)}  (${total.messages} messages)`,
  );

  lines.push(...warningLines(result, { region, pricingFile }));

  if (showNote) {
    lines.push("");
    lines.push(RECONCILE_NOTE);
  }

  console.log(lines.join("\n"));
}
