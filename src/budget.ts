import { monthKey, startOfMonth } from "./since.ts";
import type { BudgetReport } from "./types.ts";

const DAY_MS = 86_400_000;

/**
 * Parse a --budget value: digits with an optional decimal part, above zero.
 * `label` names the flag in the error.
 */
export function parseBudget(text: string, label: string): number {
  const amount = /^\d+(?:\.\d+)?$/.test(text.trim()) ? Number(text) : NaN;

  if (amount > 0 && Number.isFinite(amount)) return amount;
  throw new Error(`invalid ${label} value: "${text}". Use a dollar amount above zero, e.g. 50 or 12.5.`);
}

/**
 * Spend for the whole current month at the pace so far. It is null during
 * the first day, because a few hours of use say nothing about the month.
 * The month runs from local midnight on the 1st to local midnight on the next
 * 1st, measured in elapsed time, so a clock change moves it by an hour.
 */
export function projectMonth(spentUSD: number, now: Date): number | null {
  const start = startOfMonth(now);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  const elapsed = now.getTime() - start.getTime();

  if (elapsed < DAY_MS) return null;
  return (spentUSD * (end.getTime() - start.getTime())) / elapsed;
}

// The month's spend as --budget and --forecast report it. `now` is the end of the month so far.
export function buildBudget({
  spentUSD,
  limitUSD,
  forecast,
  now,
}: {
  spentUSD: number;
  limitUSD: number | null;
  forecast: boolean;
  now: Date;
}): BudgetReport {
  return {
    // A valid `now` always has a month key.
    month: monthKey(now) as string,
    spentUSD,
    limitUSD,
    forecast: forecast ? { projectedUSD: projectMonth(spentUSD, now) } : null,
  };
}
