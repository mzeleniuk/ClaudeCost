import fs from "node:fs";
import path from "node:path";

function findProjectRoot(startDir: string): string {
  let dir = path.resolve(startDir);

  while (true) {
    const manifestPath = path.join(dir, "package.json");
    if (fs.existsSync(manifestPath)) {
      const manifest: unknown = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

      if (typeof manifest === "object" && manifest !== null && "name" in manifest && manifest.name === "claude-cost") {
        return dir;
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`could not locate claude-cost package.json above ${startDir}`);
    dir = parent;
  }
}

// Source runs and compiled runs share the user's configuration and usage store.
export const PROJECT_ROOT = findProjectRoot(import.meta.dirname);
