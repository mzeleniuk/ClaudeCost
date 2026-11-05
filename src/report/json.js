import { roundCost } from "./format.js";

// Totals for one scan, without the report envelope.
export function buildUsageProfile(
  { groups, notInRegion, total, unknownModels },
  { byModel },
) {
  return {
    notInRegion,
    total: roundCost(total),
    unknownModels,
    ...(byModel && {
      byModel: Object.fromEntries(
        [...groups].map(([model, b]) => [model, roundCost(b)]),
      ),
    }),
  };
}

export function renderJson(result, { byModel, since, region }) {
  const profile = buildUsageProfile(result, { byModel });
  const output = {
    generatedAt: new Date().toISOString(),
    groupedBy: byModel ? "model" : "none",
    notInRegion: profile.notInRegion,
    region,
    since: since ? since.toISOString() : null,
    total: profile.total,
    unknownModels: profile.unknownModels,
    ...(byModel && { byModel: profile.byModel }),
  };

  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}
