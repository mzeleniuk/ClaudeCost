import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { stripTypes } from "../src/dashboard/render.ts";

const moduleSource = stripTypes(fs.readFileSync(new URL("../src/paths.ts", import.meta.url), "utf8"));

function packageDir(t: TestContext, name = "claude-cost") {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-paths-")));

  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, type: "module" }));

  return dir;
}

function writeModule(root: string, relativePath: string) {
  const file = path.join(root, relativePath);

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, moduleSource);

  return pathToFileURL(file).href;
}

test("PROJECT_ROOT follows the package across source and compiled layouts and extensions", async (t) => {
  const root = packageDir(t);

  for (const file of ["src/paths.ts", "src/paths.mts", "dist/src/paths.js", "build/server/runtime/paths.mjs"]) {
    const { PROJECT_ROOT } = await import(writeModule(root, file));
    assert.equal(PROJECT_ROOT, root, file);
  }
});

test("PROJECT_ROOT skips unrelated nested packages", async (t) => {
  const root = packageDir(t);
  const moduleUrl = writeModule(root, "build/server/src/paths.js");

  fs.writeFileSync(
    path.join(root, "build/server/package.json"),
    JSON.stringify({ name: "another-package", type: "module" }),
  );

  const { PROJECT_ROOT } = await import(moduleUrl);
  assert.equal(PROJECT_ROOT, root);
});

test("PROJECT_ROOT fails clearly when no matching package exists", async (t) => {
  const root = packageDir(t, "another-package");

  await assert.rejects(
    import(writeModule(root, "build/src/paths.js")),
    /could not locate claude-cost package\.json above/,
  );
});
