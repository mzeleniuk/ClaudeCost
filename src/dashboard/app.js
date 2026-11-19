// @ts-check
/** @import { DashboardData } from "../types.js" */

// =============================================================================
// Data
// =============================================================================

/** @param {string} id @returns {HTMLElement} */
function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Dashboard template is missing #${id}.`);
  return el;
}

const data = /** @type {DashboardData} */ (JSON.parse(byId("claude-cost-data").textContent ?? "{}"));

const F = data.facts;
const NROWS = F.day.length;
const NDAYS = data.days.length;
const NMODELS = data.models.length;
const NPROJECTS = data.projects.length;
const NPROFILES = data.profiles.length;

// =============================================================================
// Dates. Day strings are already local, so they are parsed by hand and never
// through `new Date("YYYY-MM-DD")`, which would read them as UTC.
// =============================================================================

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const WEEKDAYS_PLURAL = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];

/** @param {number} n */
const pad = (n) => String(n).padStart(2, "0");

/** @param {string} s */
function dayParts(s) {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}

/** @param {string} s */
function dayDate(s) {
  const { y, m, d } = dayParts(s);
  return new Date(y, m - 1, d);
}

/** @param {Date} date */
function dayString(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** @param {string} s @param {number} n */
function addDays(s, n) {
  const date = dayDate(s);
  date.setDate(date.getDate() + n);
  return dayString(date);
}

/** Monday is 0. @param {string} s */
function weekdayOf(s) {
  return (dayDate(s).getDay() + 6) % 7;
}

/** @param {number} y @param {number} m 1-12 */
function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate();
}

/** "Nov 4" @param {string} s */
function fmtMD(s) {
  const { m, d } = dayParts(s);
  return `${MONTHS[m - 1]} ${d}`;
}

/** "Tue, Nov 4" @param {string} s */
function fmtWeekdayMD(s) {
  return `${WEEKDAYS[weekdayOf(s)]}, ${fmtMD(s)}`;
}

/** "Nov 4, 2026" @param {string} s */
function fmtMDY(s) {
  return `${fmtMD(s)}, ${dayParts(s).y}`;
}

/** "Jul 17 to Nov 11, 2026" @param {string} a @param {string} b */
function fmtSpan(a, b) {
  if (a === b) return fmtMDY(a);

  return dayParts(a).y === dayParts(b).y ? `${fmtMD(a)} to ${fmtMDY(b)}` : `${fmtMDY(a)} to ${fmtMDY(b)}`;
}

/** Local date and time of an ISO instant in the data's time zone. @param {string} iso */
function localClock(iso) {
  const instant = new Date(iso);
  /** @param {string | undefined} timeZone */
  const parts = (timeZone) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant);

  let list;

  try {
    list = parts(data.timezone);
  } catch {
    list = parts(undefined);
  }

  /** @param {string} type */
  const get = (type) => list.find((p) => p.type === type)?.value ?? "00";

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
    atMidnight:
      get("hour") === "00" && get("minute") === "00" && get("second") === "00" && instant.getUTCMilliseconds() === 0,
  };
}

const generated = localClock(data.generatedAt);
const capturedFrom = data.since ? localClock(data.since) : null;

/** Whether the capture includes a whole day from local midnight. @param {string} day */
function coversDayStart(day) {
  return !capturedFrom || capturedFrom.date < day || (capturedFrom.date === day && capturedFrom.atMidnight);
}

// Calendar structure per day index, computed once.
const dayWeekday = data.days.map(weekdayOf);
const dayMonthKey = data.days.map((s) => s.slice(0, 7));
const monthKeys = [...new Set(dayMonthKey)];
const dayMonth = dayMonthKey.map((k) => monthKeys.indexOf(k));
const dayWeekStart = data.days.map((s, i) => addDays(s, -dayWeekday[i]));
const weekKeys = [...new Set(dayWeekStart)];
const dayWeek = dayWeekStart.map((k) => weekKeys.indexOf(k));
const dayIndex = new Map(data.days.map((s, i) => [s, i]));

// =============================================================================
// Formatting
// =============================================================================

const usdFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/** $1,883.72 @param {number} n */
const usd = (n) => usdFormat.format(n);

/** $1.2k for chart labels. @param {number} n */
function usdShort(n) {
  if (n >= 10000) return `$${Math.round(n / 1000)}k`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  if (n < 10) return `$${n.toFixed(2)}`;
  return `$${Math.round(n)}`;
}

/** 88.1M @param {number} n */
function compact(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

/** @param {number} n */
const count = (n) => n.toLocaleString("en-US");

/** @param {number} n @param {string} word */
const plural = (n, word) => `${count(n)} ${word}${n === 1 ? "" : "s"}`;

/** Share as a percentage string. @param {number} part @param {number} whole */
function pct(part, whole) {
  if (whole <= 0) return "0%";

  const v = (part / whole) * 100;
  if (v > 0 && v < 0.1) return "<0.1%";

  return v < 10 ? `${v.toFixed(1)}%` : `${Math.round(v)}%`;
}

// =============================================================================
// Models: pretty names and colors
// =============================================================================

const FAMILIES = ["opus", "sonnet", "haiku"];

/**
 * Family and version from a model id, e.g. "claude-sonnet-4-5@20250929".
 * @param {string} id
 */
function parseModel(id) {
  const core = id
    .toLowerCase()
    .replace(/^.*claude-/, "")
    .replace(/\[.*$/, "")
    .replace(/@.*$/, "")
    .replace(/-v\d+(:\d+)?$/, "")
    .replace(/-latest$/, "")
    .replace(/-\d{8}$/, "")
    .replaceAll(".", "-");
  const parts = core.split("-");
  const family = parts.find((p) => FAMILIES.includes(p)) ?? null;

  if (!family) {
    return { family: null, version: /** @type {number[]} */ ([]), name: id };
  }

  const version = parts.filter((p) => /^\d{1,2}$/.test(p)).map(Number);
  const label = family[0].toUpperCase() + family.slice(1);

  return {
    family,
    version,
    name: version.length ? `${label} ${version.join(".")}` : label,
  };
}

/** @param {number[]} a @param {number[]} b Highest version first. */
function compareVersionsDesc(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0);
    if (diff) return diff;
  }

  return 0;
}

// Models arrive by cost. Stacks and legends use a fixed order instead, family
// first and the newest version first within it. The palette was validated
// for neighbors in this order, and a model keeps its place as costs change.
{
  const order = data.models
    .map((id, i) => ({ i, ...parseModel(id) }))
    .sort((a, b) => {
      const rank = (/** @type {string | null} */ f) => (f ? FAMILIES.indexOf(f) : FAMILIES.length);
      return rank(a.family) - rank(b.family) || compareVersionsDesc(a.version, b.version) || a.i - b.i;
    });

  const newIndex = new Array(order.length);

  order.forEach((m, k) => {
    newIndex[m.i] = k;
  });

  for (let r = 0; r < F.model.length; r++) F.model[r] = newIndex[F.model[r]];
  data.models = order.map((m) => data.models[m.i]);
}

const modelInfo = data.models.map((id) => ({ ...parseModel(id), id }));

// Ids that parse to the same name, such as "claude-sonnet-4-5" and
// "claude-sonnet-4-5@20250929", show their full id so they stay apart.
{
  const seen = new Map();

  for (const m of modelInfo) seen.set(m.name, (seen.get(m.name) ?? 0) + 1);
  for (const m of modelInfo) if (seen.get(m.name) > 1) m.name = m.id;
}

// The newest model in a family gets step 1, then 2, then 3 for everything
// older. The list is already sorted newest first, so the position within the
// family is the rank, and two ids with one version still get different steps.
const modelColors = modelInfo.map((info, i) => {
  if (!info.family) return "var(--fg-3)";

  const rank = modelInfo.slice(0, i).filter((m) => m.family === info.family).length;
  return `var(--${info.family}-${Math.min(rank, 2) + 1})`;
});

// =============================================================================
// State and URL hash
// =============================================================================

/** @typedef {"7d" | "30d" | "90d" | "month" | "all"} RangeId */

