// @ts-check
import { parseArgs } from "node:util";

import { aggregate, aggregateByMonth } from "./aggregate.js";
import { dedupeEvents } from "./dedupe.js";
import { findTranscripts, readUsageEvents } from "./parse.js";
import { loadPricing } from "./pricing.js";
import { loadProfiles } from "./profiles.js";
import { REGIONS, validateRegion } from "./regions.js";
import { loadSettings } from "./settings.js";
import { parseSince, startOfMonth } from "./since.js";
import { resolveTranscriptDirs } from "./config.js";
import { renderJson } from "./report/json.js";
import { renderMonthlyJson } from "./report/monthlyJson.js";
import { renderMonthlyTable } from "./report/monthlyTable.js";
import { renderProfileReports } from "./report/profiles.js";
import { renderTable } from "./report/table.js";

/** @import { AggregateResult, MonthlyResult, PricingTable } from "./types.js" */

// How reports name the bundled pricing file.
const DEFAULT_PRICING_NAME = "pricing.config.json";

const HELP = `
claude-cost — approximate local cost tracking for Claude Code (Vertex AI)

USAGE
  claude-cost [options]

OPTIONS
  --since <value>     Only include activity since this point.
                      Relative: 7d, 24h, 90m, 2w  |  today
                      Date: 2025-01-15 (local midnight)
                      Date and time: 2025-01-15T10:00 (local) or with Z/+02:00
  --monthly           Only include activity since the start of the current month.
  --by-month          Break down totals per month and per model (all history).
  --by-model          Break down totals per model. Not needed with --by-month.
  --json              Output machine-readable JSON instead of a table.
  --dir <path>        Override the transcript directory to scan.
                      Ignores profiles.config.json.
  --pricing <path>    Use a custom pricing JSON file.
                      Overrides any per-profile pricing file.
  --region <name>     Vertex AI endpoint you call. Non-global endpoints
                      cost 10% more. Overrides the region in
                      settings.config.json and in profiles.
                      ${REGIONS.join(", ")}
  -h, --help          Show this help.

SETTINGS
  settings.config.json next to this program sets defaults. Copy
  settings.config.example.json to get started. "region" defaults to global.

PROFILES
  If profiles.config.json exists next to this program, each listed Claude
  config directory is calculated and printed separately. Copy
  profiles.config.example.json to get started. Without that file, transcripts
  from the default Claude config directories are merged into one report, or
  only from CLAUDE_CONFIG_DIR when it is set.

EXAMPLES
  claude-cost
  claude-cost --by-month
  claude-cost --by-month --since 2025-01-01 --json
  claude-cost --dir ~/.claude/projects --pricing ./my-prices.json
  claude-cost --region us --by-model
  claude-cost --monthly --by-model
  claude-cost --since 7d --by-model
  claude-cost --since today --json
`;

/**
 * Scan transcripts in `dirs`, drop duplicate snapshots and aggregate them.
 *
 * @param {string[]} dirs
 * @param {{ pricing: PricingTable, since: Date | null, byModel: boolean, byMonth: boolean }} opts
 * @returns {Promise<AggregateResult | MonthlyResult>}
 */
async function collectReport(dirs, { pricing, since, byModel, byMonth }) {
  async function* allEvents() {
    /** @type {Set<string>} */
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

/**
 * @param {AggregateResult | MonthlyResult} result
 * @param {{ byMonth: boolean, byModel: boolean, since: Date | null, region: string, pricingFile: string, json: boolean }} opts
 */
function renderSingle(
  result,
  { byMonth, byModel, since, region, pricingFile, json },
) {
  if (byMonth) {
    const monthly = /** @type {MonthlyResult} */ (result);
    const opts = { since, region, pricingFile };

    return json
      ? renderMonthlyJson(monthly, opts)
      : renderMonthlyTable(monthly, opts);
  }

  const totals = /** @type {AggregateResult} */ (result);
  const opts = { byModel, since, region, pricingFile };

  return json ? renderJson(totals, opts) : renderTable(totals, opts);
}

/** @param {string} text */
function print(text) {
  process.stdout.write(`${text}\n`);
}

/** @param {string[]} argv */
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
      region: { type: "string" },
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

  if (values["by-model"] && values["by-month"]) {
    throw new Error(
      "use either --by-model or --by-month, not both. --by-month already breaks each month down per model.",
    );
  }

  const byModel = values["by-model"];
  const byMonth = values["by-month"];
  const since = values.monthly ? startOfMonth() : parseSince(values.since);
  const regionFlag =
    values.region != null ? validateRegion(values.region, "--region") : null;
  const settings = loadSettings();
  const profiles = values.dir ? null : loadProfiles();

  if (profiles) {
    const reports = [];
    for (const profile of profiles) {
      const region = regionFlag || profile.region || settings.region;
      const pricingPath = values.pricing || profile.pricing || undefined;
      const pricing = loadPricing(pricingPath, region);

      const result = await collectReport([profile.projectsDir], {
        pricing,
        since,
        byModel,
        byMonth,
      });

      reports.push({
        pricingFile: pricingPath ?? DEFAULT_PRICING_NAME,
        profile,
        region,
        result,
      });
    }

    print(
      renderProfileReports(reports, {
        byModel,
        byMonth,
        since,
        json: values.json,
      }),
    );

    return;
  }

  const region = regionFlag || settings.region;
  const dirs = resolveTranscriptDirs(values.dir);
  const pricing = loadPricing(values.pricing, region);
  const result = await collectReport(dirs, {
    pricing,
    since,
    byModel,
    byMonth,
  });

  print(
    renderSingle(result, {
      byModel,
      byMonth,
      json: values.json,
      pricingFile: values.pricing || DEFAULT_PRICING_NAME,
      region,
      since,
    }),
  );
}
