import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";

import type { DashboardData } from "../types.ts";

// The folder this module runs from: src/dashboard for source runs, and
// dist/src/dashboard for compiled runs, where scripts/build.ts copies the assets.
const DIR = import.meta.dirname;

// Markers in template.html. Each must appear exactly once.
const MARKERS = ["/*__STYLES__*/", "/*__APP__*/", "__DATA__"];

// Icon markers in template.html, each replaced by a data: URL of a PNG in
// the icons folder. They are optional, so a template may leave them out.
const ICONS = {
  __ICON_16__: "favicon-16x16.png",
  __ICON_32__: "favicon-32x32.png",
  __ICON_180__: "apple-touch-icon.png",
};

/**
 * JSON that is safe inside a <script> element. Escaping `<` keeps the data
 * from closing the element early, and U+2028/U+2029 are escaped for old
 * parsers that treat them as line ends.
 */
export function scriptSafeJson(value: unknown) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

/**
 * The stylesheets in the styles folder. Later rules win over earlier ones
 * at equal specificity, so responsive.css must stay last.
 */
export const STYLES = [
  "tokens",
  "base",
  "header",
  "layout",
  "sidebar",
  "kpis",
  "charts",
  "tooltip",
  "rankings",
  "heat-maps",
  "tokens-vs-dollars",
  "footer",
  "responsive",
];

/**
 * TypeScript source with its types removed. stripTypeScriptTypes warns that it
 * is experimental. Source runs of the CLI do not otherwise print a warning, so
 * drop only that one.
 */
export function stripTypes(source: string) {
  const emitWarning = process.emitWarning;

  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    if (String(warning).includes("stripTypeScriptTypes")) return;
    (emitWarning as (...args: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;

  try {
    return stripTypeScriptTypes(source);
  } finally {
    process.emitWarning = emitWarning;
  }
}

/**
 * The dashboard script. Compiled runs read the app.js that tsc emitted. Source
 * runs have only app.ts, so its types are stripped here instead of reading a
 * possibly stale build.
 */
export function readApp(dir: string) {
  const compiled = path.join(dir, "app.js");
  if (fs.existsSync(compiled)) return fs.readFileSync(compiled, "utf8");

  return stripTypes(fs.readFileSync(path.join(dir, "app.ts"), "utf8"));
}

function readStyles(dir: string) {
  return STYLES.map((name) => fs.readFileSync(path.join(dir, "styles", `${name}.css`), "utf8")).join("\n\n");
}

/**
 * The dashboard page with styles, script, data and favicons inlined, so the
 * file works offline and from file://. All markers are replaced in one pass over
 * the template, so inserted text is never searched for markers.
 */
export function renderDashboard(data: DashboardData, { dir = DIR }: { dir?: string } = {}) {
  const read = (name: string) => fs.readFileSync(path.join(dir, name), "utf8");
  const template = read("template.html");
  const icons = Object.keys(ICONS).filter((m) => template.includes(m));
  const markers = [...MARKERS, ...icons];

  for (const marker of markers) {
    if (template.split(marker).length !== 2) {
      throw new Error(`dashboard template must contain ${marker} exactly once.`);
    }
  }

  const app = readApp(dir);

  const values: Record<string, string> = {
    "/*__STYLES__*/": readStyles(dir),
    "/*__APP__*/": app.replaceAll("</script", "<\\/script"),
    __DATA__: scriptSafeJson(data),
  };

  for (const marker of icons) {
    const png = fs.readFileSync(
      path.join(dir, "icons", ICONS[marker as "__ICON_16__" | "__ICON_32__" | "__ICON_180__"]),
    );

    values[marker] = `data:image/png;base64,${png.toString("base64")}`;
  }

  const pattern = new RegExp(markers.map((m) => m.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|"), "g");
  return template.replace(pattern, (marker) => values[marker]);
}
