import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadSettings } from "../src/settings.ts";
import { DEFAULT_STORE_DIR } from "../src/store.ts";

function writeSettings(body: unknown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-settings-"));
  const file = path.join(dir, "settings.config.json");

  fs.writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body));
  return file;
}

test("loadSettings defaults to the global region when the file is missing", () => {
  const missing = path.join(os.tmpdir(), `claude-cost-missing-settings-${process.pid}.json`);

  assert.deepEqual(loadSettings(missing), {
    budget: null,
    region: "global",
    storeDir: DEFAULT_STORE_DIR,
  });
});

test("loadSettings reads region and ignores _ comments", () => {
  const file = writeSettings({ _comment: "work account", region: "eu" });
  assert.deepEqual(loadSettings(file), {
    budget: null,
    region: "eu",
    storeDir: DEFAULT_STORE_DIR,
  });
});

test("loadSettings resolves storeDir against the settings file", () => {
  const file = writeSettings({ storeDir: "./usage" });
  assert.equal(loadSettings(file).storeDir, path.join(path.dirname(file), "usage"));

  const home = writeSettings({ storeDir: "~/claude-cost-data" });
  assert.equal(loadSettings(home).storeDir, path.join(os.homedir(), "claude-cost-data"));
  assert.throws(() => loadSettings(writeSettings({ storeDir: " " })), /invalid storeDir .*expected a non-empty string/);
});

test("loadSettings rejects unknown regions, unknown keys and bad JSON", () => {
  assert.throws(() => loadSettings(writeSettings({ region: "us-central1" })), /unknown region "us-central1"/);
  assert.throws(() => loadSettings(writeSettings({ regoin: "us" })), /unknown setting "regoin"/);
  assert.throws(() => loadSettings(writeSettings({ region: 1 })), /invalid region .*expected a string/);
  assert.throws(() => loadSettings(writeSettings("{ nope")), /invalid settings file \(expected JSON\)/);
});

test("loadSettings reads a monthly budget", () => {
  assert.equal(loadSettings(writeSettings({ budget: 200 })).budget, 200);
  assert.equal(loadSettings(writeSettings({ budget: 12.5 })).budget, 12.5);
});

test("loadSettings rejects a budget that is not a number above zero", () => {
  // Raw JSON, because 1e999 is a valid JSON number that parses to Infinity.
  for (const budget of ["0", "-5", '"50"', "null", "true", "1e999", "[50]"]) {
    assert.throws(
      () => loadSettings(writeSettings(`{ "budget": ${budget} }`)),
      /invalid budget .*expected a number above zero/,
      budget,
    );
  }
});
