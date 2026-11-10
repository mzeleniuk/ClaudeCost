import { test } from "node:test";
import assert from "node:assert/strict";

import { renderJson } from "../src/report/json.js";
import { renderMonthlyTable } from "../src/report/monthlyTable.js";
import { renderProfileReports } from "../src/report/profiles.js";
import {
  RECONCILE_NOTE,
  renderTable,
  warningLines,
} from "../src/report/table.js";

test("unknown-model warning names the pricing file in use", () => {
  const result = { unknownModels: ["claude-opus-9"], notInRegion: [] };

  assert.match(
    warningLines(result).join("\n"),
    /add them to pricing\.config\.json/,
  );
  assert.match(
    warningLines(result, { pricingFile: "./pricing.work.json" }).join("\n"),
    /add them to \.\/pricing\.work\.json/,
  );
});

test("not-in-region warning names the endpoint", () => {
  const lines = warningLines(
    { unknownModels: [], notInRegion: ["claude-opus-5-5"] },
    { region: "us-east5" },
  );

  assert.match(lines.join("\n"), /Not offered at the us-east5 endpoint/);
  assert.ok(lines.includes("   - claude-opus-5-5"));
});

const totals = (inputTokens, costUSD, messages = 1) => ({
  inputTokens,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  costUSD,
  messages,
});

const summary = (total) => ({ notInRegion: [], total, unknownModels: [] });

test("renderTable returns the totals table and footer", () => {
  const text = renderTable(
    { ...summary(totals(1_234_567, 1.5, 3)), groups: new Map() },
    { byModel: false, since: new Date(2025, 0, 15) },
  );

  assert.match(text, /│ input +│ '1,234,567' │/);
  assert.match(text, /^Since: {2}2025-01-15 00:00:00 \(local\)$/m);
  assert.match(text, /^Total estimated cost: \$1\.5000 {2}\(3 messages\)$/m);
  assert.ok(text.endsWith(RECONCILE_NOTE));
});

test("renderTable lists one row per model and can skip the note", () => {
  const text = renderTable(
    {
      ...summary(totals(3, 0.3, 2)),
      groups: new Map([
        ["claude-opus-5-5", totals(1, 0.1)],
        ["claude-haiku-5-5", totals(2, 0.2)],
      ]),
    },
    { byModel: true, since: null, title: "work", showNote: false },
  );

  assert.ok(text.startsWith("\n======== work ========\n┌"));
  assert.match(text, /│ claude-opus-5-5 +│/);
  assert.match(text, /│ claude-haiku-5-5 +│/);
  assert.ok(!text.includes(RECONCILE_NOTE));
});

test("renderMonthlyTable prints months in order with their totals", () => {
  const month = (cost) => ({
    models: new Map([["claude-opus-5-5", totals(1, cost)]]),
    total: totals(1, cost),
  });
  const text = renderMonthlyTable(
    {
      ...summary(totals(2, 3, 2)),
      months: new Map([
        ["2025-02", month(2)],
        ["2025-01", month(1)],
      ]),
      skippedUndated: 4,
    },
    { since: null, region: "eu" },
  );

  assert.ok(text.indexOf("=== 2025-01") < text.indexOf("=== 2025-02"));
  assert.match(text, /^Month total: \$1\.0000 \(1 messages\)$/m);
  assert.match(text, /^Region: eu \(\+10% over global\)$/m);
  assert.match(text, /^Grand total: \$3\.0000 {2}\(2 messages\)$/m);
  assert.match(text, /^Skipped 4 message\(s\) without a timestamp/m);
});

test("renderJson rounds costs and adds byModel only when grouped", () => {
  const result = {
    ...summary(totals(1, 0.123_456_789)),
    groups: new Map([["claude-opus-5-5", totals(1, 0.123_456_789)]]),
  };
  const flat = JSON.parse(renderJson(result, { byModel: false, since: null }));
  const grouped = JSON.parse(
    renderJson(result, { byModel: true, since: null, region: "us" }),
  );

  assert.equal(flat.groupedBy, "none");
  assert.equal(flat.total.costUSD, 0.123457);
  assert.equal("byModel" in flat, false);
  assert.equal(grouped.region, "us");
  assert.equal(grouped.byModel["claude-opus-5-5"].costUSD, 0.123457);
});

test("renderProfileReports adds an all-profiles total", () => {
  const report = (name, cost) => ({
    profile: { name, configuredDir: `~/.${name}`, dir: `/home/${name}` },
    region: "global",
    pricingFile: "pricing.config.json",
    result: { ...summary(totals(1, cost)), groups: new Map() },
  });
  const reports = [report("a", 1), report("b", 2)];
  const opts = { byModel: false, byMonth: false, since: null };

  const text = renderProfileReports(reports, { ...opts, json: false });
  assert.match(text, /^======== a \(~\/\.a\) ========$/m);
  assert.match(text, /^======== b \(~\/\.b\) ========$/m);
  assert.match(text, /^All profiles: \$3\.0000 {2}\(2 messages\)$/m);
  assert.equal(text.split(RECONCILE_NOTE).length, 2, "note printed once");

  const json = JSON.parse(
    renderProfileReports(reports, { ...opts, json: true }),
  );
  assert.deepEqual(
    json.profiles.map((p) => [p.name, p.dir]),
    [
      ["a", "/home/a"],
      ["b", "/home/b"],
    ],
  );
  assert.equal(json.total.costUSD, 3);
});
