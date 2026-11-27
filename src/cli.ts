import path from "node:path";
import { parseArgs } from "node:util";

import { aggregate, aggregateByMonth } from "./aggregate.ts";
import { backupStore } from "./backup.ts";
import { buildBudget, parseBudget } from "./budget.ts";
import { parseCompare, periodUsage, previousPeriod } from "./compare.ts";
import { readEvents } from "./events.ts";
import { emptyParseStats } from "./parse.ts";
import { loadPricing, priceForModel } from "./pricing.ts";
import { loadProfiles } from "./profiles.ts";
import { REGIONS, validateRegion } from "./regions.ts";
import { loadSettings } from "./settings.ts";
import { monthKey, parseSince, startOfMonth } from "./since.ts";
import { expandHome, resolveTranscriptDirs } from "./config.ts";
import { collectDashboard } from "./dashboard/collect.ts";
import { fileLink, summarizeDashboard, summarizeTokens, writeDashboardFile } from "./dashboard/output.ts";
import { renderDashboard } from "./dashboard/render.ts";
import { budgetLines, overBudgetMessages, paceMessages } from "./report/budget.ts";
import { compareLines } from "./report/compare.ts";
import { renderJson } from "./report/json.ts";
import { renderMonthlyJson } from "./report/monthlyJson.ts";
import { renderMonthlyTable } from "./report/monthlyTable.ts";
import { renderProfileReports } from "./report/profiles.ts";
import { dim } from "./report/format.ts";
import { errorMessage } from "./validate.ts";
import { renderTable } from "./report/table.ts";
import { skippedMessage } from "./report/skipped.ts";
import { unpricedMessages } from "./report/unpriced.ts";

import type { DashboardSource } from "./dashboard/collect.ts";
import type { StoreMode } from "./events.ts";
import type { ProfileReport } from "./report/profiles.ts";
import type { Unpriced } from "./report/unpriced.ts";
import type {
  AggregateResult,
  BudgetReport,
  CompareReport,
  MonthlyResult,
  ParseStats,
  Period,
  PricingSummary,
  PricingTable,
  Profile,
} from "./types.ts";

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
  --compare previous  Set the period --since or --monthly picks against the
                      period of the same length right before it, and print the
                      change in cost. For --monthly, that is the same stretch
                      of the previous month, up to the same day and time.
                      With --by-model it lists the change per model. With
                      --json it adds a "compare" key. Not with --by-month or
                      --dashboard.
  --budget <usd>      Warn on stderr when this month's spend passes <usd>.
                      The month is the current calendar month in local time,
                      whatever --since says. Overrides "budget" in
                      settings.config.json. With --strict the run exits with
                      status 1 instead of only warning.
  --forecast          Project this month's spend to the end of the month from
                      the pace so far. It needs one full day of the month.
                      With a budget, it warns when the projection passes it.
  --strict            Exit with status 1 when usage comes from a model the
                      pricing file does not list, when transcript lines with
                      usage could not be read, or when this month's spend
                      passes the budget. The report still prints.
                      Without this flag such a run prints a warning on
                      stderr and exits with status 0.
  --backup <path>     Copy the usage store into a new claude-cost-backup-<time>
                      folder inside <path>, then exit. Nothing is overwritten.
                      Use it on its own, with no other option.
  --no-cache          Read every transcript from disk and leave the usage
                      store alone. Totals miss deleted transcripts.
  --rebuild-cache     Read every transcript on disk again and rewrite the
                      usage store. Keeps usage from deleted transcripts.
  -h, --help          Show this help.

SETTINGS
  settings.config.json next to this program sets defaults. Copy
  settings.config.example.json to get started. "region" defaults to global.
  "storeDir" defaults to the data folder next to this program. "budget" is a
  monthly limit in USD and is off unless set.

