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

test("parses ISO date", () => {
  const d = parseSince("2025-01-01", NOW);
  assert.equal(d.getUTCFullYear(), 2025);
});

test("throws on garbage", () => {
  assert.throws(() => parseSince("banana", NOW), /invalid --since/);
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
