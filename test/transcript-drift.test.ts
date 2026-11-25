import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { emptyParseStats, readUsageEvents, skippedLineCount } from "../src/parse.ts";
import { skippedMessage } from "../src/report/skipped.ts";
import { readStoredEvents } from "../src/store.ts";
import type { UsageEvent } from "../src/types.ts";

/**
 * Transcripts from several Claude Code versions, with the events each one
 * must give. Claude Code does not document this format. When a new version
 * changes it, these tests fail, and the warning tests below show how a
 * user would see the same change.
 *
 * To add a version, run scripts/sanitize-transcript.ts on a real transcript
 * directory, see the comment at the top of that script.
 */
const TRANSCRIPTS = path.join(import.meta.dirname, "transcripts");

const versions = fs
  .readdirSync(TRANSCRIPTS)
  .filter((name) => name.endsWith(".jsonl"))
  .map((name) => name.replace(/\.jsonl$/, ""));

// An event as the expected files list it.
const brief = (event: UsageEvent) => ({
  messageId: event.messageId,
  requestId: event.requestId,
  model: event.model,
  ts: event.ts?.toISOString(),
  input: event.usage.input,
  output: event.usage.output,
  cacheRead: event.usage.cacheRead,
  cacheWrite: event.usage.cacheWrite,
});

function expectedFor(name: string) {
  return JSON.parse(fs.readFileSync(path.join(TRANSCRIPTS, `${name}.expected.json`), "utf8"));
}

test("fixtures cover at least five Claude Code versions", () => {
  assert.ok(versions.length >= 5, `found ${versions.length}`);
});

