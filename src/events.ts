import { dedupeEvents } from "./dedupe.ts";
import { findTranscripts, readUsageEvents } from "./parse.ts";
import { readStoredEvents } from "./store.ts";

import type { ParseStats, UsageEvent } from "./types.ts";

// How a run uses the usage store. `storeDir` is null with --no-cache.
export interface StoreMode {
  storeDir: string | null;
  rebuild: boolean;
}

/**
 * Read every usage event under `dirs` and drop duplicate snapshots. With a
 * store, transcripts are read through it and deleted ones come back
 * archived. Without one, only transcripts on disk are read. Pass `parse` to
 * add up the lines that could not be read.
 */
export async function readEvents(dirs: string[], store: StoreMode, parse?: ParseStats): Promise<UsageEvent[]> {
  async function* allEvents() {
    const visited: Set<string> = new Set();

    for (const dir of dirs) {
      if (store.storeDir) {
        yield* await readStoredEvents(dir, {
          storeDir: store.storeDir,
          rebuild: store.rebuild,
          visited,
          parse,
        });

        continue;
      }

      for await (const file of findTranscripts(dir, visited)) {
        yield* readUsageEvents(file, parse);
      }
    }
  }

  return dedupeEvents(allEvents());
}
