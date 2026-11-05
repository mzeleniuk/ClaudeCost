import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/** Expand a leading ~ or ~/ to the user's home directory. */
export function expandHome(p) {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * Candidate directories where Claude Code stores session transcripts.
 * Claude Code reads only CLAUDE_CONFIG_DIR when it is set, so we do too.
 * Otherwise: modern path first, then legacy.
 */
export function defaultTranscriptDirs(env = process.env) {
  const configDir = env.CLAUDE_CONFIG_DIR?.trim();
  if (configDir) return [path.join(expandHome(configDir), "projects")];

  const home = os.homedir();
  return [
    path.join(home, ".config", "claude", "projects"),
    path.join(home, ".claude", "projects"),
  ];
}

/**
 * Resolve transcript directories to scan.
 * With --dir: a single explicit path.
 * Otherwise: every existing default projects dir (merged), deduped by realpath.
 */
export function resolveTranscriptDirs(explicitDir, env = process.env) {
  if (explicitDir) {
    const resolved = expandHome(explicitDir);
    if (!fs.existsSync(resolved)) {
      throw new Error(`transcript directory not found: ${explicitDir}`);
    }
    return [resolved];
  }

  const found = [];
  const seen = new Set();
  for (const dir of defaultTranscriptDirs(env)) {
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
    const where = env.CLAUDE_CONFIG_DIR?.trim()
      ? ` in CLAUDE_CONFIG_DIR (${env.CLAUDE_CONFIG_DIR.trim()})`
      : "";

    throw new Error(
      `could not locate Claude Code transcripts${where}. Pass --dir <path> explicitly.`,
    );
  }
  return found;
}
