import path from "node:path";
import { parseArgs } from "node:util";

import { aggregate, aggregateByMonth } from "./aggregate.ts";
import { readEvents } from "./events.ts";
import { loadPricing, priceForModel } from "./pricing.ts";
import { loadProfiles } from "./profiles.ts";
import { REGIONS, validateRegion } from "./regions.ts";
import { loadSettings } from "./settings.ts";
import { parseSince, startOfMonth } from "./since.ts";
import { expandHome, resolveTranscriptDirs } from "./config.ts";
import { collectDashboard } from "./dashboard/collect.ts";
import { fileLink, summarizeDashboard, summarizeTokens, writeDashboardFile } from "./dashboard/output.ts";
import { renderDashboard } from "./dashboard/render.ts";
import { renderJson } from "./report/json.ts";
import { renderMonthlyJson } from "./report/monthlyJson.ts";
import { renderMonthlyTable } from "./report/monthlyTable.ts";
import { renderProfileReports } from "./report/profiles.ts";
import { dim } from "./report/format.ts";
import { errorMessage } from "./validate.ts";
import { renderTable } from "./report/table.ts";
import { unpricedMessages } from "./report/unpriced.ts";

import type { DashboardSource } from "./dashboard/collect.ts";
import type { StoreMode } from "./events.ts";
import type { ProfileReport } from "./report/profiles.ts";
import type { Unpriced } from "./report/unpriced.ts";
import type { AggregateResult, MonthlyResult, PricingSummary, PricingTable, Profile } from "./types.ts";

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
  --strict            Exit with status 1 when usage comes from a model the
                      pricing file does not list. The report still prints.
                      Without this flag such a run prints a warning on
                      stderr and exits with status 0.
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
  claude-cost --strict --json > usage.json
  claude-cost --region us --by-model
  claude-cost --monthly --by-model
  claude-cost --since 7d --by-model
  claude-cost --since today --json
  claude-cost --dashboard
  claude-cost --dashboard --since 30d --out ~/Desktop/cost.html
