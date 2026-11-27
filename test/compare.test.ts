import { test } from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";

import { parseCompare, periodUsage, previousPeriod } from "../src/compare.ts";
import { emptyParseStats } from "../src/parse.ts";
import { compareJson, compareLines } from "../src/report/compare.ts";
import { renderJson } from "../src/report/json.ts";
import { renderProfileReports } from "../src/report/profiles.ts";
import { emptyTotals } from "../src/totals.ts";

import type { AggregateResult, CompareReport, Profile, Totals } from "../src/types.ts";

const plain = (lines: string[]) => stripVTControlCharacters(lines.join("\n"));

const totals = (costUSD: number, messages: number = 1): Totals => ({ ...emptyTotals(), costUSD, messages });

const local = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0) =>
  new Date(year, month, day, hour, minute, second, ms);

test("parseCompare accepts previous and rejects anything else", () => {
  assert.equal(parseCompare("previous", "--compare"), "previous");
  assert.equal(parseCompare(" Previous ", "--compare"), "previous");

  for (const value of ["", "last", "year", "prev"]) {
    assert.throws(() => parseCompare(value, "--compare"), /invalid --compare value: ".*"\. Use previous\./, value);
  }
});

test("a rolling period is set against the period of equal length right before it", () => {
  const now = new Date("2026-11-26T12:00:00Z");
  const since = new Date("2026-11-19T12:00:00Z");
  const { since: start, until } = previousPeriod(since, now);

  assert.equal(start.toISOString(), "2026-11-12T12:00:00.000Z");
  assert.equal(until.toISOString(), "2026-11-19T12:00:00.000Z");
});

test("the month so far is set against the same stretch of the previous month", () => {
  const { since, until } = previousPeriod(local(2026, 10, 1), local(2026, 10, 26, 17, 30, 15, 250));

  assert.deepEqual(since, local(2026, 9, 1));
  assert.deepEqual(until, local(2026, 9, 26, 17, 30, 15, 250));
});

test("a previous month with fewer days ends where the current month begins", () => {
  // February 2026 has 28 days.
  for (const day of [29, 30, 31]) {
    const { since, until } = previousPeriod(local(2026, 2, 1), local(2026, 2, day, 12));

    assert.deepEqual(since, local(2026, 1, 1), String(day));
    assert.deepEqual(until, local(2026, 2, 1), String(day));
  }

  // The last day February has still ends on that day.
  assert.deepEqual(previousPeriod(local(2026, 2, 1), local(2026, 2, 28, 12)).until, local(2026, 1, 28, 12));
});

test("January is set against December of the year before", () => {
  const { since, until } = previousPeriod(local(2026, 0, 1), local(2026, 0, 10, 8));

  assert.deepEqual(since, local(2025, 11, 1));
  assert.deepEqual(until, local(2025, 11, 10, 8));
});

test("a since on the first of an earlier month is a rolling period", () => {
  const now = local(2026, 10, 26, 12);
  const since = local(2026, 8, 1);
  const { since: start, until } = previousPeriod(since, now);

  assert.deepEqual(until, since);
  assert.equal(since.getTime() - start.getTime(), now.getTime() - since.getTime());
});

test("a since that is not in the past has no previous period", () => {
  const now = new Date("2026-11-26T12:00:00Z");

  for (const since of [now, new Date("2026-11-27T12:00:00Z")]) {
    assert.throws(() => previousPeriod(since, now), /--compare needs a period that has started/);
  }
});

test("periodUsage adds up scans and merges the same model across them", () => {
  const period = { since: local(2026, 10, 1), until: local(2026, 10, 2) };

  const usage = periodUsage(period, [
    {
      total: totals(3, 2),
      groups: new Map([
        ["claude-a", totals(1)],
        ["claude-b", totals(2)],
      ]),
    },
    { total: totals(5), groups: new Map([["claude-a", totals(5)]]) },
  ]);

  assert.deepEqual(usage.since, period.since);
  assert.deepEqual(usage.until, period.until);
  assert.equal(usage.total.costUSD, 8);
  assert.equal(usage.total.messages, 3);
  assert.deepEqual([...usage.groups.keys()], ["claude-a", "claude-b"]);
  assert.equal(usage.groups.get("claude-a")?.costUSD, 6);
  assert.equal(usage.groups.get("claude-a")?.messages, 2);
});

const report = (
  current: [number, number],
  previous: [number, number],
  { byModel = false, groups = {} }: { byModel?: boolean; groups?: Record<string, [number, number]> } = {},
): CompareReport => ({
  byModel,
  current: {
    since: local(2026, 10, 19, 10),
    until: local(2026, 10, 26, 10),
    total: totals(current[0], current[1]),
    groups: new Map(Object.entries(groups).map(([model, [cost]]) => [model, totals(cost)])),
  },
  previous: {
    since: local(2026, 10, 12, 10),
    until: local(2026, 10, 19, 10),
    total: totals(previous[0], previous[1]),
    groups: new Map(Object.entries(groups).map(([model, [, cost]]) => [model, totals(cost)])),
  },
});

