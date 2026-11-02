const round = (b) => ({ ...b, costUSD: Number(b.costUSD.toFixed(6)) });

// Totals for one scan, without the report envelope.
export function buildUsageProfile(
  { groups, total, unknownModels },
  { byModel },
) {
  return {
    total: round(total),
    unknownModels,
    ...(byModel && {
      byModel: Object.fromEntries(
        [...groups].map(([model, b]) => [model, round(b)]),
      ),
    }),
  };
}

export function renderJson(result, { byModel, since }) {
  const profile = buildUsageProfile(result, { byModel });
  const output = {
    generatedAt: new Date().toISOString(),
    since: since ? since.toISOString() : null,
    groupedBy: byModel ? "model" : "none",
    total: profile.total,
    unknownModels: profile.unknownModels,
    ...(byModel && { byModel: profile.byModel }),
  };

  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}
