// Shared JSDoc types. Import them with `@import { Usage } from "./types.js"`.

/**
 * Token counts for one request, normalized from Anthropic's usage object.
 * `cacheWrite5m` and `cacheWrite1h` are null when the transcript has no
 * per-TTL breakdown, and `cacheWrite` holds the flat count instead.
 *
 * @typedef {object} Usage
 * @property {number} input
 * @property {number} output
 * @property {number} cacheRead
 * @property {number} cacheWrite
 * @property {number | null} [cacheWrite5m]
 * @property {number | null} [cacheWrite1h]
 * @property {boolean} hasCacheBreakdown
 */

/**
 * One billable request read from a transcript.
 *
 * @typedef {object} UsageEvent
 * @property {Date | null} ts
 * @property {string} model
 * @property {Usage} usage
 * @property {string | null} messageId
 * @property {string | null} requestId
 * @property {string} file
 * @property {boolean} [archived] True when `file` is gone and the event came
 *   from the usage store.
 */

/**
 * The fields pricing reads from one transcript line, kept as written. The
 * usage store saves these, so a parser fix also applies to stored history.
 * It drops zero and empty fields from `usage` and keeps one record per
 * message, see compactRecords in store.js.
 *
 * @typedef {object} UsageRecord
 * @property {any} ts
 * @property {any} id
 * @property {any} requestId
 * @property {any} model
 * @property {Record<string, any>} usage
 */

/**
 * What the usage store keeps for one transcript. `offset` is the byte offset
 * just past the last complete line read, and `check` is a hash of the bytes
 * before it, used to confirm the file was appended to and not rewritten.
 *
 * @typedef {object} StoreEntry
 * @property {number} size
 * @property {number} mtimeMs
 * @property {number} offset
 * @property {string} check
 * @property {UsageRecord[]} records
 * @property {string} [deletedAt] When the transcript was first missing.
 */

/**
 * USD per 1,000,000 tokens.
 *
 * @typedef {object} Rates
 * @property {number} input
 * @property {number} output
 * @property {number} cacheWrite
 * @property {number} cacheWrite1h
 * @property {number} cacheRead
 */

/**
 * A pricing table entry. Prompts over `longContext.threshold` tokens are
 * billed at the `longContext` rates. `_unknown` marks the $0 placeholder for
 * unlisted models, and `_notInRegion` marks models the endpoint does not list.
 *
 * @typedef {Rates & {
 *   longContext?: Rates & { threshold: number },
 *   _unknown?: true,
 *   _notInRegion?: true,
 * }} Price
 */

/** @typedef {Record<string, Price>} PricingTable */

/**
 * @typedef {object} Totals
 * @property {number} inputTokens
 * @property {number} outputTokens
 * @property {number} cacheWriteTokens
 * @property {number} cacheReadTokens
 * @property {number} costUSD
 * @property {number} messages
 */

/**
 * @typedef {object} PricingSummary
 * @property {Totals} total
 * @property {string[]} unknownModels
 * @property {string[]} notInRegion
 * @property {number} archivedTranscripts Deleted transcripts from the usage
 *   store that added at least one message to `total`.
 */

/**
 * Result of `aggregate`. `groups` is keyed by model and is empty unless the
 * report was grouped by model.
 *
 * @typedef {PricingSummary & { groups: Map<string, Totals> }} AggregateResult
 */

/**
 * @typedef {object} MonthTotals
 * @property {Map<string, Totals>} models
 * @property {Totals} total
 */

/**
 * Result of `aggregateByMonth`. `months` is keyed by local "YYYY-MM".
 *
 * @typedef {PricingSummary & {
 *   months: Map<string, MonthTotals>,
 *   skippedUndated: number,
 * }} MonthlyResult
 */

/**
 * @typedef {object} Profile
 * @property {string} name
 * @property {string} dir Absolute Claude config directory.
 * @property {string} configuredDir `dir` as written in profiles.config.json.
 * @property {string} projectsDir
 * @property {string | null} pricing Absolute path to a pricing file.
 * @property {string | null} region
 */

/**
 * @typedef {object} ReportOptions
 * @property {Date | null} since
 * @property {string} [region]
 * @property {string} [pricingFile] Pricing file name shown in warnings.
 * @property {string} [title]
 * @property {string} [subtitle] Printed dim after the title.
 * @property {boolean} [showNote] Print the reconciliation note. Default true.
 */

/**
 * Usage summed per local day, hour, profile, model, project and agent kind,
 * stored as parallel arrays of equal length. `day` indexes
 * `DashboardData.days`, and `profile`, `model` and `project` index the
 * matching lists. `subagent` is 1 for subagent transcripts. `cost` is the
 * priced USD cost, and the four `cost*` columns after it split that cost by
 * kind of token. `uncachedCost` prices the same messages with every cache
 * read and write billed as plain input, so the difference is what caching
 * saved after the cache-write premium.
 *
 * @typedef {object} DashboardFacts
 * @property {number[]} day
 * @property {number[]} hour 0-23, local time.
 * @property {number[]} profile
 * @property {number[]} model
 * @property {number[]} project
 * @property {number[]} subagent
 * @property {number[]} input
 * @property {number[]} output
 * @property {number[]} cacheWrite
 * @property {number[]} cacheRead
 * @property {number[]} cost
 * @property {number[]} costInput Part of `cost` for input tokens.
 * @property {number[]} costOutput Part of `cost` for output tokens.
 * @property {number[]} costCacheWrite Part of `cost` for cache writes.
 * @property {number[]} costCacheRead Part of `cost` for cache reads.
 * @property {number[]} uncachedCost
 * @property {number[]} messages
 */

/**
 * One row per session, as parallel arrays. A session is a top-level
 * transcript plus its subagent transcripts. `firstDay` and `lastDay` index
 * `DashboardData.days`.
 *
 * @typedef {object} DashboardSessions
 * @property {number[]} profile
 * @property {number[]} project
 * @property {number[]} firstDay
 * @property {number[]} lastDay
 */

/**
 * @typedef {object} DashboardProject
 * @property {string} label Short name, usually the last path segment.
 * @property {string} folder Folder name under `projects`.
 * @property {string | null} path Working directory decoded from `folder`,
 *   or null when no existing directory matches.
 */

/**
 * Everything the HTML dashboard reads. Built by collectDashboard and
 * embedded in the page as JSON.
 *
 * @typedef {object} DashboardData
 * @property {1} version
 * @property {string} generatedAt ISO time.
 * @property {string} timezone IANA zone used for `days` and `hour`.
 * @property {string | null} since ISO lower bound, or null for all history.
 * @property {string[]} days Every local "YYYY-MM-DD" from the first active
 *   day to the day of `generatedAt`, ascending, including days without
 *   usage. Empty when there is no usage.
 * @property {{ name: string, region: string, pricingFile: string }[]} profiles
 * @property {string[]} models
 * @property {DashboardProject[]} projects
 * @property {DashboardFacts} facts
 * @property {DashboardSessions} sessions
 * @property {{
 *   unknownModels: string[],
 *   notInRegion: string[],
 *   archivedTranscripts: number,
 *   skippedUndated: number,
 * }} warnings
 */

export {};