const RANGES = /** @type {{ id: RangeId, label: string, days: number }[]} */ ([
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
  { id: "90d", label: "90 days", days: 90 },
  { id: "month", label: "month", days: 0 },
  { id: "all", label: "all", days: 0 },
]);

/** @param {unknown} v @returns {v is RangeId} */
const isRangeId = (v) => RANGES.some((r) => r.id === v);

const state = {
  /** @type {RangeId} */
  range: "all",
  /** Profile index, or -1 for all profiles. */
  profile: -1,
  modelOn: Array.from({ length: NMODELS }, () => true),
  projectOn: Array.from({ length: NPROJECTS }, () => true),
};

/**
 * Active indices from a hash list like "0.2.3". A missing key means all on,
 * an empty value means all off. A value with no valid index is ignored, so
 * a mistyped hash shows everything rather than nothing.
 * @param {URLSearchParams} params @param {string} key @param {number} n
 */
function readActive(params, key, n) {
  const raw = params.get(key);
  const all = () => Array.from({ length: n }, () => true);

  if (raw === null) return all();

  const on = Array.from({ length: n }, () => false);
  if (raw === "") return on;

  let valid = false;

  for (const part of raw.split(".")) {
    if (!/^\d+$/.test(part)) continue;

    const i = Number(part);

    if (i < n) {
      on[i] = true;
      valid = true;
    }
  }

  return valid ? on : all();
}

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const range = params.get("range");
  state.range = isRangeId(range) ? range : "all";
  const rawProfile = params.get("profile") ?? "";
  const profile = /^\d+$/.test(rawProfile) ? Number(rawProfile) : -1;
  state.profile = profile < NPROFILES ? profile : -1;
  // Edit the arrays in place, the sidebar rows hold on to them.
  state.modelOn.splice(0, NMODELS, ...readActive(params, "models", NMODELS));
  state.projectOn.splice(0, NPROJECTS, ...readActive(params, "projects", NPROJECTS));
}

/** @param {boolean[]} on */
const activeList = (on) => on.flatMap((v, i) => (v ? [i] : [])).join(".");

function writeHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  for (const key of ["range", "profile", "models", "projects"]) params.delete(key);

  if (state.range !== "all") params.set("range", state.range);
  if (state.profile >= 0) params.set("profile", String(state.profile));
  if (state.modelOn.includes(false)) params.set("models", activeList(state.modelOn));
  if (state.projectOn.includes(false)) params.set("projects", activeList(state.projectOn));

  const hash = params.toString();

  try {
    history.replaceState(null, "", `${location.pathname}${location.search}${hash ? `#${hash}` : ""}`);
  } catch {
    location.hash = hash;
  }
}

// =============================================================================
// Range and filters
// =============================================================================

/** Inclusive day-index bounds of the selected range. Empty when hi < lo. */
const view = { lo: 0, hi: -1 };

function computeView() {
  if (state.range === "all") {
    view.lo = 0;
    view.hi = NDAYS - 1;
    return;
  }

  // The collector can retain usage dated tomorrow when a transcript's clock
  // is ahead. Recent ranges and their comparisons end on the generation day.
  view.hi = data.days.findLastIndex((day) => day <= generated.date);

  if (state.range === "month") {
    const key = generated.date.slice(0, 7);
    const first = dayMonthKey.indexOf(key);

    view.lo = first < 0 ? NDAYS : first;
  } else {
    const n = RANGES.find((r) => r.id === state.range)?.days ?? 0;
    view.lo = Math.max(0, view.hi - n + 1);
  }
}

/** The equal-length period before the range, or null when not comparable. */
function previousBounds() {
  const n = view.hi - view.lo + 1;
  if (state.range === "all" || n <= 0) return null;

  let lo = view.lo - n;
  let hi = view.lo - 1;

  if (state.range === "month") {
    const { y, m } = dayParts(data.days[view.lo]);
    const prevStart = dayIndex.get(m === 1 ? `${y - 1}-12-01` : `${y}-${pad(m - 1)}-01`);

    if (prevStart === undefined) return null;
    lo = prevStart;
    hi = Math.min(prevStart + n - 1, view.lo - 1);
  }

  if (lo < 0 || !coversDayStart(data.days[lo])) return null;
  return { lo, hi };
}

/**
 * @typedef {object} Use Which filters a predicate applies. All default to true.
 * @property {boolean} [range]
 * @property {boolean} [models]
 * @property {boolean} [projects]
 */

/**
 * A predicate over fact rows for the current profile, range and filters.
 * @param {Use} [use]
 * @returns {(i: number) => boolean}
 */
function matcher({ range = true, models = true, projects = true } = {}) {
  const { lo, hi } = view;
  const { profile, modelOn, projectOn } = state;

  return (i) =>
    (profile < 0 || F.profile[i] === profile) &&
    (!range || (F.day[i] >= lo && F.day[i] <= hi)) &&
    (!models || modelOn[F.model[i]]) &&
    (!projects || projectOn[F.project[i]]);
}

// =============================================================================
// Aggregation. Everything on screen is a loop over the fact rows.
// =============================================================================

/** @param {number} i */
const costOf = (i) => F.cost[i];

/**
 * Sum `value(i)` into a rows x cols table, for every fact row that passes.
 * @param {(i: number) => boolean} pass
 * @param {number} rows @param {number} cols
 * @param {(i: number) => number} row @param {(i: number) => number} col
 * @param {(i: number) => number} [value]
 */
function tabulate(pass, rows, cols, row, col, value = costOf) {
  const out = new Float64Array(rows * cols);

  for (let i = 0; i < NROWS; i++) {
    if (pass(i)) out[row(i) * cols + col(i)] += value(i);
  }

  return out;
}

/**
 * Sum `value(i)` per key. @param {(i: number) => boolean} pass
 * @param {(i: number) => number} key @param {number} size
 * @param {(i: number) => number} [value]
 */
function groupSum(pass, key, size, value = costOf) {
  return tabulate(pass, size, 1, key, () => 0, value);
}

/** @param {(i: number) => boolean} pass @param {(i: number) => number} [value] */
function sumOf(pass, value = costOf) {
  let total = 0;
  for (let i = 0; i < NROWS; i++) if (pass(i)) total += value(i);

  return total;
}

/** @param {ArrayLike<number>} values */
function arraySum(values) {
  let total = 0;
  for (let i = 0; i < values.length; i++) total += values[i];

  return total;
}

const byDay = (/** @type {number} */ i) => F.day[i];
const byModel = (/** @type {number} */ i) => F.model[i];
const byProject = (/** @type {number} */ i) => F.project[i];
const messagesOf = (/** @type {number} */ i) => F.messages[i];

// Cost by token kind, in the order input, output, cache write, cache read.
const categoryCost = [F.costInput, F.costOutput, F.costCacheWrite, F.costCacheRead];

// =============================================================================
// DOM and SVG helpers
// =============================================================================

/**
 * @param {string} tag
 * @param {{ class?: string, text?: string, title?: string, attrs?: Record<string, string> }} [props]
 * @param {(Node | null)[]} [kids]
 */
function h(tag, props = {}, kids = []) {
  const el = document.createElement(tag);

  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.title) el.title = props.title;

  for (const [k, v] of Object.entries(props.attrs ?? {})) el.setAttribute(k, v);
  for (const kid of kids) if (kid) el.append(kid);

  return el;
}

/** @param {HTMLElement} el @param {(Node | null)[]} kids */
function fill(el, kids) {
  el.replaceChildren(...kids.filter((k) => k !== null));
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * @param {string} tag
 * @param {Record<string, string | number>} [attrs]
 * @param {(Node | string)[]} [kids]
 */
function svg(tag, attrs = {}, kids = []) {
  const el = document.createElementNS(SVG_NS, tag);

  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const kid of kids) el.append(kid);

  return el;
}

/** Round to two decimals for compact path data. @param {number} n */
const r2 = (n) => Math.round(n * 100) / 100;

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/** @param {string} color */
function dot(color) {
  const el = h("i", { class: "dot" });
  el.style.background = color;

  return el;
}

