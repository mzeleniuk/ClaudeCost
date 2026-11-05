export const fmtUSD = (n) => `$${n.toFixed(4)}`;
export const fmtNum = (n) => n.toLocaleString("en-US");

// Copy of a totals object with cost rounded for JSON output
export const roundCost = (totals) => ({
  ...totals,
  costUSD: Number(totals.costUSD.toFixed(6)),
});

// console.table rows for a Map of model -> totals
export function modelRows(models) {
  const rows = {};

  for (const [model, t] of models) {
    rows[model] = {
      input: fmtNum(t.inputTokens),
      output: fmtNum(t.outputTokens),
      cacheRead: fmtNum(t.cacheReadTokens),
      cacheWrite: fmtNum(t.cacheWriteTokens),
      msgs: t.messages,
      cost: fmtUSD(t.costUSD),
    };
  }

  return rows;
}
