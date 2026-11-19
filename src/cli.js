// @ts-check
import path from "node:path";
import { parseArgs } from "node:util";

import { aggregate, aggregateByMonth } from "./aggregate.js";
import { readEvents } from "./events.js";
import { loadPricing } from "./pricing.js";
import { loadProfiles } from "./profiles.js";
import { REGIONS, validateRegion } from "./regions.js";
import { loadSettings } from "./settings.js";
import { parseSince, startOfMonth } from "./since.js";
import { expandHome, resolveTranscriptDirs } from "./config.js";
import { collectDashboard } from "./dashboard/collect.js";
import {
  fileLink,
  summarizeDashboard,
  summarizeTokens,
  writeDashboardFile,
} from "./dashboard/output.js";
import { renderDashboard } from "./dashboard/render.js";
import { renderJson } from "./report/json.js";
import { renderMonthlyJson } from "./report/monthlyJson.js";
import { renderMonthlyTable } from "./report/monthlyTable.js";
import { renderProfileReports } from "./report/profiles.js";
import { dim } from "./report/format.js";
import { renderTable } from "./report/table.js";

/** @import { DashboardSource } from "./dashboard/collect.js" */
/** @import { StoreMode } from "./events.js" */
/**
 * @import {
 *   AggregateResult,
 *   MonthlyResult,
 *   PricingTable,
 *   Profile,
 * } from "./types.js"
 */

// How reports name the bundled pricing file.
const DEFAULT_PRICING_NAME = "pricing.config.json";

// File name --dashboard uses in the store folder when --out is not given.
const DEFAULT_DASHBOARD_NAME = "dashboard.html";

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
  --dashboard         Write an HTML dashboard of all your usage to one file.
                      It works offline and filters in the browser. It lists
                      project names and spend, so keep it private.
                      Prints a file:// link to open in any browser.
                      Not with --json, --by-model, --by-month or --monthly.
  --out <path>        Where --dashboard writes. Default: dashboard.html in
                      the store folder (data/, see "storeDir" below).
  --dir <path>        Override the transcript directory to scan.
                      Ignores profiles.config.json.
  --pricing <path>    Use a custom pricing JSON file.
                      Overrides any per-profile pricing file.
  --region <name>     Vertex AI endpoint you call. Non-global endpoints
                      cost 10% more. Overrides the region in
                      settings.config.json and in profiles.
                      ${REGIONS.join(", ")}
  --no-cache          Read every transcript from disk and leave the usage
                      store alone. Totals miss deleted transcripts.
  --rebuild-cache     Read every transcript on disk again and rewrite the
                      usage store. Keeps usage from deleted transcripts.
  -h, --help          Show this help.

SETTINGS
  settings.config.json next to this program sets defaults. Copy
  settings.config.example.json to get started. "region" defaults to global.
  "storeDir" defaults to the data folder next to this program.

USAGE STORE
  Usage read from transcripts is saved in the store, one file per
  transcript directory, so later runs read only new transcript data. Claude
  Code deletes transcripts after cleanupPeriodDays, 30 days by default. Their
  usage stays in the store and in the totals, so back the store up. It may
  be the only copy of that history.

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
  claude-cost --dashboard
  claude-cost --dashboard --since 30d --out ~/Desktop/cost.html
