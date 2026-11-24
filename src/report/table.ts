import { DEFAULT_REGION, describeRegion } from "../regions.ts";
import { formatLocalDateTime } from "../since.ts";
import { bold, byCostDesc, dim, renderGrid, warn } from "./format.ts";
import type { AggregateResult, PricingSummary, ReportOptions } from "../types.ts";

export const RECONCILE_NOTE = "Approximate. Reconcile with your GCP Billing export.";

// Section bodies sit under the "  ⎿  " branch.
export const INDENT = "     ";

// Report heading in the style of a Claude Code tool call.
export function headingLines(title: string = "Claude Code usage", subtitle?: string): string[] {
  return ["", `⏺ ${bold(title)}${subtitle ? ` ${dim(subtitle)}` : ""}`];
}

/**
 * What the report covers: the time range, plus the region when it is not
 * the default global endpoint.
 */
export function scopeLine(since: Date | null, region?: string) {
  const parts = [since ? `Since ${formatLocalDateTime(since)} local` : "All history"];

  if (region && region !== DEFAULT_REGION) {
    parts.push(`region ${describeRegion(region)}`);
  }

  return `  ⎿  ${dim(parts.join(", "))}`;
}

/**
 * Warnings printed under a report's table.
 * `pricingFile` names the pricing file the report used.
 */
export function warningLines(
  { unknownModels, notInRegion = [] }: Pick<PricingSummary, "unknownModels"> & { notInRegion?: string[] },
  { region, pricingFile = "pricing.config.json" }: { region?: string; pricingFile?: string } = {},
): string[] {
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

// A note when usage from deleted transcripts is in the totals.
export function archiveLines({ archivedTranscripts }: Pick<PricingSummary, "archivedTranscripts">): string[] {
  if (!archivedTranscripts) return [];
  return [`${INDENT}${dim(`Includes ${archivedTranscripts} deleted transcript(s) kept in the usage store.`)}`];
}

export const EMPTY_LINE = `${INDENT}${dim("No activity in this period.")}`;

export const noteLines = (text: string = RECONCILE_NOTE) => ["", `  ${dim(text)}`];

// Text report for `aggregate` results.
export function renderTable(
  result: AggregateResult,
  { byModel, since, title, subtitle, region, pricingFile, showNote = true }: ReportOptions & { byModel: boolean },
) {
  const { groups, total } = result;
  const [grid] = renderGrid([byModel ? { rows: byCostDesc([...groups]), total } : { rows: [["all models", total]] }]);

  const lines = [
    ...headingLines(title, subtitle),
    scopeLine(since, region),
    "",
    ...(total.messages ? grid.map((line) => INDENT + line) : [EMPTY_LINE]),
    ...archiveLines(result),
    ...warningLines(result, { region, pricingFile }),
  ];

  if (showNote) lines.push(...noteLines());
  return lines.join("\n");
}
