import { formatLocalDateTime } from "../since.ts";
import { bold, dim, fmtNum, fmtUSD, roundCost, roundUSD } from "./format.ts";
import { INDENT, headingLines } from "./table.ts";
import type { CompareReport, Period, PeriodUsage } from "../types.ts";

// The cost of one model, or of all models together, in each period.
interface Row {
  current: number;
  name: string;
  previous: number;
}

// Every model either period used, the dearest in the current period first.
function rowsOf({ current, previous, byModel }: CompareReport): Row[] {
  if (!byModel) return [{ name: "all models", current: current.total.costUSD, previous: previous.total.costUSD }];

  const names = new Set([...current.groups.keys(), ...previous.groups.keys()]);

  return [...names]
    .map((name) => ({
      name,
      current: current.groups.get(name)?.costUSD ?? 0,
      previous: previous.groups.get(name)?.costUSD ?? 0,
    }))
    .sort((a, b) => b.current - a.current || b.previous - a.previous);
}

// The change in percent, or null when the previous period has no cost to measure it against.
const percentChange = (current: number, previous: number) =>
  previous > 0 ? ((current - previous) / previous) * 100 : null;

// "+$11.97 (+30%)". The percent is left out when the previous period cost nothing.
function changeText(current: number, previous: number) {
  if (fmtUSD(current) === fmtUSD(previous)) return "no change";

  const sign = current > previous ? "+" : "-";
  const percent = percentChange(current, previous);
  const share = percent == null ? "" : ` (${sign}${fmtNum(Math.round(Math.abs(percent)))}%)`;

  return `${sign}${fmtUSD(Math.abs(current - previous))}${share}`;
}

// Right-aligned columns after the first, with the total under a rule.
function tableLines(header: string[], rows: string[][], total: string[] | null) {
  const all = total ? [header, ...rows, total] : [header, ...rows];
  const widths = header.map((_, i) => Math.max(...all.map((cells) => cells[i].length)));

  const line = (cells: string[]) =>
    cells.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join("  ");

  const lines = [dim(line(header)), ...rows.map(line)];

  if (total) lines.push(dim("─".repeat(line(header).length)), bold(line(total)));
  return lines;
}

const range = ({ since, until }: Period) => dim(`${formatLocalDateTime(since)} to ${formatLocalDateTime(until)} local`);

// The block printed under a text report: both periods and the change in cost.
export function compareLines(report: CompareReport): string[] {
  const { current, previous, byModel } = report;

  const lines = [
    ...headingLines("Compared with the previous period"),
    `  ⎿  ${"This period".padEnd(13)}${range(current)}`,
    `${INDENT}${"Previous".padEnd(13)}${range(previous)}`,
    "",
  ];

  if (!current.total.messages && !previous.total.messages) {
    return [...lines, `${INDENT}${dim("No activity in either period.")}`];
  }

  const cells = ({ name, current, previous }: Row) => [
    name,
    fmtUSD(current),
    fmtUSD(previous),
    changeText(current, previous),
  ];
  const rows = rowsOf(report);
  const total = { name: "total", current: current.total.costUSD, previous: previous.total.costUSD };

  // With one row, the total would repeat it.
  const grid = tableLines(
    ["model", "this period", "previous", "change"],
    rows.map(cells),
    byModel ? cells(total) : null,
  );

  return [...lines, ...grid.map((line) => INDENT + line)];
}

function changeJson(current: number, previous: number) {
  const percent = percentChange(current, previous);

  return {
    changeUSD: roundUSD(current - previous),
    changePercent: percent == null ? null : Number(percent.toFixed(1)),
  };
}

// The compare block of a JSON report.
export function compareJson(report: CompareReport) {
  const { current, previous, byModel } = report;

  const side = ({ since, until, total }: PeriodUsage) => ({
    since: since.toISOString(),
    until: until.toISOString(),
    total: roundCost(total),
  });

  return {
    against: "previous",
    current: side(current),
    previous: side(previous),
    ...changeJson(current.total.costUSD, previous.total.costUSD),
    ...(byModel && {
      byModel: Object.fromEntries(
        rowsOf(report).map((row) => [
          row.name,
          {
            currentUSD: roundUSD(row.current),
            previousUSD: roundUSD(row.previous),
            ...changeJson(row.current, row.previous),
          },
        ]),
      ),
    }),
  };
}
