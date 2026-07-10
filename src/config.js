import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/**
 * Candidate directories where Claude Code stores session transcripts.
 * We probe these in order; the first that exists wins unless --dir is passed.
 */
export function defaultTranscriptDirs() {
  const home = os.homedir();
  return [
    path.join(home, ".claude", "projects"),
    path.join(home, ".config", "claude", "projects"),
    path.join(home, ".claude"),
  ];
}

/** Expand a leading ~ or ~/ to the user's home directory. */
export function expandHome(p) {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function resolveTranscriptDir(explicitDir) {
  if (explicitDir) {
    const resolved = expandHome(explicitDir);
    if (!fs.existsSync(resolved)) {
      throw new Error(`transcript directory not found: ${explicitDir}`);
    }
    return resolved;
  }
  const found = defaultTranscriptDirs().find((d) => fs.existsSync(d));
  if (!found) {
    throw new Error(
      "could not locate Claude Code transcripts. Pass --dir <path> explicitly.",
    );
  }
  return found;
}
