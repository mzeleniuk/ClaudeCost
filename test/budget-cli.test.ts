import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify, stripVTControlCharacters } from "node:util";

import { run } from "../src/cli.ts";
import { startOfMonth } from "../src/since.ts";

const BIN = path.join(import.meta.dirname, "..", "bin", "claude-cost.ts");

const message = (id: string, timestamp: Date, inputTokens: number) =>
  JSON.stringify({
    type: "assistant",
    timestamp: timestamp.toISOString(),
    requestId: `r-${id}`,
    message: { id, model: "claude-test-a", usage: { input_tokens: inputTokens, output_tokens: 0 } },
  });

/**
 * Run the CLI on a transcript priced at $1 per million input tokens. It holds
 * $1 from the current month, and $10 from September 2026 that no month check
 * may count. The current-month message is one second after the month began,
 * so it is in the month whenever the test runs.
 */
async function cli(args: string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-budget-"));

  try {
    const projects = path.join(root, "projects");
    fs.mkdirSync(path.join(projects, "proj"), { recursive: true });

    const lines = [
      message("old", new Date(2026, 8, 15, 12), 10_000_000),
      message("now", new Date(startOfMonth().getTime() + 1000), 1_000_000),
    ];

    fs.writeFileSync(path.join(projects, "proj", "session.jsonl"), `${lines.join("\n")}\n`);

    const pricing = path.join(root, "pricing.json");
    const zero = { output: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0 };
    fs.writeFileSync(pricing, JSON.stringify({ "claude-test-a": { ...zero, input: 1 } }));

    const base = [BIN, "--dir", projects, "--pricing", pricing, "--region", "global", "--no-cache"];

    try {
      const { stdout, stderr } = await promisify(execFile)(process.execPath, [...base, ...args]);
      return { code: 0, stdout: stripVTControlCharacters(stdout), stderr };
    } catch (error) {
      const { code, stdout, stderr } = error as { code: number; stdout: string; stderr: string };
      return { code, stdout: stripVTControlCharacters(stdout), stderr };
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("rejects an invalid --budget before scanning anything", async () => {
  for (const value of ["abc", "0", "-5", "", "1e3"]) {
    // The "=" form lets a value start with a dash.
    await assert.rejects(run([`--budget=${value}`]), /invalid --budget value/, value);
  }
});

test("stays silent when the month is under the budget", async () => {
  const { code, stdout, stderr } = await cli(["--budget", "5"]);

  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.match(stdout, /^ {2}⎿ {2}Spent {5}\$1\.00 of \$5\.00 budget \(20%\)$/m);
});

test("warns on stderr when the month passes the budget and still exits 0", async () => {
  const { code, stdout, stderr } = await cli(["--budget", "0.5"]);

  assert.equal(code, 0);
  assert.match(stderr, /^claude-cost: warning: \w+ \d{4} spend \$1\.00 is \$0\.50 over the \$0\.50 budget\.\n$/);
  assert.match(stdout, /Spent {5}\$1\.00 of \$0\.50 budget \(200%\) {2}⚠ \$0\.50 over/);
});

test("--strict exits 1 when the month passes the budget, after the report prints", async () => {
  const { code, stdout, stderr } = await cli(["--budget", "0.5", "--strict"]);

  assert.equal(code, 1);
  assert.match(stderr, /^claude-cost: error: \w+ \d{4} spend \$1\.00 is \$0\.50 over the \$0\.50 budget\.\n$/);
  assert.match(stdout, /all models .* \$11\.00$/m);
});

test("--strict exits 0 when the month is under the budget", async () => {
  const { code, stderr } = await cli(["--budget", "5", "--strict"]);

  assert.equal(code, 0);
  assert.equal(stderr, "");
});

test("counts the current month only, whatever --since says", async () => {
  // All history costs $11 and the current month $1.
  for (const since of ["2020-01-01", "today"]) {
    const { code, stderr } = await cli(["--budget", "2", "--strict", "--since", since]);

    assert.equal(code, 0, since);
    assert.equal(stderr, "", since);
  }
});

test("--json carries the budget and stays valid JSON when it warns", async () => {
  for (const mode of [[], ["--by-model"], ["--by-month"]]) {
    const { stdout, stderr } = await cli(["--json", "--budget", "0.5", ...mode]);
    const { budget } = JSON.parse(stdout);

    assert.equal(budget.spentUSD, 1, mode.join(" "));
    assert.equal(budget.budgetUSD, 0.5, mode.join(" "));
    assert.equal(budget.overBudget, true, mode.join(" "));
    assert.equal(budget.forecast, null, mode.join(" "));
    assert.match(stderr, /^claude-cost: warning: /, mode.join(" "));
  }
});

test("--json has no budget block without --budget or --forecast", async () => {
  const { stdout } = await cli(["--json"]);
  assert.equal("budget" in JSON.parse(stdout), false);
});

test("--forecast without a budget prints a projection or says it is too early", async () => {
  const { code, stdout, stderr } = await cli(["--forecast"]);

  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.match(stdout, /^ {2}⎿ {2}Spent {5}\$1\.00$/m);
  assert.match(
    stdout,
    /^ {5}Forecast {2}(\$\d+\.\d\d at the current pace|not available during the first day of the month)$/m,
  );
});

test("--forecast --json reports the projection next to the budget", async () => {
  const { budget } = JSON.parse((await cli(["--json", "--forecast", "--budget", "5"])).stdout);

  assert.equal(budget.budgetUSD, 5);
  assert.ok(budget.forecast.projectedUSD === null || budget.forecast.projectedUSD >= 1);
  assert.equal(typeof budget.forecast.overBudget, "boolean");
});

test("the dashboard run prints the budget block and honors --strict", async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-out-")), "d.html");
  const lenient = await cli(["--dashboard", "--out", out, "--budget", "0.5"]);

  assert.equal(lenient.code, 0);
  assert.match(lenient.stdout, /Spent {5}\$1\.00 of \$0\.50 budget/);
  assert.match(lenient.stderr, /^claude-cost: warning: .* over the \$0\.50 budget\.\n$/);

  const strict = await cli(["--dashboard", "--out", out, "--budget", "0.5", "--strict"]);

  assert.equal(strict.code, 1);
  assert.match(strict.stdout, /Dashboard written to /);
});
