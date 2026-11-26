import { test } from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";

import { buildBudget, parseBudget, projectMonth } from "../src/budget.ts";
import { budgetJson, budgetLines, overBudgetMessages, paceMessages } from "../src/report/budget.ts";
import type { BudgetReport } from "../src/types.ts";

// February 2026 has 28 days and no clock change in any common time zone.
const feb = (day: number, hour = 0) => new Date(2026, 1, day, hour);

const report = (overrides: Partial<BudgetReport> = {}): BudgetReport => ({
  month: "2026-02",
  spentUSD: 50,
  limitUSD: 200,
  forecast: { projectedUSD: 100 },
  ...overrides,
});

const plain = (lines: string[]) => lines.map((line) => stripVTControlCharacters(line));

test("parseBudget accepts a positive dollar amount", () => {
  assert.equal(parseBudget("50", "--budget"), 50);
  assert.equal(parseBudget("12.5", "--budget"), 12.5);
  assert.equal(parseBudget(" 0.01 ", "--budget"), 0.01);
});

test("parseBudget rejects zero, signs, symbols, exponents and words", () => {
  for (const text of ["", " ", "0", "0.0", "-5", "+5", "$5", "5.", ".5", "1e3", "0x10", "Infinity", "NaN", "five"]) {
    assert.throws(
      () => parseBudget(text, "--budget"),
      /invalid --budget value: ".*"\. Use a dollar amount above zero/,
      text,
    );
  }
});

test("projectMonth scales spend by the share of the month that has passed", () => {
  // 14 of 28 days.
  assert.equal(projectMonth(50, feb(15)), 100);
  // 1 of 28 days.
  assert.equal(projectMonth(1, feb(2)), 28);
  assert.equal(projectMonth(0, feb(15)), 0);
});

test("projectMonth is close to the spend at the end of the month", () => {
  const projected = projectMonth(100, new Date(2026, 1, 28, 23, 59, 59));
  assert.ok(projected != null && projected > 100 && projected < 100.01, String(projected));
});

test("projectMonth needs a full day of the month", () => {
  assert.equal(projectMonth(50, feb(1)), null);
  assert.equal(projectMonth(50, feb(1, 23)), null);
});

test("projectMonth uses the length of the month it is in", () => {
  // 14 of 31 days in January, and 14 of 30 in June.
  assert.ok(Math.abs((projectMonth(14, new Date(2026, 0, 15)) as number) - 31) < 1e-9);
  assert.ok(Math.abs((projectMonth(14, new Date(2026, 5, 15)) as number) - 30) < 1e-9);
});

test("buildBudget keys the report by local month and forecasts only on request", () => {
  assert.deepEqual(buildBudget({ spentUSD: 50, limitUSD: 200, forecast: false, now: feb(15) }), {
    month: "2026-02",
    spentUSD: 50,
    limitUSD: 200,
    forecast: null,
  });

  assert.deepEqual(buildBudget({ spentUSD: 50, limitUSD: null, forecast: true, now: feb(15) }), {
    month: "2026-02",
    spentUSD: 50,
    limitUSD: null,
    forecast: { projectedUSD: 100 },
  });

  assert.deepEqual(buildBudget({ spentUSD: 5, limitUSD: null, forecast: true, now: feb(1, 6) }).forecast, {
    projectedUSD: null,
  });
});

test("budgetLines shows spend against the budget and the forecast", () => {
  assert.deepEqual(plain(budgetLines(report())), [
    "",
    "⏺ February 2026",
    "  ⎿  Spent     $50.00 of $200.00 budget (25%)",
    "     Forecast  $100.00 at the current pace",
  ]);
});

test("budgetLines marks spend and a forecast that pass the budget", () => {
  const lines = plain(budgetLines(report({ spentUSD: 250, limitUSD: 200, forecast: { projectedUSD: 400 } })));

  assert.equal(lines[2], "  ⎿  Spent     $250.00 of $200.00 budget (125%)  ⚠ $50.00 over");
  assert.equal(lines[3], "     Forecast  $400.00 at the current pace  ⚠ $200.00 over");
});

test("budgetLines leaves out the budget and the forecast when they were not asked for", () => {
  assert.deepEqual(plain(budgetLines(report({ limitUSD: null, forecast: null }))).slice(2), ["  ⎿  Spent     $50.00"]);

  assert.deepEqual(plain(budgetLines(report({ limitUSD: null }))).slice(2), [
    "  ⎿  Spent     $50.00",
    "     Forecast  $100.00 at the current pace",
  ]);
});

test("budgetLines says when the forecast is not available yet", () => {
  const lines = plain(budgetLines(report({ forecast: { projectedUSD: null } })));
  assert.equal(lines[3], "     Forecast  not available during the first day of the month");
});

test("budgetJson rounds costs and flags spend and forecast over the budget", () => {
  assert.deepEqual(budgetJson(report({ spentUSD: 50.1234567, forecast: { projectedUSD: 250.5 } })), {
    month: "2026-02",
    spentUSD: 50.123457,
    budgetUSD: 200,
    overBudget: false,
    forecast: { projectedUSD: 250.5, overBudget: true },
  });
});

test("budgetJson uses null for a missing budget or forecast", () => {
  assert.deepEqual(budgetJson(report({ limitUSD: null, forecast: null })), {
    month: "2026-02",
    spentUSD: 50,
    budgetUSD: null,
    overBudget: false,
    forecast: null,
  });

  assert.deepEqual(budgetJson(report({ forecast: { projectedUSD: null } })).forecast, {
    projectedUSD: null,
    overBudget: false,
  });
});

test("overBudgetMessages is empty at or under the budget, or without one", () => {
  assert.deepEqual(overBudgetMessages(null, { strict: true }), []);
  assert.deepEqual(overBudgetMessages(report(), { strict: true }), []);
  assert.deepEqual(overBudgetMessages(report({ spentUSD: 200 }), { strict: true }), []);
  assert.deepEqual(overBudgetMessages(report({ spentUSD: 500, limitUSD: null }), { strict: true }), []);
});

test("overBudgetMessages is a warning, or an error with strict", () => {
  const over = report({ spentUSD: 250 });

  assert.deepEqual(overBudgetMessages(over, { strict: false }), [
    "claude-cost: warning: February 2026 spend $250.00 is $50.00 over the $200.00 budget.",
  ]);

  assert.deepEqual(overBudgetMessages(over, { strict: true }), [
    "claude-cost: error: February 2026 spend $250.00 is $50.00 over the $200.00 budget.",
  ]);
});

test("paceMessages warns when the forecast passes a budget that spend has not", () => {
  assert.deepEqual(paceMessages(report({ forecast: { projectedUSD: 260 } })), [
    "claude-cost: warning: February 2026 is on pace for $260.00, $60.00 over the $200.00 budget.",
  ]);
});

test("paceMessages is empty without a forecast over a budget that spend has not passed", () => {
  assert.deepEqual(paceMessages(null), []);
  assert.deepEqual(paceMessages(report()), []);
  assert.deepEqual(paceMessages(report({ forecast: { projectedUSD: 200 } })), []);
  assert.deepEqual(paceMessages(report({ forecast: null })), []);
  assert.deepEqual(paceMessages(report({ forecast: { projectedUSD: null } })), []);
  assert.deepEqual(paceMessages(report({ limitUSD: null, forecast: { projectedUSD: 900 } })), []);
  // Spend is already over, so overBudgetMessages reports it.
  assert.deepEqual(paceMessages(report({ spentUSD: 250, forecast: { projectedUSD: 400 } })), []);
});
