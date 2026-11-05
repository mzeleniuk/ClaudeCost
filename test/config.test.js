import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import {
  expandHome,
  defaultTranscriptDirs,
  resolveTranscriptDirs,
} from "../src/config.js";

test("expandHome expands ~ and ~/ paths", () => {
  const home = os.homedir();
  assert.equal(expandHome("~"), home);
  assert.equal(expandHome("~/projects"), path.join(home, "projects"));
  assert.equal(expandHome("/tmp/foo"), "/tmp/foo");
});

test("defaultTranscriptDirs is modern-first projects only", () => {
  const home = os.homedir();
  const dirs = defaultTranscriptDirs({});

  assert.deepEqual(dirs, [
    path.join(home, ".config", "claude", "projects"),
    path.join(home, ".claude", "projects"),
  ]);
  assert.ok(!dirs.some((d) => d === path.join(home, ".claude")));
});

test("resolveTranscriptDirs returns explicit --dir", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-dir-"));
  const dirs = resolveTranscriptDirs(root);
  assert.deepEqual(dirs, [root]);
});

test("resolveTranscriptDirs throws for missing --dir", () => {
  assert.throws(
    () => resolveTranscriptDirs("/nonexistent/claude-cost-path-xyz"),
    /transcript directory not found/,
  );
});

test("defaultTranscriptDirs uses only CLAUDE_CONFIG_DIR when it is set", () => {
  const home = os.homedir();

  assert.deepEqual(
    defaultTranscriptDirs({ CLAUDE_CONFIG_DIR: "/srv/claude" }),
    [path.join("/srv/claude", "projects")],
  );
  assert.deepEqual(
    defaultTranscriptDirs({ CLAUDE_CONFIG_DIR: "~/.claude-work" }),
    [path.join(home, ".claude-work", "projects")],
  );
  // An empty value is treated as unset
  assert.equal(defaultTranscriptDirs({ CLAUDE_CONFIG_DIR: " " }).length, 2);
});

test("resolveTranscriptDirs reads CLAUDE_CONFIG_DIR and names it when empty", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-config-"));
  const env = { CLAUDE_CONFIG_DIR: root };

  assert.throws(
    () => resolveTranscriptDirs(undefined, env),
    /could not locate Claude Code transcripts in CLAUDE_CONFIG_DIR \(/,
  );

  fs.mkdirSync(path.join(root, "projects"));
  assert.deepEqual(resolveTranscriptDirs(undefined, env), [
    path.join(root, "projects"),
  ]);
});
