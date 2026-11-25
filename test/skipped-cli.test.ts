import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const BIN = path.join(import.meta.dirname, "..", "bin", "claude-cost.ts");

const GOOD = JSON.stringify({
  type: "assistant",
  timestamp: "2026-09-15T12:00:00.000Z",
  requestId: "r1",
  message: { id: "m1", model: "claude-test-a", usage: { input_tokens: 1_000_000, output_tokens: 0 } },
});

// A usage object whose token fields Claude Code renamed.
const RENAMED = JSON.stringify({
  type: "assistant",
  timestamp: "2026-09-15T12:00:01.000Z",
  requestId: "r2",
  message: { id: "m2", model: "claude-test-a", usage: { prompt_tokens: 1_000_000 } },
});

// Run the CLI on a transcript with `lines`, priced at $1 per million input tokens.
async function cli(lines: string[], args: string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-skipped-"));

  try {
    const projects = path.join(root, "projects");
    fs.mkdirSync(path.join(projects, "proj"), { recursive: true });
    fs.writeFileSync(path.join(projects, "proj", "session.jsonl"), `${lines.join("\n")}\n`);

    const pricing = path.join(root, "pricing.json");
    const zero = { output: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0 };
    fs.writeFileSync(pricing, JSON.stringify({ "claude-test-a": { ...zero, input: 1 } }));

    try {
      const base = [BIN, "--dir", projects, "--pricing", pricing, "--region", "global", "--no-cache"];
      const { stdout, stderr } = await promisify(execFile)(process.execPath, [...base, ...args]);

      return { code: 0, stdout, stderr };
    } catch (error) {
      const { code, stdout, stderr } = error as { code: number; stdout: string; stderr: string };
      return { code, stdout, stderr };
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("prints no warning when every line is read", async () => {
  const { code, stderr } = await cli([GOOD], ["--json"]);

  assert.equal(code, 0);
  assert.equal(stderr, "");
});

test("warns on stderr about unreadable lines, keeps stdout JSON and exits 0", async () => {
  for (const mode of [["--json"], ["--json", "--by-model"], ["--json", "--by-month"]]) {
    const { code, stdout, stderr } = await cli([GOOD, RENAMED], mode);

    assert.equal(code, 0, mode.join(" "));
    assert.match(stderr, /^claude-cost: warning: 1 of 2 transcript lines with usage could not be read /);
    assert.match(stderr, /\(1 without recognized token counts\)/);
    assert.match(stderr, /session\.jsonl, byte \d+: usage object without recognized token counts\.\n$/);
    assert.deepEqual(JSON.parse(stdout).skippedLines, { badTokenCounts: 1, invalidJson: 0, noUsage: 0 });
  }
});

test("--strict exits 1 on unreadable lines and still prints the report", async () => {
  for (const mode of [[], ["--by-model"], ["--by-month"], ["--json"]]) {
    const { code, stdout, stderr } = await cli(
      [GOOD, '{"type":"assistant","message":{"usage":{"input_tok', GOOD],
      [...mode, "--strict"],
    );

    assert.equal(code, 1, mode.join(" "));
    assert.match(
      stderr,
      /^claude-cost: error: 1 of 3 transcript lines with usage could not be read \(1 not valid JSON\)/,
    );
    assert.match(stdout, /\$1\.00|"costUSD": 1/);
  }
});

test("--strict exits 0 when every line is read", async () => {
  assert.equal((await cli([GOOD], ["--strict"])).code, 0);
});
