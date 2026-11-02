import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { loadProfiles } from "../src/profiles.js";

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "profile-sample",
);

function writeProfiles(dir, body) {
  const file = path.join(dir, "profiles.config.json");
  fs.writeFileSync(file, JSON.stringify(body));
  return file;
}

test("loadProfiles returns null when the file is missing", () => {
  const missing = path.join(
    os.tmpdir(),
    `claude-cost-missing-profiles-${process.pid}.json`,
  );
  assert.equal(loadProfiles(missing), null);
});

test("loadProfiles expands ~ in dir", () => {
  const home = os.homedir();

  assert.ok(
    fixture.startsWith(`${home}${path.sep}`),
    "profile fixture must live under the home directory",
  );

  const configured = `~/${path.relative(home, fixture)}`;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-profiles-"));
  const file = writeProfiles(root, {
    profiles: [{ name: "vertex", dir: configured }],
  });

  const profiles = loadProfiles(file);

  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].name, "vertex");
  assert.equal(profiles[0].configuredDir, configured);
  assert.equal(profiles[0].dir, fixture);
  assert.equal(profiles[0].projectsDir, path.join(fixture, "projects"));
  assert.equal(profiles[0].pricing, null);
});

test("loadProfiles rejects duplicate names", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-profiles-"));
  const file = writeProfiles(root, {
    profiles: [
      { name: "work", dir: fixture },
      { name: "work", dir: fixture },
    ],
  });

  assert.throws(() => loadProfiles(file), /duplicate profile name "work"/);
});

test("loadProfiles rejects a missing config directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-profiles-"));
  const file = writeProfiles(root, {
    profiles: [{ name: "work", dir: path.join(root, "missing-config") }],
  });

  assert.throws(
    () => loadProfiles(file),
    /profile "work" config directory not found/,
  );
});

test("loadProfiles rejects a config directory without projects", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-profiles-"));
  const configDir = path.join(root, "config");
  fs.mkdirSync(configDir);
  const file = writeProfiles(root, {
    profiles: [{ name: "work", dir: configDir }],
  });

  assert.throws(
    () => loadProfiles(file),
    /profile "work" transcript directory not found/,
  );
});

test("loadProfiles resolves an optional pricing path", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-profiles-"));
  const configDir = path.join(root, "config");
  fs.mkdirSync(path.join(configDir, "projects"), { recursive: true });
  const pricing = path.join(root, "pricing.work.json");
  fs.writeFileSync(pricing, "{}");
  const file = writeProfiles(root, {
    profiles: [
      { name: "work", dir: configDir, pricing: "./pricing.work.json" },
    ],
  });

  const profiles = loadProfiles(file);
  assert.equal(profiles[0].pricing, pricing);
});
