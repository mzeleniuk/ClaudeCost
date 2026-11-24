import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { fmtNum, fmtTokens } from "../report/format.ts";
import type { DashboardData, DashboardFacts, DashboardSessions } from "../types.ts";

// Write the page, creating its folder first.
export function writeDashboardFile(file: string, html: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
}

/**
 * A file:// link to an absolute path, with spaces and other characters
 * percent-encoded so terminals can make it clickable.
 */
export function fileLink(file: string, { windows = process.platform === "win32" }: { windows?: boolean } = {}) {
  return pathToFileURL(file, { windows }).href;
}

function shortDay(day: string, withYear = false) {
  const [year, month, date] = day.split("-").map(Number);

  return new Date(year, month - 1, date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear && { year: "numeric" }),
  });
}

// One line of totals, like "$1,883.72 across 272 sessions, Jul 17 to Nov 11".
export function summarizeDashboard({
  days,
  facts,
  sessions,
}: {
  days: string[];
  facts: Pick<DashboardFacts, "cost" | "day">;
  sessions: Pick<DashboardSessions, "profile">;
}) {
  const total = facts.cost.reduce((sum, cost) => sum + cost, 0);
  const money = total.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const count = sessions.profile.length;
  const noun = count === 1 ? "session" : "sessions";
  const text = `$${money} across ${count.toLocaleString("en-US")} ${noun}`;

  if (days.length === 0) return text;

  // `days` runs to today, so the span ends at the last day with usage.
  const first = days[0];
  const last = days[facts.day.reduce((a, b) => Math.max(a, b), 0)];
  const withYear = first.slice(0, 4) !== last.slice(0, 4);

  if (first === last) return `${text}, ${shortDay(first, true)}`;
  return `${text}, ${shortDay(first, withYear)} to ${shortDay(last, withYear)}`;
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/**
 * One line of token totals, like "285k input, 10M output, 956.4M cache read,
 * 98M cache write, 13,667 messages". Null when there is no usage.
 */
export function summarizeTokens({ facts }: Pick<DashboardData, "facts">): string | null {
  const messages = sum(facts.messages);
  if (messages === 0) return null;

  return [
    `${fmtTokens(sum(facts.input))} input`,
    `${fmtTokens(sum(facts.output))} output`,
    `${fmtTokens(sum(facts.cacheRead))} cache read`,
    `${fmtTokens(sum(facts.cacheWrite))} cache write`,
    `${fmtNum(messages)} ${messages === 1 ? "message" : "messages"}`,
  ].join(", ");
}
