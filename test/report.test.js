import { test } from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";

import { fmtTokens, fmtUSD } from "../src/report/format.js";
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
    /Add them to pricing\.config\.json/,
  );
  assert.match(
    warningLines(result, { pricingFile: "./pricing.work.json" }).join("\n"),
    /Add them to \.\/pricing\.work\.json/,
  );
});

test("not-in-region warning names the endpoint", () => {
  const lines = warningLines(
    { unknownModels: [], notInRegion: ["claude-opus-5-5"] },
    { region: "us-east5" },
  );

  const text = stripVTControlCharacters(lines.join("\n"));

  assert.match(text, /Not offered at the us-east5 endpoint/);
  assert.match(text, /^ {7}claude-opus-5-5$/m);
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

test("fmtUSD and fmtTokens keep figures short", () => {
  assert.equal(fmtUSD(36.9372), "$36.94");
  assert.equal(fmtUSD(0), "$0.00");
  assert.equal(fmtUSD(0.0031), "<$0.01");
  assert.equal(fmtTokens(950), "950");
  assert.equal(fmtTokens(2_474), "2.5k");
  assert.equal(fmtTokens(88_077_238), "88.1M");
});

const plain = (text) => stripVTControlCharacters(text);

test("renderTable returns the totals table and footer", () => {
  const text = plain(
    renderTable(
      { ...summary(totals(1_234_567, 1.5, 3)), groups: new Map() },
      { byModel: false, since: new Date(2025, 0, 15) },
    ),
  );

  assert.match(text, /^⏺ Claude Code usage$/m);
  assert.match(text, /^ {2}⎿ {2}Since 2025-01-15 00:00:00 local$/m);
  assert.match(text, /^ {5}all models +1\.2M .* 3 +\$1\.50$/m);
  assert.ok(text.endsWith(RECONCILE_NOTE));
});

test("renderTable says when there is no activity", () => {
  const text = plain(
    renderTable(
      { ...summary(totals(0, 0, 0)), groups: new Map() },
      { byModel: true, since: null },
    ),
  );

  assert.match(text, /^ {2}⎿ {2}All history$/m);
  assert.match(text, /No activity in this period\./);
  assert.ok(!text.includes("model "));
});

test("renderTable lists models by cost with share bars and can skip the note", () => {
  const text = plain(
    renderTable(
      {
        ...summary(totals(3, 0.3, 2)),
        groups: new Map([
          ["claude-opus-5-5", totals(1, 0.1)],
          ["claude-haiku-5-5", totals(2, 0.2)],
        ]),
      },
      {
        byModel: true,
        since: null,
        title: "work",
        subtitle: "~/.work",
        showNote: false,
      },
    ),
  );

  assert.ok(text.startsWith("\n⏺ work ~/.work\n"));
  assert.ok(text.indexOf("claude-haiku-5-5") < text.indexOf("claude-opus-5-5"));
  assert.match(text, /^ {5}claude-haiku-5-5 .* \$0\.20 {2}█████▍$/m);
  assert.match(text, /^ {5}claude-opus-5-5 .* \$0\.10 {2}██▋$/m);
  assert.match(text, /^ {5}─+$/m);
  assert.match(text, /^ {5}total .* 2 +\$0\.30$/m);
  assert.ok(!text.includes(RECONCILE_NOTE));
});

test("renderMonthlyTable prints months in order with their totals", () => {
  const month = (cost) => ({
    models: new Map([["claude-opus-5-5", totals(1, cost)]]),
    total: totals(1, cost),
  });
  const text = plain(
    renderMonthlyTable(
      {
        ...summary(totals(2, 3, 2)),
        months: new Map([
          ["2025-02", month(2)],
          ["2025-01", month(1)],
        ]),
        skippedUndated: 4,
      },
      { since: null, region: "eu" },
    ),
  );

  assert.ok(text.indexOf("January 2025") < text.indexOf("February 2025"));
  assert.match(text, /^ {5}January 2025 +input +output/m);
  assert.match(text, /^ {5}total .* 1 +\$1\.00$/m);
  assert.match(
    text,
    /^ {2}⎿ {2}All history, region eu \(\+10% over global\)$/m,
  );
  assert.match(text, /^ {5}All months {2}\$3\.00 {2}2 messages$/m);
  assert.match(text, /^ {5}Skipped 4 message\(s\) without a timestamp/m);
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

  const text = plain(renderProfileReports(reports, { ...opts, json: false }));
  assert.match(text, /^⏺ a ~\/\.a$/m);
  assert.match(text, /^⏺ b ~\/\.b$/m);
  assert.match(text, /^⏺ All profiles$/m);
  assert.match(text, /^ {2}⎿ {2}profile +msgs +cost$/m);
  assert.match(text, /^ {5}b +1 +\$2\.00 {2}█+▍$/m);
  assert.match(text, /^ {5}total +2 +\$3\.00$/m);
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
