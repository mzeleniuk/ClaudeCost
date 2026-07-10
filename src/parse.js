import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

/** Recursively yield all *.jsonl files under a directory. */
export async function* findTranscripts(dir, visited = new Set()) {
  let realDir;
  try {
    realDir = await fs.promises.realpath(dir);
  } catch {
    return;
  }
  if (visited.has(realDir)) return;
  visited.add(realDir);

  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* findTranscripts(full, visited);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      yield full;
    } else if (entry.isSymbolicLink()) {
      try {
        const st = await fs.promises.stat(full);
        if (st.isDirectory()) {
          yield* findTranscripts(full, visited);
        } else if (st.isFile() && entry.name.endsWith(".jsonl")) {
          yield full;
        }
      } catch {
        // skip unreadable symlinks
      }
    }
  }
}

function hasBillableTokens(usage) {
  return (
    (usage.input_tokens ?? 0) > 0 ||
    (usage.output_tokens ?? 0) > 0 ||
    (usage.cache_read_input_tokens ?? 0) > 0 ||
    (usage.cache_creation_input_tokens ?? 0) > 0
  );
}

/**
 * Stream a JSONL transcript and yield normalized usage events.
 * Each yielded record: { ts: Date|null, model: string, usage: object, file }
 *
 * Streaming line-by-line keeps memory flat even for very large transcripts.
 */
export async function* readUsageEvents(file) {
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let rec;
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue; // tolerate partial/corrupt lines
    }

    const msg = rec.message ?? rec;
    const usage = msg?.usage;
    if (!usage || !hasBillableTokens(usage)) continue;

    const tsRaw = rec.timestamp ?? rec.ts ?? msg?.timestamp;
    const ts = tsRaw ? new Date(tsRaw) : null;

    yield {
      ts: ts && !Number.isNaN(ts.getTime()) ? ts : null,
      model: msg.model ?? rec.model ?? "unknown",
      usage,
      file,
    };
  }
}
