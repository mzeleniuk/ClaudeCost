import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { collectDashboard } from "../src/dashboard/collect.js";
import { summarizeDashboard } from "../src/dashboard/output.js";
import { readEvents } from "../src/events.js";

const PRICING = {
  "claude-test-a": {
    input: 1,
    output: 2,
    cacheWrite: 1.25,
    cacheWrite1h: 2,
    cacheRead: 0.1,
  },
};

const M = 1_000_000;
const NOW = new Date("2026-11-01T12:00:00.000Z");
const decodeProject = (folder) => ({ label: folder, folder, path: null });

/** A projects directory, a store directory and helpers to build a dashboard. */
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-dash-"));
  const projects = path.join(root, "projects");
  const storeDir = path.join(root, "data");

  /** Write a transcript with one message at `input` tokens. */
  const write = (parts, id, input) => {
    const file = path.join(projects, ...parts);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      `${JSON.stringify({
        timestamp: "2026-10-01T12:00:00.000Z",
        requestId: `req-${id}`,
        message: {
          id,
          model: "claude-test-a",
          usage: { input_tokens: input },
        },
      })}\n`,
    );
    return file;
  };

  /** What `claude-cost --dashboard` builds for this directory. */
  const build = async (
    store = { storeDir, rebuild: false },
    pricing = PRICING,
  ) =>
    collectDashboard(
      [
        {
          name: "default",
          region: "global",
          pricingFile: "pricing.config.json",
          pricing,
          dirs: [projects],
          events: await readEvents([projects], store),
        },
      ],
      { now: NOW, decodeProject },
    );

  return { root, projects, storeDir, write, build };
}

const total = (data) => data.facts.cost.reduce((sum, cost) => sum + cost, 0);

test("a deleted transcript stays in the dashboard through the store", async (t) => {
  const s = setup();
  t.after(() => fs.rmSync(s.root, { recursive: true, force: true }));

  s.write(["foo", "s1.jsonl"], "m1", M);
  const gone = s.write(["foo", "s2.jsonl"], "m2", 2 * M);
  s.write(["foo", "s2", "subagents", "agent-x.jsonl"], "m3", 4 * M);

  const before = await s.build();

  assert.equal(total(before), 7);
  assert.equal(before.sessions.profile.length, 2);
  assert.equal(before.warnings.archivedTranscripts, 0);

  fs.rmSync(gone);
  fs.rmSync(path.join(s.projects, "foo", "s2"), { recursive: true });

  const after = await s.build();

  assert.equal(total(after), 7);
  assert.equal(after.sessions.profile.length, 2);
  assert.deepEqual(
    after.projects.map((p) => p.folder),
    ["foo"],
  );
  assert.equal(after.warnings.archivedTranscripts, 2);
  // The archived subagent transcript still counts as a subagent.
  assert.equal(
    after.facts.subagent.reduce((sum, flag) => sum + flag, 0),
    1,
  );
  assert.equal(summarizeDashboard(after), summarizeDashboard(before));
});

test("--no-cache leaves a deleted transcript out of the dashboard", async (t) => {
  const s = setup();
  t.after(() => fs.rmSync(s.root, { recursive: true, force: true }));

  s.write(["foo", "s1.jsonl"], "m1", M);
  const gone = s.write(["foo", "s2.jsonl"], "m2", 2 * M);

  await s.build();
  fs.rmSync(gone);

  const uncached = await s.build({ storeDir: null, rebuild: false });

  assert.equal(total(uncached), 1);
  assert.equal(uncached.warnings.archivedTranscripts, 0);
  // The store was not touched, so the next cached run still has it.
  assert.equal(total(await s.build()), 3);
});

test("--rebuild-cache keeps a deleted transcript in the dashboard", async (t) => {
  const s = setup();
  t.after(() => fs.rmSync(s.root, { recursive: true, force: true }));

  s.write(["foo", "s1.jsonl"], "m1", M);
  const gone = s.write(["foo", "s2.jsonl"], "m2", 2 * M);

  await s.build();
  fs.rmSync(gone);

  const rebuilt = await s.build({ storeDir: s.storeDir, rebuild: true });

  assert.equal(total(rebuilt), 3);
  assert.equal(rebuilt.warnings.archivedTranscripts, 1);
});

test("a changed price applies to stored usage without a rebuild", async (t) => {
  const s = setup();
  t.after(() => fs.rmSync(s.root, { recursive: true, force: true }));

  s.write(["foo", "s1.jsonl"], "m1", M);
  assert.equal(total(await s.build()), 1);

  const dearer = { "claude-test-a": { ...PRICING["claude-test-a"], input: 3 } };

  assert.equal(total(await s.build(undefined, dearer)), 3);
});
