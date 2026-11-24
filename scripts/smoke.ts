import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The tests run the TypeScript sources. This runs the compiled CLI, which is
// what the installed claude-cost command starts, on the test fixtures.
const root = path.resolve(import.meta.dirname, "..");
const bin = path.join(root, "dist/bin/claude-cost.js");
const base = ["--dir", path.join(root, "test/fixtures"), "--no-cache", "--region", "global"];

const table = execFileSync(process.execPath, [bin, ...base, "--by-model"], { encoding: "utf8" });
if (!table.includes("claude-sonnet-4")) throw new Error(`the compiled CLI printed no usage:\n${table}`);

const out = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-smoke-"));

try {
  const file = path.join(out, "dashboard.html");
  execFileSync(process.execPath, [bin, ...base, "--dashboard", "--out", file], { encoding: "utf8" });

  const html = fs.readFileSync(file, "utf8");
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!script) throw new Error("the compiled dashboard has no module script");

  // Fails on syntax the browser could not run, such as types left in the script.
  execFileSync(process.execPath, ["--check", "--input-type=module"], { input: script });
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}

console.log("smoke: compiled CLI and dashboard run");