// test/dashboard-app.test.js runs everything above the end marker below, so
// keep code above it free of canvas, chart and event setup.
// @test calculations end
const measureCtx = document.createElement("canvas").getContext("2d");
let bodyFont = "";

/** Rendered width of chart text in px. @param {string} text @param {number} [size] */
function textWidth(text, size = 11) {
  if (!measureCtx) return text.length * size * 0.6;

  bodyFont ||= getComputedStyle(document.body).fontFamily;
  measureCtx.font = `${size}px ${bodyFont}`;

  return measureCtx.measureText(text).width;
}

// =============================================================================
// Tooltip controller, shared by every chart
// =============================================================================

/**
 * @typedef {object} TipContent
 * @property {string} title
 * @property {string} [total]
 * @property {{ color?: string, name: string, value: string }[]} [rows]
 * @property {string} [foot]
 */

/**
 * What a column chart gives the tooltip controller.
 * @typedef {object} ColumnHandle
 * @property {HTMLElement} host
 * @property {number} count
 * @property {(i: number) => TipContent} content
 * @property {(i: number) => { left: number, right: number, top: number, bottom: number, limit: number }} anchor Viewport coordinates.
 * @property {(i: number | null) => void} highlight
 */

const tipEl = byId("tooltip");
/** @type {{ handle: ColumnHandle, index: number } | null} */
let pinned = null;
/** @type {ColumnHandle | null} */
let shown = null;

/** @param {TipContent} c */
function fillTip(c) {
  fill(tipEl, [
    h("div", { class: "tip-head" }, [
      h("span", { text: c.title }),
      c.total ? h("span", { class: "tip-total", text: c.total }) : null,
    ]),
    c.rows?.length
      ? h(
          "div",
          { class: "tip-rows" },
          c.rows.map((r) =>
            h("div", { class: "tip-row" }, [
              r.color ? dot(r.color) : null,
              h("span", { class: "name", text: r.name }),
              h("span", { class: "val", text: r.value }),
            ]),
          ),
        )
      : null,
    c.foot ? h("div", { class: "tip-foot", text: c.foot }) : null,
  ]);
}

/** @param {number} x @param {number} y */
function moveTip(x, y) {
  tipEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

/**
 * @param {ColumnHandle} handle @param {number} i @param {number} [pointerY]
 */
function showColumn(handle, i, pointerY) {
  if (shown && shown !== handle) shown.highlight(null);
  shown = handle;
  handle.highlight(i);
  fillTip(handle.content(i));
  tipEl.hidden = false;

  const a = handle.anchor(i);
  const w = tipEl.offsetWidth;
  const hgt = tipEl.offsetHeight;
  let x = a.right + 12;

  if (x + w > Math.min(a.limit, innerWidth - 8)) x = a.left - 12 - w;

  let y = pointerY === undefined ? a.top : pointerY - hgt / 2;
  y = clamp(y, a.top, Math.max(a.top, a.bottom - hgt));

  moveTip(Math.max(8, x), clamp(y, 8, Math.max(8, innerHeight - hgt - 8)));
}

/** Tooltip that follows the pointer, used by the heat maps. @param {TipContent} c @param {number} x @param {number} y */
function showPoint(c, x, y) {
  if (pinned) return;

  fillTip(c);
  tipEl.hidden = false;

  const w = tipEl.offsetWidth;
  const hgt = tipEl.offsetHeight;
  const left = x + 14 + w > innerWidth - 8 ? x - 14 - w : x + 14;

  moveTip(Math.max(8, left), clamp(y + 14, 8, Math.max(8, innerHeight - hgt - 8)));
}

function hideTip() {
  tipEl.hidden = true;
  shown?.highlight(null);
  shown = null;
}

/** Hide and unpin. Called whenever the data under the tooltip changes. */
function resetTip() {
  pinned = null;
  delete tipEl.dataset.pinned;
  hideTip();
}

/** @param {ColumnHandle} handle @param {number} i @param {number} y */
function hoverColumn(handle, i, y) {
  if (!pinned) showColumn(handle, i, y);
}

/** @param {ColumnHandle} handle */
function leaveColumn(handle) {
  if (!pinned && shown === handle) hideTip();
}

/** @param {ColumnHandle} handle @param {number} i @param {number} y */
function pinColumn(handle, i, y) {
  if (pinned && pinned.handle === handle && pinned.index === i) {
    resetTip();
    return;
  }

  pinned = { handle, index: i };
  tipEl.dataset.pinned = "";
  showColumn(handle, i, y);
}

document.addEventListener("click", (e) => {
  if (pinned && !(e.target instanceof Node && pinned.handle.host.contains(e.target))) {
    resetTip();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    resetTip();
    setSidebar(false);
  } else if (pinned && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    e.preventDefault();

    const { handle } = pinned;

    pinned.index = clamp(pinned.index + (e.key === "ArrowLeft" ? -1 : 1), 0, handle.count - 1);
    showColumn(handle, pinned.index);
  }
});

// =============================================================================
// Chart hosts. Each chart is a draw function that reads its host's width, and a
// ResizeObserver redraws it when that width changes.
// =============================================================================

/** @type {Map<Element, () => void>} */
const drawers = new Map();
/** @type {WeakMap<Element, number>} */
const lastWidth = new WeakMap();
/** @type {Set<Element>} */
const pendingDraws = new Set();
let frame = 0;

const resizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const width = Math.round(entry.contentRect.width);
    if (lastWidth.get(entry.target) === width) continue;

    lastWidth.set(entry.target, width);
    if (drawers.has(entry.target)) pendingDraws.add(entry.target);
  }

  if (pendingDraws.size && !frame) {
    frame = requestAnimationFrame(() => {
      frame = 0;
      resetTip();
      for (const host of pendingDraws) drawers.get(host)?.();
      pendingDraws.clear();
    });
  }
});

/** @param {HTMLElement} host @param {() => void} draw */
function mount(host, draw) {
  drawers.set(host, draw);
  resizeObserver.observe(host);
  lastWidth.set(host, Math.round(host.clientWidth));
  draw();
}

/**
 * Replace a chart with the empty message. Messages that cost $0, from a model
 * the pricing file does not list, are usage too, so the text says so.
 * @param {HTMLElement} host @param {number} height
 */
function drawEmpty(host, height) {
  drawers.delete(host);
  host.removeAttribute("role");
  host.removeAttribute("aria-label");

  const unpriced = sumOf(matcher(), messagesOf) > 0;
  const text = unpriced ? "usage in this range is priced at $0." : "no usage in this range.";

  fill(host, [h("div", { class: "empty", text, attrs: { style: `height:${height}px` } })]);
}

/** @param {HTMLElement} host @param {{ color: string, label: string }[]} items */
function renderLegend(host, items) {
  fill(
    host,
    items.map((it) => h("span", {}, [dot(it.color), document.createTextNode(it.label)])),
  );

  host.hidden = items.length < 2;
}

// =============================================================================
// Column chart: stacked bars with a $ axis. Used for days, months and weeks.
// =============================================================================

// @test scales start

