import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  collectDashboard,
  locateTranscript,
} from "../src/dashboard/collect.js";
import {
  summarizeDashboard,
  summarizeTokens,
} from "../src/dashboard/output.js";
import { createProjectDecoder } from "../src/dashboard/projects.js";
import { renderDashboard, scriptSafeJson } from "../src/dashboard/render.js";

// Round prices so expected costs are easy to check by hand.
const PRICING = {
  "claude-test-a": {
    input: 1,
    output: 2,
    cacheWrite: 1.25,
    cacheWrite1h: 2,
    cacheRead: 0.1,
  },
  "claude-test-b": {
    input: 5,
    output: 10,
    cacheWrite: 6.25,
    cacheWrite1h: 10,
    cacheRead: 0.5,
  },
  "claude-region": {
    input: 0,
    output: 0,
    cacheWrite: 0,
    cacheWrite1h: 0,
    cacheRead: 0,
    _notInRegion: true,
  },
};

const M = 1_000_000;
const DIR = path.join(path.sep, "claude", "projects");

const usage = (input = 0, output = 0, cacheRead = 0, cacheWrite = 0) => ({
  input,
  output,
  cacheRead,
  cacheWrite,
  hasCacheBreakdown: false,
});

/** An event at a local time, in `project`, in a session file under DIR. */
function event(local, model, use, file, extra = {}) {
  return {
    ts: local && new Date(...local),
    model,
    usage: use,
    messageId: null,
    requestId: null,
    file: path.join(DIR, ...file),
    ...extra,
  };
}

const decodeProject = (folder) => ({ label: folder, folder, path: null });

/** @param {object[]} events */
function source(events, extra = {}) {
  return {
    name: "vertex",
    region: "global",
    pricingFile: "pricing.config.json",
    pricing: PRICING,
    dirs: [DIR],
    events,
    ...extra,
  };
}

// Local time, so its calendar day is the same in every time zone.
const NOW = new Date(2026, 2, 13, 8, 0);

/** One fact row as an object, for readable assertions. */
function row(data, i) {
  return Object.fromEntries(
    Object.entries(data.facts).map(([key, values]) => [key, values[i]]),
  );
}

const events = [
  // bar is seen first but costs the least.
  event([2026, 2, 10, 9, 30], "claude-test-a", usage(M / 10), [
    "bar",
    "s2.jsonl",
  ]),
  event([2026, 2, 10, 9, 45], "claude-test-a", usage(M), ["foo", "s1.jsonl"]),
  event([2026, 2, 10, 9, 50], "claude-test-a", usage(0, M, 2 * M, M), [
    "foo",
    "s1.jsonl",
  ]),
  // A subagent of s1, two days later. Day 2026-03-11 has no usage.
  event([2026, 2, 12, 14, 0], "claude-test-b", usage(M), [
    "foo",
    "s1",
    "subagents",
    "agent-x.jsonl",
  ]),
];

