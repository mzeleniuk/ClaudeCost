import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  findTranscripts,
  readUsageEvents,
  normalizeUsage,
  advisorUsagesFromRaw,
} from "../src/parse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "fixtures");
const SAMPLE = path.join(FIXTURES, "sample.jsonl");

test("readUsageEvents parses nested message usage", async () => {
  const events = [];
  for await (const ev of readUsageEvents(SAMPLE)) events.push(ev);

  assert.ok(events.length >= 5);
  assert.equal(events[0].model, "claude-sonnet-4@20250514");
  assert.equal(events[0].usage.input, 100);
  assert.equal(events[0].messageId, "msg-1");
  assert.equal(events[0].requestId, "req-1");
  assert.equal(events[0].ts?.toISOString(), "2025-01-10T10:00:00.000Z");
});

test("readUsageEvents reads model from top-level record", async () => {
  const events = [];
  for await (const ev of readUsageEvents(SAMPLE)) events.push(ev);

  assert.equal(events[1].model, "claude-opus-4@20250514");
});

test("readUsageEvents skips corrupt lines and all-zero usage", async () => {
  const events = [];
  for await (const ev of readUsageEvents(SAMPLE)) events.push(ev);

  assert.ok(
    events.every(
      (ev) =>
        ev.usage.input ||
        ev.usage.output ||
        ev.usage.cacheRead ||
        ev.usage.cacheWrite,
    ),
  );
});

test("readUsageEvents tolerates missing or invalid timestamps", async () => {
  const events = [];
  for await (const ev of readUsageEvents(SAMPLE)) events.push(ev);

  const badTs = events.find((ev) => ev.usage.input === 5);
  assert.equal(badTs.ts, null);

  const noTs = events.find((ev) => ev.usage.input === 25);
  assert.equal(noTs.ts, null);
});

test("normalizeUsage prefers cache_creation breakdown", () => {
  const u = normalizeUsage({
    input_tokens: 1,
    cache_creation_input_tokens: 100,
    cache_creation: {
      ephemeral_5m_input_tokens: 20,
      ephemeral_1h_input_tokens: 80,
    },
  });
  assert.equal(u.hasCacheBreakdown, true);
  assert.equal(u.cacheWrite5m, 20);
  assert.equal(u.cacheWrite1h, 80);
  assert.equal(u.cacheWrite, 100);
});

test("normalizeUsage falls back to flat cache_creation_input_tokens", () => {
  const u = normalizeUsage({
    cache_creation_input_tokens: 50,
  });
  assert.equal(u.hasCacheBreakdown, false);
  assert.equal(u.cacheWrite5m, null);
  assert.equal(u.cacheWrite1h, null);
  assert.equal(u.cacheWrite, 50);
});

test("readUsageEvents normalizes cache breakdown from sample", async () => {
  const events = [];
  for await (const ev of readUsageEvents(SAMPLE)) events.push(ev);

  const cached = events.find((ev) => ev.messageId === "msg-cache");
  assert.ok(cached);
  assert.equal(cached.usage.hasCacheBreakdown, true);
  assert.equal(cached.usage.cacheWrite5m, 20);
  assert.equal(cached.usage.cacheWrite1h, 80);
  assert.equal(cached.usage.cacheWrite, 100);
});

test("advisorUsagesFromRaw keeps only advisor_message with a model", () => {
  const advisors = advisorUsagesFromRaw({
    input_tokens: 1,
    iterations: [
      { type: "other", model: "x", input_tokens: 9 },
      {
        type: "advisor_message",
        model: "advisor-a",
        input_tokens: 10,
        output_tokens: 2,
      },
      { type: "advisor_message", model: "", input_tokens: 50 },
      { type: "advisor_message", input_tokens: 50 },
    ],
  });
  assert.equal(advisors.length, 1);
  assert.equal(advisors[0].model, "advisor-a");
  assert.equal(advisors[0].usage.input, 10);
  assert.equal(advisors[0].usage.output, 2);
});

test("readUsageEvents expands advisor_message iterations", async () => {
  const events = [];
  for await (const ev of readUsageEvents(SAMPLE)) events.push(ev);

  const parent = events.find((ev) => ev.messageId === "msg-advisor");
  assert.ok(parent);
  assert.equal(parent.model, "claude-sonnet-4");
  assert.equal(parent.usage.input, 1);
  assert.equal(parent.usage.output, 2);
  assert.equal(parent.requestId, "req-advisor");

  const advisors = events.filter((ev) =>
    String(ev.messageId ?? "").startsWith("msg-advisor:advisor:"),
  );
  assert.equal(advisors.length, 2);
  assert.equal(advisors[0].messageId, "msg-advisor:advisor:0");
  assert.equal(advisors[0].model, "claude-opus-4");
  assert.equal(advisors[0].usage.input, 10);
  assert.equal(advisors[0].usage.output, 2);
  assert.equal(advisors[0].requestId, "req-advisor");
  assert.equal(advisors[1].messageId, "msg-advisor:advisor:1");
  assert.equal(advisors[1].model, "claude-haiku-4");
  assert.equal(advisors[1].usage.input, 3);

  assert.equal(
    events.some((ev) => ev.usage.input === 99),
    false,
    "non-advisor iterations must not be counted",
  );
});

test("readUsageEvents yields advisors when parent usage is all zero", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-advisor-"));
  const file = path.join(dir, "session.jsonl");
  fs.writeFileSync(
    file,
    JSON.stringify({
      timestamp: "2025-01-15T10:00:00.000Z",
      message: {
        id: "msg-zero-parent",
        model: "claude-sonnet-4",
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          iterations: [
            {
              type: "advisor_message",
              model: "claude-opus-4",
              input_tokens: 7,
              output_tokens: 1,
            },
          ],
        },
      },
      requestId: "req-zero",
    }) + "\n",
  );

  const events = [];
  for await (const ev of readUsageEvents(file)) events.push(ev);

  assert.equal(events.length, 1);
  assert.equal(events[0].messageId, "msg-zero-parent:advisor:0");
  assert.equal(events[0].model, "claude-opus-4");
  assert.equal(events[0].usage.input, 7);
});

test("findTranscripts discovers jsonl files recursively", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-parse-"));
  const nested = path.join(root, "proj", "nested");
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, "session.jsonl"), "{}");
  fs.writeFileSync(path.join(root, "notes.txt"), "skip");

  const files = [];
  for await (const file of findTranscripts(root)) files.push(file);
  assert.deepEqual(files, [path.join(nested, "session.jsonl")]);
});

test("findTranscripts avoids symlink cycles", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-symlink-"));
  const sub = path.join(root, "sub");
  fs.mkdirSync(sub);
  fs.writeFileSync(path.join(sub, "session.jsonl"), "{}");
  fs.symlinkSync(sub, path.join(root, "loop"), "dir");

  const files = [];
  for await (const file of findTranscripts(root)) files.push(file);
  assert.equal(files.length, 1);
  assert.equal(path.basename(files[0]), "session.jsonl");
});
