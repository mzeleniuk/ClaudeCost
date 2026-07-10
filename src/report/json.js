export function renderJson(
  { groups, total, unknownModels },
  { byModel, since },
) {
  const round = (b) => ({ ...b, costUSD: Number(b.costUSD.toFixed(6)) });

  const output = {
    generatedAt: new Date().toISOString(),
    since: since ? since.toISOString() : null,
    groupedBy: byModel ? "model" : "none",
    total: round(total),
    unknownModels,
    ...(byModel && {
      byModel: Object.fromEntries(
        [...groups].map(([model, b]) => [model, round(b)]),
      ),
    }),
  };

  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}
