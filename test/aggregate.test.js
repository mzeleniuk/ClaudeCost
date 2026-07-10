import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate } from "../src/aggregate.js";

const PRICING = {
  "claude-sonnet-4": {
    input: 3.0,
    output: 15.0,
    cacheWrite: 3.75,
    cacheRead: 0.3,
  },
};

async function* mockEvents(list) {
  for (const e of list) yield e;
}

test("sums totals across events", async () => {
  const events = mockEvents([
    {
      ts: new Date("2025-01-10"),
      model: "claude-sonnet-4",
      usage: { input_tokens: 1_000_000, output_tokens: 0 },
    },
    {
      ts: new Date("2025-01-11"),
      model: "claude-sonnet-4",
      usage: { input_tokens: 0, output_tokens: 1_000_000 },
    },
  ]);

  const { total } = await aggregate(events, { pricing: PRICING });
  assert.equal(total.messages, 2);
  assert.equal(total.costUSD, 18.0);
});

test("respects --since filter", async () => {
  const events = mockEvents([
    {
      ts: new Date("2025-01-01"),
      model: "claude-sonnet-4",
      usage: { input_tokens: 1_000_000 },
    },
    {
      ts: new Date("2025-01-20"),
      model: "claude-sonnet-4",
      usage: { input_tokens: 1_000_000 },
    },
  ]);

  const { total } = await aggregate(events, {
    pricing: PRICING,
    since: new Date("2025-01-15"),
  });
  assert.equal(total.messages, 1);
  assert.equal(total.inputTokens, 1_000_000);
});

test("groups by model", async () => {
  const events = mockEvents([
    { ts: null, model: "claude-sonnet-4", usage: { input_tokens: 1_000_000 } },
    { ts: null, model: "claude-opus-4", usage: { input_tokens: 1_000_000 } },
  ]);

  const { groups } = await aggregate(events, {
    pricing: PRICING,
    byModel: true,
  });
  assert.equal(groups.size, 2);
  assert.ok(groups.has("claude-sonnet-4"));
});

test("excludes undated events when --since is set", async () => {
  const events = mockEvents([
    {
      ts: null,
      model: "claude-sonnet-4",
      usage: { input_tokens: 1_000_000 },
    },
    {
      ts: new Date("2025-01-20"),
      model: "claude-sonnet-4",
      usage: { input_tokens: 1_000_000 },
    },
  ]);

  const { total } = await aggregate(events, {
    pricing: PRICING,
    since: new Date("2025-01-15"),
  });
  assert.equal(total.messages, 1);
  assert.equal(total.inputTokens, 1_000_000);
});
