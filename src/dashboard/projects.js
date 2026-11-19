// @ts-check
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** @import { DashboardProject } from "../types.js" */

// Claude Code names a project folder after the working directory with
// every character outside A-Z, a-z and 0-9 replaced by "-". Older versions
// kept some of those characters, so a directory name matches under any of
// these.
const ENCODINGS = [/[^a-zA-Z0-9]/g, /[/.]/g, /[/._]/g];

/**
 * The folder name Claude Code uses for a working directory.
 *
 * @param {string} cwd
 */
export function encodeCwd(cwd) {
  return cwd.replace(ENCODINGS[0], "-");
}

/**
 * Names of the sub-directories of `dir`, or none when it cannot be read.
 *
 * @param {string} dir
 * @returns {string[]}
 */
export function listDirectories(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => {
        if (entry.isDirectory()) return true;
        if (!entry.isSymbolicLink()) return false;

        try {
          return fs.statSync(path.join(dir, entry.name)).isDirectory();
        } catch {
          return false;
        }
      })
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

// A real path takes about one step per directory level. This is far more.
const MAX_STEPS = 500;

// Temp directories that are gone by the time the dashboard runs. The prefix
// is the same for all of them, so the label keeps only the part that differs.
// macOS: /private/var/folders/xx/hash/T/<name>. Linux and macOS: /tmp/<name>.
const TEMP_PREFIXES = [
  /^-(?:private-)?var-folders-.+?-T-(.+)$/,
  /^-(?:private-)?tmp-(.+)$/,
];

/**
 * @param {string} folder
 * @returns {string | null}
 */
function tempLabel(folder) {
  for (const pattern of TEMP_PREFIXES) {
    const match = pattern.exec(folder);
    if (match) return match[1];
  }

  return null;
}

/**
 * Find the directory under `dir` whose encoded path is `segments` joined by
 * "-". A directory name may span several segments, so try the longest
 * names first and back up when a branch dead-ends. `budget` caps the
 * directories visited, because symlink loops make the search exponential.
 *
 * @param {string} dir
 * @param {string[]} segments
 * @param {(dir: string) => string[]} listDirs
 * @param {{ left: number }} budget
 * @returns {string | null}
 */
function walk(dir, segments, listDirs, budget) {
  if (segments.length === 0) return dir;
  if (budget.left <= 0) return null;
  budget.left -= 1;

  const rest = segments.join("-");
  /** @type {Map<string, { name: string, count: number }>} */
  const matches = new Map();

  for (const name of listDirs(dir)) {
    for (const encoding of ENCODINGS) {
      const encoded = name.replace(encoding, "-");

      if (rest === encoded || rest.startsWith(`${encoded}-`)) {
        const count = encoded.split("-").length;
        matches.set(`${name}\0${count}`, { name, count });
      }
    }
  }

  const longestFirst = [...matches.values()].sort((a, b) => b.count - a.count);

  for (const { name, count } of longestFirst) {
    const found = walk(
      path.join(dir, name),
      segments.slice(count),
      listDirs,
      budget,
    );

    if (found) return found;
  }

  return null;
}

/**
 * Build a function that turns a project folder name back into the working
 * directory it came from. The encoding loses information, since "-" stands
 * for "/", "." and a real "-", so the decoder walks the file system from "/"
 * and keeps only paths that exist. Results are cached per folder.
 *
 * @param {object} [opts]
 * @param {(dir: string) => string[]} [opts.listDirs] Sub-directory names of a
 *   directory. Replaceable for tests.
 * @param {string} [opts.home] Home directory. Defaults to the user's.
 * @returns {(folder: string) => DashboardProject}
 */
export function createProjectDecoder({
  listDirs = listDirectories,
  home = os.homedir(),
} = {}) {
  const encodedHome = encodeCwd(home);
  /** @type {Map<string, DashboardProject>} */
  const cache = new Map();
  /** @type {Map<string, string[]>} */
  const listings = new Map();

  // Every folder walk starts at the root, so they list the same directories.
  /** @param {string} dir */
  const listCached = (dir) => {
    let names = listings.get(dir);

    if (!names) {
      names = listDirs(dir);
      listings.set(dir, names);
    }

    return names;
  };

  /**
   * Where the walk starts and the segments left to match. A POSIX path
   * encodes as "-Users-me-app". A Windows path encodes as "C--Users-me-app",
   * because "C:\\" becomes "C--".
   *
   * @param {string} folder
   * @returns {{ root: string, segments: string[] } | null}
   */
  function startOf(folder) {
    if (folder.startsWith("-")) {
      return { root: "/", segments: folder.slice(1).split("-") };
    }

    const drive = /^([a-zA-Z])--(.+)$/.exec(folder);
    if (drive) {
      return { root: `${drive[1]}:\\`, segments: drive[2].split("-") };
    }

    return null;
  }

  /** @param {string} folder */
  function decode(folder) {
    const start = startOf(folder);
    const dir = start
      ? walk(start.root, start.segments, listCached, { left: MAX_STEPS })
      : null;

    const temp = tempLabel(folder);
    let label = folder || "(unknown)";

    if (folder === encodedHome) label = "~";
    else if (dir) label = path.basename(dir);
    else if (temp) label = temp;
    else if (folder.startsWith(`${encodedHome}-`)) {
      label = folder.slice(encodedHome.length + 1);
    }

    return { label, folder, path: dir };
  }

  return (folder) => {
    let project = cache.get(folder);

    if (!project) {
      project = decode(folder);
      cache.set(folder, project);
    }

    return project;
  };
}
