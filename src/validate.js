// @ts-check
import fs from "node:fs";

/**
 * True for `{...}` values. Rejects null and arrays.
 *
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read a JSON file whose top level must be an object.
 * `kind` names the file in errors, e.g. "settings".
 *
 * @param {string} filePath
 * @param {string} kind
 * @returns {Record<string, unknown>}
 */
export function readJsonObject(filePath, kind) {
  const text = fs.readFileSync(filePath, "utf8");
  let parsed;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`invalid ${kind} file (expected JSON): ${filePath}`);
  }

  if (!isPlainObject(parsed)) {
    throw new Error(`invalid ${kind} file (expected object): ${filePath}`);
  }

  return parsed;
}
