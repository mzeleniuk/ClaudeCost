import { sortedMonthKeys } from "../aggregateByMonth.js";

const round = (b) => ({ ...b, costUSD: Number(b.costUSD.toFixed(6)) });

export function renderMonthlyJson(
  { months, total, unknownModels, skippedUndated },
  { since },
) {
  const byMonth = {};

  for (const key of sortedMonthKeys(months)) {
    const month = months.get(key);

    byMonth[key] = {
      models: Object.fromEntries(
        [...month.models].map(([model, b]) => [model, round(b)]),
      ),
      total: round(month.total),
    };
  }

  const output = {
    byMonth,
    generatedAt: new Date().toISOString(),
    groupedBy: "month-model",
    since: since ? since.toISOString() : null,
    skippedUndated,
    total: round(total),
    unknownModels,
  };

  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}
