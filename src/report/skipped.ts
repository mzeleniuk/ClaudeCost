import { addParseStats, emptyParseStats, skippedLineCount } from "../parse.ts";
import { fmtNum } from "./format.ts";
import type { ParseStats } from "../types.ts";

/**
 * One stderr line when scans left transcript lines unread, or null when they
 * read every line. With `strict` the line is an error, because the run then
 * exits with status 1. Profiles are added together.
 */
export function skippedMessage(scans: ParseStats[], { strict }: { strict: boolean }): string | null {
  const total = emptyParseStats();

  for (const scan of scans) addParseStats(total, scan);

  const skipped = skippedLineCount(total);
  if (skipped === 0) return null;

  const parts = [
    total.invalidJson && `${fmtNum(total.invalidJson)} not valid JSON`,
    total.noUsage && `${fmtNum(total.noUsage)} assistant without a usage object`,
    total.badTokenCounts && `${fmtNum(total.badTokenCounts)} without recognized token counts`,
  ].filter(Boolean);

  const level = strict ? "error" : "warning";
  const first = total.example ? ` First: ${total.example}.` : "";

  return (
    `claude-cost: ${level}: ${fmtNum(skipped)} of ${fmtNum(total.lines)} transcript lines with usage could not be read ` +
    `(${parts.join(", ")}). Totals may be too low, and Claude Code may have changed its transcript format.${first}`
  );
}

// The skipped line counts for a JSON report.
export function skippedLines({ invalidJson, noUsage, badTokenCounts }: ParseStats) {
  return { badTokenCounts, invalidJson, noUsage };
}
