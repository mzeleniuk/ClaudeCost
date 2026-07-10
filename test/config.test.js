import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { expandHome } from "../src/config.js";

test("expandHome expands ~ and ~/ paths", () => {
  const home = os.homedir();
  assert.equal(expandHome("~"), home);
  assert.equal(expandHome("~/projects"), path.join(home, "projects"));
  assert.equal(expandHome("/tmp/foo"), "/tmp/foo");
});
