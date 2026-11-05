import { sortedMonthKeys } from "../aggregateByMonth.js";

const round = (b) => ({ ...b, costUSD: Number(b.costUSD.toFixed(6)) });

// Monthly totals for one scan, without the report envelope.
export function buildMonthlyProfile({
  months,
  notInRegion,
  skippedUndated,
  total,
  unknownModels,
}) {
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

  return {
    byMonth,
    notInRegion,
    skippedUndated,
    total: round(total),
    unknownModels,
  };
}

export function renderMonthlyJson(result, { since, region }) {
  const profile = buildMonthlyProfile(result);
  const output = {
    byMonth: profile.byMonth,
    generatedAt: new Date().toISOString(),
    groupedBy: "month-model",
    notInRegion: profile.notInRegion,
    region,
    since: since ? since.toISOString() : null,
    skippedUndated: profile.skippedUndated,
    total: profile.total,
    unknownModels: profile.unknownModels,
  };

  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}
