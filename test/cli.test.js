import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify, stripVTControlCharacters } from "node:util";

import { run } from "../src/cli.js";

const BIN = path.join(import.meta.dirname, "..", "bin", "claude-cost.js");

test("rejects --by-model together with --by-month", async () => {
  await assert.rejects(
    run(["--by-model", "--by-month"]),
    /use either --by-model or --by-month, not both/,
  );
});

test("rejects an invalid --since before scanning anything", async () => {
  await assert.rejects(run(["--since", "1"]), /invalid --since value: "1"/);
});

/**
 * A transcript directory and a pricing file with round prices, so the
 * expected costs are easy to check by hand:
 *   m1 (claude-test-a): two snapshots, the larger one is kept. $1 + $2 = $3.
 *   m2 (claude-test-b): 1M cache writes with an empty breakdown. $4.
 *   m3 (claude-mystery): not in the pricing file. $0.
 */
function setupProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-cli-"));
  const projects = path.join(root, "projects");
  const session = path.join(projects, "my-project");
  fs.mkdirSync(session, { recursive: true });

  const lines = [
    {
      timestamp: "2026-09-15T12:00:00.000Z",
      requestId: "r1",
      message: {
        id: "m1",
        model: "claude-test-a",
        usage: { input_tokens: 1_000_000, output_tokens: 1 },
      },
    },
    {
      timestamp: "2026-09-15T12:00:01.000Z",
      requestId: "r1",
      message: {
        id: "m1",
        model: "claude-test-a",
        usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
      },
    },
    {
      timestamp: "2026-10-15T12:00:00.000Z",
      requestId: "r2",
      message: {
        id: "m2",
        model: "claude-test-b@20260101",
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 1_000_000,
          cache_creation: {},
        },
      },
    },
    {
      timestamp: "2026-10-20T12:00:00.000Z",
      requestId: "r3",
      message: {
        id: "m3",
        model: "claude-mystery",
        usage: { input_tokens: 500, output_tokens: 0 },
      },
    },
  ];

  fs.writeFileSync(
    path.join(session, "session.jsonl"),
    lines.map((line) => JSON.stringify(line)).join("\n"),
  );

  const pricing = path.join(root, "pricing.json");
  const zero = { cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0 };

  fs.writeFileSync(
    pricing,
    JSON.stringify({
      "claude-test-a": { ...zero, input: 1, output: 2 },
      "claude-test-b": { ...zero, input: 0, output: 0, cacheWrite: 4 },
    }),
  );

  return { projects, pricing };
}

/** @param {string[]} args */
async function cli(args) {
  const { projects, pricing } = setupProject();
  const { stdout } = await promisify(execFile)(process.execPath, [
    BIN,
    "--dir",
    projects,
    "--pricing",
    pricing,
    "--region",
    "global",
    ...args,
  ]);

  return { stdout, pricing };
}

test("prints a per-model table with the total and unknown models", async () => {
  const { stdout, pricing } = await cli(["--by-model"]);
  const text = stripVTControlCharacters(stdout);

  assert.match(text, /^ {5}claude-test-a +1M +1M +0 +0 +1 +\$3\.00  █+/m);
  assert.match(
    text,
    /^ {5}claude-test-b@20260101 +0 +0 +0 +1M +1 +\$4\.00  █+/m,
  );
  assert.match(text, /^ {5}total .* 3 +\$7\.00$/m);
  assert.ok(text.includes(`Add them to ${pricing}`));
  assert.match(text, /^ {5}claude-mystery .* \$0\.00$/m);
  assert.match(text, /^ {7}claude-mystery$/m);
  assert.match(stdout, /Reconcile with your GCP Billing export/);
});

test("prints a JSON report that dedupes snapshots and keeps cache writes", async () => {
  const report = JSON.parse((await cli(["--json", "--by-model"])).stdout);

  assert.equal(report.region, "global");
  assert.equal(report.groupedBy, "model");
  assert.equal(report.total.costUSD, 7);
  assert.equal(report.total.messages, 3);
  assert.equal(report.total.outputTokens, 1_000_000);
  assert.equal(report.total.cacheWriteTokens, 1_000_000);
  assert.equal(report.byModel["claude-test-a"].costUSD, 3);
  assert.equal(report.byModel["claude-test-b@20260101"].costUSD, 4);
  assert.deepEqual(report.unknownModels, ["claude-mystery"]);
});

test("splits the JSON report by month and applies --since", async () => {
  const all = JSON.parse((await cli(["--json", "--by-month"])).stdout);

  assert.deepEqual(Object.keys(all.byMonth), ["2026-09", "2026-10"]);
  assert.equal(all.byMonth["2026-09"].total.costUSD, 3);
  assert.equal(all.byMonth["2026-10"].total.costUSD, 4);
  assert.equal(all.total.costUSD, 7);

  const recent = JSON.parse(
    (await cli(["--json", "--by-month", "--since", "2026-10-01"])).stdout,
  );

  assert.deepEqual(Object.keys(recent.byMonth), ["2026-10"]);
  assert.equal(recent.total.costUSD, 4);
  assert.equal(recent.total.messages, 2);
});
