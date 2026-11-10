// @ts-check
import { Console } from "node:console";
import { Writable } from "node:stream";

/** @import { Totals } from "../types.js" */

/** @param {number} n */
export const fmtUSD = (n) => `$${n.toFixed(4)}`;

/** @param {number} n */
export const fmtNum = (n) => n.toLocaleString("en-US");

/**
 * Copy of a totals object with cost rounded for JSON output.
 *
 * @param {Totals} totals
 * @returns {Totals}
 */
export const roundCost = (totals) => ({
  ...totals,
  costUSD: Number(totals.costUSD.toFixed(6)),
});

/**
 * `console.table` output as a string, without the trailing newline.
 *
 * @param {object} data
 */
export function formatTable(data) {
  let text = "";

  const stream = new Writable({
    write(chunk, _encoding, done) {
      text += chunk;
      done();
    },
  });

  // Writable calls write() synchronously, so `text` is complete on return.
  new Console({ stdout: stream, colorMode: false }).table(data);

  return text.replace(/\n$/, "");
}

/**
 * `console.table` rows for a Map of model to totals.
 *
 * @param {Map<string, Totals>} models
 */
export function modelRows(models) {
  /** @type {Record<string, object>} */
  const rows = {};

  for (const [model, totals] of models) {
    rows[model] = {
      input: fmtNum(totals.inputTokens),
      output: fmtNum(totals.outputTokens),
      cacheRead: fmtNum(totals.cacheReadTokens),
      cacheWrite: fmtNum(totals.cacheWriteTokens),
      msgs: totals.messages,
      cost: fmtUSD(totals.costUSD),
    };
  }

  return rows;
}

/**
 * Pretty-printed JSON for a report.
 *
 * @param {unknown} value
 */
export const formatJson = (value) => JSON.stringify(value, null, 2);
