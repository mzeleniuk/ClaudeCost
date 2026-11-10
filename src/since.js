// @ts-check

/** @type {Record<string, number>} */
const UNIT_MS = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/** @param {number} n */
const pad2 = (n) => String(n).padStart(2, "0");

/**
 * Format a Date for display in the user's local timezone.
 *
 * @param {Date} date
 */
export function formatLocalDateTime(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/**
 * "YYYY-MM" in local timezone; returns null if date is invalid.
 *
 * @param {Date | null | undefined} date
 */
export function monthKey(date) {
  if (!date || Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

/**
 * First day of the current month at local midnight (inclusive lower bound).
 *
 * @param {Date} [now]
 */
export function startOfMonth(now = new Date()) {
  const d = new Date(now);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

// YYYY-MM-DD, optionally followed by a time and an offset.
const DATE_TIME =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})(?:[t ](?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2})(?:\.(?<ms>\d{1,3}))?)?(?<offset>z|[+-]\d{2}:\d{2})?)?$/;

/**
 * @param {number} year
 * @param {number} month 1-12
 */
const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

/**
 * Build a Date from DATE_TIME groups, or null if a part is out of range.
 *
 * @param {Record<string, string | undefined>} groups
 */
function dateFromParts(groups) {
  const year = Number(groups.year);
  const month = Number(groups.month);
  const day = Number(groups.day);
  const hour = Number(groups.hour ?? 0);
  const minute = Number(groups.minute ?? 0);
  const second = Number(groups.second ?? 0);
  const millis = Number((groups.ms ?? "0").padEnd(3, "0"));
  const { offset } = groups;

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  if (!offset) {
    return new Date(year, month - 1, day, hour, minute, second, millis);
  }

  let offsetMinutes = 0;

  if (offset !== "z") {
    const sign = offset[0] === "-" ? -1 : 1;
    const [offsetHours, offsetMins] = offset.slice(1).split(":").map(Number);
    if (offsetHours > 23 || offsetMins > 59) return null;
    offsetMinutes = sign * (offsetHours * 60 + offsetMins);
  }

  const utc = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  return new Date(utc - offsetMinutes * 60_000);
}

/**
 * Parse a --since value into a lower-bound Date (inclusive).
 * Supports:
 *   - Relative durations: "7d", "24h", "90m", "30s", "2w"
 *   - Dates: "2025-01-15" (local midnight)
 *   - Date and time: "2025-01-15T10:00", "2025-01-15 10:00:30" (local), or
 *     with an offset: "2025-01-15T10:00:00Z", "2025-01-15T10:00+02:00"
 *   - "today"
 *
 * @param {string | null | undefined} input
 * @param {Date} [now]
 * @returns {Date | null} null when input is missing (no lower bound).
 */
export function parseSince(input, now = new Date()) {
  if (input == null) return null;
  const value = String(input).trim().toLowerCase();

  if (value === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  const relative = value.match(/^(?<amount>\d+)\s*(?<unit>[smhdw])$/);
  if (relative?.groups) {
    const { amount, unit } = relative.groups;
    return new Date(now.getTime() - Number(amount) * UNIT_MS[unit]);
  }

  const absolute = value.match(DATE_TIME);
  const date = absolute?.groups && dateFromParts(absolute.groups);

  if (date) return date;

  throw new Error(
    `invalid --since value: "${input}". Use e.g. 7d, 24h, today, 2025-01-15, or 2025-01-15T10:00.`,
  );
}
