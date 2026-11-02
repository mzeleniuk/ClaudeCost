import { parseArgs } from "node:util";

import { aggregate } from "./aggregate.js";
import { aggregateByMonth } from "./aggregateByMonth.js";
import { dedupeEvents } from "./dedupe.js";
import { findTranscripts, readUsageEvents } from "./parse.js";
import { loadPricing } from "./pricing.js";
import { loadProfiles } from "./profiles.js";
import { parseSince, startOfMonth } from "./since.js";
import { resolveTranscriptDirs } from "./config.js";
import { renderJson } from "./report/json.js";
import { renderMonthlyJson } from "./report/monthlyJson.js";
import { renderMonthlyTable } from "./report/monthlyTable.js";
import { renderProfileReports } from "./report/profiles.js";
import { renderTable } from "./report/table.js";

const HELP = `
claude-cost — approximate local cost tracking for Claude Code (Vertex AI)

USAGE
  claude-cost [options]

OPTIONS
  --since <value>     Only include activity since this point.
                      Relative: 7d, 24h, 90m, 2w  |  today  |  ISO: 2025-01-15
  --monthly           Only include activity since the start of the current month.
  --by-month          Break down totals per month and per model (all history).
  --by-model          Break down totals per model.
  --json              Output machine-readable JSON instead of a table.
  --dir <path>        Override the transcript directory to scan.
                      Ignores profiles.config.json.
  --pricing <path>    Use a custom pricing JSON file.
                      Overrides any per-profile pricing file.
  -h, --help          Show this help.

PROFILES
  If profiles.config.json exists next to this program, each listed Claude
  config directory is calculated and printed separately. Copy
  profiles.config.example.json to get started. Without that file, transcripts
  from the default Claude config directories are merged into one report.

EXAMPLES
  claude-cost
  claude-cost --by-month
  claude-cost --by-month --since 2025-01-01 --json
  claude-cost --dir ~/.claude/projects --pricing ./my-prices.json
  claude-cost --monthly --by-model
  claude-cost --since 7d --by-model
  claude-cost --since today --json
`;

async function collectReport(dirs, { pricing, since, byModel, byMonth }) {
  async function* allEvents() {
    const visited = new Set();

    for (const dir of dirs) {
      for await (const file of findTranscripts(dir, visited)) {
        yield* readUsageEvents(file);
      }
    }
  }

  const deduped = await dedupeEvents(allEvents());

  if (byMonth) {
    return aggregateByMonth(deduped, { pricing, since });
  }

  return aggregate(deduped, { pricing, since, byModel });
}

function renderSingle(result, { byMonth, byModel, since, json }) {
  if (byMonth) {
    const opts = { since };
    if (json) renderMonthlyJson(result, opts);
    else renderMonthlyTable(result, opts);
    return;
  }

  const opts = { byModel, since };
  if (json) renderJson(result, opts);
  else renderTable(result, opts);
}

export async function run(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "by-model": { type: "boolean", default: false },
      "by-month": { type: "boolean", default: false },
      dir: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
      json: { type: "boolean", default: false },
      monthly: { type: "boolean", default: false },
      pricing: { type: "string" },
      since: { type: "string" },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(HELP);
    return;
  }

  if (values.monthly && values.since != null) {
    throw new Error("use either --monthly or --since, not both.");
  }

  if (values.monthly && values["by-month"]) {
    throw new Error("use either --monthly or --by-month, not both.");
  }

  const byModel = values["by-model"];
  const byMonth = values["by-month"];
  const since = values.monthly ? startOfMonth() : parseSince(values.since);
  const profiles = values.dir ? null : loadProfiles();

  if (profiles) {
    const reports = [];
    for (const profile of profiles) {
      const pricing = loadPricing(
        values.pricing || profile.pricing || undefined,
      );

      const result = await collectReport([profile.projectsDir], {
        pricing,
        since,
        byModel,
        byMonth,
      });

      reports.push({ profile, result });
    }

    renderProfileReports(reports, {
      byModel,
      byMonth,
      since,
      json: values.json,
    });

    return;
  }

  const dirs = resolveTranscriptDirs(values.dir);
  const pricing = loadPricing(values.pricing);
  const result = await collectReport(dirs, {
    pricing,
    since,
    byModel,
    byMonth,
  });

  renderSingle(result, {
    byMonth,
    byModel,
    since,
    json: values.json,
  });
}
