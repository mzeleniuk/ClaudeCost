/**
 * Parse a --since value into a lower-bound Date (inclusive).
 * Supports:
 *   - Relative durations: "7d", "24h", "90m", "30s", "2w"
 *   - ISO dates: "2025-01-15", "2025-01-15T10:00:00Z"
 *   - "today"
 * Returns null when input is undefined (meaning: no lower bound).
 */
const UNIT_MS = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

const pad2 = (n) => String(n).padStart(2, "0");

/** Format a Date for display in the user's local timezone. */
export function formatLocalDateTime(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/** "YYYY-MM" in local timezone; returns null if date is invalid. */
export function monthKey(date) {
  if (!date || Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

/** First day of the current month at local midnight (inclusive lower bound). */
export function startOfMonth(now = new Date()) {
  const d = new Date(now);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function parseSince(input, now = new Date()) {
  if (input == null) return null;
  const value = String(input).trim().toLowerCase();

  if (value === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  const rel = value.match(/^(\d+)\s*([smhdw])$/);
  if (rel) {
    const amount = Number(rel[1]);
    const unit = rel[2];
    return new Date(now.getTime() - amount * UNIT_MS[unit]);
  }

  const abs = new Date(input); // preserve original casing for ISO parsing
  if (!Number.isNaN(abs.getTime())) return abs;

  throw new Error(
    `invalid --since value: "${input}". Use e.g. 7d, 24h, today, or 2025-01-15.`,
  );
}
