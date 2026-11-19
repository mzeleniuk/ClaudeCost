import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

import { collectDashboard } from "../src/dashboard/collect.js";

const app = fs.readFileSync(new URL("../src/dashboard/app.js", import.meta.url), "utf8");

// Position of the "// @test <name>" comment in app.js. Each one must appear
// exactly once, otherwise a slice would silently cover the wrong code.
function marker(name) {
  const comment = `// @test ${name}`;
  const at = app.indexOf(comment);

  assert.notEqual(at, -1, `app.js has no "${comment}" comment`);
  assert.equal(app.indexOf(comment, at + 1), -1, `app.js has more than one "${comment}" comment`);

  return at;
}

// Run the app's data setup, KPI renderer and chart scale calculations with a
// minimal DOM. Chart drawing and browser event handlers stay outside these tests.
const calculations = app.slice(0, marker("calculations end"));
const kpis = app.slice(marker("kpis start"), marker("kpis end"));
const scales = app.slice(marker("scales start"), marker("scales end"));

class Element {
  children = [];
  textContent = "";
  append(child) {
    this.children.push(child);
  }
  replaceChildren(...children) {
    this.children = children;
  }
  setAttribute() {}
}

function loadApp(data) {
  const host = new Element();
  const context = vm.createContext({
    Intl,
    document: {
      getElementById: (id) => (id === "claude-cost-data" ? { textContent: JSON.stringify(data) } : host),
      createElement: () => new Element(),
      createTextNode: (textContent) => ({ textContent }),
    },
  });
  vm.runInContext(`${calculations}\n${kpis}\n${scales}`, context);
  return {
    evaluate: (expression) => vm.runInContext(expression, context),
    renderKpis: () => {
      vm.runInContext("computeView(); renderKpis();", context);
      return host.children.map((cell) => ({
        label: cell.children[0].textContent,
        value: cell.children[1].textContent,
        sub: cell.children[2].textContent,
      }));
    },
  };
}

function dashboard(
  since = null,
  usage = {
    input: 1_000_000,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    hasCacheBreakdown: false,
  },
  { now = new Date(2026, 2, 13, 18), dates = [new Date(2026, 2, 13, 12)] } = {},
) {
  return collectDashboard(
    [
      {
        name: "default",
        region: "global",
        pricingFile: "pricing.config.json",
        pricing: {
          "claude-opus-5-5": {
            input: 1,
            output: 2,
            cacheWrite: 1.25,
            cacheWrite1h: 2,
            cacheRead: 0.1,
          },
        },
        dirs: ["/projects"],
        events: dates.map((ts, i) => ({
          ts,
          model: "claude-opus-5.5",
          file: `/projects/foo/session-${i}.jsonl`,
          usage,
        })),
      },
    ],
    {
      now,
      since,
      decodeProject: (folder) => ({ folder, label: folder, path: null }),
    },
  );
}

for (const [range, n] of [
  ["7d", 7],
  ["30d", 30],
  ["90d", 90],
]) {
  test(`dashboard anchors ${range} and its comparison to the generation date with future usage`, () => {
    const data = dashboard(null, undefined, {
      now: new Date(2026, 2, 13, 23, 30),
      dates: [
        new Date(2026, 2, 14 - 2 * n, 12),
        new Date(2026, 2, 14 - n, 12),
        new Date(2026, 2, 13, 12),
        new Date(2026, 2, 14, 0, 30),
      ],
    });
    const app = loadApp(data);
    app.evaluate(`state.range = '${range}'`);
    const rows = app.renderKpis();

    assert.equal(app.evaluate("data.days[view.lo]"), data.days[n]);
    assert.equal(app.evaluate("data.days[view.hi]"), "2026-03-13");
    assert.equal(app.evaluate("view.hi - view.lo + 1"), n);
    assert.equal(rows.find((row) => row.label === "spent").value, "$2.00");
    assert.equal(rows.find((row) => row.label === `vs previous ${range}`).sub, "$1.00");

    app.evaluate("state.range = 'all'");
    assert.equal(app.renderKpis().find((row) => row.label === "spent").value, "$4.00");
  });
}

test("dashboard recent ranges are empty when all usage is dated tomorrow", () => {
  const data = dashboard(null, undefined, {
    now: new Date(2026, 2, 13, 23, 30),
    dates: [new Date(2026, 2, 14, 0, 30)],
  });
  const app = loadApp(data);

  for (const range of ["7d", "30d", "90d", "month"]) {
    app.evaluate(`state.range = '${range}'`);
    assert.equal(app.renderKpis().find((row) => row.label === "spent").value, "$0.00");
    assert.equal(app.evaluate("view.hi < view.lo"), true);
  }
});

