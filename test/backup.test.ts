import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { backupStore } from "../src/backup.ts";
import { isStoreFileName } from "../src/store.ts";

const NOW = new Date("2026-11-25T10:20:30.123Z");

/**
 * A store folder with two store files, a set-aside copy and two files that
 * are not part of the store, next to a folder to back up into.
 */
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-backup-"));
  const storeDir = path.join(root, "data");
  const destDir = path.join(root, "backups");
  const files = {
    "claude-projects-44718ff5.json": '{"version":1,"files":{"a":1}}',
    "work-projects-c90a53fe.json": '{"version":1,"files":{"b":2}}',
    "work-projects-c90a53fe.json.corrupt-2026-11-01T08-00-00-000Z": "not json",
  };

  fs.mkdirSync(storeDir);
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(storeDir, name), body);
  fs.writeFileSync(path.join(storeDir, "dashboard.html"), "<html></html>");
  fs.writeFileSync(path.join(storeDir, "claude-projects-44718ff5.json.123.tmp"), "half");

  return { root, storeDir, destDir, files };
}

test("isStoreFileName matches store files and set-aside copies only", () => {
  assert.equal(isStoreFileName("claude-projects-44718ff5.json"), true);
  assert.equal(isStoreFileName("root-0123abcd.json"), true);
  assert.equal(isStoreFileName("claude-projects-44718ff5.json.corrupt-2026-11-01T08-00-00-000Z"), true);
  assert.equal(isStoreFileName("claude-projects-44718ff5.json.123.tmp"), false);
  assert.equal(isStoreFileName("dashboard.html"), false);
  assert.equal(isStoreFileName("notes.json"), false);
});

test("copies the store files into a new folder named after the time", (t) => {
  const s = setup();
  t.after(() => fs.rmSync(s.root, { recursive: true, force: true }));

  const { dir, files } = backupStore(s.storeDir, s.destDir, NOW);

  assert.equal(dir, path.join(s.destDir, "claude-cost-backup-2026-11-25T10-20-30-123Z"));
  assert.deepEqual(files, Object.keys(s.files));
  assert.deepEqual(fs.readdirSync(dir).sort(), Object.keys(s.files));

  for (const [name, body] of Object.entries(s.files)) {
    assert.equal(fs.readFileSync(path.join(dir, name), "utf8"), body);
  }

  // Only the finished folder is left in the destination.
  assert.deepEqual(fs.readdirSync(s.destDir), [path.basename(dir)]);
});

test("leaves an earlier backup alone when the store has shrunk since", (t) => {
  const s = setup();
  t.after(() => fs.rmSync(s.root, { recursive: true, force: true }));

  const first = backupStore(s.storeDir, s.destDir, NOW);

  // The store is deleted and rebuilt from fewer transcripts.
  fs.rmSync(s.storeDir, { recursive: true });
  fs.mkdirSync(s.storeDir);
  fs.writeFileSync(path.join(s.storeDir, "claude-projects-44718ff5.json"), '{"version":1,"files":{}}');

  const second = backupStore(s.storeDir, s.destDir, new Date(NOW.getTime() + 1000));

  assert.notEqual(second.dir, first.dir);
  assert.equal(
    fs.readFileSync(path.join(first.dir, "claude-projects-44718ff5.json"), "utf8"),
    s.files["claude-projects-44718ff5.json"],
  );
  assert.equal(
    fs.readFileSync(path.join(second.dir, "claude-projects-44718ff5.json"), "utf8"),
    '{"version":1,"files":{}}',
  );
});

test("creates the destination folder and its parents", (t) => {
  const s = setup();
  t.after(() => fs.rmSync(s.root, { recursive: true, force: true }));

  const { dir } = backupStore(s.storeDir, path.join(s.destDir, "a", "b"), NOW);
  assert.ok(fs.existsSync(path.join(dir, "claude-projects-44718ff5.json")));
});

test("rejects a destination inside the store folder", (t) => {
  const s = setup();
  t.after(() => fs.rmSync(s.root, { recursive: true, force: true }));

  for (const dest of [s.storeDir, path.join(s.storeDir, "backups")]) {
    assert.throws(() => backupStore(s.storeDir, dest, NOW), /is inside the usage store folder/);
  }

  assert.equal(fs.existsSync(path.join(s.storeDir, "backups")), false);
});

test("rejects a destination that reaches the store folder through a symlink", (t) => {
  const s = setup();
  t.after(() => fs.rmSync(s.root, { recursive: true, force: true }));

  const link = path.join(s.root, "link");
  fs.symlinkSync(s.storeDir, link);

  assert.throws(() => backupStore(s.storeDir, path.join(link, "backups"), NOW), /is inside the usage store folder/);
});

test("allows a destination that only shares a name prefix with the store folder", (t) => {
  const s = setup();
  t.after(() => fs.rmSync(s.root, { recursive: true, force: true }));

  const { dir } = backupStore(s.storeDir, `${s.storeDir}-backups`, NOW);
  assert.ok(fs.existsSync(dir));
});

test("names the store folder when there is nothing to back up", (t) => {
  const s = setup();
  t.after(() => fs.rmSync(s.root, { recursive: true, force: true }));

  const missing = path.join(s.root, "missing");
  assert.throws(() => backupStore(missing, s.destDir, NOW), new RegExp(`no usage store to back up in ${missing}`));

  const empty = path.join(s.root, "empty");
  fs.mkdirSync(empty);
  fs.writeFileSync(path.join(empty, "dashboard.html"), "");
  assert.throws(() => backupStore(empty, s.destDir, NOW), /no usage store to back up/);

  assert.equal(fs.existsSync(s.destDir), false);
});

test("refuses to reuse a backup folder and leaves it untouched", (t) => {
  const s = setup();
  t.after(() => fs.rmSync(s.root, { recursive: true, force: true }));

  const { dir } = backupStore(s.storeDir, s.destDir, NOW);
  fs.writeFileSync(path.join(dir, "claude-projects-44718ff5.json"), "kept");

  assert.throws(() => backupStore(s.storeDir, s.destDir, NOW), /already exists/);
  assert.equal(fs.readFileSync(path.join(dir, "claude-projects-44718ff5.json"), "utf8"), "kept");
});

test("names the backup folder when the copy fails and removes the partial copy", (t) => {
  const s = setup();
  t.after(() => fs.rmSync(s.root, { recursive: true, force: true }));

  // A file where the destination folder is needed.
  fs.writeFileSync(s.destDir, "");

  assert.throws(
    () => backupStore(s.storeDir, s.destDir, NOW),
    /cannot back up the usage store to .*claude-cost-backup-/,
  );
  assert.equal(fs.statSync(s.destDir).isFile(), true);
});