`;

/**
 * Scan transcripts in `dirs`, drop duplicate snapshots and aggregate them.
 *
 * @param {string[]} dirs
 * @param {{ pricing: PricingTable, since: Date | null, byModel: boolean, byMonth: boolean, store: StoreMode }} opts
 * @returns {Promise<AggregateResult | MonthlyResult>}
 */
async function collectReport(
  dirs,
  { pricing, since, byModel, byMonth, store },
) {
  const deduped = await readEvents(dirs, store);

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

/**
 * Region and pricing file for one source. A flag beats the profile, and the
 * profile beats the settings. `profile` is null when --dir is used.
 *
 * @param {object} opts
 * @param {Profile | null} opts.profile
 * @param {string | undefined} opts.pricingFlag
 * @param {string | null} opts.regionFlag
 * @param {{ region: string }} opts.settings
 */
function resolveSource({ profile, pricingFlag, regionFlag, settings }) {
  const region = regionFlag || profile?.region || settings.region;
  const pricingPath = pricingFlag || profile?.pricing || undefined;

  return {
    region,
    pricingFile: pricingPath ?? DEFAULT_PRICING_NAME,
    pricing: loadPricing(pricingPath, region),
  };
}

/**
 * Build the dashboard data from the same profiles, directories, pricing and
 * store the other modes use.
 *
 * @param {object} opts
 * @param {Profile[] | null} opts.profiles
 * @param {{ dir?: string, pricing?: string }} opts.flags
 * @param {string | null} opts.regionFlag
 * @param {{ region: string }} opts.settings
 * @param {Date | null} opts.since
 * @param {StoreMode} opts.store
 */
async function collectDashboardData({
  profiles,
  flags,
  regionFlag,
  settings,
  since,
  store,
}) {
  /** @type {DashboardSource[]} */
  const sources = [];

  if (profiles) {
    for (const profile of profiles) {
      const { region, pricingFile, pricing } = resolveSource({
        profile,
        pricingFlag: flags.pricing,
        regionFlag,
        settings,
      });

      const dirs = [profile.projectsDir];

      sources.push({
        name: profile.name,
        region,
        pricingFile,
        pricing,
        dirs,
        events: await readEvents(dirs, store),
      });
    }
  } else {
    const { region, pricingFile, pricing } = resolveSource({
      profile: null,
      pricingFlag: flags.pricing,
      regionFlag,
      settings,
    });

    const dirs = resolveTranscriptDirs(flags.dir);

    sources.push({
      name: "default",
      region,
      pricingFile,
      pricing,
      dirs,
      events: await readEvents(dirs, store),
    });
  }

  return collectDashboard(sources, { since });
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
      dashboard: { type: "boolean", default: false },
      dir: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
      json: { type: "boolean", default: false },
      monthly: { type: "boolean", default: false },
      "no-cache": { type: "boolean", default: false },
      out: { type: "string" },
      pricing: { type: "string" },
      "rebuild-cache": { type: "boolean", default: false },
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

  if (values["no-cache"] && values["rebuild-cache"]) {
    throw new Error("use either --no-cache or --rebuild-cache, not both.");
  }

  if (values.dashboard) {
    const conflicts = /** @type {const} */ ([
      "json",
      "by-model",
      "by-month",
      "monthly",
    ]);

    for (const flag of conflicts) {
      if (values[flag]) {
        throw new Error(`use either --dashboard or --${flag}, not both.`);
      }
    }

    if (values.out != null && values.out.trim() === "") {
      throw new Error("--out needs a file path.");
    }
  } else if (values.out != null) {
    throw new Error("--out needs --dashboard.");
  }

  const byModel = values["by-model"];
  const byMonth = values["by-month"];
  const since = values.monthly ? startOfMonth() : parseSince(values.since);
  const regionFlag =
    values.region != null ? validateRegion(values.region, "--region") : null;
  const settings = loadSettings();
  const profiles = values.dir ? null : loadProfiles();
  /** @type {StoreMode} */
  const store = {
    storeDir: values["no-cache"] ? null : settings.storeDir,
    rebuild: values["rebuild-cache"],
  };

  if (values.dashboard) {
    const data = await collectDashboardData({
      profiles,
      flags: values,
      regionFlag,
      settings,
      since,
      store,
    });

    const file = values.out
      ? path.resolve(expandHome(values.out))
      : path.join(settings.storeDir, DEFAULT_DASHBOARD_NAME);

    const html = renderDashboard(data);

    try {
      writeDashboardFile(file, html);
    } catch (error) {
      throw new Error(
        `cannot write the dashboard to ${file}: ${/** @type {Error} */ (error).message}. Pass --out <path> to write it elsewhere.`,
      );
    }

    print(`Dashboard written to ${file}`);
    print(`Open in your browser: ${fileLink(file)}`);
    print(dim(summarizeDashboard(data)));

    const tokens = summarizeTokens(data);
    if (tokens) print(dim(tokens));

    return;
  }

  if (profiles) {
    const reports = [];
    for (const profile of profiles) {
      const { region, pricingFile, pricing } = resolveSource({
        profile,
        pricingFlag: values.pricing,
        regionFlag,
        settings,
      });

      const result = await collectReport([profile.projectsDir], {
        byModel,
        byMonth,
        pricing,
        since,
        store,
      });

      reports.push({
        pricingFile,
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

  const { region, pricingFile, pricing } = resolveSource({
    profile: null,
    pricingFlag: values.pricing,
    regionFlag,
    settings,
  });
  const dirs = resolveTranscriptDirs(values.dir);
  const result = await collectReport(dirs, {
    byModel,
    byMonth,
    pricing,
    since,
    store,
  });

  print(
    renderSingle(result, {
      byModel,
      byMonth,
      json: values.json,
      pricingFile,
      region,
      since,
    }),
  );
}
