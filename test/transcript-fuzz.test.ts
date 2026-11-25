import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { dedupeEvents } from "../src/dedupe.ts";
import {
  emptyParseStats,
  eventsFromRecord,
  parseUsageLine,
  readUsageEvents,
  scanUsageRecords,
  skippedLineCount,
} from "../src/parse.ts";
import { readStoredEvents } from "../src/store.ts";
import type { UsageEvent } from "../src/types.ts";

/**
 * Seeded fuzz over the fixture transcripts. Each run mutates lines the way a
 * format change or a crash could, writes them to a file and checks what the
 * parser promises:
 *
 *   - it never throws
 *   - the result does not depend on how the file is split into read chunks
 *   - every complete line with a "usage" key that is not valid JSON is counted
 *   - a mutation that loses a line's event is counted, unless it also removed the "usage" key
 *   - reading through the usage store gives the same totals and counts
 *
 * FUZZ_SEED and FUZZ_RUNS override the defaults. A failure names its seed and run.
 */
const SEED = Number(process.env.FUZZ_SEED ?? 20261125);
const RUNS = Number(process.env.FUZZ_RUNS ?? 60);

const TRANSCRIPTS = path.join(import.meta.dirname, "transcripts");

const POOL = fs
  .readdirSync(TRANSCRIPTS)
  .filter((name) => name.endsWith(".jsonl"))
  .flatMap((name) => fs.readFileSync(path.join(TRANSCRIPTS, name), "utf8").split("\n"))
  .filter(Boolean);

// A small seeded generator, mulberry32, so a failing run can be repeated.
function random(seed: number) {
  let state = seed >>> 0;

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    below: (n: number) => Math.floor(next() * n),
    pick: <T>(items: T[]): T => items[Math.floor(next() * items.length)],
    chance: (p: number) => next() < p,
  };
}

type Rng = ReturnType<typeof random>;
type Json = Record<string, any> | any[];

// Every path to a value below `root`, as lists of keys.
function pathsIn(root: Json, prefix: (string | number)[] = [], depth = 0): (string | number)[][] {
  if (depth > 5 || typeof root !== "object" || root === null) return [];

  return Object.entries(root).flatMap(([key, value]) => {
    const here = [...prefix, Array.isArray(root) ? Number(key) : key];
    return [here, ...pathsIn(value, here, depth + 1)];
  });
}

const REPLACEMENTS = ["x", "12", null, 7, -1, {}, [], true];

// One structural change to a parsed line: delete, rename or retype a value.
function mutateStructure(line: string, rng: Rng) {
  const root = JSON.parse(line);
  const paths = pathsIn(root);
  if (paths.length === 0) return line;

  const target = rng.pick(paths);
  const parent = target.slice(0, -1).reduce((node, key) => node[key], root);
  const key = target.at(-1) as string | number;
  const op = rng.below(3);

  if (op === 0) {
    if (Array.isArray(parent)) parent.splice(Number(key), 1);
    else delete parent[key];
  } else if (op === 1 && !Array.isArray(parent)) {
    parent[`${key}_v2`] = parent[key];
    delete parent[key];
  } else {
    parent[key] = rng.pick(REPLACEMENTS);
  }

  return JSON.stringify(root);
}

function mutateLine(line: string, rng: Rng) {
  const kind = rng.below(10);

  if (kind < 5) return line;
  if (kind < 8) return mutateStructure(line, rng);
  if (kind === 8) return line.slice(0, 1 + rng.below(line.length - 1)); // cut off
  return `${"\u0000x{"}${line}`; // garbage in front
}

function validJson(text: string) {
  try {
    JSON.parse(text.trim());
    return true;
  } catch {
    return false;
  }
}

// How many events one line gives, and whether the parser counted a problem with it.
function lineOutcome(line: string) {
  const { record, problem } = parseUsageLine(line);
  return { events: record ? eventsFromRecord(record, "f").length : 0, problem };
}

const CHUNKS = [7, 100, undefined];

for (let run = 0; run < RUNS; run++) {
  const label = `seed ${SEED}, run ${run}`;

  test(`fuzz: ${label}`, async () => {
    const rng = random(SEED + run * 7919);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cost-fuzz-"));

    try {
      const originals = Array.from({ length: 6 + rng.below(8) }, () => rng.pick(POOL));
      const lines = originals.map((line) => mutateLine(line, rng));

      for (const [index, line] of lines.entries()) {
        const original = lineOutcome(originals[index]);
        const mutated = lineOutcome(line);

        if (original.events > 0 && mutated.events === 0 && line.includes('"usage"')) {
          assert.ok(mutated.problem, `${label}: lost an event without a count: ${line}`);
        }
      }

      const eol = rng.chance(0.25) ? "\r\n" : "\n";
      const endsWithNewline = rng.chance(0.7);
      const text = lines.join(eol) + (endsWithNewline ? eol : "");
      const complete = endsWithNewline ? lines : lines.slice(0, -1);
      const withUsage = complete.filter((line) => line.includes('"usage"'));

      const projects = path.join(root, "projects");
      const file = path.join(projects, "proj", "session.jsonl");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);

      const scans = await Promise.all(
        CHUNKS.map((chunkBytes) => scanUsageRecords(file, 0, chunkBytes ? { chunkBytes } : {})),
      );

      for (const scan of scans.slice(1)) assert.deepEqual(scan, scans[0], `${label}: chunk size changed the result`);

      const { records, skipped } = scans[0];

      assert.equal(skipped.lines, withUsage.length, `${label}: lines`);

      assert.equal(
        skipped.invalidJson,
        withUsage.filter((line) => !validJson(line)).length,
        `${label}: invalid JSON lines`,
      );

      assert.ok(records.length + skipped.invalidJson + skipped.noUsage <= skipped.lines, `${label}: accounting`);

      const parse = emptyParseStats();
      const direct: UsageEvent[] = [];
      for await (const event of readUsageEvents(file, parse)) direct.push(event);

      assert.deepEqual(parse, skipped, `${label}: readUsageEvents stats`);

      const storeParse = emptyParseStats();

      const stored = await readStoredEvents(projects, {
        storeDir: path.join(root, "data"),
        parse: storeParse,
      });

      assert.deepEqual(storeParse, skipped, `${label}: store stats`);
      assert.equal(skippedLineCount(storeParse), skippedLineCount(skipped));

      const totals = (events: UsageEvent[]) =>
        events
          .map((event) => [event.messageId, event.requestId, event.model, event.usage.input, event.usage.output])
          .sort((a, b) => String(a).localeCompare(String(b)));

      assert.deepEqual(
        totals(await dedupeEvents(stored)),
        totals(await dedupeEvents(direct)),
        `${label}: store events`,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
