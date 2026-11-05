import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadSettings } from "../src/settings.js";

function writeSettings(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-settings-"));
  const file = path.join(dir, "settings.config.json");

  fs.writeFileSync(
    file,
    typeof body === "string" ? body : JSON.stringify(body),
  );

  return file;
}

test("loadSettings defaults to the global region when the file is missing", () => {
  const missing = path.join(
    os.tmpdir(),
    `claude-cost-missing-settings-${process.pid}.json`,
  );
  assert.deepEqual(loadSettings(missing), { region: "global" });
});

test("loadSettings reads region and ignores _ comments", () => {
  const file = writeSettings({ _comment: "work account", region: "eu" });
  assert.deepEqual(loadSettings(file), { region: "eu" });
});

test("loadSettings rejects unknown regions, unknown keys and bad JSON", () => {
  assert.throws(
    () => loadSettings(writeSettings({ region: "us-central1" })),
    /unknown region "us-central1"/,
  );
  assert.throws(
    () => loadSettings(writeSettings({ regoin: "us" })),
    /unknown setting "regoin"/,
  );
  assert.throws(
    () => loadSettings(writeSettings({ region: 1 })),
    /invalid region .*expected a string/,
  );
  assert.throws(
    () => loadSettings(writeSettings("{ nope")),
    /invalid settings file \(expected JSON\)/,
  );
});
