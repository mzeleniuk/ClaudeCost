import type { DashboardData, DashboardFacts } from "../src/types.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { collectDashboard } from "../src/dashboard/collect.ts";
import { readApp } from "../src/dashboard/render.ts";

const app = readApp(path.join(import.meta.dirname, "../src/dashboard"));

// Position of the "// @test <name>" comment in app.ts. Each one must appear
// exactly once, otherwise a slice would silently cover the wrong code.
function marker(name: string) {
  const comment = `// @test ${name}`;
  const at = app.indexOf(comment);

  assert.notEqual(at, -1, `app.ts has no "${comment}" comment`);
  assert.equal(app.indexOf(comment, at + 1), -1, `app.ts has more than one "${comment}" comment`);

  return at;
}

// Run the app's data setup, KPI renderer and chart scale calculations with a
// minimal DOM. Chart drawing and browser event handlers stay outside these tests.
const calculations = app.slice(0, marker("calculations end"));
const kpis = app.slice(marker("kpis start"), marker("kpis end"));
const scales = app.slice(marker("scales start"), marker("scales end"));

class Element {
  children: Element[] = [];
  textContent = "";
  append(child: Element) {
    this.children.push(child);
  }
  replaceChildren(...children: Element[]) {
    this.children = children;
  }
  setAttribute() {}
}

function loadApp(data: DashboardData, hash = "") {
  const host = new Element();
  const location = { hash, pathname: "/dashboard.html", search: "" };

  // Like the browser, replaceState changes the hash without a hashchange event.
  const history = {
    replaceState: (_state: unknown, _title: string, url: string) => {
      location.hash = url.includes("#") ? url.slice(url.indexOf("#")) : "";
    },
  };

  const context = vm.createContext({
    Intl,
    URLSearchParams,
    location,
    history,
    document: {
      getElementById: (id: string) => (id === "claude-cost-data" ? { textContent: JSON.stringify(data) } : host),
      createElement: () => new Element(),
      createTextNode: (textContent: string) => ({ textContent }),
    },
  });
  vm.runInContext(`${calculations}\n${kpis}\n${scales}`, context);
  return {
    evaluate: (expression: string) => vm.runInContext(expression, context),
    hash: () => location.hash,
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
  since: Date | null = null,
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; hasCacheBreakdown: boolean } = {
    input: 1_000_000,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    hasCacheBreakdown: false,
  },
  { now = new Date(2026, 2, 13, 18), dates = [new Date(2026, 2, 13, 12)] }: { now?: Date; dates?: Date[] } = {},
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
          messageId: null,
          requestId: null,
          model: "claude-opus-5.5",
          file: `/projects/foo/session-${i}.jsonl`,
          usage,
        })),
      },
    ],
    {
      now,
      since,
      decodeProject: (folder: string) => ({ folder, label: folder, path: null }),
    },
  );
}

for (const [range, n] of [
  ["7d", 7],
  ["30d", 30],
  ["90d", 90],
] as const) {
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
    assert.equal(rows.find((row) => row.label === "spent")!.value, "$2.00");
    assert.equal(rows.find((row) => row.label === `vs previous ${range}`)!.sub, "$1.00");

    app.evaluate("state.range = 'all'");
    assert.equal(app.renderKpis().find((row) => row.label === "spent")!.value, "$4.00");
  });
}