test("sums facts per day, hour, model, project and agent kind", () => {
  const data = collectDashboard([source(events)], {
    now: NOW,
    decodeProject,
  });

  assert.equal(data.version, 1);
  assert.equal(data.generatedAt, NOW.toISOString());
  assert.equal(data.since, null);
  assert.equal(data.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.deepEqual(data.profiles, [
    { name: "vertex", region: "global", pricingFile: "pricing.config.json" },
  ]);

  // Models and projects are ordered by cost, highest first.
  assert.deepEqual(data.models, ["claude-test-b", "claude-test-a"]);
  assert.deepEqual(
    data.projects.map((p) => p.folder),
    ["foo", "bar"],
  );

  const length = data.facts.day.length;
  assert.equal(length, 3);

  for (const values of Object.values(data.facts)) {
    assert.equal(values.length, length);
  }

  // 03-10 09:00, foo, model a: two messages summed.
  //   1M input = $1. 1M output + 2M cache read + 1M cache write = $2 + $0.2 + $1.25.
  //   Uncached: 1M input, then 1M output + 3M input = $1 + $2 + $3.
  assert.deepEqual(row(data, 0), {
    day: 0,
    hour: 9,
    profile: 0,
    model: 1,
    project: 0,
    subagent: 0,
    input: M,
    output: M,
    cacheWrite: M,
    cacheRead: 2 * M,
    cost: 4.45,
    costInput: 1,
    costOutput: 2,
    costCacheWrite: 1.25,
    costCacheRead: 0.2,
    uncachedCost: 6,
    messages: 2,
  });

  // 03-10 09:00, bar, model a: $0.10.
  assert.deepEqual(row(data, 1), {
    day: 0,
    hour: 9,
    profile: 0,
    model: 1,
    project: 1,
    subagent: 0,
    input: M / 10,
    output: 0,
    cacheWrite: 0,
    cacheRead: 0,
    cost: 0.1,
    costInput: 0.1,
    costOutput: 0,
    costCacheWrite: 0,
    costCacheRead: 0,
    uncachedCost: 0.1,
    messages: 1,
  });

  // 03-12 14:00, foo subagent, model b: $5.
  assert.deepEqual(row(data, 2), {
    day: 2,
    hour: 14,
    profile: 0,
    model: 0,
    project: 0,
    subagent: 1,
    input: M,
    output: 0,
    cacheWrite: 0,
    cacheRead: 0,
    cost: 5,
    costInput: 5,
    costOutput: 0,
    costCacheWrite: 0,
    costCacheRead: 0,
    uncachedCost: 5,
    messages: 1,
  });
});

test("fills days without usage between the first day and today", () => {
  const data = collectDashboard([source(events)], { now: NOW, decodeProject });

  // The last usage is 03-12 and NOW is 03-13, so the last day is idle.
  assert.deepEqual(data.days, [
    "2026-03-10",
    "2026-03-11",
    "2026-03-12",
    "2026-03-13",
  ]);
});

test("ends days at the last usage when it is ahead of now by under a day", () => {
  const data = collectDashboard([source(events)], {
    now: new Date(2026, 2, 12, 1, 0),
    decodeProject,
  });

  assert.equal(data.days.at(-1), "2026-03-12");
});

test("leaves out timestamps before 2023 or over a day ahead", () => {
  const early = event([1970, 0, 1, 0, 0], "claude-test-a", usage(M), [
    "foo",
    "old.jsonl",
  ]);
  const late = event([2026, 2, 20, 9, 0], "claude-test-a", usage(M), [
    "foo",
    "future.jsonl",
  ]);
  const data = collectDashboard([source([...events, early, late])], {
    now: NOW,
    decodeProject,
  });

  assert.equal(data.days[0], "2026-03-10");
  assert.equal(data.days.length, 4);
  assert.equal(data.warnings.skippedUndated, 2);
});

test("fills days across a month and year end", () => {
  const data = collectDashboard(
    [
      source([
        event([2025, 11, 30, 23, 0], "claude-test-a", usage(1), [
          "p",
          "a.jsonl",
        ]),
        event([2026, 0, 2, 1, 0], "claude-test-a", usage(1), ["p", "b.jsonl"]),
      ]),
    ],
    { now: new Date(2026, 0, 2, 12, 0), decodeProject },
  );

  assert.deepEqual(data.days, [
    "2025-12-30",
    "2025-12-31",
    "2026-01-01",
    "2026-01-02",
  ]);
});

test("a session spans its main and subagent transcripts", () => {
  const { sessions } = collectDashboard([source(events)], {
    now: NOW,
    decodeProject,
  });

  // s1 runs from day 0 to day 2 through its subagent. s2 is one day.
  assert.deepEqual(sessions, {
    profile: [0, 0],
    project: [1, 0],
    firstDay: [0, 0],
    lastDay: [0, 2],
  });
});

test("the same session id in two profiles is two sessions", () => {
  const second = source(
    [
      event([2026, 2, 10, 9, 0], "claude-test-a", usage(M), [
        "foo",
        "s1.jsonl",
      ]),
    ],
    { name: "work", region: "us" },
  );
  const data = collectDashboard([source(events), second], {
    now: NOW,
    decodeProject,
  });

  assert.equal(data.profiles[1].region, "us");
  assert.equal(data.sessions.profile.length, 3);
  assert.deepEqual(
    data.projects.map((p) => p.folder),
    ["foo", "bar"],
  );
  assert.ok(data.facts.profile.includes(1));
});

test("since drops older and undated events", () => {
  const data = collectDashboard([source(events)], {
    since: new Date(2026, 2, 12),
    now: NOW,
    decodeProject,
  });

  assert.equal(data.since, new Date(2026, 2, 12).toISOString());
  assert.deepEqual(data.days, ["2026-03-12", "2026-03-13"]);
  assert.deepEqual(data.models, ["claude-test-b"]);
  assert.deepEqual(data.facts.messages, [1]);
  assert.deepEqual(data.sessions.firstDay, [0]);
  assert.equal(data.warnings.skippedUndated, 0);
});

test("counts undated events without since and leaves them out of facts", () => {
  const undated = event(null, "claude-test-a", usage(M), ["foo", "s1.jsonl"]);
  const data = collectDashboard([source([...events, undated])], {
    now: NOW,
    decodeProject,
  });

  assert.equal(data.warnings.skippedUndated, 1);
  assert.equal(
    data.facts.messages.reduce((a, b) => a + b, 0),
    4,
  );
});

test("an undated event does not count with since", () => {
  const undated = event(null, "claude-test-a", usage(M), ["foo", "s1.jsonl"]);
  const data = collectDashboard([source([undated])], {
    since: new Date(2026, 0, 1),
    now: NOW,
    decodeProject,
  });

  assert.equal(data.warnings.skippedUndated, 0);
  assert.deepEqual(data.days, []);
  assert.deepEqual(data.facts.day, []);
});

test("returns empty arrays when there are no events", () => {
  const data = collectDashboard([source([])], { now: NOW, decodeProject });

  assert.deepEqual(data.days, []);
  assert.deepEqual(data.models, []);
  assert.deepEqual(data.sessions.profile, []);
});

test("collects warnings across sources", () => {
  const archived = (name, file) =>
    event([2026, 2, 10, 9, 0], name, usage(M), file, { archived: true });

  const data = collectDashboard(
    [
      source([
        archived("claude-mystery", ["foo", "gone.jsonl"]),
        archived("claude-mystery", ["foo", "gone.jsonl"]),
        archived("claude-region", ["foo", "old.jsonl"]),
        event([2026, 2, 10, 9, 0], "unknown", usage(M), ["foo", "s.jsonl"]),
        event([2026, 2, 10, 9, 0], "", usage(M), ["foo", "s.jsonl"]),
      ]),
      source(
        [
          archived("claude-mystery", ["foo", "gone.jsonl"]),
          event([2026, 2, 10, 9, 0], "claude-other", usage(M), [
            "foo",
            "t.jsonl",
          ]),
        ],
        { name: "work" },
      ),
    ],
    { now: NOW, decodeProject },
  );

  assert.deepEqual(data.warnings, {
    unknownModels: ["claude-mystery", "claude-other"],
    notInRegion: ["claude-region"],
    // gone.jsonl once per source, and old.jsonl.
    archivedTranscripts: 3,
    skippedUndated: 0,
  });
});

test("rounds costs to 6 decimals", () => {
  const data = collectDashboard(
    [
      source([
        event([2026, 2, 10, 9, 0], "claude-test-a", usage(0, 0, 1), [
          "p",
          "a.jsonl",
        ]),
      ]),
    ],
    { now: NOW, decodeProject },
  );

  assert.equal(data.facts.cost[0], 0);
  assert.equal(data.facts.uncachedCost[0], 0.000001);

  const third = collectDashboard(
    [
      source([
        event([2026, 2, 10, 9, 0], "claude-test-a", usage(333_333), [
          "p",
          "a.jsonl",
        ]),
      ]),
    ],
    { now: NOW, decodeProject },
  );

  assert.equal(third.facts.cost[0], 0.333333);
});

test("locateTranscript reads project, session and agent kind from the path", () => {
  const at = (...parts) => locateTranscript([DIR], path.join(DIR, ...parts));

  assert.deepEqual(at("-Users-me-foo", "abc.jsonl"), {
    folder: "-Users-me-foo",
    session: "abc",
    subagent: 0,
  });
  assert.deepEqual(at("-Users-me-foo", "abc", "subagents", "agent-1.jsonl"), {
    folder: "-Users-me-foo",
    session: "abc",
    subagent: 1,
  });
  assert.equal(
    locateTranscript(["/other", DIR], path.join(DIR, "p", "s.jsonl")).folder,
    "p",
  );
});

test("locateTranscript treats a single project folder as the project", () => {
  const project = path.join(DIR, "-Users-me-foo");
  const at = (...parts) =>
    locateTranscript([project], path.join(project, ...parts));

  assert.deepEqual(at("abc.jsonl"), {
    folder: "-Users-me-foo",
    session: "abc",
    subagent: 0,
  });
  assert.deepEqual(at("abc", "subagents", "agent-1.jsonl"), {
    folder: "-Users-me-foo",
    session: "abc",
    subagent: 1,
  });
});

/** A fake file system as a map from directory to its sub-directories. */
function fakeDirs(tree) {
  const calls = [];
  const listDirs = (dir) => {
    calls.push(dir);
    return tree[dir] ?? [];
  };

  return { listDirs, calls };
}

const TREE = {
  "/": ["Users", "opt"],
  "/Users": ["me"],
  "/Users/me": ["library", ".claude", "a-b", "a"],
  "/Users/me/library": ["npm-vue-components", "npm"],
  "/Users/me/library/npm": ["vue"],
  "/Users/me/a": ["b-c"],
};

test("decodes a folder name with hyphens in a directory name", () => {
  const { listDirs } = fakeDirs(TREE);
  const decode = createProjectDecoder({ listDirs, home: "/Users/me" });

  assert.deepEqual(decode("-Users-me-library-npm-vue-components"), {
    label: "npm-vue-components",
    folder: "-Users-me-library-npm-vue-components",
    path: "/Users/me/library/npm-vue-components",
  });
  assert.equal(
    decode("-Users-me-library-npm-vue").path,
    "/Users/me/library/npm/vue",
  );
});

test("decodes a Windows folder name from its drive letter", () => {
  // path.join follows the host, so compare with the separators unified.
  const unify = (/** @type {string} */ p) => p.replace(/[\\/]+/g, "\\");
  const tree = {
    "C:\\": ["Users"],
    "C:\\Users": ["me"],
    "C:\\Users\\me": ["my-app"],
  };
  const decode = createProjectDecoder({
    listDirs: (dir) => tree[unify(dir)] ?? [],
    home: "/Users/me",
  });
  const project = decode("C--Users-me-my-app");

  assert.equal(project.label, "my-app");
  assert.equal(unify(project.path ?? ""), "C:\\Users\\me\\my-app");
});

test("lists each directory once across project folders", () => {
  const { listDirs, calls } = fakeDirs(TREE);
  const decode = createProjectDecoder({ listDirs, home: "/Users/me" });

  decode("-Users-me-library-npm-vue");
  decode("-Users-me-library-npm-vue-components");
  decode("-Users-me-a-b-c");

  assert.equal(calls.filter((dir) => dir === "/").length, 1);
  assert.equal(calls.filter((dir) => dir === "/Users/me").length, 1);
});

test("backs up when the longest directory name dead-ends", () => {
  const { listDirs } = fakeDirs(TREE);
  const decode = createProjectDecoder({ listDirs, home: "/Users/me" });

  assert.equal(decode("-Users-me-a-b-c").path, "/Users/me/a/b-c");
});

test("decodes a dot directory", () => {
  const { listDirs } = fakeDirs(TREE);
  const decode = createProjectDecoder({ listDirs, home: "/Users/me" });

  assert.deepEqual(decode("-Users-me--claude"), {
    label: ".claude",
    folder: "-Users-me--claude",
    path: "/Users/me/.claude",
  });
});

test("falls back to the folder name without the home prefix", () => {
  const { listDirs } = fakeDirs(TREE);
  const decode = createProjectDecoder({ listDirs, home: "/Users/me" });

  assert.deepEqual(decode("-Users-me-Dev-gone"), {
    label: "Dev-gone",
    folder: "-Users-me-Dev-gone",
    path: null,
  });
  assert.deepEqual(decode("-opt-thing"), {
    label: "-opt-thing",
    folder: "-opt-thing",
    path: null,
  });
});

test("labels the home folder ~", () => {
  const { listDirs } = fakeDirs(TREE);
  const decode = createProjectDecoder({ listDirs, home: "/Users/me" });

  assert.deepEqual(decode("-Users-me"), {
    label: "~",
    folder: "-Users-me",
    path: "/Users/me",
  });
});

test("decodes each folder once", () => {
  const { listDirs, calls } = fakeDirs(TREE);
  const decode = createProjectDecoder({ listDirs, home: "/Users/me" });

  decode("-Users-me-library-npm-vue-components");
  const first = calls.length;
  decode("-Users-me-library-npm-vue-components");

  assert.ok(first > 0);
  assert.equal(calls.length, first);
});

test("decodes against the real file system", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-proj-"));
  const real = fs.realpathSync(root);
  const dir = path.join(real, "my-app");
  fs.mkdirSync(dir);

  const folder = dir.replace(/[^a-zA-Z0-9]/g, "-");
  const decode = createProjectDecoder({ home: "/nowhere" });

  assert.deepEqual(decode(folder), { label: "my-app", folder, path: dir });
});

