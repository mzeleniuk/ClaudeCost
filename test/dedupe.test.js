import { test } from "node:test";
import assert from "node:assert/strict";

import { dedupeEvents, usageTokenTotal } from "../src/dedupe.js";

async function* mockEvents(list) {
  for (const e of list) yield e;
}

test("usageTokenTotal sums normalized fields", () => {
  assert.equal(
    usageTokenTotal({ input: 1, output: 2, cacheWrite: 3, cacheRead: 4 }),
    10,
  );
});

test("dedupe keeps higher-token snapshot for same messageId+requestId", async () => {
  const events = await dedupeEvents(
    mockEvents([
      {
        messageId: "msg-1",
        requestId: "req-1",
        usage: { input: 1, output: 2, cacheWrite: 0, cacheRead: 0 },
      },
      {
        messageId: "msg-1",
        requestId: "req-1",
        usage: { input: 1, output: 100, cacheWrite: 0, cacheRead: 0 },
      },
    ]),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].usage.output, 100);
});

test("dedupe keeps both when messageId is missing", async () => {
  const events = await dedupeEvents(
    mockEvents([
      {
        messageId: null,
        requestId: "req-1",
        usage: { input: 1, output: 0, cacheWrite: 0, cacheRead: 0 },
      },
      {
        messageId: null,
        requestId: "req-1",
        usage: { input: 2, output: 0, cacheWrite: 0, cacheRead: 0 },
      },
    ]),
  );
  assert.equal(events.length, 2);
});

test("dedupe treats different requestIds as distinct", async () => {
  const events = await dedupeEvents(
    mockEvents([
      {
        messageId: "msg-1",
        requestId: "req-a",
        usage: { input: 1, output: 0, cacheWrite: 0, cacheRead: 0 },
      },
      {
        messageId: "msg-1",
        requestId: "req-b",
        usage: { input: 2, output: 0, cacheWrite: 0, cacheRead: 0 },
      },
    ]),
  );
  assert.equal(events.length, 2);
});

test("dedupe keeps first on equal totals", async () => {
  const events = await dedupeEvents(
    mockEvents([
      {
        messageId: "msg-1",
        requestId: "req-1",
        model: "first",
        usage: { input: 10, output: 0, cacheWrite: 0, cacheRead: 0 },
      },
      {
        messageId: "msg-1",
        requestId: "req-1",
        model: "second",
        usage: { input: 10, output: 0, cacheWrite: 0, cacheRead: 0 },
      },
    ]),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].model, "first");
});
