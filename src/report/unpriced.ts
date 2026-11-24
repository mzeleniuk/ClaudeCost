export interface Unpriced {
  pricingFile: string;
  models: string[];
}

/**
 * One stderr line for each pricing file that lacks models the run used.
 * Profiles that share a pricing file share a line. With `strict` the line is
 * an error, because the run then exits with status 1.
 */
export function unpricedMessages(entries: Unpriced[], { strict }: { strict: boolean }): string[] {
  const byFile: Map<string, Set<string>> = new Map();

  for (const { pricingFile, models } of entries) {
    const missing = byFile.get(pricingFile) ?? new Set<string>();

    for (const model of models) missing.add(model);
    byFile.set(pricingFile, missing);
  }

  const level = strict ? "error" : "warning";

  return [...byFile]
    .filter(([, missing]) => missing.size)
    .map(
      ([pricingFile, missing]) =>
        `claude-cost: ${level}: models missing from ${pricingFile} are priced at $0: ${[...missing].join(", ")}`,
    );
}
