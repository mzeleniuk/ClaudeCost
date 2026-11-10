// @ts-check
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

import { isPlainObject } from "./validate.js";

/** @import { Usage, UsageEvent } from "./types.js" */

/**
 * Recursively yield all *.jsonl files under a directory.
 * `visited` holds real paths already scanned, so symlink cycles end.
 *
 * @param {string} dir
 * @param {Set<string>} [visited]
 * @returns {AsyncGenerator<string>}
 */
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
 *
 * @param {any} [raw] `usage` object from a transcript record.
 * @returns {Usage}
 */
export function normalizeUsage(raw = {}) {
  const breakdown = isPlainObject(raw.cache_creation) ? raw.cache_creation : {};
  const breakdown5m = breakdown.ephemeral_5m_input_tokens ?? 0;
  const breakdown1h = breakdown.ephemeral_1h_input_tokens ?? 0;
  const hasBreakdown = breakdown5m + breakdown1h > 0;

  const cacheWrite5m = hasBreakdown ? breakdown5m : 0;
  const cacheWrite1h = hasBreakdown ? breakdown1h : 0;
  const cacheWrite = hasBreakdown
    ? cacheWrite5m + cacheWrite1h
    : (raw.cache_creation_input_tokens ?? 0);

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

/** @param {Usage} usage */
function hasBillableTokens(usage) {
  return (
    usage.input > 0 ||
    usage.output > 0 ||
    usage.cacheRead > 0 ||
    usage.cacheWrite > 0
  );
}

/**
 * Extract advisor_message iterations from usage.
 * Other iteration types are ignored; top-level usage stays on the main model.
 *
 * @param {any} [raw]
 * @returns {{ model: string, usage: Usage }[]}
 */
export function advisorUsagesFromRaw(raw = {}) {
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

/**
 * Stream a JSONL transcript and yield normalized usage events.
 *
 * Advisor iterations (type advisor_message) are yielded as separate events
 * under the advisor model, with messageId `{id}:advisor:{index}` when the
 * parent has an id.
 *
 * Streaming line-by-line keeps memory flat even for very large transcripts.
 *
 * @param {string} file
 * @returns {AsyncGenerator<UsageEvent>}
 */
export async function* readUsageEvents(file) {
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    // Most lines are tool output and chat text with no usage. A usage key is
    // always written as the literal "usage", so skip the rest before parsing.
    if (!line.includes('"usage"')) continue;

    const trimmed = line.trim();
    if (!trimmed) continue;

    let record;

    try {
      record = JSON.parse(trimmed);
    } catch {
      continue; // tolerate partial/corrupt lines
    }

    const msg = record.message ?? record;
    const rawUsage = msg?.usage;
    if (!rawUsage) continue;

    const usage = normalizeUsage(rawUsage);
    const advisors = advisorUsagesFromRaw(rawUsage);
    if (!hasBillableTokens(usage) && advisors.length === 0) continue;

    const tsRaw = record.timestamp || record.ts || msg?.timestamp;
    const tsDate = tsRaw ? new Date(tsRaw) : null;
    const ts = tsDate && !Number.isNaN(tsDate.getTime()) ? tsDate : null;
    const messageId = msg.id || null;
    const requestId = record.requestId || null;

    if (hasBillableTokens(usage)) {
      yield {
        ts,
        model: msg.model || record.model || "unknown",
        usage,
        messageId,
        requestId,
        file,
      };
    }

    for (const [index, advisor] of advisors.entries()) {
      if (!hasBillableTokens(advisor.usage)) continue;
      yield {
        ts,
        model: advisor.model,
        usage: advisor.usage,
        messageId: messageId != null ? `${messageId}:advisor:${index}` : null,
        requestId,
        file,
      };
    }
  }
}
