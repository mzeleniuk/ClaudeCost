import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { aggregate } from "../src/aggregate.js";
import { dedupeEvents } from "../src/dedupe.js";
import { eventsFromRecord } from "../src/parse.js";
import {
  STORE_VERSION,
  compactRecords,
  readStoredEvents,
  storeFileName,
} from "../src/store.js";

/**
 * A transcript directory, a store directory, and helpers to read through the
 * store and to find its file.
 */
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-store-"));
  const projects = path.join(root, "projects");
  const storeDir = path.join(root, "data");
  fs.mkdirSync(path.join(projects, "proj"), { recursive: true });

  const warnings = [];
  const read = (opts = {}) =>
    readStoredEvents(projects, {
      storeDir,
      warn: (message) => warnings.push(message),
      ...opts,
    });
  const storeFile = () =>
    path.join(storeDir, storeFileName(fs.realpathSync.native(projects)));
  const readStore = () => JSON.parse(fs.readFileSync(storeFile(), "utf8"));
  const transcript = (name) => path.join(projects, "proj", name);

  return {
    root,
    storeDir,
    read,
    storeFile,
    readStore,
    transcript,
    warnings,
  };
}

/**
 * One transcript line with usage.
 *
 * @param {string} id
 * @param {number} input
 */
const line = (id, input) =>
  JSON.stringify({
    timestamp: "2026-10-01T12:00:00.000Z",
    requestId: `req-${id}`,
    message: { id, model: "claude-opus-5-5", usage: { input_tokens: input } },
  });

/** @param {{ messageId: string | null, usage: { input: number } }[]} events */
const summary = (events) =>
  events.map((event) => [event.messageId, event.usage.input]);

test("storeFileName is a readable slug plus a hash of the path", () => {
  const name = storeFileName(path.join(os.homedir(), ".claude", "projects"));
  assert.match(name, /^claude-projects-[0-9a-f]{8}\.json$/);

  const other = storeFileName(path.join(os.homedir(), "claude", "projects"));
  assert.match(other, /^claude-projects-[0-9a-f]{8}\.json$/);
  assert.notEqual(name, other);

  assert.match(storeFileName("/srv/x y/projects"), /^srv-x-y-projects-/);
});

test("saves records and reuses them while the file is unchanged", async (t) => {
  const s = setup();
  t.after(() => fs.rmSync(s.root, { recursive: true, force: true }));
  const file = s.transcript("a.jsonl");

  // A whole-second mtime, so utimesSync can set exactly the same one later.
  const mtime = new Date("2026-10-01T12:00:00Z");
  fs.writeFileSync(file, `${line("m1", 10)}\n${line("m2", 20)}\n`);
  fs.utimesSync(file, mtime, mtime);
  assert.deepEqual(summary(await s.read()), [
    ["m1", 10],
    ["m2", 20],
  ]);

  const store = s.readStore();
  assert.equal(store.version, STORE_VERSION);
  assert.equal(store.files[path.join("proj", "a.jsonl")].records.length, 2);

  // Same size and mtime, different bytes: the store must not read it again.
  fs.writeFileSync(file, `${line("m1", 90)}\n${line("m2", 80)}\n`);
  fs.utimesSync(file, mtime, mtime);

  assert.deepEqual(summary(await s.read()), [
    ["m1", 10],
    ["m2", 20],
  ]);
});

test("reads only appended lines and rereads a rewritten file", async (t) => {
  const s = setup();
  t.after(() => fs.rmSync(s.root, { recursive: true, force: true }));
  const file = s.transcript("a.jsonl");

  fs.writeFileSync(file, `${line("m1", 10)}\n`);
  await s.read();

  fs.appendFileSync(file, `${line("m2", 20)}\n`);
  assert.deepEqual(summary(await s.read()), [
    ["m1", 10],
    ["m2", 20],
  ]);

  const entry = s.readStore().files[path.join("proj", "a.jsonl")];
  assert.equal(entry.offset, fs.statSync(file).size);

  // Longer, but the old bytes changed: not an append, so read it all.
  fs.writeFileSync(file, `${line("m9", 99)}\n${line("m8", 88)}\n`);
  assert.deepEqual(summary(await s.read()), [
    ["m9", 99],
    ["m8", 88],
  ]);

  // Shorter: read it all.
  fs.writeFileSync(file, `${line("m7", 7)}\n`);
  assert.deepEqual(summary(await s.read()), [["m7", 7]]);
});

