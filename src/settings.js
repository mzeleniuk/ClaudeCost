import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_REGION, validateRegion } from "./regions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Local settings. Sits next to pricing.config.json and is not committed. */
export const DEFAULT_SETTINGS_PATH = path.join(
  __dirname,
  "..",
  "settings.config.json",
);

const KNOWN_KEYS = new Set(["region"]);

/**
 * Load global settings. A missing file means defaults.
 * Keys starting with "_" are comments and are ignored.
 *
 * @param {string} [filePath]
 * @returns {{ region: string }}
 */
export function loadSettings(filePath = DEFAULT_SETTINGS_PATH) {
  const settings = { region: DEFAULT_REGION };
  if (!fs.existsSync(filePath)) return settings;

  let parsed;

  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw new Error(`invalid settings file (expected JSON): ${filePath}`);
  }

  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`invalid settings file (expected object): ${filePath}`);
  }

  for (const key of Object.keys(parsed)) {
    if (!key.startsWith("_") && !KNOWN_KEYS.has(key)) {
      throw new Error(`unknown setting "${key}" in ${filePath}`);
    }
  }

  if (parsed.region !== undefined) {
    if (typeof parsed.region !== "string") {
      throw new Error(`invalid region in ${filePath}: expected a string`);
    }

    settings.region = validateRegion(parsed.region, filePath);
  }

  return settings;
}
