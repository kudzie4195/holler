/**
 * Resident requests (holler_signals rows with source 'holler-request') must disappear from every public and member surface as soon as
 * they end: closed or removed (expires_at is set to the close time) or simply run out (expires_at = confirm time + 14 days).
 * The scan cron deletes their rows (lib/requests/service.ts purgeEndedRequests); these helpers are the read-time guard on top, so a row
 * the purge has not reached yet is never shown. Other sources are untouched: an expired weather alert still counts as history.
 * Client-safe (no imports).
 */

export const HOLLER_REQUEST_SOURCE = 'holler-request';

/**
 * Cache lifetime for a cached entry (city, weekly, trade page, /check) that lists at least one resident request.
 * `revalidate` 5 minutes, `expire` 15 minutes: per the cacheLife docs an entry older than `expire` is never served (the next request
 * waits for a fresh render, and the read-time filter drops the ended request), so a request that ends leaves every cached page within
 * 15 minutes at most. Before, `expire` was 24 hours, so a page nobody visited could show a closed request the next day (review P1-2).
 * Those entries are also tagged REQUEST_CACHE_TAG, and closing, removing and the purge expire the tag at once (lib/requests/cache.ts).
 * The legal pages and emails promise "within about 15 minutes", which is what `expire` guarantees.
 */
export const REQUEST_CACHE_LIFE = { stale: 300, revalidate: 300, expire: 900 } as const;
export const REQUEST_PAGE_REVALIDATE_SECONDS = REQUEST_CACHE_LIFE.revalidate;
/** Max age, in seconds, of any cached copy of a page that lists a resident request. */
export const REQUEST_PAGE_MAX_AGE_SECONDS = REQUEST_CACHE_LIFE.expire;
export const REQUEST_CACHE_TAG = 'holler-requests';

interface MaybeRequest {
  source?: string | null;
  expires_at?: string | null;
}

/** True for a resident request that has ended (or has no expiry, which a live request always has). False for every other source. */
export function isEndedRequest(r: MaybeRequest, nowMs: number): boolean {
  if (r.source !== HOLLER_REQUEST_SOURCE) return false;
  if (!r.expires_at) return true;
  const exp = Date.parse(r.expires_at);
  return !Number.isFinite(exp) || exp <= nowMs;
}

/** The rows minus ended resident requests. */
export function withoutEndedRequests<T extends MaybeRequest>(rows: T[], nowMs: number): T[] {
  return rows.filter((r) => !isEndedRequest(r, nowMs));
}

/** True when any row is a resident request (its page should be cached for a short time only). */
export function hasRequestRows(rows: MaybeRequest[]): boolean {
  return rows.some((r) => r.source === HOLLER_REQUEST_SOURCE);
}

/**
 * PostgREST `or` filter that keeps every row except ended resident requests: `.or(liveRequestsFilter(nowIso))`.
 * Rows of other sources pass whatever their expiry; resident requests pass only while expires_at is in the future.
 */
export function liveRequestsFilter(nowIso: string): string {
  return `source.neq.${HOLLER_REQUEST_SOURCE},expires_at.gt.${nowIso}`;
}
