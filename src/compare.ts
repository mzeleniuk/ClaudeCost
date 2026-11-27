import { startOfMonth } from "./since.ts";
import { sumTotals } from "./totals.ts";
import type { AggregateResult, Period, PeriodUsage, Totals } from "./types.ts";

/**
 * Parse a --compare value. `previous` is the only comparison. `label` names
 * the flag in the error.
 */
export function parseCompare(text: string, label: string): "previous" {
  if (text.trim().toLowerCase() === "previous") return "previous";
  throw new Error(`invalid ${label} value: "${text}". Use previous.`);
}

/**
 * The period to set the report's period against. The report covers `since` to
 * `now`.
 *
 * The current month so far is set against the same stretch of the previous
 * month, from its first day to the same day and time. A shorter previous month
 * ends where the current one begins. Comparing with the whole previous month
 * would make every month look like it dropped until its last day.
 *
 * Any other period is set against the stretch of equal length right before it.
 */
export function previousPeriod(since: Date, now: Date): Period {
  const month = startOfMonth(now);

  if (since.getTime() === month.getTime()) {
    const start = new Date(month.getFullYear(), month.getMonth() - 1, 1);

    // A day the previous month lacks rolls over into the current month.
    const sameTime = new Date(
      start.getFullYear(),
      start.getMonth(),
      now.getDate(),
      now.getHours(),
      now.getMinutes(),
      now.getSeconds(),
      now.getMilliseconds(),
    );

    return { since: start, until: sameTime < month ? sameTime : month };
  }

  const length = now.getTime() - since.getTime();

  if (length <= 0) {
    throw new Error("--compare needs a period that has started, but --since is not in the past.");
  }

  return { since: new Date(since.getTime() - length), until: since };
}

// The totals of every scan added up, and each model's totals added up across scans.
export function periodUsage(period: Period, scans: Pick<AggregateResult, "groups" | "total">[]): PeriodUsage {
  const byModel = new Map<string, Totals[]>();

  for (const { groups } of scans) {
    for (const [model, totals] of groups) {
      byModel.set(model, [...(byModel.get(model) ?? []), totals]);
    }
  }

  return {
    ...period,
    total: sumTotals(scans.map((scan) => scan.total)),
    groups: new Map([...byModel].map(([model, list]) => [model, sumTotals(list)])),
  };
}
