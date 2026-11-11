// @ts-check
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  eventsFromRecord,
  findTranscripts,
  scanUsageRecords,
} from "./parse.js";
import { isPlainObject } from "./validate.js";

/** @import { StoreEntry, UsageEvent, UsageRecord } from "./types.js" */

/**
 * Local usage store. Sits next to pricing.config.json and is not committed.
 * It keeps usage from transcripts Claude Code has since deleted, so it is the
 * only copy of that history.
 */
export const DEFAULT_STORE_DIR = path.join(import.meta.dirname, "..", "data");

// Bump when the saved format changes, and migrate older stores in loadStore.
export const STORE_VERSION = 1;

// How many bytes before `offset` the check hash covers.
const CHECK_BYTES = 256;

/** @param {string} message */
const printWarning = (message) => {
  return process.stderr.write(`claude-cost: ${message}\n`);
};

/**
 * Store file name for a transcript directory: a readable slug of its real
 * path, plus a short hash because two paths can share a slug.
 * `~/.claude/projects` becomes `claude-projects-<hash>.json`.
 *
 * @param {string} realDir
 */
export function storeFileName(realDir) {
  const rel = path.relative(os.homedir(), realDir);
  const underHome =
    rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  const slug =
    (underHome ? rel : realDir)
      .split(path.sep)
      .map((part) => part.replace(/^\.+/, ""))
      .join("-")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "root";
  const hash = crypto.createHash("sha256").update(realDir).digest("hex");

  return `${slug}-${hash.slice(0, 8)}.json`;
}

/**
 * Hash of the bytes just before `offset`. If a file grew and this still
 * matches, the old bytes are in place and only the new ones need reading.
 *
 * @param {string} file
 * @param {number} offset
 */
async function checkAt(file, offset) {
  const start = Math.max(0, offset - CHECK_BYTES);
  const buf = Buffer.alloc(offset - start);
  const handle = await fs.promises.open(file, "r");

  try {
    await handle.read(buf, 0, buf.length, start);
  } finally {
    await handle.close();
  }

  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

/** @param {unknown} entry */
function isEntry(entry) {
  return (
    isPlainObject(entry) &&
    Number.isFinite(entry.size) &&
    Number.isFinite(entry.mtimeMs) &&
    Number.isInteger(entry.offset) &&
    typeof entry.check === "string" &&
    Array.isArray(entry.records) &&
    entry.records.every((record) => isPlainObject(record?.usage)) &&
    (entry.deletedAt === undefined || typeof entry.deletedAt === "string")
  );
}

/**
 * Read a store file. A missing file is an empty store. A file that cannot be
 * parsed is renamed aside, never deleted, because it may hold history that
 * exists nowhere else.
 *
 * @param {string} file
 * @param {(message: string) => void} warn
 * @returns {{ files: Record<string, StoreEntry>, setAside: boolean }}
 */
function loadStore(file, warn) {
  let text;

  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") {
      return { files: {}, setAside: false };
    }

    throw new Error(
      `cannot read usage store ${file}: ${/** @type {Error} */ (error).message}. Pass --no-cache to skip it.`,
    );
  }

  let parsed = null;

  try {
    parsed = JSON.parse(text);
  } catch {
    // handled below
  }

  const version = isPlainObject(parsed) ? parsed.version : undefined;

  if (Number.isInteger(version) && Number(version) > STORE_VERSION) {
    throw new Error(
      `usage store ${file} was written by a newer claude-cost (format ${version}). Update claude-cost, or pass --no-cache.`,
    );
  }

  if (
    isPlainObject(parsed) &&
    version === STORE_VERSION &&
    isPlainObject(parsed.files) &&
    Object.values(parsed.files).every(isEntry)
  ) {
    return {
      files: /** @type {Record<string, StoreEntry>} */ (parsed.files),
      setAside: false,
    };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const aside = `${file}.corrupt-${stamp}`;

  try {
    fs.renameSync(file, aside);
  } catch (error) {
    throw new Error(
      `usage store ${file} is unreadable and could not be moved aside: ${/** @type {Error} */ (error).message}`,
    );
  }

  warn(
    `usage store ${file} is unreadable. Moved it to ${aside} and rebuilt it from the transcripts on disk. Usage from deleted transcripts is only in the moved file.`,
  );

  return { files: {}, setAside: true };
}