test("scriptSafeJson escapes closing tags and line separators", () => {
  const json = scriptSafeJson({ a: "</script><!--", b: "x\u2028y\u2029z" });

  assert.ok(!json.includes("</script"));
  assert.ok(!json.includes("<"));
  assert.ok(!json.includes("\u2028"));
  assert.ok(!json.includes("\u2029"));
  assert.deepEqual(JSON.parse(json), {
    a: "</script><!--",
    b: "x\u2028y\u2029z",
  });
});

/** A folder with a tiny template that has each marker once. */
function templateDir({ template, css = "body{}", app = "run();" }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-tpl-"));

  fs.writeFileSync(path.join(dir, "template.html"), template);
  fs.writeFileSync(path.join(dir, "styles.css"), css);
  fs.writeFileSync(path.join(dir, "app.js"), app);

  return dir;
}

const TEMPLATE =
  "<style>/*__STYLES__*/</style><script>/*__APP__*/</script>" +
  "<script>const data = __DATA__;</script>";

test("renderDashboard inlines styles, script and data", () => {
  const dir = templateDir({ template: TEMPLATE });
  const data = collectDashboard([source(events)], { now: NOW, decodeProject });
  const html = renderDashboard(data, { dir });

  assert.ok(html.includes("<style>body{}</style>"));
  assert.ok(html.includes("<script>run();</script>"));
  assert.ok(html.includes(`const data = ${scriptSafeJson(data)};`));
  assert.ok(html.includes('"version":1'));
});

