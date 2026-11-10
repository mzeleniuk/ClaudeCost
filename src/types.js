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

export {};
