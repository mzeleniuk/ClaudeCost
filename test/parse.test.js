import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findTranscripts, readUsageEvents } from "../src/parse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "fixtures");
const SAMPLE = path.join(FIXTURES, "sample.jsonl");

test("readUsageEvents parses nested message usage", async () => {
  const events = [];
  for await (const ev of readUsageEvents(SAMPLE)) events.push(ev);

  assert.equal(events.length, 5);
  assert.equal(events[0].model, "claude-sonnet-4@20250514");
  assert.equal(events[0].usage.input_tokens, 100);
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
        ev.usage.input_tokens ||
        ev.usage.output_tokens ||
        ev.usage.cache_read_input_tokens ||
        ev.usage.cache_creation_input_tokens,
    ),
  );
});

test("readUsageEvents tolerates missing or invalid timestamps", async () => {
  const events = [];
  for await (const ev of readUsageEvents(SAMPLE)) events.push(ev);

  const badTs = events.find((ev) => ev.usage.input_tokens === 5);
  assert.equal(badTs.ts, null);

  const noTs = events.find((ev) => ev.usage.input_tokens === 25);
  assert.equal(noTs.ts, null);
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
