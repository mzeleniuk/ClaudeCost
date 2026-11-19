// @ts-check
import fs from "node:fs";
import path from "node:path";

/** @import { DashboardData } from "../types.js" */

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
 *
 * @param {unknown} value
 */
export function scriptSafeJson(value) {
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

/** @param {string} dir Folder with the styles folder. */
function readStyles(dir) {
  return STYLES.map((name) =>
    fs.readFileSync(path.join(dir, "styles", `${name}.css`), "utf8"),
  ).join("\n\n");
}

/**
 * The dashboard page with styles, script, data and favicons inlined, so the
 * file works offline and from file://. All markers are replaced in one pass over
 * the template, so inserted text is never searched for markers.
 *
 * @param {DashboardData} data
 * @param {{ dir?: string }} [opts] Folder with template.html, app.js and a styles folder of .css files.
 */
export function renderDashboard(data, { dir = DIR } = {}) {
  const read = (/** @type {string} */ name) =>
    fs.readFileSync(path.join(dir, name), "utf8");

  const template = read("template.html");

  const icons = Object.keys(ICONS).filter((m) => template.includes(m));
  const markers = [...MARKERS, ...icons];

  for (const marker of markers) {
    if (template.split(marker).length !== 2) {
      throw new Error(
        `dashboard template must contain ${marker} exactly once.`,
      );
    }
  }

  /** @type {Record<string, string>} */
  const values = {
    "/*__STYLES__*/": readStyles(dir),
    "/*__APP__*/": read("app.js").replaceAll("</script", "<\\/script"),
    __DATA__: scriptSafeJson(data),
  };

  for (const marker of icons) {
    const png = fs.readFileSync(
      path.join(
        dir,
        "icons",
        ICONS[/** @type {keyof typeof ICONS} */ (marker)],
      ),
    );

    values[marker] = `data:image/png;base64,${png.toString("base64")}`;
  }

  const pattern = new RegExp(
    markers.map((m) => m.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|"),
    "g",
  );

  return template.replace(pattern, (marker) => values[marker]);
}
