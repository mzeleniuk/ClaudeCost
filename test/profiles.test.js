import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import { loadProfiles } from "../src/profiles.js";

const fixture = path.join(import.meta.dirname, "fixtures", "profile-sample");

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

test("loadProfiles reads an optional region and rejects unknown ones", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-profiles-"));
  const workDir = path.join(root, "work");
  fs.mkdirSync(path.join(workDir, "projects"), { recursive: true });
  const file = writeProfiles(root, {
    profiles: [
      { name: "vertex", dir: fixture },
      { name: "work", dir: workDir, region: "eu" },
    ],
  });

  const profiles = loadProfiles(file);
  assert.equal(profiles[0].region, null);
  assert.equal(profiles[1].region, "eu");

  writeProfiles(root, {
    profiles: [{ name: "work", dir: fixture, region: "mars" }],
  });
  assert.throws(
    () => loadProfiles(file),
    /unknown region "mars" in profile "work"/,
  );
});

function makeConfigDir(...parts) {
  const dir = path.join(...parts);
  fs.mkdirSync(path.join(dir, "projects"), { recursive: true });

  return dir;
}

test("loadProfiles rejects two profiles with the same config directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-profiles-"));
  const dir = makeConfigDir(root, "shared");
  const file = writeProfiles(root, {
    profiles: [
      { name: "vertex", dir },
      // Same directory, spelled differently
      { name: "work", dir: path.join(root, "x", "..", "shared") },
    ],
  });

  assert.throws(
    () => loadProfiles(file),
    /profile "work" reads the same transcript directory as "vertex" \(.*\), so they would be counted twice/,
  );
});

test("loadProfiles rejects a profile whose transcripts sit inside another's", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-profiles-"));
  const outer = makeConfigDir(root, "outer");
  const inner = makeConfigDir(outer, "projects", "nested");

  for (const [first, second, relation] of [
    [outer, inner, /profile "b" reads transcripts inside "a"'s/],
    [inner, outer, /profile "b" reads transcripts that contain "a"'s/],
  ]) {
    const file = writeProfiles(root, {
      profiles: [
        { name: "a", dir: first },
        { name: "b", dir: second },
      ],
    });
    assert.throws(() => loadProfiles(file), relation);
  }
});

test("loadProfiles rejects profiles linked to the same transcripts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-profiles-"));
  const real = makeConfigDir(root, "real");
  const link = path.join(root, "link");
  fs.symlinkSync(real, link);
  const file = writeProfiles(root, {
    profiles: [
      { name: "vertex", dir: real },
      { name: "work", dir: link },
    ],
  });

  assert.throws(
    () => loadProfiles(file),
    /reads the same transcript directory/,
  );
});

test("loadProfiles accepts sibling directories with a shared name prefix", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-profiles-"));
  const file = writeProfiles(root, {
    profiles: [
      { name: "vertex", dir: makeConfigDir(root, ".claude") },
      { name: "work", dir: makeConfigDir(root, ".claude-work") },
    ],
  });

  assert.equal(loadProfiles(file).length, 2);
});