for (const name of versions) {
  test(`${name} gives the expected events and skips no lines`, async () => {
    const stats = emptyParseStats();
    const events = [];

    for await (const event of readUsageEvents(path.join(TRANSCRIPTS, `${name}.jsonl`), stats)) events.push(event);

    const expected = expectedFor(name);

    assert.deepEqual(events.map(brief), expected);
    assert.equal(skippedLineCount(stats), 0, stats.example ?? "");
    assert.equal(stats.example, null);

    // The assistant records, plus a tool result that carries its own usage object.
    assert.equal(stats.lines, expected.length + 1);
  });

  test(`${name} gives the same events through the usage store`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-drift-"));

    try {
      const projects = path.join(root, "projects", "proj");
      fs.mkdirSync(projects, { recursive: true });
      fs.copyFileSync(path.join(TRANSCRIPTS, `${name}.jsonl`), path.join(projects, "session.jsonl"));

      const parse = emptyParseStats();

      const events = await readStoredEvents(path.join(root, "projects"), {
        storeDir: path.join(root, "data"),
        parse,
      });

      assert.deepEqual(events.map(brief), expectedFor(name));
      assert.equal(skippedLineCount(parse), 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

const usage = { input_tokens: 5, output_tokens: 1 };
const assistant = (message: object) => JSON.stringify({ type: "assistant", message });

/**
 * Lines a future Claude Code version could write, with what the parser must
 * count. `events` is the number of priced events the lines still give.
 */
const DRIFT = [
  {
    name: "a line cut off in the middle",
    lines: ['{"type":"assistant","message":{"id":"m","usage":{"input_tokens":5'],
    counts: { invalidJson: 1 },
    events: 0,
  },
  {
    name: "usage nested under another key",
    lines: [assistant({ id: "m", model: "claude-x", metrics: { usage } })],
    counts: { noUsage: 1 },
    events: 0,
  },
  {
    name: "usage set to null",
    lines: [assistant({ id: "m", model: "claude-x", usage: null })],
    counts: { noUsage: 1 },
    events: 0,
  },
  {
    name: "token fields renamed",
    lines: [assistant({ id: "m", model: "claude-x", usage: { prompt_tokens: 5, completion_tokens: 1 } })],
    counts: { badTokenCounts: 1 },
    events: 0,
  },
  {
    name: "token counts written as strings",
    lines: [assistant({ id: "m", model: "claude-x", usage: { input_tokens: "5", output_tokens: "1" } })],
    counts: { badTokenCounts: 1 },
    events: 0,
  },
  {
    name: "one token count with the wrong type",
    lines: [assistant({ id: "m", model: "claude-x", usage: { input_tokens: 5, output_tokens: null } })],
    counts: { badTokenCounts: 1 },
    events: 1,
  },
  {
    name: "new fields next to the known ones",
    lines: [assistant({ id: "m", model: "claude-x", usage: { ...usage, speed: "fast", new_counter: { a: 1 } } })],
    counts: {},
    events: 1,
  },
  {
    name: "a user record that carries usage",
    lines: [JSON.stringify({ type: "user", message: { content: "x" }, toolUseResult: { usage } })],
    counts: {},
    events: 0,
  },
  {
    name: "an all-zero usage object",
    lines: [assistant({ id: "m", model: "claude-x", usage: { input_tokens: 0, output_tokens: 0 } })],
    counts: {},
    events: 0,
  },
];

for (const { name, lines, counts, events } of DRIFT) {
  test(`counts ${name}`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-drift-"));

    try {
      const file = path.join(root, "session.jsonl");
      // Followed by a newline, so the line is complete and not one still being written.
      fs.writeFileSync(file, `${lines.join("\n")}\n`);

      const stats = emptyParseStats();
      const got = [];

      for await (const event of readUsageEvents(file, stats)) got.push(event);

      assert.deepEqual(
        { invalidJson: stats.invalidJson, noUsage: stats.noUsage, badTokenCounts: stats.badTokenCounts },
        { invalidJson: 0, noUsage: 0, badTokenCounts: 0, ...counts },
      );

      assert.equal(got.length, events);
      assert.equal(stats.example === null, skippedLineCount(stats) === 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

test("a last line with no newline is not counted, because it may still be written", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-drift-"));

  try {
    const file = path.join(root, "session.jsonl");
    fs.writeFileSync(file, `${assistant({ id: "m1", usage })}\n{"type":"assistant","message":{"usage":{"input_`);

    const stats = emptyParseStats();
    const events = [];

    for await (const event of readUsageEvents(file, stats)) events.push(event);

    assert.equal(events.length, 1);
    assert.equal(skippedLineCount(stats), 0);
    assert.equal(stats.lines, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the example names the file, the byte offset and the problem", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-drift-"));

  try {
    const file = path.join(root, "session.jsonl");
    const first = assistant({ id: "m1", usage });

    fs.writeFileSync(file, `${first}\n${assistant({ id: "m2", usage: { tokens: 1 } })}\n`);

    const stats = emptyParseStats();
    for await (const _event of readUsageEvents(file, stats));

    assert.equal(
      stats.example,
      `${file}, byte ${Buffer.byteLength(first) + 1}: usage object without recognized token counts`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("skippedMessage is null when every line was read", () => {
  assert.equal(skippedMessage([emptyParseStats()], { strict: false }), null);
  assert.equal(skippedMessage([], { strict: true }), null);
});

test("skippedMessage adds the profiles together and names the first example", () => {
  const a = { ...emptyParseStats(), lines: 1000, invalidJson: 2, example: "a.jsonl, byte 5: not valid JSON" };
  const b = { ...emptyParseStats(), lines: 234, noUsage: 1, badTokenCounts: 3, example: "b.jsonl, byte 9: other" };

  assert.equal(
    skippedMessage([a, b], { strict: false }),
    "claude-cost: warning: 6 of 1,234 transcript lines with usage could not be read " +
      "(2 not valid JSON, 1 assistant without a usage object, 3 without recognized token counts). " +
      "Totals may be too low, and Claude Code may have changed its transcript format. " +
      "First: a.jsonl, byte 5: not valid JSON.",
  );

  assert.match(skippedMessage([a], { strict: true }) ?? "", /^claude-cost: error: 2 of 1,000 /);
});
