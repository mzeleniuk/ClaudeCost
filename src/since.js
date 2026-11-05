/**
 * Parse a --since value into a lower-bound Date (inclusive).
 * Supports:
 *   - Relative durations: "7d", "24h", "90m", "30s", "2w"
 *   - Dates: "2025-01-15" (local midnight)
 *   - Date and time: "2025-01-15T10:00", "2025-01-15 10:00:30" (local), or
 *     with an offset: "2025-01-15T10:00:00Z", "2025-01-15T10:00+02:00"
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

// YYYY-MM-DD, optionally followed by a time and an offset.
const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(z|[+-]\d{2}:\d{2})?)?$/;

const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

/** Build a Date from DATE_TIME parts, or null if a part is out of range. */
function dateFromParts(match) {
  const [, y, mo, d, h = "0", mi = "0", s = "0", ms = "0", offset] = match;
  const [year, month, day, hour, minute, second] = [y, mo, d, h, mi, s].map(
    Number,
  );
  const millis = Number(ms.padEnd(3, "0"));

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  if (!offset) {
    return new Date(year, month - 1, day, hour, minute, second, millis);
  }

  let offsetMinutes = 0;

  if (offset !== "z") {
    const sign = offset[0] === "-" ? -1 : 1;
    const [oh, om] = offset.slice(1).split(":").map(Number);
    if (oh > 23 || om > 59) return null;
    offsetMinutes = sign * (oh * 60 + om);
  }

  const utc = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  return new Date(utc - offsetMinutes * 60_000);
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

  const abs = value.match(DATE_TIME);
  const date = abs && dateFromParts(abs);

  if (date) return date;

  throw new Error(
    `invalid --since value: "${input}". Use e.g. 7d, 24h, today, 2025-01-15, or 2025-01-15T10:00.`,
  );
}
