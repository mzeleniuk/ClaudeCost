// Shared contracts for parsing, pricing, storage, reports and the dashboard.

/**
 * Token counts for one request, normalized from Anthropic's usage object.
 * `cacheWrite5m` and `cacheWrite1h` are null when the transcript has no
 * per-TTL breakdown, and `cacheWrite` holds the flat count instead.
 */
export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite5m?: number | null;
  cacheWrite1h?: number | null;
  hasCacheBreakdown: boolean;
}

// The four token counts that make up a request's total.
export type TokenCounts = Pick<Usage, "input" | "output" | "cacheWrite" | "cacheRead">;

// One billable request read from a transcript.
export interface UsageEvent {
  ts: Date | null;
  model: string;
  usage: Usage;
  messageId: string | null;
  requestId: string | null;
  file: string;
  archived?: boolean;
}

// Provider usage fields kept in the store; additional fields survive compaction.
export interface RawUsage extends Record<string, unknown> {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
  iterations?: unknown[];
}

/**
 * The fields pricing reads from one transcript line, kept as written. The
 * usage store saves these, so a parser fix also applies to stored history.
 * It drops zero and empty fields from `usage` and keeps one record per
 * message, see compactRecords in store.ts.
 */
export interface UsageRecord {
  ts: string | number | null;
  id: string | null;
  requestId: string | null;
  model: string | null;
  usage: RawUsage;
}

/**
 * What the usage store keeps for one transcript. `offset` is the byte offset
 * just past the last complete line read, and `check` is a hash of the bytes
 * before it, used to confirm the file was appended to and not rewritten.
 */
export interface StoreEntry {
  size: number;
  mtimeMs: number;
  offset: number;
  check: string;
  records: UsageRecord[];
  skipped?: ParseStats;
  deletedAt?: string;
}

/**
 * What a scan could not read. `lines` counts the lines that contain the
 * literal "usage" key. The other counts are lines the parser dropped, and
 * `example` says where and why the first one failed.
 */
export interface ParseStats {
  lines: number;
  invalidJson: number;
  noUsage: number;
  badTokenCounts: number;
  example: string | null;
}

// USD per 1,000,000 tokens.
export interface Rates {
  input: number;
  output: number;
  cacheWrite: number;
  cacheWrite1h: number;
  cacheRead: number;
}

/**
 * A pricing table entry. Prompts over `longContext.threshold` tokens are
 * billed at the `longContext` rates. `_unknown` marks the $0 placeholder for
 * unlisted models, and `_notInRegion` marks models the endpoint does not list.
 */
export type Price = Rates & { longContext?: Rates & { threshold: number }; _unknown?: true; _notInRegion?: true };

export interface PricingTable {
  [x: string]: Price;
}

export interface Totals {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  costUSD: number;
  messages: number;
}

export interface PricingSummary {
  total: Totals;
  unknownModels: string[];
  notInRegion: string[];
  archivedTranscripts: number;
  parse: ParseStats;
}

/**
 * Result of `aggregate`. `groups` is keyed by model and is empty unless the
 * report was grouped by model.
 */
export type AggregateResult = PricingSummary & { groups: Map<string, Totals> };

export interface MonthTotals {
  models: Map<string, Totals>;
  total: Totals;
}

// Result of `aggregateByMonth`. `months` is keyed by local "YYYY-MM".
export type MonthlyResult = PricingSummary & { months: Map<string, MonthTotals>; skippedUndated: number };

/**
 * This month's spend for --budget and --forecast. `month` is a local
 * "YYYY-MM" key. `limitUSD` is null when only --forecast was given.
 * `forecast` is null unless --forecast was given, and its `projectedUSD` is
 * null during the first day of the month, when the run rate says too little.
 */
export interface BudgetReport {
  forecast: { projectedUSD: number | null } | null;
  limitUSD: number | null;
  month: string;
  spentUSD: number;
}

// A stretch of time. `since` is inclusive and `until` is exclusive.
export interface Period {
  since: Date;
  until: Date;
}

/**
 * Usage in one period. `groups` is keyed by model and is empty unless the
 * report was grouped by model.
 */
export interface PeriodUsage extends Period {
  groups: Map<string, Totals>;
  total: Totals;
}

/**
 * --compare previous: the report's period and the period before it. `current`
 * ends when the run started.
 */
export interface CompareReport {
  byModel: boolean;
  current: PeriodUsage;
  previous: PeriodUsage;
}

export interface Profile {
  name: string;
  dir: string;
  configuredDir: string;
  projectsDir: string;
  pricing: string | null;
  region: string | null;
}

export interface ReportOptions {
  since: Date | null;
  region?: string;
  pricingFile?: string;
  title?: string;
  subtitle?: string;
  showNote?: boolean;
}

/**
 * Usage summed per local day, hour, profile, model, project and agent kind,
 * stored as parallel arrays of equal length. `day` indexes
 * `DashboardData.days`, and `profile`, `model` and `project` index the
 * matching lists. `subagent` is 1 for subagent transcripts. `cost` is the
 * priced USD cost, and the four `cost*` columns after it split that cost by
 * kind of token. `uncachedCost` prices the same messages with every cache
 * read and write billed as plain input, so the difference is what caching
 * saved after the cache-write premium.
 */
export interface DashboardFacts {
  day: number[];
  hour: number[];
  profile: number[];
  model: number[];
  project: number[];
  subagent: number[];
  input: number[];
  output: number[];
  cacheWrite: number[];
  cacheRead: number[];
  cost: number[];
  costInput: number[];
  costOutput: number[];
  costCacheWrite: number[];
  costCacheRead: number[];
  uncachedCost: number[];
  messages: number[];
}

/**
 * One row per session, as parallel arrays. A session is a top-level
 * transcript plus its subagent transcripts. `firstDay` and `lastDay` index
 * `DashboardData.days`.
 */
export interface DashboardSessions {
  profile: number[];
  project: number[];
  firstDay: number[];
  lastDay: number[];
}

export interface DashboardProject {
  label: string;
  folder: string;
  path: string | null;
}

/**
 * Everything the HTML dashboard reads. Built by collectDashboard and
 * embedded in the page as JSON.
 */
export interface DashboardData {
  version: 1;
  generatedAt: string;
  timezone: string;
  since: string | null;
  days: string[];
  profiles: { name: string; region: string; pricingFile: string }[];
  models: string[];
  projects: DashboardProject[];
  facts: DashboardFacts;
  sessions: DashboardSessions;
  warnings: { unknownModels: string[]; notInRegion: string[]; archivedTranscripts: number; skippedUndated: number };
}
