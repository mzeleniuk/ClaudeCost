import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/**
 * Candidate directories where Claude Code stores session transcripts.
 * Modern path first, then legacy.
 */
export function defaultTranscriptDirs() {
  const home = os.homedir();
  return [
    path.join(home, ".config", "claude", "projects"),
    path.join(home, ".claude", "projects"),
  ];
}

/** Expand a leading ~ or ~/ to the user's home directory. */
export function expandHome(p) {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * Resolve transcript directories to scan.
 * With --dir: a single explicit path.
 * Otherwise: every existing default projects dir (merged), deduped by realpath.
 */
export function resolveTranscriptDirs(explicitDir) {
  if (explicitDir) {
    const resolved = expandHome(explicitDir);
    if (!fs.existsSync(resolved)) {
      throw new Error(`transcript directory not found: ${explicitDir}`);
    }
    return [resolved];
  }

  const found = [];
  const seen = new Set();
  for (const dir of defaultTranscriptDirs()) {
    if (!fs.existsSync(dir)) continue;
    let key = dir;
    try {
      key = fs.realpathSync(dir);
    } catch {
      // use the original path if realpath fails
    }
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(dir);
  }

  if (found.length === 0) {
    throw new Error(
      "could not locate Claude Code transcripts. Pass --dir <path> explicitly.",
    );
  }
  return found;
}