test("counts a half-written last line once, before and after it ends", async (t) => {
  const s = setup();
  t.after(() => fs.rmSync(s.root, { recursive: true, force: true }));
  const file = s.transcript("a.jsonl");

  fs.writeFileSync(file, `${line("m1", 10)}\n${line("m2", 20)}`);
  assert.deepEqual(summary(await s.read()), [
    ["m1", 10],
    ["m2", 20],
  ]);

  const entry = s.readStore().files[path.join("proj", "a.jsonl")];
  assert.equal(entry.records.length, 1, "the unfinished line is not saved");

  fs.appendFileSync(file, `\n${line("m3", 30)}\n`);
  assert.deepEqual(summary(await s.read()), [
    ["m1", 10],
    ["m2", 20],
    ["m3", 30],
  ]);
});

test("keeps usage from deleted transcripts, also through a rebuild", async (t) => {
  const s = setup();
  t.after(() => fs.rmSync(s.root, { recursive: true, force: true }));
  const kept = s.transcript("kept.jsonl");
  const gone = s.transcript("gone.jsonl");

  fs.writeFileSync(kept, `${line("m1", 10)}\n`);
  fs.writeFileSync(gone, `${line("m2", 20)}\n`);
  await s.read();
  fs.rmSync(gone);

  for (const rebuild of [false, true]) {
    const events = await s.read({ rebuild });
    const archived = events.find((event) => event.messageId === "m2");

    assert.equal(events.length, 2);
    assert.equal(archived?.archived, true);
    assert.equal(archived?.file, gone);
  }

  const entry = s.readStore().files[path.join("proj", "gone.jsonl")];
  assert.equal(typeof entry.deletedAt, "string");

  // Back on disk: no longer archived.
  fs.writeFileSync(gone, `${line("m2", 20)}\n`);
  const events = await s.read();
  assert.equal(
    events.some((event) => event.archived),
    false,
  );
  assert.equal(
    s.readStore().files[path.join("proj", "gone.jsonl")].deletedAt,
    undefined,
  );
});

test("archived and live copies of a message are deduped and counted", async (t) => {
  const s = setup();
  t.after(() => fs.rmSync(s.root, { recursive: true, force: true }));
  const old = s.transcript("old.jsonl");

  // A resumed session copies m1 into the new transcript.
  fs.writeFileSync(old, `${line("m1", 10)}\n${line("m2", 20)}\n`);
  fs.writeFileSync(s.transcript("new.jsonl"), `${line("m1", 10)}\n`);
  await s.read();
  fs.rmSync(old);

  const events = await dedupeEvents(await s.read());
  assert.deepEqual(summary(events).sort(), [
    ["m1", 10],
    ["m2", 20],
  ]);

  const result = await aggregate(events, { pricing: {} });
  assert.equal(result.total.messages, 2);
  assert.equal(result.archivedTranscripts, 1);
});

test("moves an unreadable store aside and rebuilds it", async (t) => {
  const s = setup();
  t.after(() => fs.rmSync(s.root, { recursive: true, force: true }));

  fs.writeFileSync(s.transcript("a.jsonl"), `${line("m1", 10)}\n`);
  fs.mkdirSync(s.storeDir);
  fs.writeFileSync(s.storeFile(), "{ not json");

  assert.deepEqual(summary(await s.read()), [["m1", 10]]);
  assert.equal(s.warnings.length, 1);
  assert.match(s.warnings[0], /unreadable\. Moved it to .*\.corrupt-/);

  const names = fs.readdirSync(s.storeDir);
  assert.equal(names.filter((n) => n.includes(".corrupt-")).length, 1);
  assert.equal(s.readStore().version, STORE_VERSION);
});

test("refuses a store written by a newer version", async (t) => {
  const s = setup();
  t.after(() => fs.rmSync(s.root, { recursive: true, force: true }));
  const newer = JSON.stringify({ version: STORE_VERSION + 1, files: {} });

  fs.mkdirSync(s.storeDir);
  fs.writeFileSync(s.storeFile(), newer);

  await assert.rejects(s.read(), /written by a newer claude-cost/);
  assert.equal(fs.readFileSync(s.storeFile(), "utf8"), newer);
});

test("a stored record is priced again by the current parser", async (t) => {
  const s = setup();
  t.after(() => fs.rmSync(s.root, { recursive: true, force: true }));
  const file = s.transcript("a.jsonl");

  fs.writeFileSync(file, `${line("m1", 10)}\n`);
  await s.read();
  fs.rmSync(file);

  // The store keeps the raw usage object, not normalized numbers, so a
  // stored cache_creation breakdown is still read by normalizeUsage.
  const store = s.readStore();
  const entry = store.files[path.join("proj", "a.jsonl")];
  entry.records[0].usage = {
    input_tokens: 0,
    cache_creation_input_tokens: 5,
    cache_creation: {},
  };
  fs.writeFileSync(s.storeFile(), JSON.stringify(store));

  const [event] = await s.read();
  assert.equal(event.usage.cacheWrite, 5);
  assert.equal(event.usage.hasCacheBreakdown, false);
});

