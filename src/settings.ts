import { PROJECT_ROOT } from "./paths.ts";
import fs from "node:fs";
import path from "node:path";

import { resolveUserPath } from "./config.ts";
import { DEFAULT_REGION, validateRegion } from "./regions.ts";
import { DEFAULT_STORE_DIR } from "./store.ts";
import { readJsonObject } from "./validate.ts";

// Local settings. Sits next to pricing.config.json and is not committed.
const DEFAULT_SETTINGS_PATH = path.join(PROJECT_ROOT, "settings.config.json");
const KNOWN_KEYS = new Set(["region", "storeDir"]);

/**
 * Load global settings. A missing file means defaults.
 * Keys starting with "_" are comments and are ignored.
 * A relative `storeDir` is resolved against the settings file's directory.
 */
export function loadSettings(filePath: string = DEFAULT_SETTINGS_PATH): { region: string; storeDir: string } {
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
      throw new Error(`invalid storeDir in ${filePath}: expected a non-empty string`);
    }

    settings.storeDir = resolveUserPath(parsed.storeDir.trim(), filePath);
  }

  return settings;
}
