import fs from "node:fs";
import path from "node:path";

/**
 * Build the per-version fixtures in test/transcripts from real transcripts.
 *
 *   node scripts/sanitize-transcript.ts <projects-dir> <out-dir> <version>...
 *
 * For each Claude Code version it keeps a few assistant records with
 * different usage shapes. The usage object is copied as written, because it
 * is the format under test. Ids and timestamps are replaced and message text
 * is dropped, so no private content reaches the repo. It also writes
 * non-assistant lines with a "usage" key, which the parser must ignore.
 *
 * The expected events come from the raw token fields, not from the parser.
 */

const [projectsDir, outDir, ...versions] = process.argv.slice(2);

if (!projectsDir || !outDir || versions.length === 0) {
  console.error("usage: node scripts/sanitize-transcript.ts <projects-dir> <out-dir> <version>...");
  process.exit(1);
}

const PER_VERSION = 4;

type Json = Record<string, any>;

function* transcriptFiles(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) yield* transcriptFiles(full);
    else if (entry.name.endsWith(".jsonl")) yield full;
  }
}

// Records with the same signature have the same usage shape.
function signature(usage: Json) {
  const cache = usage.cache_creation ?? {};
  const iterations = Array.isArray(usage.iterations) ? usage.iterations.length : 0;

  return [
    Object.keys(usage).sort().join(","),
    cache.ephemeral_1h_input_tokens > 0 ? "1h" : "5m",
    iterations > 0 ? "iterations" : "plain",
  ].join("|");
}

function tokens(usage: Json) {
  return {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
  };
}

const wanted = new Set(versions);
const found = new Map<string, Map<string, Json>>();

for (const file of transcriptFiles(projectsDir)) {
  for (const text of fs.readFileSync(file, "utf8").split("\n")) {
    if (!text.includes('"type":"assistant"')) continue;

    let record;

    try {
      record = JSON.parse(text);
    } catch {
      continue;
    }

    const usage = record.message?.usage;
    if (record.type !== "assistant" || !wanted.has(record.version) || !usage) continue;
    if (Object.values(tokens(usage)).every((count) => count === 0)) continue;
    if (JSON.stringify(usage.iterations ?? []).includes("advisor_message")) continue;

    const bySignature = found.get(record.version) ?? new Map();
    const key = signature(usage);

    if (!bySignature.has(key)) bySignature.set(key, record);
    found.set(record.version, bySignature);
  }
}

fs.mkdirSync(outDir, { recursive: true });

for (const [index, version] of versions.entries()) {
  const records = [...(found.get(version)?.values() ?? [])].slice(0, PER_VERSION);

  if (records.length === 0) throw new Error(`no assistant records with usage for version ${version}`);

  const stamp = (n: number) => new Date(Date.UTC(2026, index, 1, 10, n)).toISOString();
  const lines: string[] = [];
  const expected = [];

  // A tool result with its own usage object, as subagent results have.
  lines.push(
    JSON.stringify({
      type: "user",
      version,
      timestamp: stamp(0),
      message: { role: "user", content: "tool result" },
      toolUseResult: { totalTokens: 7, usage: { input_tokens: 3, output_tokens: 4 } },
    }),
  );

  for (const [n, record] of records.entries()) {
    const messageId = `msg-${version}-${n}`;
    const requestId = `req-${version}-${n}`;
    const timestamp = stamp(n + 1);

    lines.push(
      JSON.stringify({
        type: "assistant",
        version,
        timestamp,
        requestId,
        message: {
          id: messageId,
          type: "message",
          role: "assistant",
          model: record.message.model,
          usage: record.message.usage,
        },
      }),
    );

    expected.push({
      messageId,
      requestId,
      model: record.message.model,
      ts: timestamp,
      ...tokens(record.message.usage),
    });
  }

  lines.push(JSON.stringify({ type: "attachment", version, timestamp: stamp(9), attachment: { type: "note" } }));

  fs.writeFileSync(path.join(outDir, `claude-code-${version}.jsonl`), `${lines.join("\n")}\n`);
  fs.writeFileSync(path.join(outDir, `claude-code-${version}.expected.json`), `${JSON.stringify(expected, null, 2)}\n`);
  console.log(`${version}: ${records.length} records`);
}
