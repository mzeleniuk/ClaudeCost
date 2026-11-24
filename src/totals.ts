import type { TokenCounts, Totals } from "./types.ts";

// Token and cost totals for a group of messages.
export function emptyTotals(): Totals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    costUSD: 0,
    messages: 0,
  };
}

// Add one message's normalized usage and cost to `totals`.
export function addUsage(totals: Totals, usage: TokenCounts, cost: number) {
  totals.inputTokens += usage.input;
  totals.outputTokens += usage.output;
  totals.cacheWriteTokens += usage.cacheWrite;
  totals.cacheReadTokens += usage.cacheRead;
  totals.costUSD += cost;
  totals.messages += 1;
}

// Sum several totals into a new one.
export function sumTotals(list: Totals[]) {
  const sum = emptyTotals();
  const keys = Object.keys(sum) as (keyof Totals)[];

  for (const totals of list) {
    for (const key of keys) sum[key] += totals[key];
  }

  return sum;
}
