// @ts-check

/** @import { Usage, UsageEvent } from "./types.js" */

/**
 * Total tokens for comparing duplicate usage snapshots.
 *
 * @param {Pick<Usage, "input" | "output" | "cacheWrite" | "cacheRead">} usage
 */
export function usageTokenTotal(usage) {
  return (
    (usage.input ?? 0) +
    (usage.output ?? 0) +
    (usage.cacheWrite ?? 0) +
    (usage.cacheRead ?? 0)
  );
}

/**
 * Deduplicate usage events by messageId + requestId.
 * Events without messageId are always kept.
 * On collision, keep the entry with the higher token total (tie → keep first).
 *
 * @param {AsyncIterable<UsageEvent> | Iterable<UsageEvent>} events
 * @returns {Promise<UsageEvent[]>}
 */
export async function dedupeEvents(events) {
  /** @type {Map<string, UsageEvent>} */
  const byKey = new Map();
  const noKey = [];

  for await (const event of events) {
    if (!event.messageId) {
      noKey.push(event);
      continue;
    }

    const key = `${event.messageId}\0${event.requestId ?? ""}`;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, event);
      continue;
    }

    if (usageTokenTotal(event.usage) > usageTokenTotal(existing.usage)) {
      byKey.set(key, event);
    }
  }

  return [...byKey.values(), ...noKey];
}