/**
 * A usage record as parseUsageRecord returns it.
 *
 * @param {string | null} id
 * @param {string} ts
 * @param {Record<string, any>} usage
 */
const record = (id, ts, usage) => ({
  id,
  model: "claude-opus-5-5",
  requestId: id && `req-${id}`,
  ts,
  usage,
});

/** @param {ReturnType<typeof record>[]} records */
const priced = async (records) =>
  (await dedupeEvents(records.flatMap((r) => eventsFromRecord(r, "f")))).map(
    (event) => [event.messageId, event.ts?.toISOString(), event.usage],
  );

test("compactRecords drops empty usage fields but keeps iteration indexes", () => {
  const [compact] = compactRecords([
    record("m1", "2026-10-01T12:00:00.000Z", {
      input_tokens: 3,
      output_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 0 },
      inference_geo: "",
      fallback_credit: null,
      service_tier: "standard",
      iterations: [{ type: "message", input_tokens: 0 }, { type: "x" }],
      server_tool_use: { web_search_requests: 0, web_fetch_requests: 2 },
    }),
  ]);

  assert.deepEqual(compact.usage, {
    input_tokens: 3,
    service_tier: "standard",
    iterations: [{ type: "message" }, { type: "x" }],
    server_tool_use: { web_fetch_requests: 2 },
  });
});

test("compactRecords keeps one copy of a streamed message", async () => {
  const records = [
    record("m1", "2026-10-01T12:00:01.000Z", { input_tokens: 5 }),
    record("m1", "2026-10-01T12:00:02.000Z", { input_tokens: 5 }),
    record("m2", "2026-10-01T12:00:03.000Z", { output_tokens: 1 }),
    record("m2", "2026-10-01T12:00:04.000Z", { output_tokens: 9 }),
    record(null, "2026-10-01T12:00:05.000Z", { input_tokens: 1 }),
    record(null, "2026-10-01T12:00:05.000Z", { input_tokens: 1 }),
  ];
  const compact = compactRecords(records);

  // A tie keeps the first copy, a bigger later copy replaces it, and
  // records without an id are never merged.
  assert.deepEqual(
    compact.map((r) => [r.id, r.ts]),
    [
      ["m1", "2026-10-01T12:00:01.000Z"],
      ["m2", "2026-10-01T12:00:04.000Z"],
      [null, "2026-10-01T12:00:05.000Z"],
      [null, "2026-10-01T12:00:05.000Z"],
    ],
  );
  assert.deepEqual(await priced(compact), await priced(records));
});

test("compactRecords keeps both copies when each wins one event", async () => {
  const advisor = (tokens) => ({
    type: "advisor_message",
    model: "claude-haiku-5-5",
    input_tokens: tokens,
  });
  const records = [
    record("m1", "2026-10-01T12:00:01.000Z", {
      input_tokens: 9,
      iterations: [advisor(1)],
    }),
    record("m1", "2026-10-01T12:00:02.000Z", {
      input_tokens: 2,
      iterations: [advisor(7)],
    }),
    // Loses to the copy above on both events.
    record("m1", "2026-10-01T12:00:03.000Z", {
      input_tokens: 2,
      iterations: [advisor(7)],
    }),
  ];
  const compact = compactRecords(records);

  assert.equal(compact.length, 2);
  assert.deepEqual(await priced(compact), await priced(records));
});

test("collapses copies of a message split across two runs", async (t) => {
  const s = setup();
  t.after(() => fs.rmSync(s.root, { recursive: true, force: true }));
  const file = s.transcript("a.jsonl");

  fs.writeFileSync(file, `${line("m1", 10)}\n${line("m1", 10)}\n`);
  await s.read();
  fs.appendFileSync(file, `${line("m1", 30)}\n${line("m2", 20)}\n`);

  assert.deepEqual(summary(await dedupeEvents(await s.read())), [
    ["m1", 30],
    ["m2", 20],
  ]);

  const entry = s.readStore().files[path.join("proj", "a.jsonl")];
  assert.deepEqual(
    entry.records.map((r) => [r.id, r.usage.input_tokens]),
    [
      ["m1", 30],
      ["m2", 20],
    ],
  );
});