/** Tick values from 0 up past `max`, spaced at least one cent apart. @param {number} max @param {number} [target] */
function niceTicks(max, target = 4) {
  if (!(max > 0)) return { ticks: [0, 1], step: 1 };

  const raw = max / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = Math.max(0.01, (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag);
  const n = Math.ceil(max / step - 1e-9);

  return { ticks: Array.from({ length: n + 1 }, (_, i) => r2(i * step)), step };
}

/** @param {number} v @param {number} step */
function axisUsd(v, step) {
  if (v >= 1000) return `$${Number((v / 1000).toFixed(1))}k`;
  return step < 1 ? `$${v.toFixed(2)}` : `$${v}`;
}

// @test scales end

/**
 * Path for a bar whose top corners are rounded.
 * @param {number} x @param {number} y @param {number} w @param {number} hgt @param {number} r
 */
function barPath(x, y, w, hgt, r) {
  const rr = Math.min(r, w / 2, hgt);

  x = r2(x);
  y = r2(y);
  w = r2(w);
  hgt = r2(hgt);

  if (rr <= 0) return `M${x},${y}h${w}v${hgt}h${-w}z`;
  return `M${x},${y + hgt}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + hgt}z`;
}

/**
 * @typedef {object} ColumnChart
 * @property {HTMLElement} host
 * @property {number} height
 * @property {{ color: string }[]} segs Stack order, bottom first.
 * @property {{ values: number[], total: number }[]} cols
 * @property {number[]} [line] Dashed line, one value per column.
 * @property {boolean} [totals] Print the total above each bar.
 * @property {"start" | "middle"} [labelAnchor]
 * @property {(i: number, slot: number) => string | null} xLabel
 * @property {(i: number) => TipContent} tooltip
 * @property {string} aria
 */

/** @param {ColumnChart} o */
function columnChart(o) {
  const w = o.host.clientWidth;
  const n = o.cols.length;
  if (w < 60 || n === 0) return;

  const top = o.totals ? 24 : 10;
  const bottom = 24;
  const right = 6;
  const yMax0 = Math.max(0.01, ...o.cols.map((c) => c.total), ...(o.line ?? []));
  const { ticks, step } = niceTicks(yMax0);
  const yMax = ticks[ticks.length - 1];
  const labels = ticks.map((t) => axisUsd(t, step));
  const left = Math.ceil(Math.max(...labels.map((l) => textWidth(l)))) + 12;
  const plotW = w - left - right;
  const plotH = o.height - top - bottom;
  const slot = plotW / n;
  const yOf = (/** @type {number} */ v) => top + plotH * (1 - v / yMax);

  let gap = slot >= 8 ? 2 : 1;
  let bw = slot - gap;
  if (bw < 3) {
    gap = 0;
    bw = slot;
  }
  bw = Math.min(bw, 56);
  const barX = (/** @type {number} */ i) => left + i * slot + (slot - bw) / 2;
  const segGap = bw >= 8 ? 2 : bw >= 4 ? 1 : 0;

  const root = svg("svg", {
    width: w,
    height: o.height,
    viewBox: `0 0 ${w} ${o.height}`,
  });

  // Grid and y axis.
  ticks.forEach((t, k) => {
    const y = r2(yOf(t)) + 0.5;
    root.append(
      svg("line", {
        class: k === 0 ? "base-line" : "grid-line",
        x1: left,
        x2: w - right,
        y1: y,
        y2: y,
      }),
    );

    root.append(svg("text", { x: left - 8, y: y + 4, "text-anchor": "end" }, [labels[k]]));
  });

  // Hover column sits behind the bars.
  const hoverCol = svg("rect", {
    class: "hover-col",
    x: 0,
    y: 0,
    width: slot,
    height: top + plotH,
    visibility: "hidden",
  });
  root.append(hoverCol);

  // Bars.
  o.cols.forEach((col, i) => {
    let topK = -1;
    col.values.forEach((v, k) => {
      if (v > 0) topK = k;
    });

    let acc = 0;
    col.values.forEach((v, k) => {
      if (v <= 0) return;

      const yBottom = yOf(acc);
      const yTop = yOf(acc + v);
      acc += v;
      let y = yTop;
      let hgt = Math.max(yBottom - yTop, 0.75);

      if (k !== topK && hgt > segGap + 1) {
        y += segGap;
        hgt -= segGap;
      }

      root.append(
        svg("path", {
          d: barPath(barX(i), y, bw, hgt, k === topK ? 2 : 0),
          fill: o.segs[k].color,
        }),
      );
    });

    if (o.totals && col.total > 0 && slot >= 30) {
      root.append(
        svg(
          "text",
          {
            class: "total",
            x: r2(left + i * slot + slot / 2),
            y: r2(yOf(col.total) - 7),
            "text-anchor": "middle",
          },
          [usdShort(col.total)],
        ),
      );
    }
  });

  // Trailing average.
  if (o.line && n > 1) {
    const d = o.line.map((v, i) => `${i ? "L" : "M"}${r2(left + i * slot + slot / 2)},${r2(yOf(v))}`).join("");
    root.append(svg("path", { class: "avg-line", d }));
  }

  // X labels, thinned so they never overlap.
  const anchor = o.labelAnchor ?? "middle";
  let lastEnd = -Infinity;

  for (let i = 0; i < n; i++) {
    const text = o.xLabel(i, slot);
    if (!text) continue;
    const tw = textWidth(text);
    const x = anchor === "start" ? left + i * slot : left + i * slot + slot / 2;
    const x0 = anchor === "start" ? x : x - tw / 2;
    if (x0 < lastEnd + 8 || x0 + tw > w) continue;
    lastEnd = x0 + tw;
    root.append(svg("text", { x: r2(x), y: o.height - 6, "text-anchor": anchor }, [text]));
  }

  // One transparent target over the whole plot, so the pointer never misses a gap.
  const hit = svg("rect", {
    class: "hit",
    x: left,
    y: 0,
    width: plotW,
    height: o.height - bottom + 14,
  });
  root.append(hit);

  /** @type {ColumnHandle} */
  const handle = {
    host: o.host,
    count: n,
    content: o.tooltip,
    anchor(i) {
      const r = root.getBoundingClientRect();
      return {
        left: r.left + left + i * slot,
        right: r.left + left + (i + 1) * slot,
        top: r.top + top,
        bottom: r.top + top + plotH,
        limit: r.right,
      };
    },
    highlight(i) {
      if (i === null) {
        hoverCol.setAttribute("visibility", "hidden");
      } else {
        hoverCol.setAttribute("x", String(r2(left + i * slot)));
        hoverCol.setAttribute("visibility", "visible");
      }
    },
  };

  /** @param {PointerEvent | MouseEvent} e */
  const indexAt = (e) => clamp(Math.floor((e.clientX - root.getBoundingClientRect().left - left) / slot), 0, n - 1);

  hit.addEventListener("pointermove", (e) => hoverColumn(handle, indexAt(e), e.clientY));
  hit.addEventListener("pointerleave", () => leaveColumn(handle));
  hit.addEventListener("click", (e) => pinColumn(handle, indexAt(e), e.clientY));

  o.host.setAttribute("role", "img");
  o.host.setAttribute("aria-label", o.aria);
  o.host.replaceChildren(root);
}

// =============================================================================
// Header, tabs, theme
// =============================================================================

const rangeTabs = byId("range-tabs");
const profileTabs = byId("profile-tabs");

/** @param {string} label @param {() => void} onClick */
function tabButton(label, onClick) {
  const b = /** @type {HTMLButtonElement} */ (h("button", { class: "tab", text: label, attrs: { type: "button" } }));
  b.addEventListener("click", onClick);

  return b;
}

/** @param {() => void} fn */
function change(fn) {
  fn();
  writeHash();
  render();
}

const rangeButtons = RANGES.map((r) =>
  tabButton(r.label, () =>
    change(() => {
      state.range = r.id;
    }),
  ),
);

fill(rangeTabs, rangeButtons);

const profileButtons = [
  tabButton("all profiles", () =>
    change(() => {
      state.profile = -1;
    }),
  ),
  ...data.profiles.map((p, i) =>
    tabButton(p.name, () =>
      change(() => {
        state.profile = i;
      }),
    ),
  ),
];

if (NPROFILES > 1) {
  fill(profileTabs, profileButtons);
  profileTabs.hidden = false;
  byId("profile-sep").hidden = false;
}

function syncTabs() {
  RANGES.forEach((r, i) => rangeButtons[i].setAttribute("aria-pressed", String(r.id === state.range)));
  profileButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(i - 1 === state.profile)));
}

const themeToggle = byId("theme-toggle");

const ICON_SUN = () =>
  svg("svg", { viewBox: "0 0 16 16", "aria-hidden": "true" }, [
    svg("circle", { cx: 8, cy: 8, r: 2.8 }),
    svg("path", {
      d: "M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1",
    }),
  ]);

const ICON_MOON = () =>
  svg("svg", { viewBox: "0 0 16 16", "aria-hidden": "true" }, [
    svg("path", {
      d: "M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8z",
    }),
  ]);

