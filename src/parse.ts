import fs from "node:fs";
import path from "node:path";

import { isPlainObject } from "./validate.ts";

import type { RawUsage, Usage, UsageEvent, UsageRecord } from "./types.ts";

/**
 * Recursively yield all *.jsonl files under a directory.
 * `visited` holds real paths already scanned, so symlink cycles end.
 */
export async function* findTranscripts(dir: string, visited: Set<string> = new Set()): AsyncGenerator<string> {
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
        const stats = await fs.promises.stat(full);

        if (stats.isDirectory()) {
          yield* findTranscripts(full, visited);
        } else if (stats.isFile() && entry.name.endsWith(".jsonl")) {
          yield full;
        }
      } catch {
        // skip unreadable symlinks
      }
    }
  }
}

/**
 * Normalize Anthropic usage into a flat shape for aggregation/pricing.
 * Prefers cache_creation 5m/1h breakdown when present. An empty or all-zero
 * breakdown says nothing about the split, so the flat
 * cache_creation_input_tokens count is used instead of dropping it.
 */
export function normalizeUsage(raw: RawUsage = {}): Usage {
  const breakdown = isPlainObject(raw.cache_creation) ? raw.cache_creation : {};
  const breakdown5m = breakdown.ephemeral_5m_input_tokens ?? 0;
  const breakdown1h = breakdown.ephemeral_1h_input_tokens ?? 0;
  const hasBreakdown = breakdown5m + breakdown1h > 0;

  const cacheWrite5m = hasBreakdown ? breakdown5m : 0;
  const cacheWrite1h = hasBreakdown ? breakdown1h : 0;
  const cacheWrite = hasBreakdown ? cacheWrite5m + cacheWrite1h : (raw.cache_creation_input_tokens ?? 0);

  return {
    cacheRead: raw.cache_read_input_tokens ?? 0,
    cacheWrite,
    cacheWrite1h: hasBreakdown ? cacheWrite1h : null,
    cacheWrite5m: hasBreakdown ? cacheWrite5m : null,
    hasCacheBreakdown: hasBreakdown,
    input: raw.input_tokens ?? 0,
    output: raw.output_tokens ?? 0,
  };
}

function hasBillableTokens(usage: Usage) {
  return usage.input > 0 || usage.output > 0 || usage.cacheRead > 0 || usage.cacheWrite > 0;
}

/**
 * Extract advisor_message iterations from usage.
 * Other iteration types are ignored; top-level usage stays on the main model.
 */
export function advisorUsagesFromRaw(raw: RawUsage = {}): { model: string; usage: Usage }[] {
  const iterations = raw.iterations;
  if (!Array.isArray(iterations) || iterations.length === 0) return [];

  const advisors = [];

  for (const iteration of iterations) {
    if (!isPlainObject(iteration)) continue;
    if (iteration.type !== "advisor_message") continue;

    const model = iteration.model;
    if (typeof model !== "string" || model.length === 0) continue;

    advisors.push({ model, usage: normalizeUsage(iteration) });
  }

  return advisors;
}

const NEWLINE = 0x0a;
const USAGE_KEY = Buffer.from('"usage"');
const READ_CHUNK_BYTES = 1024 * 1024;

/**
 * Yield every line in `buf` that contains the literal "usage", decoded.
 * `buf` must end on a line boundary or at the end of the file.
 */
function* usageLinesIn(buf: Buffer<ArrayBufferLike>): Generator<string> {
  let at = buf.indexOf(USAGE_KEY);

  while (at !== -1) {
    const start = buf.lastIndexOf(NEWLINE, at) + 1;
    let end = buf.indexOf(NEWLINE, at);
    if (end === -1) end = buf.length;

    yield buf.toString("utf8", start, end);
    at = buf.indexOf(USAGE_KEY, end);
  }
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// A timestamp as written: a non-empty string, or a finite number of epoch milliseconds.
function timestampOrNull(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return stringOrNull(value);
}

/**
 * The fields pricing reads from one transcript line, as written. Returns null
 * for lines that are not JSON or have no usage object.
 */
export function parseUsageRecord(line: string): UsageRecord | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let record;

  try {
    record = JSON.parse(trimmed);
  } catch {
    return null; // tolerate partial/corrupt lines
  }

  if (!isPlainObject(record)) return null;

  const msg = record.message ?? record;
  if (!isPlainObject(msg) || !isPlainObject(msg.usage)) return null;

  // Transcript fields keep their original values for store compatibility. A field
  // of the wrong type counts as absent, so dedupe keys and the store get only
  // strings. Token counts in usage are checked later by normalizeUsage.
  return {
    id: stringOrNull(msg.id),
    model: stringOrNull(msg.model) ?? stringOrNull(record.model),
    requestId: stringOrNull(record.requestId),
    ts: timestampOrNull(record.timestamp) ?? timestampOrNull(record.ts) ?? timestampOrNull(msg.timestamp),
    usage: msg.usage,
  };
}

