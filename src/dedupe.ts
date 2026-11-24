import type { TokenCounts, UsageEvent } from "./types.ts";

// Total tokens for comparing duplicate usage snapshots.
export function usageTokenTotal(usage: TokenCounts) {
  return usage.input + usage.output + usage.cacheWrite + usage.cacheRead;
}

/**
 * Deduplicate usage events by messageId + requestId.
 * Events without messageId are always kept.
 * On collision, keep the entry with the higher token total (tie → keep first).
 */
export async function dedupeEvents(events: AsyncIterable<UsageEvent> | Iterable<UsageEvent>): Promise<UsageEvent[]> {
  const byKey: Map<string, UsageEvent> = new Map();
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