test("dashboard recent ranges are empty when all usage is dated tomorrow", () => {
  const data = dashboard(null, undefined, {
    now: new Date(2026, 2, 13, 23, 30),
    dates: [new Date(2026, 2, 14, 0, 30)],
  });
  const app = loadApp(data);

  for (const range of ["7d", "30d", "90d", "month"] as const) {
    app.evaluate(`state.range = '${range}'`);
    assert.equal(app.renderKpis().find((row) => row.label === "spent")!.value, "$0.00");
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
  assert.equal(rows.find((row) => row.label === "spent")!.value, "$2.00");
  assert.equal(rows.find((row) => row.label === "month-end pace")!.sub, "month to date $2.00");
});

test("dashboard chart ticks and labels stay distinct for small spending amounts", () => {
  const { evaluate } = loadApp(dashboard());

  for (const max of [0.000001, 0.005, 0.01, 0.015, 0.02, 0.025, 0.04, 1, 1234] as const) {
    const { ticks, labels }: { ticks: number[]; labels: string[] } = JSON.parse(
      evaluate(`JSON.stringify((() => {
      const { ticks, step } = niceTicks(${max});
      return { ticks, labels: ticks.map((tick) => axisUsd(tick, step)) };
    })())`),
    );
    assert.equal(ticks[0], 0);
    assert.ok(ticks.at(-1)! >= max);
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
  ] as const) {
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
  for (const since of [null, new Date(2026, 1, 20), new Date(2026, 2, 1)] as const) {
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
  const fixture: DashboardData = JSON.parse(
    fs.readFileSync(new URL("fixtures/dashboard-data.json", import.meta.url), "utf8"),
  );
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
  assert.equal(rows.find((row) => row.label === "spent")!.value, usd.format(total));
  for (const row of rows) assert.doesNotMatch(`${row.value} ${row.sub}`, /NaN|undefined/, row.label);
});

test("dashboard checks the capture cutoff in the data timezone, including sub-minute cutoffs", () => {
  for (const [since, hasPace] of [
    ["2026-03-01T04:59:59.999Z", true],
    ["2026-03-01T05:00:00.000Z", true],
    ["2026-03-01T05:00:00.001Z", false],
    ["2026-03-01T05:00:01.000Z", false],
    ["2026-03-01T05:01:00.000Z", false],
  ] as const) {
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
] as const) {
  test(`dashboard compares ${range} only when the previous period is fully captured`, () => {
    const data = dashboard();
    data.timezone = "America/New_York";
    data.generatedAt = "2026-03-13T22:00:00.000Z";
    data.days = Array.from({ length: days }, (_, i) =>
      new Date(Date.UTC(2026, 2, 14 - days + i)).toISOString().slice(0, 10),
    );
    // The captured previous period costs $1 and the current one costs $10.
    for (const [key, values] of Object.entries(data.facts)) {
      data.facts[key as keyof DashboardFacts] = [values[0], values[0]];
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
    ] as const) {
      data.since = since;
      const app = loadApp(data);
      app.evaluate(`state.range = ${JSON.stringify(range)}`);
      const rows = app.renderKpis();
      assert.equal(
        rows.some((row) => row.label === label),
        comparable,
        String(since),
      );
      assert.equal(rows.find((row) => row.label === "spent")!.value, "$10.00");
      if (comparable) assert.equal(rows.find((row) => row.label === label)!.sub, "$1.00");
    }
  });
}

// Usage 60 days back, 30 days back and on the generation day, so the last 30
// days and the 30 before them both have spend.
const recent = () =>
  dashboard(null, undefined, {
    now: new Date(2026, 2, 13, 23, 30),
    dates: [new Date(2026, 2, 14 - 60, 12), new Date(2026, 2, 14 - 30, 12), new Date(2026, 2, 13, 12)],
  });

// Usage only 90 and 100 days back, so the last 30 days are empty.
const stale = () =>
  dashboard(null, undefined, {
    now: new Date(2026, 2, 13, 23, 30),
    dates: [new Date(2026, 2, 14 - 100, 12), new Date(2026, 2, 14 - 90, 12)],
  });

test("dashboard opens on 30 days when there is recent usage, and shows the change from the 30 before", () => {
  const app = loadApp(recent());

  app.evaluate("readHash()");
  assert.equal(app.evaluate("defaultRange"), "30d");
  assert.equal(app.evaluate("state.range"), "30d");

  const rows = app.renderKpis();

  assert.equal(rows.find((row) => row.label === "spent")!.value, "$2.00");
  assert.equal(rows.find((row) => row.label === "vs previous 30d")!.sub, "$1.00");
});

test("dashboard opens on all history when the last 30 days have no usage", () => {
  const app = loadApp(stale());

  app.evaluate("readHash()");
  assert.equal(app.evaluate("defaultRange"), "all");
  assert.equal(app.evaluate("state.range"), "all");
  assert.equal(app.renderKpis().find((row) => row.label === "spent")!.value, "$2.00");
});

test("dashboard reads the range from the link and falls back to the default", () => {
  for (const [hash, range] of [
    ["", "30d"],
    ["#range=all", "all"],
    ["#range=7d", "7d"],
    ["#range=month", "month"],
    ["#range=yesterday", "30d"],
    ["#range=", "30d"],
    ["#profile=0", "30d"],
  ]) {
    const app = loadApp(recent(), hash);

    app.evaluate("readHash()");
    assert.equal(app.evaluate("state.range"), range, hash);
  }
});

test("dashboard leaves the default range out of the link and keeps any other, all included", () => {
  const app = loadApp(recent());

  app.evaluate("readHash()");

  for (const [range, hash] of [
    ["30d", ""],
    ["all", "#range=all"],
    ["7d", "#range=7d"],
    ["30d", ""],
  ]) {
    app.evaluate(`state.range = '${range}'; writeHash()`);
    assert.equal(app.hash(), hash, range);
  }

  // The choice survives a reload of the link.
  app.evaluate("state.range = 'all'; writeHash()");

  const reloaded = loadApp(recent(), app.hash());

  reloaded.evaluate("readHash()");
  assert.equal(reloaded.evaluate("state.range"), "all");
});

test("dashboard writes 30 days to the link when the default is all history", () => {
  const app = loadApp(stale());

  app.evaluate("readHash()");

  for (const [range, hash] of [
    ["all", ""],
    ["30d", "#range=30d"],
  ]) {
    app.evaluate(`state.range = '${range}'; writeHash()`);
    assert.equal(app.hash(), hash, range);
  }
});

test("dashboard keeps other link settings when the range changes", () => {
  const app = loadApp(recent(), "#profile=0&theme=light");

  app.evaluate("readHash()");
  app.evaluate("state.range = 'all'; writeHash()");

  const params = new URLSearchParams(app.hash().slice(1));

  assert.equal(params.get("range"), "all");
  assert.equal(params.get("profile"), "0");
  assert.equal(params.get("theme"), "light");
});