/**
 * Normalized usage events for one record. Advisor iterations (type
 * advisor_message) become separate events under the advisor model, with
 * messageId `{id}:advisor:{index}` when the parent has an id.
 */
export function eventsFromRecord(record: UsageRecord, file: string): UsageEvent[] {
  const usage = normalizeUsage(record.usage);
  const advisors = advisorUsagesFromRaw(record.usage);
  const tsDate = record.ts ? new Date(record.ts) : null;
  const ts = tsDate && !Number.isNaN(tsDate.getTime()) ? tsDate : null;
  const messageId = record.id;
  const requestId = record.requestId;
  const events = [];

  if (hasBillableTokens(usage)) {
    events.push({
      file,
      messageId,
      model: record.model || "unknown",
      requestId,
      ts,
      usage,
    });
  }

  for (const [index, advisor] of advisors.entries()) {
    if (!hasBillableTokens(advisor.usage)) continue;

    events.push({
      file,
      messageId: messageId != null ? `${messageId}:advisor:${index}` : null,
      model: advisor.model,
      requestId,
      ts,
      usage: advisor.usage,
    });
  }

  return events;
}

/**
 * Read `file` from byte `start` and collect the usage records on its lines.
 *
 * Most lines are tool output and chat text with no usage. A usage key is
 * always written as the literal "usage", so this searches raw bytes for it
 * and decodes only the matching lines. Splitting on the newline byte is safe
 * in UTF-8 because it never appears inside a multi-byte character.
 *
 * `end` is the byte offset just past the last newline. Records from a final
 * line with no newline go in `tail`, because Claude Code may still be
 * writing that line.
 */
export async function scanUsageRecords(
  file: string,
  start: number = 0,
): Promise<{ records: UsageRecord[]; tail: UsageRecord[]; end: number }> {
  const stream = fs.createReadStream(file, {
    highWaterMark: READ_CHUNK_BYTES,
    start,
  });

  const records: UsageRecord[] = [];
  let end = start;

  // Chunks since the last newline. Joined only once a newline arrives, so a
  // line longer than one chunk is copied once instead of once per chunk.

  let pending: Buffer<ArrayBufferLike>[] = [];

  const collect = (buf: Buffer<ArrayBufferLike>, into: UsageRecord[]) => {
    for (const line of usageLinesIn(buf)) {
      const record = parseUsageRecord(line);
      if (record) into.push(record);
    }
  };

  for await (const chunk of stream) {
    const lastNewline = chunk.lastIndexOf(NEWLINE);

    if (lastNewline === -1) {
      pending.push(chunk);
      continue;
    }

    const head = chunk.subarray(0, lastNewline + 1);
    const complete = pending.length ? Buffer.concat([...pending, head]) : head;

    collect(complete, records);
    end += complete.length;
    pending = lastNewline + 1 < chunk.length ? [chunk.subarray(lastNewline + 1)] : [];
  }

  const tail: UsageRecord[] = [];
  if (pending.length) collect(Buffer.concat(pending), tail);

  return { records, tail, end };
}

/**
 * Read a JSONL transcript and yield normalized usage events.
 *
 * The file is read in chunks, so memory grows with the number of usage
 * records, not with the size of the transcript.
 */
export async function* readUsageEvents(file: string): AsyncGenerator<UsageEvent> {
  const { records, tail } = await scanUsageRecords(file);

  for (const record of [...records, ...tail]) {
    yield* eventsFromRecord(record, file);
  }
}
