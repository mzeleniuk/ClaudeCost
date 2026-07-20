/** Total tokens for comparing duplicate usage snapshots. */
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
 */
export async function dedupeEvents(events) {
  const byKey = new Map();
  const noKey = [];

  for await (const ev of events) {
    if (!ev.messageId) {
      noKey.push(ev);
      continue;
    }
    const key = `${ev.messageId}\0${ev.requestId ?? ""}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, ev);
      continue;
    }
    if (usageTokenTotal(ev.usage) > usageTokenTotal(existing.usage)) {
      byKey.set(key, ev);
    }
  }

  return [...byKey.values(), ...noKey];
}
