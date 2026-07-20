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
  const dirs = defaultTranscriptDirs();
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
