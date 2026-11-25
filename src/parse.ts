import fs from "node:fs";
import path from "node:path";

import { isPlainObject } from "./validate.ts";
import type { ParseStats, RawUsage, Usage, UsageEvent, UsageRecord } from "./types.ts";

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

// A token count as written. Anything but a number counts as 0, so a string cannot reach the totals.
function count(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Normalize Anthropic usage into a flat shape for aggregation/pricing.
 * Prefers cache_creation 5m/1h breakdown when present. An empty or all-zero
 * breakdown says nothing about the split, so the flat
 * cache_creation_input_tokens count is used instead of dropping it.
 */
export function normalizeUsage(raw: RawUsage = {}): Usage {
  const breakdown = isPlainObject(raw.cache_creation) ? raw.cache_creation : {};
  const breakdown5m = count(breakdown.ephemeral_5m_input_tokens);
  const breakdown1h = count(breakdown.ephemeral_1h_input_tokens);
  const hasBreakdown = breakdown5m + breakdown1h > 0;

  const cacheWrite5m = hasBreakdown ? breakdown5m : 0;
  const cacheWrite1h = hasBreakdown ? breakdown1h : 0;
  const cacheWrite = hasBreakdown ? cacheWrite5m + cacheWrite1h : count(raw.cache_creation_input_tokens);

  return {
    cacheRead: count(raw.cache_read_input_tokens),
    cacheWrite,
    cacheWrite1h: hasBreakdown ? cacheWrite1h : null,
    cacheWrite5m: hasBreakdown ? cacheWrite5m : null,
    hasCacheBreakdown: hasBreakdown,
    input: count(raw.input_tokens),
    output: count(raw.output_tokens),
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
 * Yield every line in `buf` that contains the literal "usage", decoded, with
 * the byte offset in `buf` where it starts.
 * `buf` must end on a line boundary or at the end of the file.
 */
function* usageLinesIn(buf: Buffer<ArrayBufferLike>): Generator<{ line: string; start: number }> {
  let at = buf.indexOf(USAGE_KEY);

  while (at !== -1) {
    const start = buf.lastIndexOf(NEWLINE, at) + 1;
    let end = buf.indexOf(NEWLINE, at);
    if (end === -1) end = buf.length;

    yield { line: buf.toString("utf8", start, end), start };
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

// Why the parser dropped or distrusted a line that has a "usage" key.
export type LineProblem = "invalidJson" | "noUsage" | "badTokenCounts";

const TOKEN_FIELDS = [
  "input_tokens",
  "output_tokens",
  "cache_read_input_tokens",
  "cache_creation_input_tokens",
] as const;

/**
 * True when no token count in `usage` is a number, or one is present with
 * another type. Fields the parser does not know are ignored, because new
 * Claude Code versions add them.
 */
function hasBadTokenCounts(usage: Record<string, unknown>) {
  let numeric = false;

  for (const field of TOKEN_FIELDS) {
    const value = usage[field];
    if (value === undefined) continue;
    if (typeof value !== "number") return true;
    numeric = true;
  }

  return !numeric;
}

/**
 * The fields pricing reads from one transcript line, as written, and the
 * problem found with it. `record` is null when the line has no usage object.
 * A `problem` with a `record` means the usage object is there but its token
 * counts are not recognized, so the record prices at $0.
 *
 * A line with no usage object is a problem only when it is an assistant
 * record. User and attachment records may mention "usage" in their text.
 */
export function parseUsageLine(line: string): { record: UsageRecord | null; problem: LineProblem | null } {
  const trimmed = line.trim();
  if (!trimmed) return { record: null, problem: null };

  let record;

  try {
    record = JSON.parse(trimmed);
  } catch {
    return { record: null, problem: "invalidJson" }; // tolerate partial/corrupt lines
  }

  if (!isPlainObject(record)) return { record: null, problem: null };

  const msg = record.message ?? record;

  if (!isPlainObject(msg) || !isPlainObject(msg.usage)) {
    return { record: null, problem: record.type === "assistant" ? "noUsage" : null };
  }

  // Transcript fields keep their original values for store compatibility. A field
  // of the wrong type counts as absent, so dedupe keys and the store get only
  // strings. Token counts in usage are checked later by normalizeUsage.
  return {
    record: {
      id: stringOrNull(msg.id),
      model: stringOrNull(msg.model) ?? stringOrNull(record.model),
      requestId: stringOrNull(record.requestId),
      ts: timestampOrNull(record.timestamp) ?? timestampOrNull(record.ts) ?? timestampOrNull(msg.timestamp),
      usage: msg.usage,
    },
    problem: hasBadTokenCounts(msg.usage) ? "badTokenCounts" : null,
  };
}

/**
 * The fields pricing reads from one transcript line, as written. Returns null
 * for lines that are not JSON or have no usage object.
 */
export function parseUsageRecord(line: string): UsageRecord | null {
  return parseUsageLine(line).record;
}

export function emptyParseStats(): ParseStats {
  return { lines: 0, invalidJson: 0, noUsage: 0, badTokenCounts: 0, example: null };
}

// Add the counts in `from` to `into`. `into` keeps its own example if it has one.
export function addParseStats(into: ParseStats, from: ParseStats) {
  into.lines += from.lines;
  into.invalidJson += from.invalidJson;
  into.noUsage += from.noUsage;
  into.badTokenCounts += from.badTokenCounts;
  into.example ??= from.example;
}

// Lines the parser dropped or could not price.
export function skippedLineCount(stats: ParseStats) {
  return stats.invalidJson + stats.noUsage + stats.badTokenCounts;
}

const PROBLEM_TEXT: Record<LineProblem, string> = {
  invalidJson: "not valid JSON",
  noUsage: "assistant record without a usage object",
  badTokenCounts: "usage object without recognized token counts",
};

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
 * writing that line. `skipped` counts problems on complete lines only, so a
 * line still being written is not reported.
 *
 * `chunkBytes` sets the read size. Tests make it small to put chunk
 * boundaries inside lines.
 */
export async function scanUsageRecords(
  file: string,
  start: number = 0,
  { chunkBytes = READ_CHUNK_BYTES }: { chunkBytes?: number } = {},
): Promise<{ records: UsageRecord[]; tail: UsageRecord[]; end: number; skipped: ParseStats }> {
  const stream = fs.createReadStream(file, {
    highWaterMark: chunkBytes,
    start,
  });

  const records: UsageRecord[] = [];
  const skipped = emptyParseStats();
  let end = start;

  // Chunks since the last newline. Joined only once a newline arrives, so a
  // line longer than one chunk is copied once instead of once per chunk.

  let pending: Buffer<ArrayBufferLike>[] = [];

  // `base` is the file offset of `buf`. `stats` is null for the unfinished last line.
  const collect = (buf: Buffer<ArrayBufferLike>, base: number, into: UsageRecord[], stats: ParseStats | null) => {
    for (const { line, start: at } of usageLinesIn(buf)) {
      const { record, problem } = parseUsageLine(line);

      if (record) into.push(record);
      if (!stats) continue;

      stats.lines += 1;
      if (!problem) continue;

      stats[problem] += 1;
      stats.example ??= `${file}, byte ${base + at}: ${PROBLEM_TEXT[problem]}`;
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

    collect(complete, end, records, skipped);
    end += complete.length;
    pending = lastNewline + 1 < chunk.length ? [chunk.subarray(lastNewline + 1)] : [];
  }

  const tail: UsageRecord[] = [];
  if (pending.length) collect(Buffer.concat(pending), end, tail, null);

  return { records, tail, end, skipped };
}

/**
 * Read a JSONL transcript and yield normalized usage events. Pass `stats` to
 * collect the lines that could not be read.
 *
 * The file is read in chunks, so memory grows with the number of usage
 * records, not with the size of the transcript.
 */
export async function* readUsageEvents(file: string, stats?: ParseStats): AsyncGenerator<UsageEvent> {
  const { records, tail, skipped } = await scanUsageRecords(file);

  if (stats) addParseStats(stats, skipped);

  for (const record of [...records, ...tail]) {
    yield* eventsFromRecord(record, file);
  }
}