`;

// What a scan needs besides the directories to read.
interface Scan {
  pricing: PricingTable;
  since: Date | null;
  store: StoreMode;
}

// Scan transcripts in `dirs`, drop duplicate snapshots and total them, grouped by model on request.
async function collectUsage(dirs: string[], { pricing, since, store }: Scan, byModel: boolean) {
  return aggregate(await readEvents(dirs, store), { pricing, since, byModel });
}

// Scan transcripts in `dirs`, drop duplicate snapshots and total them per month and model.
async function collectMonthly(dirs: string[], { pricing, since, store }: Scan) {
  return aggregateByMonth(await readEvents(dirs, store), { pricing, since });
}

// One report per profile, each scanned with the region and pricing file that profile resolves to.
async function collectProfileReports<R extends PricingSummary>(
  profiles: Profile[],
  flags: { pricingFlag: string | undefined; regionFlag: string | null; settings: { region: string } },
  collect: (dirs: string[], pricing: PricingTable) => Promise<R>,
): Promise<ProfileReport<R>[]> {
  const reports = [];

  for (const profile of profiles) {
    const { region, pricingFile, pricing } = resolveSource({ profile, ...flags });
    reports.push({ profile, region, pricingFile, result: await collect([profile.projectsDir], pricing) });
  }

  return reports;
}

// Where a report came from and how it is labeled.
interface Origin {
  region: string;
  pricingFile: string;
}

function renderUsage(
  result: AggregateResult,
  { byModel, since, region, pricingFile, json }: Origin & { byModel: boolean; since: Date | null; json: boolean },
) {
  const opts = { byModel, since, region, pricingFile };
  return json ? renderJson(result, opts) : renderTable(result, opts);
}

function renderMonthly(
  result: MonthlyResult,
  { since, region, pricingFile, json }: Origin & { since: Date | null; json: boolean },
) {
  const opts = { since, region, pricingFile };
  return json ? renderMonthlyJson(result, opts) : renderMonthlyTable(result, opts);
}

/**
 * Region and pricing file for one source. A flag beats the profile, and the
 * profile beats the settings. `profile` is null when --dir is used.
 */
function resolveSource({
  profile,
  pricingFlag,
  regionFlag,
  settings,
}: {
  profile: Profile | null;
  pricingFlag: string | undefined;
  regionFlag: string | null;
  settings: { region: string };
}) {
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
 * store the other modes use. `unpriced` names the models each pricing file lacks.
 */
async function collectDashboardData({
  profiles,
  flags,
  regionFlag,
  settings,
  since,
  store,
}: {
  profiles: Profile[] | null;
  flags: { dir?: string; pricing?: string };
  regionFlag: string | null;
  settings: { region: string };
  since: Date | null;
  store: StoreMode;
}) {
  const sources: DashboardSource[] = [];

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

  const data = collectDashboard(sources, { since });

  // The dashboard merges its profiles' unknown models, so each pricing file
  // gets the ones it lacks. A model that two files lack is listed for both.
  const unpriced = sources.map(({ pricingFile, pricing }) => ({
    pricingFile,
    models: data.warnings.unknownModels.filter((model) => priceForModel(pricing, model)._unknown),
  }));

  return { data, unpriced };
}

function print(text: string) {
  process.stdout.write(`${text}\n`);
}

// The models a scan priced at $0 and the pricing file that lacks them.
function unpricedOf({ pricingFile, result }: { pricingFile: string; result: PricingSummary }): Unpriced {
  return { pricingFile, models: result.unknownModels };
}

/**
 * Warn on stderr about models priced at $0. Returns the exit status: 1 when
 * `strict` is set and there are such models, otherwise 0.
 */
function reportUnpriced(entries: Unpriced[], strict: boolean) {
  const lines = unpricedMessages(entries, { strict });

  for (const line of lines) console.error(line);
  return strict && lines.length ? 1 : 0;
}

export async function run(argv: string[]) {
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
      strict: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(HELP);
    return 0;
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
    const conflicts = ["json", "by-model", "by-month", "monthly"] as const;

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
  const regionFlag = values.region != null ? validateRegion(values.region, "--region") : null;
  const settings = loadSettings();
  const profiles = values.dir ? null : loadProfiles();

  const store: StoreMode = {
    storeDir: values["no-cache"] ? null : settings.storeDir,
    rebuild: values["rebuild-cache"],
  };

  if (values.dashboard) {
    const { data, unpriced } = await collectDashboardData({
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
        `cannot write the dashboard to ${file}: ${errorMessage(error)}. Pass --out <path> to write it elsewhere.`,
      );
    }

    print(`Dashboard written to ${file}`);
    print(`Open in your browser: ${fileLink(file)}`);
    print(dim(summarizeDashboard(data)));

    const tokens = summarizeTokens(data);
    if (tokens) print(dim(tokens));

    return reportUnpriced(unpriced, values.strict);
  }

  const sourceFlags = { pricingFlag: values.pricing, regionFlag, settings };
  const scanOf = (pricing: PricingTable): Scan => ({ pricing, since, store });

  if (profiles) {
    const options = { since, json: values.json };

    if (byMonth) {
      const reports = await collectProfileReports(profiles, sourceFlags, (dirs, pricing) =>
        collectMonthly(dirs, scanOf(pricing)),
      );

      print(renderProfileReports({ byMonth: true, reports }, options));
      return reportUnpriced(reports.map(unpricedOf), values.strict);
    }

    const reports = await collectProfileReports(profiles, sourceFlags, (dirs, pricing) =>
      collectUsage(dirs, scanOf(pricing), byModel),
    );

    print(renderProfileReports({ byMonth: false, byModel, reports }, options));
    return reportUnpriced(reports.map(unpricedOf), values.strict);
  }

  const { region, pricingFile, pricing } = resolveSource({ profile: null, ...sourceFlags });
  const dirs = resolveTranscriptDirs(values.dir);
  const origin = { region, pricingFile, since, json: values.json };

  if (byMonth) {
    const result = await collectMonthly(dirs, scanOf(pricing));

    print(renderMonthly(result, origin));
    return reportUnpriced([unpricedOf({ pricingFile, result })], values.strict);
  }

  const result = await collectUsage(dirs, scanOf(pricing), byModel);

  print(renderUsage(result, { ...origin, byModel }));
  return reportUnpriced([unpricedOf({ pricingFile, result })], values.strict);
}