function syncTheme() {
  const light = document.documentElement.dataset.theme === "light";
  const next = light ? "dark" : "light";

  themeToggle.replaceChildren(light ? ICON_MOON() : ICON_SUN());
  themeToggle.setAttribute("aria-label", `Switch to ${next} theme`);
  themeToggle.title = `Switch to ${next} theme`;
}

themeToggle.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;

  try {
    localStorage.setItem("claude-cost-theme", next);
  } catch {
    /* storage can be blocked on file:// */
  }

  syncTheme();
});

matchMedia("(prefers-color-scheme: light)").addEventListener("change", (e) => {
  let saved = null;

  try {
    saved = localStorage.getItem("claude-cost-theme");
  } catch {
    /* ignore */
  }

  if (!saved) {
    document.documentElement.dataset.theme = e.matches ? "light" : "dark";
    syncTheme();
  }
});

// =============================================================================
// Sidebar
// =============================================================================

const sidebar = byId("sidebar");

/** @param {boolean} open */
function setSidebar(open) {
  sidebar.toggleAttribute("data-open", open);
  document.body.style.overflow = open ? "hidden" : "";
}

byId("filters-open").addEventListener("click", () => setSidebar(true));
byId("filters-close").addEventListener("click", () => setSidebar(false));

/**
 * Click toggles a row, alt-click or double-click shows only that row.
 * Doing it again on the only active row turns everything back on.
 * @param {boolean[]} on @param {number} i
 */
function showOnly(on, i) {
  const alreadyOnly = on.every((v, k) => v === (k === i));

  on.forEach((_, k) => {
    on[k] = alreadyOnly || k === i;
  });
}

/**
 * @param {HTMLElement} host
 * @param {boolean[]} on
 * @param {{ label: string, color?: string, title?: string }[]} items
 */
function buildRows(host, on, items) {
  const rows = items.map((item, i) => {
    const b = /** @type {HTMLButtonElement} */ (
      h("button", { class: "side-row", title: item.title, attrs: { type: "button" } }, [
        item.color ? dot(item.color) : null,
        h("span", { class: "name", text: item.label }),
        h("span", { class: "amt" }),
      ])
    );

    b.addEventListener("click", (e) =>
      change(() => {
        if (e.altKey) showOnly(on, i);
        else on[i] = !on[i];
      }),
    );

    b.addEventListener("dblclick", () => change(() => showOnly(on, i)));
    return b;
  });

  fill(host, rows);
  return rows;
}

const modelRows = buildRows(
  byId("side-models"),
  state.modelOn,
  modelInfo.map((m, i) => ({ label: m.name, color: modelColors[i] })),
);

const projectRows = buildRows(
  byId("side-projects"),
  state.projectOn,
  data.projects.map((p) => ({
    label: p.label,
    title: p.path ?? p.folder,
  })),
);

for (const [id, on] of /** @type {[string, boolean[]][]} */ ([
  ["models", state.modelOn],
  ["projects", state.projectOn],
])) {
  byId(`reset-${id}`).addEventListener("click", () => change(() => on.fill(true)));
}

/**
 * @param {HTMLElement[]} rows @param {boolean[]} on @param {Float64Array} costs
 * @param {Float64Array} seen Fact rows per item in the selected profile. Items
 *   with none are hidden.
 * @param {string} countId @param {string} resetId
 */
function updateRows(rows, on, costs, seen, countId, resetId) {
  let shown = 0;
  let active = 0;

  rows.forEach((row, i) => {
    row.hidden = seen[i] === 0;
    row.setAttribute("aria-pressed", String(on[i]));
    const amt = row.querySelector(".amt");
    if (amt) amt.textContent = usd(costs[i]);

    if (!row.hidden) {
      shown += 1;
      if (on[i]) active += 1;
    }
  });

  byId(countId).textContent = active === shown ? String(shown) : `${active} of ${shown}`;
  byId(resetId).hidden = active === shown;
}

function updateSidebar() {
  const inProfile = matcher({ range: false, models: false, projects: false });
  const one = () => 1;

  updateRows(
    modelRows,
    state.modelOn,
    groupSum(matcher({ models: false }), byModel, NMODELS),
    groupSum(inProfile, byModel, NMODELS, one),
    "count-models",
    "reset-models",
  );

  updateRows(
    projectRows,
    state.projectOn,
    groupSum(matcher({ projects: false }), byProject, NPROJECTS),
    groupSum(inProfile, byProject, NPROJECTS, one),
    "count-projects",
    "reset-projects",
  );
}

// =============================================================================
// Section: KPIs
// =============================================================================

// test/dashboard-app.test.js also runs the code between the start and end
// markers in this file. Each marker is a comment that appears once.
// @test kpis start

/**
 * @param {string} label @param {string | (Node | null)[]} value @param {string} sub
 * @param {{ big?: boolean, dim?: boolean }} [opts]
 */
function kpi(label, value, sub, { big = false, dim = false } = {}) {
  const valueEl = h("div", { class: `kpi-value${dim ? " dim" : ""}` });
  if (typeof value === "string") valueEl.textContent = value;
  else fill(valueEl, value);

  return h("div", { class: `kpi${big ? " kpi-big" : ""}` }, [
    h("div", { class: "kpi-label", text: label }),
    valueEl,
    h("div", { class: "kpi-sub", text: sub }),
  ]);
}

function renderKpis() {
  const pass = matcher();
  const n = view.hi - view.lo + 1;
  const perDay = groupSum(pass, byDay, NDAYS);
  const total = sumOf(pass);
  const cells = [];

  cells.push(
    kpi("spent", usd(total), n > 0 ? fmtSpan(data.days[view.lo], data.days[view.hi]) : "no days with usage", {
      big: true,
    }),
  );

  // Change against the equal-length period before.
  const prev = previousBounds();

  if (prev) {
    const before = sumOf(matcher({ range: false }), (i) =>
      F.day[i] >= prev.lo && F.day[i] <= prev.hi ? F.cost[i] : 0,
    );

    if (before > 0) {
      const rounded = Math.round(((total - before) / before) * 100);
      const text = rounded === 0 ? "0%" : `${rounded > 0 ? "+" : "-"}${count(Math.abs(rounded))}%`;
      const label = state.range === "month" ? "vs previous month" : `vs previous ${state.range}`;

      cells.push(
        kpi(
          label,
          [
            rounded === 0 ? null : h("span", { class: "arrow", text: rounded > 0 ? "▲" : "▼" }),
            document.createTextNode(text),
          ],
          usd(before),
          { dim: true },
        ),
      );
    }
  }

  const active = perDay.reduce((c, v, d) => c + (d >= view.lo && d <= view.hi && v > 0 ? 1 : 0), 0);
  cells.push(kpi("per active day", usd(active ? total / active : 0), `${active} of ${Math.max(n, 0)} days active`));

  // Project only when --since preserves the whole month to date; otherwise
  // show the peak day in the selected range.
  const month = generated.date.slice(0, 7);
  const monthStart = `${month}-01`;

  if (n > 0 && dayMonthKey[view.hi] === month && coversDayStart(monthStart)) {
    const base = matcher({ range: false });
    const toDate = sumOf((i) => base(i) && dayMonthKey[F.day[i]] === month && data.days[F.day[i]] <= generated.date);
    const { y, m, d } = dayParts(generated.date);

    cells.push(kpi("month-end pace", usd((toDate / d) * daysInMonth(y, m)), `month to date ${usd(toDate)}`));
  } else {
    let best = -1;
    perDay.forEach((v, d) => {
      if (d >= view.lo && d <= view.hi && v > 0 && (best < 0 || v > perDay[best])) best = d;
    });

    cells.push(kpi("busiest day", usd(best < 0 ? 0 : perDay[best]), best < 0 ? "no spend" : fmtMD(data.days[best])));
  }

  // Cache writes cost more than plain input, so caching can cost more than it
  // saves. Sums of rounded costs can miss by a fraction of a cent.
  const uncached = sumOf(pass, (i) => F.uncachedCost[i]);
  const saved = uncached - total;
  const share = uncached > 0 ? Math.round((Math.abs(saved) / uncached) * 100) : 0;

  cells.push(
    saved > -0.005
      ? kpi("caching saved", usd(Math.max(saved, 0)), `${share}% off the uncached price`)
      : kpi("caching cost", usd(-saved), `${share}% over the uncached price`),
  );

  fill(byId("kpis"), cells);
}

