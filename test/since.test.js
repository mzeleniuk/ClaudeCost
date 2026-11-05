import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatLocalDateTime,
  monthKey,
  parseSince,
  startOfMonth,
} from "../src/since.js";

const NOW = new Date("2025-01-15T12:00:00Z");

test("returns null for undefined", () => {
  assert.equal(parseSince(undefined, NOW), null);
});

test("parses relative days", () => {
  const d = parseSince("7d", NOW);
  assert.equal(d.toISOString(), "2025-01-08T12:00:00.000Z");
});

test("parses hours", () => {
  const d = parseSince("24h", NOW);
  assert.equal(d.toISOString(), "2025-01-14T12:00:00.000Z");
});

test("formatLocalDateTime uses local timezone components", () => {
  const d = new Date(2026, 6, 1, 0, 0, 0);
  assert.equal(formatLocalDateTime(d), "2026-07-01 00:00:00");
});

test("startOfMonth returns first day at local midnight", () => {
  const d = startOfMonth(NOW);
  assert.equal(d.getDate(), 1);
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
});

test('parses "today" to local midnight', () => {
  const d = parseSince("today", NOW);
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
});

test("parses a date as local midnight", () => {
  const d = parseSince("2025-01-01", NOW);
  assert.equal(d.getTime(), new Date(2025, 0, 1).getTime());
});

test("parses a date and time without an offset as local time", () => {
  assert.equal(
    parseSince("2025-01-15T10:30", NOW).getTime(),
    new Date(2025, 0, 15, 10, 30).getTime(),
  );
  assert.equal(
    parseSince("2025-01-15 10:30:05.25", NOW).getTime(),
    new Date(2025, 0, 15, 10, 30, 5, 250).getTime(),
  );
});

test("parses a date and time with an offset as that instant", () => {
  assert.equal(
    parseSince("2025-01-15T10:00:00Z", NOW).toISOString(),
    "2025-01-15T10:00:00.000Z",
  );
  assert.equal(
    parseSince("2025-01-15T10:00+02:00", NOW).toISOString(),
    "2025-01-15T08:00:00.000Z",
  );
  assert.equal(
    parseSince("2025-01-15T10:00-05:30", NOW).toISOString(),
    "2025-01-15T15:30:00.000Z",
  );
});

test("accepts Feb 29 only in leap years", () => {
  assert.equal(
    parseSince("2024-02-29", NOW).getTime(),
    new Date(2024, 1, 29).getTime(),
  );
  assert.throws(() => parseSince("2025-02-29", NOW), /invalid --since/);
});

test("throws on garbage", () => {
  assert.throws(() => parseSince("banana", NOW), /invalid --since/);
});

test("rejects bare numbers, impossible dates and loose formats", () => {
  for (const value of [
    "1",
    "30",
    "2025-02-30",
    "2025-13-01",
    "2025-00-10",
    "2025-01-01T24:00",
    "2025-01-01T10:60",
    "2025-1-1",
    "Jan 1 2025",
    "2025-01-15T10:00+25:00",
  ]) {
    assert.throws(() => parseSince(value, NOW), /invalid --since/, value);
  }
});

test("monthKey returns YYYY-MM in local timezone", () => {
  const d = new Date(2026, 6, 1, 0, 0, 0);
  assert.equal(monthKey(d), "2026-07");
});

test("monthKey returns null for invalid dates", () => {
  assert.equal(monthKey(null), null);
  assert.equal(monthKey(undefined), null);
  assert.equal(monthKey(new Date("invalid")), null);
});