test("dashboard month to date and its pace leave out tomorrow's usage", () => {
  const app = loadApp(
    dashboard(null, undefined, {
      now: new Date(2026, 2, 13, 23, 30),
      dates: [
        new Date(2026, 1, 28, 12),
        new Date(2026, 2, 1, 12),
        new Date(2026, 2, 13, 12),
        new Date(2026, 2, 14, 0, 30),
      ],
    }),
  );
  app.evaluate("state.range = 'month'");
  const rows = app.renderKpis();

  assert.equal(app.evaluate("data.days[view.lo]"), "2026-03-01");
  assert.equal(app.evaluate("data.days[view.hi]"), "2026-03-13");
  assert.equal(rows.find((row) => row.label === "spent").value, "$2.00");
  assert.equal(rows.find((row) => row.label === "month-end pace").sub, "month to date $2.00");
});

test("dashboard chart ticks and labels stay distinct for small spending amounts", () => {
  const { evaluate } = loadApp(dashboard());

  for (const max of [0.000001, 0.005, 0.01, 0.015, 0.02, 0.025, 0.04, 1, 1234]) {
    const { ticks, labels } = JSON.parse(
      evaluate(`JSON.stringify((() => {
      const { ticks, step } = niceTicks(${max});
      return { ticks, labels: ticks.map((tick) => axisUsd(tick, step)) };
    })())`),
    );
    assert.equal(ticks[0], 0);
    assert.ok(ticks.at(-1) >= max);
    assert.ok(ticks.every((tick, i) => i === 0 || tick > ticks[i - 1]));
    assert.equal(new Set(labels).size, labels.length);
    assert.ok(labels.every((label) => !/NaN|Infinity/.test(label)));
  }
});

test("dashboard model labels retain dotted versions and strip provider/context suffixes", () => {
  const { evaluate } = loadApp(dashboard());
  for (const [id, expected] of [
    ["claude-opus-5.5", "Opus 5.5"],
    ["claude-opus-4.5", "Opus 4.5"],
    ["claude-sonnet-4-5[1m]", "Sonnet 4.5"],
    ["claude-sonnet-4.5@20250929[1m]", "Sonnet 4.5"],
    ["anthropic.claude-sonnet-4-5-20250929-v1:0", "Sonnet 4.5"],
    ["claude-opus-5.5-latest", "Opus 5.5"],
    ["claude-mystery", "claude-mystery"],
  ]) {
    assert.equal(evaluate(`parseModel(${JSON.stringify(id)}).name`), expected);
  }
  assert.equal(evaluate("modelInfo[0].name"), "Opus 5.5");
});

test("dashboard keeps ids with the same parsed name apart", () => {
  const data = dashboard();
  data.models = ["claude-sonnet-4-5", "claude-sonnet-4-5@20250929"];
  const { evaluate } = loadApp(data);

  assert.equal(evaluate("modelInfo.map((m) => m.name).join('|')"), "claude-sonnet-4-5|claude-sonnet-4-5@20250929");
  assert.notEqual(evaluate("modelColors[0]"), evaluate("modelColors[1]"));
});

test("dashboard orders dotted model versions newest first and remaps facts", () => {
  const data = dashboard();
  data.models = ["claude-opus-4.5", "claude-opus-5.5"];
  const { evaluate } = loadApp(data);
  assert.equal(evaluate("data.models.join(',')"), "claude-opus-5.5,claude-opus-4.5");
  assert.equal(evaluate("F.model[0]"), 1);
});

test("dashboard replaces month-end pace with the busiest day after a mid-month capture cutoff", () => {
  const rows = loadApp(dashboard(new Date(2026, 2, 10))).renderKpis();
  assert.ok(!rows.some((row) => row.label === "month-end pace"));
  assert.deepEqual(
    rows.find((row) => row.label === "busiest day"),
    {
      label: "busiest day",
      value: "$1.00",
      sub: "Mar 13",
    },
  );
});

test("dashboard retains month-end pace when the complete month is captured", () => {
  for (const since of [null, new Date(2026, 1, 20), new Date(2026, 2, 1)]) {
    const rows = loadApp(dashboard(since)).renderKpis();
    assert.deepEqual(
      rows.find((row) => row.label === "month-end pace"),
      {
        label: "month-end pace",
        value: "$2.38",
        sub: "month to date $1.00",
      },
    );
  }
});

test("dashboard shows what caching saved against the uncached price", () => {
  const rows = loadApp(
    dashboard(null, {
      input: 0,
      output: 0,
      cacheRead: 10_000_000,
      cacheWrite: 0,
      hasCacheBreakdown: false,
    }),
  ).renderKpis();
  assert.deepEqual(
    rows.find((row) => row.label.startsWith("caching")),
    {
      label: "caching saved",
      value: "$9.00",
      sub: "90% off the uncached price",
    },
  );
});

