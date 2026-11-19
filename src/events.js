// @ts-check
import { dedupeEvents } from "./dedupe.js";
import { findTranscripts, readUsageEvents } from "./parse.js";
import { readStoredEvents } from "./store.js";

/** @import { UsageEvent } from "./types.js" */

/**
 * How a run uses the usage store. `storeDir` is null with --no-cache.
 *
 * @typedef {{ storeDir: string | null, rebuild: boolean }} StoreMode
 */

/**
 * Read every usage event under `dirs` and drop duplicate snapshots. With a
 * store, transcripts are read through it and deleted ones come back
 * archived. Without one, only transcripts on disk are read.
 *
 * @param {string[]} dirs Transcript directories ("projects" folders).
 * @param {StoreMode} store
 * @returns {Promise<UsageEvent[]>}
 */
export async function readEvents(dirs, store) {
  async function* allEvents() {
    /** @type {Set<string>} */
    const visited = new Set();

    for (const dir of dirs) {
      if (store.storeDir) {
        yield* await readStoredEvents(dir, {
          storeDir: store.storeDir,
          rebuild: store.rebuild,
          visited,
        });

        continue;
      }

      for await (const file of findTranscripts(dir, visited)) {
        yield* readUsageEvents(file);
      }
    }
  }

  return dedupeEvents(allEvents());
}
