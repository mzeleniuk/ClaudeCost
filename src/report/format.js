// @ts-check
import { styleText } from "node:util";

/** @import { Totals } from "../types.js" */

// styleText drops the escape codes when stdout is not a color terminal,
// and honors NO_COLOR and FORCE_COLOR.
/** @param {string} text */
export const dim = (text) => styleText("dim", text);

/** @param {string} text */
export const bold = (text) => styleText("bold", text);

/** @param {string} text */
export const warn = (text) => styleText("yellow", text);

/** @param {string} text */
const accent = (text) => styleText("magenta", text);

/** @param {number} n */
export const fmtUSD = (n) =>
  n > 0 && n < 0.005 ? "<$0.01" : `$${n.toFixed(2)}`;

/** @param {number} n */
export const fmtNum = (n) => n.toLocaleString("en-US");

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/**
 * Token count as 950, 2.5k, 88.1M.
 *
 * @param {number} n
 */
export const fmtTokens = (n) => compact.format(n).replace("K", "k");

/**
 * Copy of a totals object with cost rounded for JSON output.
 *
 * @param {Totals} totals
 * @returns {Totals}
 */
export const roundCost = (totals) => ({
  ...totals,
  costUSD: Number(totals.costUSD.toFixed(6)),
});

/**
 * @typedef {object} Column
 * @property {string} header
 * @property {(totals: Totals) => string} value
 */

/** @type {Column[]} */
export const USAGE_COLUMNS = [
  { header: "input", value: (t) => fmtTokens(t.inputTokens) },
  { header: "output", value: (t) => fmtTokens(t.outputTokens) },
  { header: "cache read", value: (t) => fmtTokens(t.cacheReadTokens) },
  { header: "cache write", value: (t) => fmtTokens(t.cacheWriteTokens) },
  { header: "msgs", value: (t) => fmtNum(t.messages) },
  { header: "cost", value: (t) => fmtUSD(t.costUSD) },
];

/** @type {Column[]} */
export const COST_COLUMNS = USAGE_COLUMNS.slice(-2);

/**
 * One table in a grid. `title` replaces the dim label header, e.g. with a
 * month name. Rows get a cost-share bar when there is more than one, and
 * `total` is printed under a rule.
 *
 * @typedef {object} GridBlock
 * @property {string} [title]
 * @property {[string, Totals][]} rows
 * @property {Totals} [total]
 */

// Eighth blocks give a bar of BAR_WIDTH cells 8 * BAR_WIDTH steps.
const BAR_WIDTH = 8;
const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];

/** @param {number} share Between 0 and 1. */
function shareBar(share) {
  if (!(share > 0)) return "";

  const steps = Math.max(1, Math.round(share * BAR_WIDTH * 8));
  return accent("█".repeat(Math.floor(steps / 8)) + EIGHTHS[steps % 8]);
}

/** @param {[string, Totals][]} rows */
export const byCostDesc = (rows) => {
  return [...rows].sort(([, a], [, b]) => b.costUSD - a.costUSD);
};

/**
 * Borderless, right-aligned tables. Every block shares one set of column
 * widths so the blocks line up when printed one after another.
 *
 * @param {GridBlock[]} blocks
 * @param {{ label?: string, columns?: Column[] }} [opts]
 * @returns {string[][]} Lines for each block, without indentation.
 */
export function renderGrid(
  blocks,
  { label = "model", columns = USAGE_COLUMNS } = {},
) {
  /** @type {[string, Totals][]} */
  const all = blocks.flatMap((b) =>
    b.total ? [...b.rows, ["total", b.total]] : b.rows,
  );

  const labelWidth = Math.max(
    label.length,
    ...blocks.map((b) => b.title?.length ?? 0),
    ...all.map(([name]) => name.length),
  );

  const widths = columns.map((col) =>
    Math.max(col.header.length, ...all.map(([, t]) => col.value(t).length)),
  );

  const ruleWidth = labelWidth + widths.reduce((sum, w) => sum + w + 2, 1);

  /**
   * @param {string} name
   * @param {string[]} cells
   */
  const line = (name, cells) =>
    [
      name.padEnd(labelWidth + 1),
      ...cells.map((c, i) => c.padStart(widths[i])),
    ].join("  ");

  return blocks.map(({ title, rows, total }) => {
    const header = line(
      title ?? label,
      columns.map((c) => c.header),
    );

    const lines = [
      title
        ? bold(title.padEnd(labelWidth + 1)) + dim(header.slice(labelWidth + 1))
        : dim(header),
    ];

    const blockCost = total?.costUSD ?? 0;

    for (const [name, totals] of rows) {
      const row = line(
        name,
        columns.map((c) => c.value(totals)),
      );

      const bar =
        rows.length > 1 && blockCost > 0
          ? shareBar(totals.costUSD / blockCost)
          : "";

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

/**
 * Pretty-printed JSON for a report.
 *
 * @param {unknown} value
 */
export const formatJson = (value) => JSON.stringify(value, null, 2);
