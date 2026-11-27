import { fmtUSD, roundUSD, warn } from "./format.ts";
import { monthName } from "./monthlyTable.ts";
import { INDENT, headingLines } from "./table.ts";
import type { BudgetReport } from "../types.ts";

// How far `amount` is above `limit`, or "" when it is not.
function overBy(amount: number, limit: number | null) {
  return limit != null && amount > limit ? `  ${warn("⚠")} ${fmtUSD(amount - limit)} over` : "";
}

function spentText({ spentUSD, limitUSD }: BudgetReport) {
  if (limitUSD == null) return fmtUSD(spentUSD);

  const share = Math.round((spentUSD / limitUSD) * 100);
  return `${fmtUSD(spentUSD)} of ${fmtUSD(limitUSD)} budget (${share}%)${overBy(spentUSD, limitUSD)}`;
}

function forecastText({ forecast, limitUSD }: BudgetReport) {
  if (forecast?.projectedUSD == null) return "not available during the first day of the month";
  return `${fmtUSD(forecast.projectedUSD)} at the current pace${overBy(forecast.projectedUSD, limitUSD)}`;
}

// The block printed under a text report: the month's spend, the budget and the forecast.
export function budgetLines(report: BudgetReport): string[] {
  const rows = [["Spent", spentText(report)]];

  if (report.forecast) rows.push(["Forecast", forecastText(report)]);

  return [
    ...headingLines(monthName(report.month)),
    ...rows.map(([label, text], i) => `${i === 0 ? "  ⎿  " : INDENT}${label.padEnd(10)}${text}`),
  ];
}

// The budget block of a JSON report.
export function budgetJson({ month, spentUSD, limitUSD, forecast }: BudgetReport) {
  const over = (amount: number | null) => limitUSD != null && amount != null && amount > limitUSD;

  return {
    month,
    spentUSD: roundUSD(spentUSD),
    budgetUSD: limitUSD,
    overBudget: over(spentUSD),
    forecast: forecast && {
      projectedUSD: forecast.projectedUSD == null ? null : roundUSD(forecast.projectedUSD),
      overBudget: over(forecast.projectedUSD),
    },
  };
}

/**
 * One stderr line when this month's spend is above the budget. With `strict`
 * it is an error, because the run then exits with status 1.
 */
export function overBudgetMessages(budget: BudgetReport | null, { strict }: { strict: boolean }): string[] {
  if (!budget || budget.limitUSD == null || budget.spentUSD <= budget.limitUSD) return [];

  const { month, spentUSD, limitUSD } = budget;

  return [
    `claude-cost: ${strict ? "error" : "warning"}: ${monthName(month)} spend ${fmtUSD(spentUSD)} is ` +
      `${fmtUSD(spentUSD - limitUSD)} over the ${fmtUSD(limitUSD)} budget.`,
  ];
}

/**
 * One stderr warning when --forecast projects a total above a budget that
 * spend has not passed yet. It never fails a --strict run, because the budget
 * is not exceeded yet.
 */
export function paceMessages(budget: BudgetReport | null): string[] {
  if (!budget) return [];

  const { month, spentUSD, limitUSD, forecast } = budget;
  const projectedUSD = forecast?.projectedUSD;

  if (limitUSD == null || projectedUSD == null || spentUSD > limitUSD || projectedUSD <= limitUSD) return [];

  return [
    `claude-cost: warning: ${monthName(month)} is on pace for ${fmtUSD(projectedUSD)}, ` +
      `${fmtUSD(projectedUSD - limitUSD)} over the ${fmtUSD(limitUSD)} budget.`,
  ];
}
