import { test } from "node:test";
import assert from "node:assert/strict";

import { aggregateByMonth, sortedMonthKeys } from "../src/aggregateByMonth.js";

const PRICING = {
  "claude-sonnet-4": {
    cacheRead: 0.3,
    cacheWrite: 3.75,
    cacheWrite1h: 6.0,
    input: 3.0,
    output: 15.0,
  },
  "claude-opus-4": {
    cacheRead: 1.5,
    cacheWrite: 18.75,
    cacheWrite1h: 30.0,
    input: 15.0,
    output: 75.0,
  },
};

async function* mockEvents(list) {
  for (const e of list) yield e;
}

const usage = (input = 0, output = 0) => ({
  cacheRead: 0,
  cacheWrite: 0,
  hasCacheBreakdown: false,
  input,
  output,
});

test("groups events by month and model", async () => {
  const events = mockEvents([
    {
      ts: new Date("2025-01-10"),
      model: "claude-sonnet-4",
      usage: usage(1_000_000, 0),
    },
    {
      ts: new Date("2025-02-15"),
      model: "claude-sonnet-4",
      usage: usage(1_000_000, 0),
    },
    {
      ts: new Date("2025-02-20"),
      model: "claude-opus-4",
      usage: usage(1_000_000, 0),
    },
  ]);

  const { months, total } = await aggregateByMonth(events, {
    pricing: PRICING,
  });
  assert.equal(months.size, 2);
  assert.equal(total.messages, 3);
  assert.equal(total.costUSD, 3.0 + 3.0 + 15.0);

  const jan = months.get("2025-01");
  assert.equal(jan.total.messages, 1);
  assert.equal(jan.models.get("claude-sonnet-4").costUSD, 3.0);

  const feb = months.get("2025-02");
  assert.equal(feb.total.messages, 2);
  assert.equal(feb.models.size, 2);
});

test("sortedMonthKeys returns ascending order", async () => {
  const events = mockEvents([
    {
      ts: new Date("2025-03-01"),
      model: "claude-sonnet-4",
      usage: usage(100, 0),
    },
    {
      ts: new Date("2025-01-01"),
      model: "claude-sonnet-4",
      usage: usage(100, 0),
    },
    {
      ts: new Date("2025-02-01"),
      model: "claude-sonnet-4",
      usage: usage(100, 0),
    },
  ]);

  const { months } = await aggregateByMonth(events, { pricing: PRICING });
  assert.deepEqual(sortedMonthKeys(months), ["2025-01", "2025-02", "2025-03"]);
});

test("respects --since filter", async () => {
  const events = mockEvents([
    {
      ts: new Date("2025-01-01"),
      model: "claude-sonnet-4",
      usage: usage(1_000_000, 0),
    },
    {
      ts: new Date("2025-02-01"),
      model: "claude-sonnet-4",
      usage: usage(1_000_000, 0),
    },
  ]);

  const { months, total } = await aggregateByMonth(events, {
    pricing: PRICING,
    since: new Date("2025-02-01"),
  });

  assert.equal(months.size, 1);
  assert.ok(months.has("2025-02"));
  assert.equal(total.messages, 1);
});

test("tracks skipped undated events", async () => {
  const events = mockEvents([
    {
      ts: null,
      model: "claude-sonnet-4",
      usage: usage(1_000_000, 0),
    },
    {
      ts: new Date("2025-01-10"),
      model: "claude-sonnet-4",
      usage: usage(1_000_000, 0),
    },
  ]);

  const { months, total, skippedUndated } = await aggregateByMonth(events, {
    pricing: PRICING,
  });

  assert.equal(skippedUndated, 1);
  assert.equal(months.size, 1);
  assert.equal(total.messages, 1);
});
