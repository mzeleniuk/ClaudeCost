import { styleText } from "node:util";

import type { Totals } from "../types.ts";

// styleText drops the escape codes when stdout is not a color terminal,
// and honors NO_COLOR and FORCE_COLOR.

export const dim = (text: string) => styleText("dim", text);
export const bold = (text: string) => styleText("bold", text);
export const warn = (text: string) => styleText("yellow", text);
const accent = (text: string) => styleText("magenta", text);
export const fmtUSD = (n: number) => (n > 0 && n < 0.005 ? "<$0.01" : `$${n.toFixed(2)}`);
export const fmtNum = (n: number) => n.toLocaleString("en-US");

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

// Token count as 950, 2.5k, 88.1M.
export const fmtTokens = (n: number) => compact.format(n).replace("K", "k");

// Copy of a totals object with cost rounded for JSON output.
export const roundCost = (totals: Totals): Totals => ({
  ...totals,
  costUSD: Number(totals.costUSD.toFixed(6)),
});

export interface Column {
  header: string;
  value: (totals: Totals) => string;
}

const USAGE_COLUMNS: Column[] = [
  { header: "input", value: (t) => fmtTokens(t.inputTokens) },
  { header: "output", value: (t) => fmtTokens(t.outputTokens) },
  { header: "cache read", value: (t) => fmtTokens(t.cacheReadTokens) },
  { header: "cache write", value: (t) => fmtTokens(t.cacheWriteTokens) },
  { header: "msgs", value: (t) => fmtNum(t.messages) },
  { header: "cost", value: (t) => fmtUSD(t.costUSD) },
];

export const COST_COLUMNS: Column[] = USAGE_COLUMNS.slice(-2);

/**
 * One table in a grid. `title` replaces the dim label header, e.g. with a
 * month name. Rows get a cost-share bar when there is more than one, and
 * `total` is printed under a rule.
 */
interface GridBlock {
  title?: string;
  rows: [string, Totals][];
  total?: Totals;
}

// Eighth blocks give a bar of BAR_WIDTH cells 8 * BAR_WIDTH steps.
const BAR_WIDTH = 8;
const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];

function shareBar(share: number) {
  if (!(share > 0)) return "";

  const steps = Math.max(1, Math.round(share * BAR_WIDTH * 8));
  return accent("█".repeat(Math.floor(steps / 8)) + EIGHTHS[steps % 8]);
}

export const byCostDesc = (rows: [string, Totals][]) => {
  return [...rows].sort(([, a], [, b]) => b.costUSD - a.costUSD);
};

/**
 * Borderless, right-aligned tables. Every block shares one set of column
 * widths so the blocks line up when printed one after another.
 */
export function renderGrid(
  blocks: GridBlock[],
  { label = "model", columns = USAGE_COLUMNS }: { label?: string; columns?: Column[] } = {},
): string[][] {
  const all: [string, Totals][] = blocks.flatMap((b) => (b.total ? [...b.rows, ["total", b.total]] : b.rows));

  const labelWidth = Math.max(
    label.length,
    ...blocks.map((b) => b.title?.length ?? 0),
    ...all.map(([name]) => name.length),
  );

  const widths = columns.map((col) => Math.max(col.header.length, ...all.map(([, t]) => col.value(t).length)));
  const ruleWidth = labelWidth + widths.reduce((sum, w) => sum + w + 2, 1);

  const line = (name: string, cells: string[]) =>
    [name.padEnd(labelWidth + 1), ...cells.map((c, i) => c.padStart(widths[i]))].join("  ");

  return blocks.map(({ title, rows, total }) => {
    const header = line(
      title ?? label,
      columns.map((c) => c.header),
    );

    const lines = [title ? bold(title.padEnd(labelWidth + 1)) + dim(header.slice(labelWidth + 1)) : dim(header)];
    const blockCost = total?.costUSD ?? 0;

    for (const [name, totals] of rows) {
      const row = line(
        name,
        columns.map((c) => c.value(totals)),
      );

      const bar = rows.length > 1 && blockCost > 0 ? shareBar(totals.costUSD / blockCost) : "";
      lines.push(bar ? `${row}  ${bar}` : row);
    }

    if (total && rows.length) {
      lines.push(
        dim("─".repeat(ruleWidth)),
        bold(
          line(
            "total",
            columns.map((c) => c.value(total)),
          ),
        ),
      );
    }

    return lines;
  });
}

// Pretty-printed JSON for a report.
export const formatJson = (value: unknown) => JSON.stringify(value, null, 2);
