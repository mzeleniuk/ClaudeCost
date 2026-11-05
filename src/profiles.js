import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expandHome } from "./config.js";
import { validateRegion } from "./regions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Local profile list. Sits next to pricing.config.json and is not committed. */
export const DEFAULT_PROFILES_PATH = path.join(
  __dirname,
  "..",
  "profiles.config.json",
);

/** True when `inner` is `outer` or a path below it. Both must be real paths. */
function isSameOrInside(inner, outer) {
  const rel = path.relative(outer, inner);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Throw if this profile's transcripts overlap an earlier profile's, since
 * every shared transcript would be counted in both.
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

function resolveUserPath(value, configFilePath) {
  const expanded = expandHome(value);
  if (path.isAbsolute(expanded)) return expanded;
  return path.resolve(path.dirname(configFilePath), expanded);
}

/**
 * Load the profile list.
 * Returns null when the file is missing so the single-directory report stays
 * the default. `dir` is a Claude config directory; transcripts are in `projects`.
 *
 * @param {string} [filePath]
 * @returns {Array<{ name: string, dir: string, configuredDir: string, projectsDir: string, pricing: string|null, region: string|null }>|null}
 */
export function loadProfiles(filePath = DEFAULT_PROFILES_PATH) {
  if (!fs.existsSync(filePath)) return null;

  let parsed;

  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw new Error(`invalid profiles file (expected JSON): ${filePath}`);
  }

  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`invalid profiles file (expected object): ${filePath}`);
  }

  const { profiles } = parsed;

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

  const loaded = [];
  const realDirs = [];
  const seen = new Set();

  for (let i = 0; i < profiles.length; i++) {
    const entry = profiles[i];

    if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`invalid profile at index ${i}: expected object`);
    }

    const name = typeof entry.name === "string" ? entry.name.trim() : "";

    if (!name) {
      throw new Error(
        `invalid profile at index ${i}: name must be a non-empty string`,
      );
    }

    if (seen.has(name)) {
      throw new Error(`duplicate profile name "${name}"`);
    }

    seen.add(name);

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

    // .native also normalizes letter case on case-insensitive file systems.
    const current = {
      name,
      realProjectsDir: fs.realpathSync.native(projectsDir),
    };

    checkOverlap(current, realDirs);
    realDirs.push(current);

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

    loaded.push({
      name,
      dir,
      configuredDir,
      projectsDir,
      pricing,
      region,
    });
  }

  return loaded;
}