USAGE STORE
  Usage read from transcripts is saved in the store, one file per
  transcript directory, so later runs read only new transcript data. Claude
  Code deletes transcripts after cleanupPeriodDays, 30 days by default. Their
  usage stays in the store and in the totals, so back the store up with
  --backup. It may be the only copy of that history. To restore, copy the
  files from a backup folder into the store folder.

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
  claude-cost --since 7d --compare previous
  claude-cost --monthly --by-model --compare previous
  claude-cost --budget 200 --forecast
  claude-cost --budget 200 --strict --since 7d
  claude-cost --region us --by-model
  claude-cost --monthly --by-model
  claude-cost --since 7d --by-model
  claude-cost --since today --json
  claude-cost --dashboard
  claude-cost --dashboard --since 30d --out ~/Desktop/cost.html
  claude-cost --backup ~/Documents/claude-cost-backups
`;

// What a scan needs besides the directories to read. `until` is exclusive.
interface Scan {
  pricing: PricingTable;
  since: Date | null;
  until?: Date | null;
  store: StoreMode;
}

// Scan transcripts in `dirs`, drop duplicate snapshots and total them, grouped by model on request.
async function collectUsage(dirs: string[], { pricing, since, until, store }: Scan, byModel: boolean) {
  const parse = emptyParseStats();
  return aggregate(await readEvents(dirs, store, parse), { pricing, since, until, byModel, parse });
}

// Scan transcripts in `dirs`, drop duplicate snapshots and total them per month and model.
async function collectMonthly(dirs: string[], { pricing, since, store }: Scan) {
  const parse = emptyParseStats();
  return aggregateByMonth(await readEvents(dirs, store, parse), { pricing, since, parse });
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
  {
    byModel,
    since,
    region,
    pricingFile,
    json,
    budget,
    compare,
  }: Origin & {
    byModel: boolean;
    since: Date | null;
    json: boolean;
    budget: BudgetReport | null;
    compare: CompareReport | null;
  },
) {
  const opts = { byModel, since, region, pricingFile };
  return json ? renderJson(result, { ...opts, budget, compare }) : renderTable(result, opts);
}

function renderMonthly(
  result: MonthlyResult,
  {
    since,
    region,
    pricingFile,
    json,
    budget,
  }: Origin & { since: Date | null; json: boolean; budget: BudgetReport | null },
) {
  const opts = { since, region, pricingFile };
  return json ? renderMonthlyJson(result, { ...opts, budget }) : renderMonthlyTable(result, opts);
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

// What decides a source's region and pricing file, and which sources there are.
interface SourceFlags {
  pricingFlag: string | undefined;
  regionFlag: string | null;
  settings: { region: string };
}

interface SourceInput extends SourceFlags {
  profiles: Profile[] | null;
  dir: string | undefined;
}

// Transcript directories to read, with the pricing they are priced at.
interface Source {
  dirs: string[];
  pricing: PricingTable;
  pricingFile: string;
}

/**
 * The sources a second scan reads: one per profile, or the directories --dir
 * names. Each is priced with its own pricing file and region.
 */
function scanSources({ profiles, dir, ...sourceFlags }: SourceInput): Source[] {
  if (!profiles) {
    const { pricing, pricingFile } = resolveSource({ profile: null, ...sourceFlags });
    return [{ dirs: resolveTranscriptDirs(dir), pricing, pricingFile }];
  }

  return profiles.map((profile) => {
    const { pricing, pricingFile } = resolveSource({ profile, ...sourceFlags });
    return { dirs: [profile.projectsDir], pricing, pricingFile };
  });
}

/**
 * The current month's spend across every profile, or across the directories
 * --dir names, for --budget and --forecast. It reads the month whatever
 * --since says, and it prices each profile with its own pricing file and region.
 */
async function collectBudget(
  input: SourceInput,
  {
    limit,
    forecast,
    store,
    now = new Date(),
  }: { limit: number | null; forecast: boolean; store: StoreMode; now?: Date },
): Promise<BudgetReport> {
  const since = startOfMonth(now);
  const key = monthKey(now);

  let spentUSD = 0;

  for (const { dirs, pricing } of scanSources(input)) {
    const { months } = await collectMonthly(dirs, { pricing, since, store });
    spentUSD += (key && months.get(key)?.total.costUSD) || 0;
  }

  return buildBudget({ spentUSD, limitUSD: limit, forecast, now });
}

// The comparison for --compare, and the models its previous period priced at $0.
interface Compared {
  report: CompareReport;
  unpriced: Unpriced[];
}

/**
 * Scan the period before the report's and set it against the totals the
 * report already has, so the current figures match the report above them.
 * Usage in the previous period that no pricing file prices counts as unpriced.
 */
async function collectCompare(
  sources: Source[],
  {
    current,
    periods,
    byModel,
    store,
  }: { current: AggregateResult[]; periods: { current: Period; previous: Period }; byModel: boolean; store: StoreMode },
): Promise<Compared> {
  const scans = [];

  for (const { dirs, pricing, pricingFile } of sources) {
    scans.push({ pricingFile, result: await collectUsage(dirs, { pricing, ...periods.previous, store }, byModel) });
  }

  return {
    report: {
      current: periodUsage(periods.current, current),
      previous: periodUsage(
        periods.previous,
        scans.map(({ result }) => result),
      ),
      byModel,
    },
    unpriced: scans.map(unpricedOf),
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
  const parse = emptyParseStats();

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
        events: await readEvents(dirs, store, parse),
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
      events: await readEvents(dirs, store, parse),
    });
  }

  const data = collectDashboard(sources, { since });

  // The dashboard merges its profiles' unknown models, so each pricing file
  // gets the ones it lacks. A model that two files lack is listed for both.
  const unpriced = sources.map(({ pricingFile, pricing }) => ({
    pricingFile,
    models: data.warnings.unknownModels.filter((model) => priceForModel(pricing, model)._unknown),
  }));

  return { data, unpriced, parse };
}

function print(text: string) {
  process.stdout.write(`${text}\n`);
}

// The models a scan priced at $0 and the pricing file that lacks them.
function unpricedOf({ pricingFile, result }: { pricingFile: string; result: PricingSummary }): Unpriced {
  return { pricingFile, models: result.unknownModels };
}

/**
 * Warn on stderr about models priced at $0, transcript lines that could not
 * be read and a month's spend over the budget. Returns the exit status: 1
 * when `strict` is set and there is any of the three, otherwise 0. A forecast
 * above the budget only warns, because the budget is not exceeded yet.
 */
function reportWarnings(entries: Unpriced[], scans: ParseStats[], strict: boolean, budget: BudgetReport | null) {
  const skipped = skippedMessage(scans, { strict });

  const problems = [
    ...unpricedMessages(entries, { strict }),
    ...(skipped ? [skipped] : []),
    ...overBudgetMessages(budget, { strict }),
  ];

  for (const line of [...problems, ...paceMessages(budget)]) console.error(line);
  return strict && problems.length ? 1 : 0;
}

export async function run(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      backup: { type: "string" },
      budget: { type: "string" },
      "by-model": { type: "boolean", default: false },
      "by-month": { type: "boolean", default: false },
      compare: { type: "string" },
      dashboard: { type: "boolean", default: false },
      dir: { type: "string" },
      forecast: { type: "boolean", default: false },
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

  if (values.backup != null) {
    const conflict = Object.entries(values).find(
      ([flag, value]) => flag !== "backup" && value != null && value !== false,
    );

    if (conflict) throw new Error(`use either --backup or --${conflict[0]}, not both.`);
    if (values.backup.trim() === "") throw new Error("--backup needs a folder path.");

    const { dir, files } = backupStore(loadSettings().storeDir, path.resolve(expandHome(values.backup)));

    print(`Backed up ${files.length} usage store ${files.length === 1 ? "file" : "files"} to ${dir}`);
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

  if (values.compare != null) {
    parseCompare(values.compare, "--compare");

    if (values["by-month"]) {
      throw new Error("use either --compare or --by-month, not both. --by-month already lists every month.");
    }
  }

  if (values.dashboard) {
    const conflicts = ["json", "by-model", "by-month", "monthly", "compare"] as const;

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
  const now = new Date();
  const since = values.monthly ? startOfMonth(now) : parseSince(values.since, now);

  // The period before the report's, which --compare scans after the report.
  let previous: Period | null = null;

  if (values.compare != null) {
    if (!since) throw new Error("--compare needs --since or --monthly to say which period to compare.");
    previous = previousPeriod(since, now);
  }

  const regionFlag = values.region != null ? validateRegion(values.region, "--region") : null;
  const limit = values.budget != null ? parseBudget(values.budget, "--budget") : null;
  const settings = loadSettings();
  const profiles = values.dir ? null : loadProfiles();

  const store: StoreMode = {
    storeDir: values["no-cache"] ? null : settings.storeDir,
    rebuild: values["rebuild-cache"],
  };

  // The flag beats the setting. The month is read before the report, so JSON can carry it.
  const budgetLimit = limit ?? settings.budget;

  const budget =
    budgetLimit != null || values.forecast
      ? await collectBudget(
          { profiles, dir: values.dir, pricingFlag: values.pricing, regionFlag, settings },
          { limit: budgetLimit, forecast: values.forecast, store },
        )
      : null;

  // That read rewrote the store when --rebuild-cache asked for it, so the report reads it as it is.
  const reportStore: StoreMode = budget ? { ...store, rebuild: false } : store;

  // A text report is followed by the compare and budget blocks. A JSON report has them inside.
  const printBudget = () => {
    if (budget && !values.json) print(budgetLines(budget).join("\n"));
  };

  const printCompare = (compared: Compared | null) => {
    if (compared && !values.json) print(compareLines(compared.report).join("\n"));
  };

  if (values.dashboard) {
    const { data, unpriced, parse } = await collectDashboardData({
      profiles,
      flags: values,
      regionFlag,
      settings,
      since,
      store: reportStore,
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

    printBudget();
    return reportWarnings(unpriced, [parse], values.strict, budget);
  }

  const sourceFlags = { pricingFlag: values.pricing, regionFlag, settings };
  const scanOf = (pricing: PricingTable): Scan => ({ pricing, since, store: reportStore });

  // The report scan has rebuilt the store when --rebuild-cache asked for it.
  const compareWith = async (current: AggregateResult[]): Promise<Compared | null> =>
    since && previous
      ? collectCompare(scanSources({ profiles, dir: values.dir, ...sourceFlags }), {
          current,
          periods: { current: { since, until: now }, previous },
          byModel,
          store: { ...reportStore, rebuild: false },
        })
      : null;

  if (profiles) {
    const options = { since, json: values.json, budget };

    if (byMonth) {
      const reports = await collectProfileReports(profiles, sourceFlags, (dirs, pricing) =>
        collectMonthly(dirs, scanOf(pricing)),
      );

      print(renderProfileReports({ byMonth: true, reports }, options));
      printBudget();

      return reportWarnings(
        reports.map(unpricedOf),
        reports.map((report) => report.result.parse),
        values.strict,
        budget,
      );
    }

    const reports = await collectProfileReports(profiles, sourceFlags, (dirs, pricing) =>
      collectUsage(dirs, scanOf(pricing), byModel),
    );

    const compared = await compareWith(reports.map((report) => report.result));

    print(renderProfileReports({ byMonth: false, byModel, reports }, { ...options, compare: compared?.report }));
    printCompare(compared);
    printBudget();

    return reportWarnings(
      [...reports.map(unpricedOf), ...(compared?.unpriced ?? [])],
      reports.map((report) => report.result.parse),
      values.strict,
      budget,
    );
  }

  const { region, pricingFile, pricing } = resolveSource({ profile: null, ...sourceFlags });
  const dirs = resolveTranscriptDirs(values.dir);
  const origin = { region, pricingFile, since, json: values.json, budget };

  if (byMonth) {
    const result = await collectMonthly(dirs, scanOf(pricing));

    print(renderMonthly(result, origin));
    printBudget();

    return reportWarnings([unpricedOf({ pricingFile, result })], [result.parse], values.strict, budget);
  }

  const result = await collectUsage(dirs, scanOf(pricing), byModel);
  const compared = await compareWith([result]);

  print(renderUsage(result, { ...origin, byModel, compare: compared?.report ?? null }));
  printCompare(compared);
  printBudget();

  return reportWarnings(
    [unpricedOf({ pricingFile, result }), ...(compared?.unpriced ?? [])],
    [result.parse],
    values.strict,
    budget,
  );
}
