// @ts-check
import path from "node:path";

import { costBreakdown, priceForModel } from "../pricing.js";
import { dayKey } from "../since.js";
import { createProjectDecoder } from "./projects.js";

/**
 * @import {
 *   DashboardData,
 *   DashboardProject,
 *   PricingTable,
 *   UsageEvent,
 * } from "../types.js"
 */

/**
 * One profile, or the single merged run when there is no profiles file.
 * `dirs` are the transcript directories `events` were read from. They give
 * each event its project and session.
 *
 * @typedef {object} DashboardSource
 * @property {string} name
 * @property {string} region
 * @property {string} pricingFile Pricing file name shown to the user.
 * @property {PricingTable} pricing
 * @property {string[]} dirs
 * @property {UsageEvent[]} events Already deduplicated.
 */

/**
 * @typedef {object} Cell
 * @property {string} day
 * @property {number} hour
 * @property {number} profile
 * @property {number} model
 * @property {number} project
 * @property {number} subagent
 * @property {number} input
 * @property {number} output
 * @property {number} cacheWrite
 * @property {number} cacheRead
 * @property {number} cost
 * @property {number} costInput
 * @property {number} costOutput
 * @property {number} costCacheWrite
 * @property {number} costCacheRead
 * @property {number} uncachedCost
 * @property {number} messages
 */

/**
 * Where a transcript sits in its projects directory.
 *
 * @typedef {object} Location
 * @property {string} folder Project folder name.
 * @property {string} session Session id.
 * @property {number} subagent 1 for a subagent transcript.
 */

/** @param {number} n */
const round6 = (n) => Math.round(n * 1e6) / 1e6;

/**
 * Split a transcript path into project, session and agent kind.
 * "<project>/<session>.jsonl" is a top-level transcript and
 * "<project>/<session>/subagents/agent-x.jsonl" belongs to the same session.
 *
 * @param {string[]} dirs
 * @param {string} file
 * @returns {Location}
 */
export function locateTranscript(dirs, file) {
  /** @type {string[]} */
  let parts = [path.basename(path.dirname(file)), path.basename(file)];

  for (const dir of dirs) {
    const relative = path.relative(dir, file).split(path.sep);

    if (relative[0] !== ".." && !path.isAbsolute(relative[0])) {
      // A session file, or a session's subagents folder, right inside `dir`
      // means `dir` is one project folder, as with --dir on a single project.
      const inProject = relative.length === 1 || (relative.length === 3 && relative[1] === "subagents");

      parts = inProject ? [path.basename(dir), ...relative] : relative;
      break;
    }
  }

  const [folder, second] = parts.length > 1 ? parts : ["", parts[0]];

  return {
    folder,
    session: second.replace(/\.jsonl$/, ""),
    subagent: parts.slice(1, -1).includes("subagents") ? 1 : 0,
  };
}

/**
 * The index of `key` in `indexes`, added at the end on first use.
 *
 * @param {Map<string, number>} indexes
 * @param {string} key
 */
function indexFor(indexes, key) {
  let index = indexes.get(key);

  if (index === undefined) {
    index = indexes.size;
    indexes.set(key, index);
  }

  return index;
}

// Claude Code did not exist before this. An older timestamp is a bad clock or
// a corrupt line, and a single one would add thousands of empty days.
const EARLIEST_PLAUSIBLE = new Date(2023, 0, 1);
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Every local day from `first` to `last`, inclusive.
 *
 * @param {string} first "YYYY-MM-DD"
 * @param {string} last "YYYY-MM-DD"
 */
function daysBetween(first, last) {
  const [year, month, day] = first.split("-").map(Number);
  /** @type {string[]} */
  const days = [];

  for (let i = 0; ; i += 1) {
    const key = /** @type {string} */ (dayKey(new Date(year, month - 1, day + i)));

    days.push(key);
    if (key >= last) return days;
  }
}

/**
 * Order of old indexes when sorted by `totals` descending, as a map from old
 * index to new index.
 *
 * @param {number[]} totals
 */
