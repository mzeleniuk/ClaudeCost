import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

// Keep the offline dashboard's assets next to the compiled renderer.
for (const name of ["template.html", "styles", "icons"]) {
  fs.cpSync(path.join(root, "src/dashboard", name), path.join(root, "dist/src/dashboard", name), { recursive: true });
}

fs.chmodSync(path.join(root, "dist/bin/claude-cost.js"), 0o755);
