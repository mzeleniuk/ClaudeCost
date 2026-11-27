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
const DAY_MS = 86_400_000;

const message = (id: string, timestamp: Date, model: string, inputTokens: number) =>
  JSON.stringify({
    type: "assistant",
    timestamp: timestamp.toISOString(),
    requestId: `r-${id}`,
    message: { id, model, usage: { input_tokens: inputTokens, output_tokens: 0 } },
  });

const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

/**
 * Run the CLI on `lines`, priced at $1 per million input tokens for
 * claude-test-a and $2 for claude-test-b. claude-mystery is not priced.
 */
async function cli(lines: string[], args: string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-compare-"));

  try {
    const projects = path.join(root, "projects");
    fs.mkdirSync(path.join(projects, "proj"), { recursive: true });
    fs.writeFileSync(path.join(projects, "proj", "session.jsonl"), `${lines.join("\n")}\n`);

    const pricing = path.join(root, "pricing.json");
    const zero = { output: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0 };

    fs.writeFileSync(
      pricing,
      JSON.stringify({ "claude-test-a": { ...zero, input: 1 }, "claude-test-b": { ...zero, input: 2 } }),
    );

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

/**
 * This week costs $5, from claude-test-a ($3) and claude-test-b ($2). The week
 * before costs $2, all claude-test-a. Usage 30 days ago costs $100 and is in
 * neither period.
 */
const weeks = [
  message("w1", daysAgo(2), "claude-test-a", 3_000_000),
  message("w2", daysAgo(3), "claude-test-b", 1_000_000),
  message("p1", daysAgo(10), "claude-test-a", 2_000_000),
  message("old", daysAgo(30), "claude-test-a", 100_000_000),
];

test("rejects a bad --compare before scanning anything", async () => {
  await assert.rejects(run(["--compare", "next", "--since", "7d"]), /invalid --compare value: "next"/);
  await assert.rejects(run(["--compare", "", "--since", "7d"]), /invalid --compare value: ""/);
  await assert.rejects(run(["--compare", "previous"]), /--compare needs --since or --monthly/);
  await assert.rejects(run(["--compare", "previous", "--since", "2999-01-01"]), /needs a period that has started/);
});

test("rejects --compare with the modes it does not fit", async () => {
  const flags = ["--compare", "previous", "--since", "7d"];

  await assert.rejects(run([...flags, "--by-month"]), /use either --compare or --by-month, not both/);
  await assert.rejects(run([...flags, "--dashboard"]), /use either --dashboard or --compare, not both/);
  await assert.rejects(run([...flags, "--backup", os.tmpdir()]), /use either --backup or --compare, not both/);
  await assert.rejects(run(["--compare", "previous", "--monthly", "--since", "7d"]), /use either --monthly or --since/);
});

test("--compare previous prints the report, then this week against the week before", async () => {
  const { code, stdout, stderr } = await cli(weeks, ["--since", "7d", "--compare", "previous"]);

  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.match(stdout, /^ {5}all models .* \$5\.00$/m);
  assert.match(stdout, /^⏺ Compared with the previous period$/m);
  assert.match(stdout, /^ {5}all models +\$5\.00 +\$2\.00 +\+\$3\.00 \(\+150%\)$/m);
  assert.ok(stdout.indexOf("Claude Code usage") < stdout.indexOf("Compared with the previous period"));
});

test("--compare previous --by-model lists the change per model", async () => {
  const { stdout } = await cli(weeks, ["--since", "7d", "--by-model", "--compare", "previous"]);

  assert.match(stdout, /^ {5}claude-test-a +\$3\.00 +\$2\.00 +\+\$1\.00 \(\+50%\)$/m);
  assert.match(stdout, /^ {5}claude-test-b +\$2\.00 +\$0\.00 +\+\$2\.00$/m);
  assert.match(stdout, /^ {5}total +\$5\.00 +\$2\.00 +\+\$3\.00 \(\+150%\)$/m);
});

test("--json carries the comparison and prints nothing else", async () => {
  const { code, stdout, stderr } = await cli(weeks, ["--json", "--by-model", "--since", "7d", "--compare", "previous"]);
  const { compare, total, since } = JSON.parse(stdout);

  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.equal(total.costUSD, 5);
  assert.equal(compare.against, "previous");
  assert.equal(compare.current.since, since);
  assert.equal(compare.previous.until, since);
  assert.equal(compare.current.total.costUSD, 5);
  assert.equal(compare.previous.total.costUSD, 2);
  assert.equal(compare.changeUSD, 3);
  assert.equal(compare.changePercent, 150);

  assert.deepEqual(compare.byModel["claude-test-b"], {
    currentUSD: 2,
    previousUSD: 0,
    changeUSD: 2,
    changePercent: null,
  });

  // The previous period is as long as the current one.
  const length = (period: { since: string; until: string }) => Date.parse(period.until) - Date.parse(period.since);
  assert.equal(length(compare.previous), length(compare.current));
});

test("--json has no compare key without --compare", async () => {
  const { stdout } = await cli(weeks, ["--json", "--since", "7d"]);
  assert.equal("compare" in JSON.parse(stdout), false);
});

test("--monthly --compare previous sets the month so far against the same stretch of the last month", async () => {
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  // The month began at midnight, so both first-of-month messages are in their periods.
  const lines = [
    message("this", startOfMonth(now), "claude-test-a", 6_000_000),
    message("last", lastMonth, "claude-test-a", 4_000_000),
    // Two months back is in neither period.
    message("older", new Date(now.getFullYear(), now.getMonth() - 2, 1), "claude-test-a", 100_000_000),
  ];

  const { stdout } = await cli(lines, ["--monthly", "--compare", "previous"]);

  assert.match(stdout, /^ {5}all models +\$6\.00 +\$4\.00 +\+\$2\.00 \(\+50%\)$/m);
  assert.match(stdout, /^ {5}Previous {5}\d{4}-\d\d-01 00:00:00 to /m);
});

test("an unpriced model used only in the previous period is warned about, and --strict fails", async () => {
  const lines = [...weeks, message("mystery", daysAgo(9), "claude-mystery", 1_000_000)];
  const lenient = await cli(lines, ["--since", "7d", "--compare", "previous"]);

  assert.equal(lenient.code, 0);
  assert.match(
    lenient.stderr,
    /^claude-cost: warning: models missing from .*pricing\.json are priced at \$0: claude-mystery\n$/,
  );

  const strict = await cli(lines, ["--since", "7d", "--compare", "previous", "--strict"]);

  assert.equal(strict.code, 1);
  assert.match(strict.stderr, /^claude-cost: error: models missing from /);
  assert.match(strict.stdout, /Compared with the previous period/);
});

test("an unpriced model from before the previous period is not warned about", async () => {
  const lines = [...weeks, message("mystery", daysAgo(20), "claude-mystery", 1_000_000)];
  const { code, stderr } = await cli(lines, ["--since", "7d", "--compare", "previous", "--strict"]);

  assert.equal(code, 0);
  assert.equal(stderr, "");
});

test("both periods can be empty", async () => {
  const { code, stdout } = await cli(
    [message("old", daysAgo(30), "claude-test-a", 1_000_000)],
    ["--since", "7d", "--compare", "previous"],
  );

  assert.equal(code, 0);
  assert.match(stdout, /No activity in either period\./);
});
