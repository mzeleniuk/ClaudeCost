// Token and cost totals for a group of messages
export function emptyTotals() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    costUSD: 0,
    messages: 0,
  };
}

// Add one message's normalized usage and cost to `totals`
export function addUsage(totals, usage, cost) {
  totals.inputTokens += usage.input ?? 0;
  totals.outputTokens += usage.output ?? 0;
  totals.cacheWriteTokens += usage.cacheWrite ?? 0;
  totals.cacheReadTokens += usage.cacheRead ?? 0;
  totals.costUSD += cost;
  totals.messages += 1;
}

// Sum several totals into a new one
export function sumTotals(list) {
  const sum = emptyTotals();

  for (const totals of list) {
    for (const key of Object.keys(sum)) sum[key] += totals[key] ?? 0;
  }

  return sum;
}