/**
 * Write the store to a temp file, then rename it over the old one, so a
 * crash or a second run never leaves a half-written store.
 *
 * @param {string} file
 * @param {string} realDir
 * @param {Record<string, StoreEntry>} files
 * @param {(message: string) => void} warn
 */
function saveStore(file, realDir, files, warn) {
  const temp = `${file}.${process.pid}.tmp`;
  const body = { version: STORE_VERSION, projectsDir: realDir, files };

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify(body));
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    warn(
      `could not save usage store ${file}: ${/** @type {Error} */ (error).message}`,
    );
  }
}

/**
 * Bring one transcript's entry up to date. Reads only the bytes added since
 * the last run when the file was appended to, and the whole file otherwise.
 * `tail` holds records from a last line with no newline yet. They count in
 * this run but are not saved, so the line is read again once it is complete.
 *
 * @param {string} file
 * @param {fs.Stats} stats
 * @param {StoreEntry | undefined} entry
 * @returns {Promise<{ entry: StoreEntry, tail: UsageRecord[], updated: boolean }>}
 */
async function refreshEntry(file, stats, entry) {
  if (entry && entry.offset <= stats.size) {
    const unchanged =
      stats.size === entry.size && stats.mtimeMs === entry.mtimeMs;

    if (unchanged && entry.offset === stats.size) {
      return { entry, tail: [], updated: false };
    }

    if (
      unchanged ||
      (stats.size > entry.size &&
        (await checkAt(file, entry.offset)) === entry.check)
    ) {
      const scan = await scanUsageRecords(file, entry.offset);
      if (unchanged) return { entry, tail: scan.tail, updated: false };

      return {
        entry: {
          size: stats.size,
          mtimeMs: stats.mtimeMs,
          offset: scan.end,
          check: await checkAt(file, scan.end),
          records: [...entry.records, ...scan.records],
        },
        tail: scan.tail,
        updated: true,
      };
    }
  }

  const scan = await scanUsageRecords(file);

  return {
    entry: {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      offset: scan.end,
      check: await checkAt(file, scan.end),
      records: scan.records,
    },
    tail: scan.tail,
    updated: true,
  };
}

/**
 * Usage events for every transcript under `projectsDir`, read through the
 * usage store in `storeDir`. Transcripts that are unchanged since the last
 * run are not read again. Transcripts that are gone from disk stay in the
 * store, and their events come back with `archived` set.
 *
 * With `rebuild`, every transcript on disk is read in full. Entries for
 * deleted transcripts are kept, since they cannot be read again.
 *
 * @param {string} projectsDir
 * @param {object} opts
 * @param {string} opts.storeDir
 * @param {boolean} [opts.rebuild]
 * @param {Set<string>} [opts.visited] Shared with findTranscripts.
 * @param {(message: string) => void} [opts.warn]
 * @returns {Promise<UsageEvent[]>}
 */
export async function readStoredEvents(
  projectsDir,
  { storeDir, rebuild = false, visited = new Set(), warn = printWarning },
) {
  let realDir;

  try {
    realDir = fs.realpathSync.native(projectsDir);
  } catch {
    return [];
  }

  const storeFile = path.join(storeDir, storeFileName(realDir));
  const { files, setAside } = loadStore(storeFile, warn);
  let changed = setAside || rebuild;

  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {UsageEvent[]} */
  const events = [];

  for await (const file of findTranscripts(projectsDir, visited)) {
    const key = path.relative(projectsDir, file);
    const stored = rebuild ? undefined : files[key];
    let result;

    try {
      const stats = await fs.promises.stat(file);
      result = await refreshEntry(file, stats, stored);
    } catch {
      continue; // gone or unreadable since the directory was listed
    }

    seen.add(key);

    if (result.updated) {
      files[key] = result.entry;
      changed = true;
    } else if (result.entry.deletedAt !== undefined) {
      delete result.entry.deletedAt;
      changed = true;
    }

    for (const record of [...result.entry.records, ...result.tail]) {
      events.push(...eventsFromRecord(record, file));
    }
  }

  const now = new Date().toISOString();

  for (const [key, entry] of Object.entries(files)) {
    if (seen.has(key)) continue;

    if (entry.deletedAt === undefined) {
      entry.deletedAt = now;
      changed = true;
    }

    const file = path.join(projectsDir, key);

    for (const record of entry.records) {
      for (const event of eventsFromRecord(record, file)) {
        events.push({ ...event, archived: true });
      }
    }
  }

  if (changed) saveStore(storeFile, realDir, files, warn);
  return events;
}