function rankByCost(totals) {
  const order = totals.map((_, i) => i).sort((a, b) => totals[b] - totals[a]);
  const rank = new Array(totals.length);

  for (const [position, old] of order.entries()) rank[old] = position;
  return { order, rank: /** @type {number[]} */ (rank) };
}

/**
 * Price every event and sum it into the arrays the dashboard filters in the
 * browser. Events before `since` are left out, and so are events without a
 * timestamp or with an implausible one (before 2023 or more than a day ahead
 * of `now`), which `warnings.skippedUndated` counts.
 *
 * @param {DashboardSource[]} sources In profile order.
 * @param {object} [opts]
 * @param {Date | null} [opts.since] Inclusive lower bound.
 * @param {Date} [opts.now]
 * @param {(folder: string) => DashboardProject} [opts.decodeProject]
 * @returns {DashboardData}
 */
export function collectDashboard(
  sources,
  { since = null, now = new Date(), decodeProject = createProjectDecoder() } = {},
) {
  /** @type {Map<string, number>} */
  const modelIndexes = new Map();
  /** @type {Map<string, number>} */
  const folderIndexes = new Map();
  /** @type {Map<string, Cell>} */
  const cells = new Map();
  /** @type {Map<string, { profile: number, project: number, first: string, last: string }>} */
  const sessions = new Map();
  const unknownModels = new Set();
  const notInRegion = new Set();
  let archivedTranscripts = 0;
  let skippedUndated = 0;
  let firstDay = "";
  let lastDay = "";

  for (const [profile, source] of sources.entries()) {
    /** @type {Set<string>} */
    const archived = new Set();
    /** @type {Map<string, Location>} */
    const locations = new Map();

    for (const event of source.events) {
      if (since && (!event.ts || event.ts < since)) continue;

      const day = dayKey(event.ts);

      if (!day || !event.ts || event.ts < EARLIEST_PLAUSIBLE || event.ts.getTime() > now.getTime() + DAY_MS) {
        skippedUndated += 1;
        continue;
      }

      const price = priceForModel(source.pricing, event.model);

      if (event.archived) archived.add(event.file);
      if (price._notInRegion) notInRegion.add(event.model);
      if (price._unknown) unknownModels.add(event.model);

      const { usage } = event;
      const parts = costBreakdown(price, usage);
      const cost = parts.input + parts.output + parts.cacheWrite + parts.cacheRead;
      const uncached = costBreakdown(price, {
        input: usage.input + usage.cacheRead + usage.cacheWrite,
        output: usage.output,
        cacheRead: 0,
        cacheWrite: 0,
        hasCacheBreakdown: false,
      });
      const uncachedCost = uncached.input + uncached.output;

      let location = locations.get(event.file);

      if (!location) {
        location = locateTranscript(source.dirs, event.file);
        locations.set(event.file, location);
      }

      const model = indexFor(modelIndexes, event.model);
      const project = indexFor(folderIndexes, location.folder);
      const hour = event.ts.getHours();
      const key = [day, hour, profile, model, project, location.subagent].join("\t");

      let cell = cells.get(key);

      if (!cell) {
        cell = {
          day,
          hour,
          profile,
          model,
          project,
          subagent: location.subagent,
          input: 0,
          output: 0,
          cacheWrite: 0,
          cacheRead: 0,
          cost: 0,
          costInput: 0,
          costOutput: 0,
          costCacheWrite: 0,
          costCacheRead: 0,
          uncachedCost: 0,
          messages: 0,
        };

        cells.set(key, cell);
      }

      cell.input += usage.input;
      cell.output += usage.output;
      cell.cacheWrite += usage.cacheWrite;
      cell.cacheRead += usage.cacheRead;
      cell.cost += cost;
      cell.costInput += parts.input;
      cell.costOutput += parts.output;
      cell.costCacheWrite += parts.cacheWrite;
      cell.costCacheRead += parts.cacheRead;
      cell.uncachedCost += uncachedCost;
      cell.messages += 1;

      const sessionKey = `${profile}\t${project}\t${location.session}`;
      const session = sessions.get(sessionKey);

      if (!session) {
        sessions.set(sessionKey, { profile, project, first: day, last: day });
      } else if (day < session.first) {
        session.first = day;
      } else if (day > session.last) {
        session.last = day;
      }

      if (!firstDay || day < firstDay) firstDay = day;
      if (day > lastDay) lastDay = day;
    }

    archivedTranscripts += archived.size;
  }

  const modelCosts = new Array(modelIndexes.size).fill(0);
  const projectCosts = new Array(folderIndexes.size).fill(0);

  for (const cell of cells.values()) {
    modelCosts[cell.model] += cell.cost;
    projectCosts[cell.project] += cell.cost;
  }

  const modelRank = rankByCost(modelCosts);
  const projectRank = rankByCost(projectCosts);
  const modelNames = [...modelIndexes.keys()];
  const folders = [...folderIndexes.keys()];

  // Run to today, so "last 7 days" means the last 7 calendar days even when
  // the latest usage is older.
  const today = dayKey(now) ?? lastDay;
  const days = firstDay ? daysBetween(firstDay, lastDay > today ? lastDay : today) : [];
  const dayIndexes = new Map(days.map((day, i) => [day, i]));

  const rows = [...cells.values()]
    .map((cell) => ({
      ...cell,
      day: /** @type {number} */ (dayIndexes.get(cell.day)),
      model: modelRank.rank[cell.model],
      project: projectRank.rank[cell.project],
    }))
    .sort(
      (a, b) =>
        a.day - b.day ||
        a.hour - b.hour ||
        a.profile - b.profile ||
        a.model - b.model ||
        a.project - b.project ||
        a.subagent - b.subagent,
    );

  const sessionRows = [...sessions.values()]
    .map((session) => ({
      profile: session.profile,
      project: projectRank.rank[session.project],
      firstDay: /** @type {number} */ (dayIndexes.get(session.first)),
      lastDay: /** @type {number} */ (dayIndexes.get(session.last)),
    }))
    .sort((a, b) => a.firstDay - b.firstDay || a.lastDay - b.lastDay || a.profile - b.profile || a.project - b.project);

  return {
    version: 1,
    generatedAt: now.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    since: since ? since.toISOString() : null,
    days,
    profiles: sources.map(({ name, region, pricingFile }) => ({
      name,
      region,
      pricingFile,
    })),
    models: modelRank.order.map((i) => modelNames[i]),
    projects: projectRank.order.map((i) => decodeProject(folders[i])),
    facts: {
      day: rows.map((r) => r.day),
      hour: rows.map((r) => r.hour),
      profile: rows.map((r) => r.profile),
      model: rows.map((r) => r.model),
      project: rows.map((r) => r.project),
      subagent: rows.map((r) => r.subagent),
      input: rows.map((r) => r.input),
      output: rows.map((r) => r.output),
      cacheWrite: rows.map((r) => r.cacheWrite),
      cacheRead: rows.map((r) => r.cacheRead),
      cost: rows.map((r) => round6(r.cost)),
      costInput: rows.map((r) => round6(r.costInput)),
      costOutput: rows.map((r) => round6(r.costOutput)),
      costCacheWrite: rows.map((r) => round6(r.costCacheWrite)),
      costCacheRead: rows.map((r) => round6(r.costCacheRead)),
      uncachedCost: rows.map((r) => round6(r.uncachedCost)),
      messages: rows.map((r) => r.messages),
    },
    sessions: {
      profile: sessionRows.map((s) => s.profile),
      project: sessionRows.map((s) => s.project),
      firstDay: sessionRows.map((s) => s.firstDay),
      lastDay: sessionRows.map((s) => s.lastDay),
    },
    warnings: {
      unknownModels: [...unknownModels].filter((m) => m && m !== "unknown"),
      notInRegion: [...notInRegion],
      archivedTranscripts,
      skippedUndated,
    },
  };
}
