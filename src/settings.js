// @ts-check
import fs from "node:fs";
import path from "node:path";

import { resolveUserPath } from "./config.js";
import { DEFAULT_REGION, validateRegion } from "./regions.js";
import { DEFAULT_STORE_DIR } from "./store.js";
import { readJsonObject } from "./validate.js";

/** Local settings. Sits next to pricing.config.json and is not committed. */
export const DEFAULT_SETTINGS_PATH = path.join(
  import.meta.dirname,
  "..",
  "settings.config.json",
);

const KNOWN_KEYS = new Set(["region", "storeDir"]);

/**
 * Load global settings. A missing file means defaults.
 * Keys starting with "_" are comments and are ignored.
 * A relative `storeDir` is resolved against the settings file's directory.
 *
 * @param {string} [filePath]
 * @returns {{ region: string, storeDir: string }}
 */
export function loadSettings(filePath = DEFAULT_SETTINGS_PATH) {
  const settings = { region: DEFAULT_REGION, storeDir: DEFAULT_STORE_DIR };
  if (!fs.existsSync(filePath)) return settings;

  const parsed = readJsonObject(filePath, "settings");

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

  if (parsed.storeDir !== undefined) {
    if (typeof parsed.storeDir !== "string" || parsed.storeDir.trim() === "") {
      throw new Error(
        `invalid storeDir in ${filePath}: expected a non-empty string`,
      );
    }

    settings.storeDir = resolveUserPath(parsed.storeDir.trim(), filePath);
  }

  return settings;
}