test("dashboard shows what caching cost when cache writes outweigh reads", () => {
  const rows = loadApp(
    dashboard(null, {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 1_000_000,
      hasCacheBreakdown: false,
    }),
  ).renderKpis();
  assert.deepEqual(
    rows.find((row) => row.label.startsWith("caching")),
    {
      label: "caching cost",
      value: "$0.25",
      sub: "25% over the uncached price",
    },
  );
});

test("dashboard shows nothing saved when there is no caching", () => {
  const rows = loadApp(dashboard()).renderKpis();
  assert.deepEqual(
    rows.find((row) => row.label.startsWith("caching")),
    {
      label: "caching saved",
      value: "$0.00",
      sub: "0% off the uncached price",
    },
  );
});

test("the sample fixture matches the collected data shape and renders its KPIs", () => {
  const fixture = JSON.parse(fs.readFileSync(new URL("fixtures/dashboard-data.json", import.meta.url), "utf8"));
  const collected = dashboard();
  assert.deepEqual(Object.keys(fixture).sort(), Object.keys(collected).sort());
  assert.deepEqual(Object.keys(fixture.facts).sort(), Object.keys(collected.facts).sort());
  assert.deepEqual(Object.keys(fixture.sessions).sort(), Object.keys(collected.sessions).sort());
  assert.deepEqual(Object.keys(fixture.warnings).sort(), Object.keys(collected.warnings).sort());

  const rows = loadApp(fixture).renderKpis();
  const total = fixture.facts.cost.reduce((sum, cost) => sum + cost, 0);
  const usd = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  });
  assert.equal(rows.find((row) => row.label === "spent").value, usd.format(total));
  for (const row of rows) assert.doesNotMatch(`${row.value} ${row.sub}`, /NaN|undefined/, row.label);
});

test("dashboard checks the capture cutoff in the data timezone, including sub-minute cutoffs", () => {
  for (const [since, hasPace] of [
    ["2026-03-01T04:59:59.999Z", true],
    ["2026-03-01T05:00:00.000Z", true],
    ["2026-03-01T05:00:00.001Z", false],
    ["2026-03-01T05:00:01.000Z", false],
    ["2026-03-01T05:01:00.000Z", false],
  ]) {
    const data = dashboard();
    data.timezone = "America/New_York";
    data.generatedAt = "2026-03-13T12:00:00Z";
    data.since = since;
    const rows = loadApp(data).renderKpis();
    assert.equal(
      rows.some((row) => row.label === "month-end pace"),
      hasPace,
      since,
    );
  }
});

for (const { range, days, midnightOffset } of [
  { range: "7d", days: 14, midnightOffset: "05:00" },
  { range: "30d", days: 60, midnightOffset: "05:00" },
  { range: "90d", days: 180, midnightOffset: "04:00" },
  { range: "month", days: 41, midnightOffset: "05:00" },
]) {
  test(`dashboard compares ${range} only when the previous period is fully captured`, () => {
    const data = dashboard();
    data.timezone = "America/New_York";
    data.generatedAt = "2026-03-13T22:00:00.000Z";
    data.days = Array.from({ length: days }, (_, i) =>
      new Date(Date.UTC(2026, 2, 14 - days + i)).toISOString().slice(0, 10),
    );
    // The captured previous period costs $1 and the current one costs $10.
    for (const [key, values] of Object.entries(data.facts)) {
      data.facts[key] = [values[0], values[0]];
    }
    data.facts.day = [0, days - 1];
    data.facts.input = [1_000_000, 10_000_000];
    data.facts.cost = data.facts.costInput = data.facts.uncachedCost = [1, 10];
    data.sessions.firstDay = [0];
    data.sessions.lastDay = [days - 1];

    const midnight = new Date(`${data.days[0]}T${midnightOffset}:00.000Z`);
    const label = range === "month" ? "vs previous month" : `vs previous ${range}`;

    for (const [since, comparable] of [
      [null, true],
      [new Date(midnight.getTime() - 1).toISOString(), true],
      [midnight.toISOString(), true],
      [new Date(midnight.getTime() + 1).toISOString(), false],
      [new Date(midnight.getTime() + 12 * 60 * 60 * 1000).toISOString(), false],
    ]) {
      data.since = since;
      const app = loadApp(data);
      app.evaluate(`state.range = ${JSON.stringify(range)}`);
      const rows = app.renderKpis();
      assert.equal(
        rows.some((row) => row.label === label),
        comparable,
        String(since),
      );
      assert.equal(rows.find((row) => row.label === "spent").value, "$10.00");
      if (comparable) assert.equal(rows.find((row) => row.label === label).sub, "$1.00");
    }
  });
}
