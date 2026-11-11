// @ts-check
import fs from "node:fs";
import path from "node:path";

import { resolveUserPath } from "./config.js";
import { validateRegion } from "./regions.js";
import { isPlainObject, readJsonObject } from "./validate.js";

/** @import { Profile } from "./types.js" */

/** Local profile list. Sits next to pricing.config.json and is not committed. */
export const DEFAULT_PROFILES_PATH = path.join(
  import.meta.dirname,
  "..",
  "profiles.config.json",
);

/**
 * True when `inner` is `outer` or a path below it. Both must be real paths.
 *
 * @param {string} inner
 * @param {string} outer
 */
function isSameOrInside(inner, outer) {
  const rel = path.relative(outer, inner);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Throw if this profile's transcripts overlap an earlier profile's, since
 * every shared transcript would be counted in both.
 *
 * @param {{ name: string, realProjectsDir: string }} profile
 * @param {{ name: string, realProjectsDir: string }[]} earlier
 */
function checkOverlap(profile, earlier) {
  const a = profile.realProjectsDir;

  for (const other of earlier) {
    const b = other.realProjectsDir;
    let detail = null;

    if (a === b) {
      detail = `the same transcript directory as "${other.name}" (${a})`;
    } else if (isSameOrInside(a, b)) {
      detail = `transcripts inside "${other.name}"'s (${a} is inside ${b})`;
    } else if (isSameOrInside(b, a)) {
      detail = `transcripts that contain "${other.name}"'s (${b} is inside ${a})`;
    }

    if (detail) {
      throw new Error(
        `profile "${profile.name}" reads ${detail}, so they would be counted ` +
          "twice. Give each profile its own config directory.",
      );
    }
  }
}

/**
 * Validate one entry of the `profiles` array and resolve its paths.
 *
 * @param {unknown} entry
 * @param {number} index
 * @param {string} filePath
 * @returns {Profile}
 */
function parseProfile(entry, index, filePath) {
  if (!isPlainObject(entry)) {
    throw new Error(`invalid profile at index ${index}: expected object`);
  }

  const name = typeof entry.name === "string" ? entry.name.trim() : "";

  if (!name) {
    throw new Error(
      `invalid profile at index ${index}: name must be a non-empty string`,
    );
  }

  if (typeof entry.dir !== "string" || entry.dir.trim() === "") {
    throw new Error(
      `invalid profile "${name}": dir must be a non-empty string`,
    );
  }

  const configuredDir = entry.dir.trim();
  const dir = resolveUserPath(configuredDir, filePath);

  if (!fs.existsSync(dir)) {
    throw new Error(
      `profile "${name}" config directory not found: ${configuredDir}`,
    );
  }

  const projectsDir = path.join(dir, "projects");

  if (!fs.existsSync(projectsDir)) {
    throw new Error(
      `profile "${name}" transcript directory not found: ${projectsDir}`,
    );
  }

  let pricing = null;

  if (entry.pricing != null) {
    if (typeof entry.pricing !== "string" || entry.pricing.trim() === "") {
      throw new Error(
        `invalid profile "${name}": pricing must be a non-empty string`,
      );
    }

    const configuredPricing = entry.pricing.trim();
    pricing = resolveUserPath(configuredPricing, filePath);

    if (!fs.existsSync(pricing)) {
      throw new Error(
        `profile "${name}" pricing file not found: ${configuredPricing}`,
      );
    }
  }

  let region = null;

  if (entry.region != null) {
    if (typeof entry.region !== "string") {
      throw new Error(`invalid profile "${name}": region must be a string`);
    }

    region = validateRegion(entry.region, `profile "${name}"`);
  }

  return { name, dir, configuredDir, projectsDir, pricing, region };
}

/**
 * Load the profile list.
 * Returns null when the file is missing so the single-directory report stays
 * the default. `dir` is a Claude config directory; transcripts are in `projects`.
 *
 * @param {string} [filePath]
 * @returns {Profile[] | null}
 */
export function loadProfiles(filePath = DEFAULT_PROFILES_PATH) {
  if (!fs.existsSync(filePath)) return null;

  const { profiles } = readJsonObject(filePath, "profiles");

  if (!Array.isArray(profiles)) {
    throw new Error(
      `invalid profiles file (expected a profiles array): ${filePath}`,
    );
  }

  if (profiles.length === 0) {
    throw new Error(
      `profiles file must list at least one profile: ${filePath}`,
    );
  }

  /** @type {Profile[]} */
  const loaded = [];
  const realDirs = [];

  for (const [index, entry] of profiles.entries()) {
    const profile = parseProfile(entry, index, filePath);

    if (loaded.some((other) => other.name === profile.name)) {
      throw new Error(`duplicate profile name "${profile.name}"`);
    }

    // .native also normalizes letter case on case-insensitive file systems.
    const current = {
      name: profile.name,
      realProjectsDir: fs.realpathSync.native(profile.projectsDir),
    };

    checkOverlap(current, realDirs);
    realDirs.push(current);
    loaded.push(profile);
  }

  return loaded;
}