test("the text block names both periods and the change in cost", () => {
  const text = plain(compareLines(report([52.07, 10], [40.1, 8])));

  assert.match(text, /^⏺ Compared with the previous period$/m);
  assert.match(text, /^ {2}⎿ {2}This period {2}2026-11-19 10:00:00 to 2026-11-26 10:00:00 local$/m);
  assert.match(text, /^ {5}Previous {5}2026-11-12 10:00:00 to 2026-11-19 10:00:00 local$/m);
  assert.match(text, /^ {5}all models +\$52\.07 +\$40\.10 +\+\$11\.97 \(\+30%\)$/m);
});

test("the text block shows a drop with a minus sign", () => {
  assert.match(plain(compareLines(report([5, 1], [7, 1]))), /\$5\.00 +\$7\.00 +-\$2\.00 \(-29%\)$/m);
});

test("the text block leaves out the percent when the previous period cost nothing", () => {
  const text = plain(compareLines(report([5, 1], [0, 0])));

  assert.match(text, /\$5\.00 +\$0\.00 +\+\$5\.00$/m);
  assert.ok(!text.includes("%"));
});

test("the text block says no change when both periods cost the same", () => {
  assert.match(plain(compareLines(report([5, 1], [5.001, 1]))), /\$5\.00 +\$5\.00 +no change$/m);
});

test("the text block says when neither period has activity", () => {
  const text = plain(compareLines(report([0, 0], [0, 0])));

  assert.match(text, /^ {5}No activity in either period\.$/m);
  assert.ok(!text.includes("all models"));
});

test("the text block lists each model with a total, a model in one period included", () => {
  const text = plain(
    compareLines(
      report([5, 2], [7, 2], {
        byModel: true,
        groups: { "claude-a": [3, 2], "claude-b": [2, 0], "claude-c": [0, 5] },
      }),
    ),
  );

  const rows = text.split("\n").filter((line) => /claude-|total/.test(line));

  assert.equal(rows.length, 4);
  assert.match(rows[0], /^ {5}claude-a +\$3\.00 +\$2\.00 +\+\$1\.00 \(\+50%\)$/);
  assert.match(rows[1], /^ {5}claude-b +\$2\.00 +\$0\.00 +\+\$2\.00$/);
  assert.match(rows[2], /^ {5}claude-c +\$0\.00 +\$5\.00 +-\$5\.00 \(-100%\)$/);
  assert.match(rows[3], /^ {5}total +\$5\.00 +\$7\.00 +-\$2\.00 \(-29%\)$/);
  assert.match(text, /^ {5}─+$/m);
});

test("the JSON block carries both periods, the change and the per-model change", () => {
  const json = compareJson(
    report([5, 2], [7, 2], { byModel: true, groups: { "claude-a": [3, 2], "claude-c": [0, 5] } }),
  );

  assert.equal(json.against, "previous");
  assert.equal(json.current.since, local(2026, 10, 19, 10).toISOString());
  assert.equal(json.previous.until, local(2026, 10, 19, 10).toISOString());
  assert.equal(json.current.total.costUSD, 5);
  assert.equal(json.previous.total.costUSD, 7);
  assert.equal(json.changeUSD, -2);
  assert.equal(json.changePercent, -28.6);

  assert.deepEqual(json.byModel, {
    "claude-a": { currentUSD: 3, previousUSD: 2, changeUSD: 1, changePercent: 50 },
    "claude-c": { currentUSD: 0, previousUSD: 5, changeUSD: -5, changePercent: -100 },
  });
});

test("the JSON percent is null without previous cost, and byModel needs --by-model", () => {
  const json = compareJson(report([5, 1], [0, 0]));

  assert.equal(json.changeUSD, 5);
  assert.equal(json.changePercent, null);
  assert.equal("byModel" in json, false);
});

const result = (total: Totals): AggregateResult => ({
  groups: new Map(),
  notInRegion: [],
  total,
  unknownModels: [],
  archivedTranscripts: 0,
  parse: emptyParseStats(),
});

test("renderJson adds a compare key only when there is a comparison", () => {
  const options = { byModel: false, since: null };

  assert.equal("compare" in JSON.parse(renderJson(result(totals(1)), options)), false);
  assert.equal("compare" in JSON.parse(renderJson(result(totals(1)), { ...options, compare: null })), false);

  const compare = JSON.parse(renderJson(result(totals(1)), { ...options, compare: report([5, 1], [4, 1]) })).compare;
  assert.equal(compare.changeUSD, 1);
});

test("a profile report adds the comparison across profiles to its JSON", () => {
  const profile = (name: string): Profile => ({
    name,
    dir: `/home/${name}`,
    configuredDir: `~/${name}`,
    projectsDir: `/home/${name}/projects`,
    pricing: null,
    region: null,
  });

  const reports = [
    { profile: profile("one"), region: "global", pricingFile: "pricing.config.json", result: result(totals(2)) },
    { profile: profile("two"), region: "global", pricingFile: "pricing.config.json", result: result(totals(3)) },
  ];

  const input = { byMonth: false, byModel: false, reports } as const;
  const options = { since: null, json: true };

  const without = JSON.parse(renderProfileReports(input, options));
  const withCompare = JSON.parse(renderProfileReports(input, { ...options, compare: report([5, 2], [4, 2]) }));

  assert.equal("compare" in without, false);
  assert.equal(withCompare.compare.current.total.costUSD, 5);
  assert.equal(withCompare.compare.changeUSD, 1);
  assert.equal(withCompare.total.costUSD, 5);
});