test("renderDashboard keeps $ patterns and marker text in the inlined parts", () => {
  const dir = templateDir({
    template: TEMPLATE,
    css: "a::after{content:'$&'}",
    app: "const s = '$` $\\' __DATA__ </script>';",
  });
  const html = renderDashboard({ note: "cost $& and $1 </script>" }, { dir });

  assert.ok(html.includes("content:'$&'"));
  assert.ok(html.includes('"cost $& and $1 \\u003c/script>"'));
  assert.ok(html.includes("const s = '$` $\\' __DATA__ <\\/script>';"));
  assert.equal(html.split("</script>").length, 3);
});

test("renderDashboard inlines the favicons from the real template", () => {
  const data = collectDashboard([source(events)], { now: NOW, decodeProject });
  const html = renderDashboard(data);

  assert.ok(!html.includes("__ICON_"));
  assert.equal(
    html.match(/<link rel="icon" [^>]*href="data:image\/png;base64,/g)?.length,
    2,
  );
  assert.match(
    html,
    /<link rel="apple-touch-icon" sizes="180x180" href="data:image\/png;base64,/,
  );
});

test("renderDashboard throws when a marker is missing or repeated", () => {
  const missing = templateDir({
    template: "<style>/*__STYLES__*/</style><script>/*__APP__*/</script>",
  });

  assert.throws(
    () => renderDashboard({}, { dir: missing }),
    /must contain __DATA__ exactly once/,
  );

  const twice = templateDir({ template: `${TEMPLATE}__DATA__` });

  assert.throws(
    () => renderDashboard({}, { dir: twice }),
    /must contain __DATA__ exactly once/,
  );
});

test("summarizeDashboard prints total, sessions and date range", () => {
  const data = collectDashboard([source(events)], { now: NOW, decodeProject });

  assert.equal(
    summarizeDashboard(data),
    "$9.55 across 2 sessions, Mar 10 to Mar 12",
  );
  assert.equal(
    summarizeDashboard({
      days: ["2025-12-30", "2026-01-02"],
      facts: { cost: [1883.7249, 1000], day: [0, 1] },
      sessions: { profile: [0] },
    }),
    "$2,883.72 across 1 session, Dec 30, 2025 to Jan 2, 2026",
  );
  // Idle days after the last usage are not part of the span.
  assert.equal(
    summarizeDashboard({
      days: ["2026-03-10", "2026-03-11", "2026-03-12"],
      facts: { cost: [2, 3], day: [0, 1] },
      sessions: { profile: [0] },
    }),
    "$5.00 across 1 session, Mar 10 to Mar 11",
  );
  assert.equal(
    summarizeDashboard(
      collectDashboard([source([])], { now: NOW, decodeProject }),
    ),
    "$0.00 across 0 sessions",
  );
});

test("summarizeTokens totals each kind of token and the messages", () => {
  const data = collectDashboard([source(events)], { now: NOW, decodeProject });

  // input 0.1M + 1M + 0 + 1M, output 1M, cache read 2M, cache write 1M.
  assert.equal(
    summarizeTokens(data),
    "2.1M input, 1M output, 2M cache read, 1M cache write, 4 messages",
  );
  assert.equal(
    summarizeTokens({ facts: { ...data.facts, messages: [1] } }).endsWith(
      "1 message",
    ),
    true,
  );
  assert.equal(
    summarizeTokens(
      collectDashboard([source([])], { now: NOW, decodeProject }),
    ),
    null,
  );
});

test("labels folders from deleted temp directories without the temp prefix", () => {
  const decode = createProjectDecoder({
    listDirs: () => [],
    home: "/Users/me",
  });
  const mac =
    "-private-var-folders--h-18swk2c916d1t9ycmjjg7cp80000gn-T-t3code-claude-title-IUQTwb";

  assert.equal(decode(mac).label, "t3code-claude-title-IUQTwb");
  assert.equal(decode(mac).folder, mac);
  assert.equal(decode(mac).path, null);
  assert.equal(decode("-private-tmp-cc-skill-test").label, "cc-skill-test");
  assert.equal(decode("-tmp-scratch").label, "scratch");
  // A folder that only looks like one is left alone.
  assert.equal(decode("-Users-me-tmp-app").label, "tmp-app");
});

test("project decoding gives up on symlink loops instead of hanging", () => {
  // Every directory holds "a", "a-a" and "a-a-a", like links back to itself.
  const decode = createProjectDecoder({
    listDirs: () => ["a", "a-a", "a-a-a"],
    home: "/nowhere",
  });
  const folder = `-${"a-".repeat(40)}x`;
  const started = Date.now();
  const project = decode(folder);

  assert.equal(project.path, null);
  assert.equal(project.folder, folder);
  assert.ok(Date.now() - started < 2000);
});