// @test kpis end

// =============================================================================
// Section: daily spend
// =============================================================================

/**
 * Tooltip content for a column of per-model spend.
 * @param {string} title @param {ArrayLike<number>} values @param {{ label: string, color: string }[]} segs
 * @param {number} messages
 * @returns {TipContent}
 */
function modelTip(title, values, segs, messages) {
  const rows = segs
    .map((s, k) => ({ color: s.color, name: s.label, value: values[k] }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((r) => ({ color: r.color, name: r.name, value: usd(r.value) }));

  return {
    title,
    total: usd(arraySum(values)),
    rows,
    foot: plural(messages, "message"),
  };
}

const modelSegs = modelInfo.map((m, i) => ({
  label: m.name,
  color: modelColors[i],
}));

function renderDaily() {
  const host = byId("chart-daily");
  const pass = matcher();
  const { lo, hi } = view;
  const grid = tabulate(pass, NDAYS, NMODELS, byDay, byModel);
  const messages = groupSum(pass, byDay, NDAYS, messagesOf);
  const totals = groupSum(matcher({ range: false }), byDay, NDAYS);
  const n = hi - lo + 1;

  const cols = Array.from({ length: Math.max(n, 0) }, (_, i) => {
    const values = Array.from({ length: NMODELS }, (_, m) => grid[(lo + i) * NMODELS + m]);

    return { values, total: arraySum(values) };
  });

  const spent = arraySum(cols.map((c) => c.total));

  if (!(spent > 0)) {
    byId("cap-daily").textContent = "";
    renderLegend(byId("legend-daily"), []);
    drawEmpty(host, 260);

    return;
  }

  let best = 0;

  cols.forEach((c, i) => {
    if (c.total > cols[best].total) best = i;
  });

  byId("cap-daily").textContent = `most expensive day ${fmtMD(data.days[lo + best])}, ${usd(cols[best].total)}`;

  const used = modelSegs.filter((_, m) => cols.some((c) => c.values[m] > 0));
  renderLegend(byId("legend-daily"), used);

  // 7-day trailing average, using days before the range when they exist.
  const line = cols.map((_, i) => {
    const from = Math.max(0, lo + i - 6);

    return arraySum(Array.from(totals.subarray(from, lo + i + 1))) / (lo + i - from + 1);
  });

  const monthStarts = Array.from({ length: n }, (_, i) => i).filter((i) => dayParts(data.days[lo + i]).d === 1);
  const multiYear = dayParts(data.days[lo]).y !== dayParts(data.days[hi]).y;

  /** @type {(i: number, slot: number) => string | null} */
  const xLabel = (i, slot) => {
    const s = data.days[lo + i];
    const { m, d, y } = dayParts(s);

    if (n <= 10) return d === 1 ? `${MONTHS[m - 1]} 1` : `${WEEKDAYS[dayWeekday[lo + i]]} ${d}`;
    if (n <= 35) return d === 1 ? `${MONTHS[m - 1]} 1` : slot >= 16 || d % 2 === 1 ? String(d) : null;
    const name = multiYear && (m === 1 || i === 0) ? `${MONTHS[m - 1]} ${y}` : MONTHS[m - 1];

    if (d === 1) return name;
    // Label the partial first month only when there is room before the next one.
    return i === 0 && (monthStarts[0] ?? n) * slot >= 56 ? name : null;
  };

  mount(host, () =>
    columnChart({
      host,
      height: 260,
      segs: modelSegs,
      cols,
      line,
      xLabel,
      labelAnchor: n > 35 ? "start" : "middle",
      tooltip: (i) => modelTip(fmtWeekdayMD(data.days[lo + i]), cols[i].values, modelSegs, messages[lo + i]),
      aria: `Stacked bar chart of daily spend from ${fmtMD(data.days[lo])} to ${fmtMD(data.days[hi])}. Total ${usd(spent)}. Peak ${usd(cols[best].total)} on ${fmtMD(data.days[lo + best])}.`,
    }),
  );
}

// =============================================================================
// Section: month by month
// =============================================================================

function renderMonthly() {
  const host = byId("chart-monthly");
  const pass = matcher({ range: false });
  const nMonths = monthKeys.length;
  const grid = tabulate(pass, nMonths, NMODELS, (i) => dayMonth[F.day[i]], byModel);
  const messages = groupSum(pass, (i) => dayMonth[F.day[i]], nMonths, messagesOf);

  const cols = monthKeys.map((_, k) => {
    const values = Array.from({ length: NMODELS }, (_, m) => grid[k * NMODELS + m]);
    return { values, total: arraySum(values) };
  });
  const spent = arraySum(cols.map((c) => c.total));
  byId("cap-monthly").textContent = capturedFrom ? `since ${fmtMDY(capturedFrom.date)}` : "all history";

  if (!(spent > 0)) {
    drawEmpty(host, 200);
    return;
  }

  const multiYear = new Set(monthKeys.map((k) => k.slice(0, 4))).size > 1;
  /** @param {number} k */
  const monthName = (k) => {
    const [y, m] = monthKeys[k].split("-").map(Number);
    return {
      short: multiYear && (m === 1 || k === 0) ? `${MONTHS[m - 1]} ${y}` : MONTHS[m - 1],
      long: `${MONTHS_LONG[m - 1]} ${y}`,
    };
  };

  mount(host, () =>
    columnChart({
      host,
      height: 200,
      segs: modelSegs,
      cols,
      totals: true,
      xLabel: (k) => monthName(k).short,
      tooltip: (k) => modelTip(monthName(k).long, cols[k].values, modelSegs, messages[k]),
      aria: `Stacked bar chart of spend per month, ${nMonths} months, ${usd(spent)} in total.`,
    }),
  );
}

// =============================================================================
// Section: models and projects
// =============================================================================

let showAllProjects = false;
const RANK_LIMIT = 10;
/** Rows that would print as $0.00 are left out of the rankings. */
const MIN_RANKED = 0.005;

/**
 * @param {HTMLElement} host
 * @param {{ label: string, title?: string, sub?: string, value: number, color: string }[]} items Sorted, highest first.
 * @param {number} total
 * @param {{ limit: number, expanded: boolean, toggle: () => void }} [more]
 */
function renderRanking(host, items, total, more) {
  const top = items.length ? items[0].value : 0;
  const shownItems = more && !more.expanded ? items.slice(0, more.limit) : items;
  const rows = shownItems.map((it) => {
    const bar = h("i");
    bar.style.width = `${top > 0 ? (it.value / top) * 100 : 0}%`;
    bar.style.background = it.color;

    return h("li", { class: "rank" }, [
      h("div", { class: "rank-line" }, [
        h("span", { class: "rank-name", title: it.title }, [
          document.createTextNode(it.label),
          it.sub ? h("span", { class: "sub", text: it.sub }) : null,
        ]),
        h("span", { class: "rank-cost", text: usd(it.value) }),
        h("span", { class: "rank-share", text: pct(it.value, total) }),
      ]),
      h("div", { class: "rank-bar" }, [bar]),
    ]);
  });

  if (more && items.length > more.limit) {
    const btn = h("button", {
      class: "more-btn",
      text: more.expanded ? "show less" : `show all ${items.length}`,
      attrs: { type: "button" },
    });

    btn.addEventListener("click", more.toggle);
    rows.push(h("li", {}, [btn]));
  }

  if (!rows.length) rows.push(h("li", { class: "rank-empty", text: "nothing to rank in this range." }));
  fill(host, rows);
}

function renderRankings() {
  const pass = matcher();
  const total = sumOf(pass);

  // Models
  const perModel = groupSum(pass, byModel, NMODELS);
  const models = modelInfo
    .map((m, i) => ({
      label: m.name,
      value: perModel[i],
      color: modelColors[i],
    }))
    .filter((m) => m.value >= MIN_RANKED)
    .sort((a, b) => b.value - a.value);
  renderRanking(byId("rank-models"), models, total);
  byId("cap-models").textContent = models.length
    ? `${models[0].label} is ${Math.round((models[0].value / total) * 100)}% of spend`
    : "";

  // Projects, with the sessions that overlap the range. Sessions have no model
  // column, so the count would be wrong while a model filter is on.
  const allModels = state.modelOn.every(Boolean);
  const perProject = groupSum(pass, byProject, NPROJECTS);
  const sessions = new Int32Array(NPROJECTS);
  const S = data.sessions;

  for (let k = 0; k < S.project.length; k++) {
    if (state.profile >= 0 && S.profile[k] !== state.profile) continue;
    if (!state.projectOn[S.project[k]]) continue;
    if (S.lastDay[k] >= view.lo && S.firstDay[k] <= view.hi) sessions[S.project[k]]++;
  }

  const projects = data.projects
    .map((p, i) => ({
      label: p.label,
      title: p.path ?? p.folder,
      value: perProject[i],
      color: "var(--accent)",
      sub: allModels ? plural(sessions[i], "session") : "",
    }))
    .filter((p) => p.value >= MIN_RANKED)
    .sort((a, b) => b.value - a.value);

  renderRanking(byId("rank-projects"), projects, total, {
    limit: RANK_LIMIT,
    expanded: showAllProjects,
    toggle: () => {
      showAllProjects = !showAllProjects;
      renderRankings();
    },
  });

  const topN = Math.min(3, projects.length);
  const topShare = Math.round((arraySum(projects.slice(0, topN).map((p) => p.value)) / total) * 100);

  byId("cap-projects").textContent = !projects.length
    ? ""
    : topN === 1
      ? `${projects[0].label} is ${topShare}% of spend`
      : `top ${topN} projects are ${topShare}%`;
}

// =============================================================================
// Section: when you spend (heat maps)
// =============================================================================

const HEAT_GAP = 3;
const HEAT_LABEL_W = 30;

/**
 * Maps spend to 0 (none) or 1-5, with the cut points at quintiles of the
 * non-zero values so a few big days do not wash out the rest.
 * @param {ArrayLike<number>} values
 */
function heatLevels(values) {
  const sorted = Array.from(values)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const max = sorted[sorted.length - 1] ?? 0;
  const cuts = [0.2, 0.4, 0.6, 0.8].map((q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]);

  return (/** @type {number} */ v) => (v <= 0 ? 0 : v >= max ? 5 : 1 + cuts.filter((c) => v > c).length);
}

/** @param {number} level */
const heatFill = (level) => (level === 0 ? "var(--line)" : `var(--heat-${level})`);

/** Cell size that fits the calendar into its panel, shared with the hour grid. @param {number} width @param {number} weeks */
function calendarCell(width, weeks) {
  return clamp(Math.floor((width - HEAT_LABEL_W + HEAT_GAP) / Math.max(weeks, 1)) - HEAT_GAP, 9, 16);
}

/**
 * Wire hover tooltips onto cells that carry a data-i index.
 * @param {SVGElement} root @param {(i: number) => TipContent} content
 */
function cellTooltips(root, content) {
  root.addEventListener("pointermove", (e) => {
    const t = e.target;
    const i = t instanceof SVGElement && t.dataset.i !== undefined ? Number(t.dataset.i) : -1;

    if (i < 0) hideTip();
    else showPoint(content(i), e.clientX, e.clientY);
  });

  root.addEventListener("pointerleave", () => {
    if (!pinned) hideTip();
  });
}

function renderHeat() {
  const pass = matcher();
  const calHost = byId("heat-days");
  const hourHost = byId("heat-hours");
  const { lo, hi } = view;
  const perDay = groupSum(pass, byDay, NDAYS);
  const spent = hi >= lo ? arraySum(Array.from(perDay.subarray(lo, hi + 1))) : 0;

  byId("heat-legend").hidden = !(spent > 0);
  if (!(spent > 0)) {
    byId("cap-when").textContent = "";
    drawEmpty(calHost, 130);
    drawEmpty(hourHost, 130);
    return;
  }

  // Calendar: one column per week, Monday at the top.
  const msgsDay = groupSum(pass, byDay, NDAYS, messagesOf);
  const dayLevel = heatLevels(Array.from(perDay.subarray(lo, hi + 1)));
  const week0 = dayWeek[lo];
  const weeks = dayWeek[hi] - week0 + 1;

  mount(calHost, () => {
    const s = calendarCell(calHost.clientWidth, weeks);
    const pitch = s + HEAT_GAP;
    const top = 18;
    const width = HEAT_LABEL_W + weeks * pitch - HEAT_GAP;
    const root = svg("svg", { width, height: top + 7 * pitch - HEAT_GAP });

    [0, 2, 4].forEach((row) => root.append(svg("text", { x: 0, y: top + row * pitch + s - 2 }, [WEEKDAYS[row]])));

    // Month labels sit over the week that holds the 1st, left to right without overlap.
    let lastEnd = -Infinity;
    for (let d = lo; d <= hi; d++) {
      const { m, d: dom } = dayParts(data.days[d]);
      const first = d === lo;
      if (dom !== 1 && !first) continue;

      const x = HEAT_LABEL_W + (dayWeek[d] - week0) * pitch;
      const nextStart = data.days.findIndex((s2, k) => k > d && s2.endsWith("-01"));

      if (first && dom !== 1 && nextStart >= 0 && dayWeek[nextStart] - dayWeek[d] < 3) continue;
      if (x < lastEnd + 6) continue;

      root.append(svg("text", { x, y: 10 }, [MONTHS[m - 1]]));
      lastEnd = x + textWidth(MONTHS[m - 1]);
    }

    for (let d = lo; d <= hi; d++) {
      root.append(
        svg("rect", {
          x: HEAT_LABEL_W + (dayWeek[d] - week0) * pitch,
          y: top + dayWeekday[d] * pitch,
          width: s,
          height: s,
          rx: 2,
          fill: heatFill(dayLevel(perDay[d])),
          "data-i": d,
        }),
      );
    }

    cellTooltips(root, (d) => ({
      title: fmtWeekdayMD(data.days[d]),
      total: usd(perDay[d]),
      foot: plural(msgsDay[d], "message"),
    }));

    calHost.setAttribute("role", "img");
    calHost.setAttribute("aria-label", `Calendar heat map of daily spend, ${weeks} weeks, ${usd(spent)} in total.`);
    calHost.replaceChildren(root);
    calHost.scrollLeft = calHost.scrollWidth;
  });

  // Hour of day by weekday.
  const hourOf = (/** @type {number} */ i) => F.hour[i];
  const weekdayOfRow = (/** @type {number} */ i) => dayWeekday[F.day[i]];
  const grid = tabulate(pass, 7, 24, weekdayOfRow, hourOf);
  const gridMsgs = tabulate(pass, 7, 24, weekdayOfRow, hourOf, messagesOf);
  const hourLevel = heatLevels(grid);
  let peak = 0;

  grid.forEach((v, k) => {
    if (v > grid[peak]) peak = k;
  });

  byId("cap-when").textContent = `busiest slot ${WEEKDAYS_PLURAL[Math.floor(peak / 24)]} around ${pad(peak % 24)}:00`;

  mount(hourHost, () => {
    const s = calendarCell(calHost.clientWidth, weeks);
    const cw = clamp(Math.floor((hourHost.clientWidth - HEAT_LABEL_W + HEAT_GAP) / 24) - HEAT_GAP, 9, 30);

    const pitchX = cw + HEAT_GAP;
    const pitchY = s + HEAT_GAP;
    const top = 18;
    const root = svg("svg", {
      width: HEAT_LABEL_W + 24 * pitchX - HEAT_GAP,
      height: top + 7 * pitchY - HEAT_GAP,
    });

    [0, 2, 4].forEach((row) => root.append(svg("text", { x: 0, y: top + row * pitchY + s - 2 }, [WEEKDAYS[row]])));

    [0, 6, 12, 18].forEach((hour) =>
      root.append(svg("text", { x: HEAT_LABEL_W + hour * pitchX, y: 10 }, [String(hour)])),
    );

    grid.forEach((v, k) => {
      root.append(
        svg("rect", {
          x: HEAT_LABEL_W + (k % 24) * pitchX,
          y: top + Math.floor(k / 24) * pitchY,
          width: cw,
          height: s,
          rx: 2,
          fill: heatFill(hourLevel(v)),
          "data-i": k,
        }),
      );
    });

    cellTooltips(root, (k) => ({
      title: `${WEEKDAYS[Math.floor(k / 24)]} ${pad(k % 24)}:00`,
      total: usd(grid[k]),
      foot: plural(gridMsgs[k], "message"),
    }));

    hourHost.setAttribute("role", "img");
    hourHost.setAttribute("aria-label", `Heat map of spend by hour and weekday. ${byId("cap-when").textContent}.`);
    hourHost.replaceChildren(root);
  });
}

function buildHeatLegend() {
  const swatch = (/** @type {number} */ level) => {
    const i = h("i");
    i.style.background = heatFill(level);
    return i;
  };

  fill(byId("heat-legend"), [
    h("span", { text: "less" }),
    ...[0, 1, 2, 3, 4, 5].map(swatch),
    h("span", { text: "more" }),
  ]);
}

// =============================================================================
// Section: tokens vs dollars
// =============================================================================

const TOKEN_KINDS = [
  { name: "input", color: "var(--tok-input)" },
  { name: "output", color: "var(--tok-output)" },
  { name: "cache write", color: "var(--tok-write)" },
  { name: "cache read", color: "var(--tok-read)" },
];

/**
 * One 100% stacked bar with a legend underneath.
 * @param {string} label @param {number[]} values @param {(v: number) => string} format
 */
function splitBlock(label, values, format) {
  const total = arraySum(values);
  const bar = h("div", { class: "split-bar", attrs: { role: "img" } });
  const summary = TOKEN_KINDS.map((k, i) => `${k.name} ${pct(values[i], total)}`).join(", ");
  bar.setAttribute("aria-label", `${label}: ${summary}`);

  for (let i = 0; i < values.length; i++) {
    if (values[i] <= 0) continue;
    const seg = h("i");
    seg.style.flexGrow = String(values[i] / total);
    seg.style.background = TOKEN_KINDS[i].color;
    bar.append(seg);
  }

  const legend = h(
    "div",
    { class: "split-legend" },
    TOKEN_KINDS.map((k, i) => {
      const swatch = dot(k.color);
      return h("span", {}, [
        swatch,
        document.createTextNode(`${k.name} `),
        h("b", { text: pct(values[i], total) }),
        document.createTextNode(` ${format(values[i])}`),
      ]);
    }),
  );

  return h("div", { class: "split" }, [h("div", { class: "split-label", text: label }), bar, legend]);
}

function renderTokens() {
  const pass = matcher();
  const tokens = [F.input, F.output, F.cacheWrite, F.cacheRead].map((arr) => sumOf(pass, (i) => arr[i]));
  const costs = categoryCost.map((arr) => sumOf(pass, (i) => arr[i]));
  const totalTokens = arraySum(tokens);
  const totalCost = arraySum(costs);
  const host = byId("tokens");

  if (!(totalTokens > 0)) {
    byId("cap-tokens").textContent = "";
    fill(host, [
      h("div", {
        class: "empty",
        text: "no usage in this range.",
        attrs: { style: "height:120px" },
      }),
    ]);
    return;
  }

  byId("cap-tokens").textContent = `${compact(totalTokens)} tokens, ${usd(sumOf(pass))}`;

  const uncached = sumOf(pass, (i) => F.uncachedCost[i]);
  const spent = sumOf(pass);
  const readTokens = pct(tokens[3], totalTokens).replace("<", "under ");
  const readCost = pct(costs[3], totalCost).replace("<", "under ");
  let sentence = `Cache reads are ${readTokens} of tokens and ${readCost} of cost.`;
  if (uncached > spent) sentence += ` Without caching this range would have cost ${usd(uncached)}.`;

  fill(host, [
    splitBlock("tokens", tokens, compact),
    splitBlock("cost", costs, usd),
    h("p", { class: "sentence", text: sentence }),
  ]);
}

// =============================================================================
// Section: main agent vs subagents
// =============================================================================

function renderAgents() {
  const host = byId("chart-agents");
  const pass = matcher();
  const { lo, hi } = view;
  const nWeeks = weekKeys.length;
  const bySubagent = (/** @type {number} */ i) => (F.subagent[i] ? 1 : 0);
  const byWeek = (/** @type {number} */ i) => dayWeek[F.day[i]];
  const grid = tabulate(pass, nWeeks, 2, byWeek, bySubagent);
  const messages = groupSum(pass, byWeek, nWeeks, messagesOf);
  const total = arraySum(grid);

  if (hi < lo || !(total > 0)) {
    byId("cap-agents").textContent = "";
    renderLegend(byId("legend-agents"), []);
    drawEmpty(host, 180);

    return;
  }

  const week0 = dayWeek[lo];
  const weeks = dayWeek[hi] - week0 + 1;
  const cols = Array.from({ length: weeks }, (_, k) => {
    const values = [grid[(week0 + k) * 2], grid[(week0 + k) * 2 + 1]];
    return { values, total: values[0] + values[1] };
  });
  const segs = [
    { label: "main agent", color: "var(--fg-3)" },
    { label: "subagents", color: "var(--accent)" },
  ];
  const subTotal = arraySum(cols.map((c) => c.values[1]));

  byId("cap-agents").textContent = `subagents are ${Math.round((subTotal / total) * 100)}% of spend`;
  renderLegend(byId("legend-agents"), segs);

  mount(host, () =>
    columnChart({
      host,
      height: 180,
      segs,
      cols,
      xLabel: (k) => fmtMD(weekKeys[week0 + k]),
      tooltip: (k) => ({
        title: `Week of ${fmtMD(weekKeys[week0 + k])}`,
        total: usd(cols[k].total),
        rows: segs.map((s, j) => ({
          color: s.color,
          name: s.label,
          value: usd(cols[k].values[j]),
        })),
        foot: plural(messages[week0 + k], "message"),
      }),
      aria: `Stacked bar chart of weekly spend, main agent against subagents. Subagents are ${Math.round((subTotal / total) * 100)}% of ${usd(total)}.`,
    }),
  );
}

// =============================================================================
// Footer
// =============================================================================

function renderFooter() {
  const unique = (/** @type {string[]} */ list) => [...new Set(list.filter(Boolean))];
  const regions = unique(data.profiles.map((p) => p.region));
  const files = unique(data.profiles.map((p) => p.pricingFile));
  const when = `${fmtMDY(generated.date)}, ${generated.time}`;
  const meta = [`generated ${when}`, data.timezone];
  if (regions.length) meta.push(`region ${regions.join(", ")}`);
  if (files.length) meta.push(files.join(", "));

  const w = data.warnings;
  const lines = [
    meta.join(" · "),
    "Estimates priced from local transcripts. Check the GCP Billing export for real numbers.",
  ];

  if (w.unknownModels.length) lines.push(`Unknown models priced at $0: ${w.unknownModels.join(", ")}`);
  if (w.notInRegion.length) lines.push(`Not offered at the endpoint: ${w.notInRegion.join(", ")}`);
  if (w.archivedTranscripts > 0) {
    lines.push(`Includes ${plural(w.archivedTranscripts, "deleted transcript")} kept in the usage store.`);
  }
  if (w.skippedUndated > 0)
    lines.push(`${plural(w.skippedUndated, "message")} with a missing or implausible date left out of the charts.`);

  fill(
    byId("foot"),
    lines.map((text) => h("p", { text })),
  );
}

// =============================================================================
// Render
// =============================================================================

function render() {
  resetTip();
  computeView();
  syncTabs();
  updateSidebar();
  renderKpis();
  renderDaily();
  renderMonthly();
  renderRankings();
  renderHeat();
  renderTokens();
  renderAgents();
}

readHash();
syncTheme();
buildHeatLegend();
renderFooter();
render();
addEventListener("hashchange", () => {
  readHash();
  render();
});
