import fs from "node:fs";

// True for `{...}` values. Rejects null and arrays.
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The message of a caught value, which may not be an Error.
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read a JSON file whose top level must be an object.
 * `kind` names the file in errors, e.g. "settings".
 */
export function readJsonObject(filePath: string, kind: string): Record<string, unknown> {
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
