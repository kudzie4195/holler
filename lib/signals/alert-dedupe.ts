/**
 * One weather alert that covers several counties is stored as one row per county (adapters/nws.ts: external id `alert#FIPS`, data.alertId =
 * the alert's own id). A member near several of them must get the alert once. The scan, the rematch and the backfill dedupe through
 * pickHits (lib/signals/match.ts); the read paths (web feed, mobile feed, digest, push count) use this helper, because matches stored in
 * different runs can point at different county rows of the same alert. Pure and client-safe.
 */

/** The fields that identify the alert: nested (a stored signal) or read flat as `alertId:data->>alertId` (a match select). */
export interface AlertKeyed {
  source?: string | null;
  data?: { alertId?: unknown } | null;
  alertId?: unknown;
}

/** `source|alertId` for a row that belongs to a multi-county alert, else null (every other record). */
export function alertKeyOf(s: AlertKeyed | null | undefined): string | null {
  if (!s) return null;
  const id = typeof s.alertId === 'string' && s.alertId ? s.alertId : typeof s.data?.alertId === 'string' && s.data.alertId ? s.data.alertId : null;
  return id ? `${s.source ?? ''}|${id}` : null;
}

/** Keeps the first item of each alert (input order decides which), and every item that is not part of a multi-county alert. */
export function dedupeByAlert<T>(items: readonly T[], signalOf: (item: T) => AlertKeyed | null | undefined): T[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    const key = alertKeyOf(signalOf(it));
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
