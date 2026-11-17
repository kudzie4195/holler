import { cacheLife, cacheTag } from 'next/cache';
import { publicClient } from './client';
import { WINDOW_DAYS } from './threshold';
import { emptyPlaceData, summarize, DEFAULT_ITEM_LIMIT, type PlaceData, type SignalRowDb } from './summarize';
import type { SectionId } from './sections';
import { UPCOMING_DAYS, newestPast } from '../time';
import { REQUEST_CACHE_LIFE, REQUEST_CACHE_TAG, hasRequestRows, liveRequestsFilter, withoutEndedRequests } from '@/lib/signals/request-visibility';

const DAY = 86_400_000;
const ROW_COLUMNS = 'id,source,kind,title,summary,url,categories,severity,occurred_at,expires_at,subtype:data->>subtype';
const ROW_CAP = 1000;
const QUERY_TIMEOUT_MS = 10_000;

/**
 * Everything a city page needs, read with the anon client from holler_signals only.
 * Cached for 6 hours (SPEC: revalidate = 21600). `export const revalidate` is removed in this
 * Next.js version when cacheComponents is on, so the 6 h lifetime is set here with cacheLife.
 * Failures are cached for only 60 s so a DB blip does not pin an empty page for 6 hours.
 * Resident requests that have ended are left out (in the query and again on the rows), and a page that lists a live request is
 * cached for 15 minutes only, so a closed request leaves it promptly.
 */
export async function loadPlaceData(slug: string): Promise<PlaceData> {
  'use cache';
  const now = new Date();
  const nowIso = now.toISOString();
  const sb = publicClient();
  if (!sb) {
    cacheLife({ stale: 300, revalidate: 60, expire: 300 });
    return emptyPlaceData(slug, nowIso, false);
  }
  try {
    const since = new Date(now.getTime() - WINDOW_DAYS * DAY).toISOString();
    const until = new Date(now.getTime() + UPCOMING_DAYS * DAY).toISOString();
    const { data, error, count } = await sb
      .from('holler_signals')
      .select(ROW_COLUMNS, { count: 'exact' })
      .eq('place_slug', slug)
      .gte('occurred_at', since)
      .lte('occurred_at', until)
      .or(liveRequestsFilter(nowIso))
      .order('occurred_at', { ascending: false })
      .limit(ROW_CAP)
      .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));
    if (error) throw new Error(error.message);
    const rows = withoutEndedRequests((data ?? []) as unknown as SignalRowDb[], now.getTime());

    const exactSectionCounts: Partial<Record<SectionId, number>> = {};
    if (typeof count === 'number' && count > rows.length) {
      // Truncated: get exact counts for kinds that map to a single section (civic is split by keyword, so skipped).
      const kinds: [string, SectionId][] = [
        ['report', 'storm'], ['disaster', 'disasters'], ['quake', 'disasters'], ['permit', 'permits'],
        ['contract', 'contracts'], ['event', 'events'], ['travel', 'airport'], ['ask', 'asks'],
      ];
      const results = await Promise.all(
        kinds.map(async ([kind, section]) => {
          const r = await sb
            .from('holler_signals')
            .select('id', { count: 'exact', head: true })
            .eq('place_slug', slug)
            .eq('kind', kind)
            .gte('occurred_at', since)
            .lte('occurred_at', until)
            .or(liveRequestsFilter(nowIso))
            .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));
          return { section, n: r.error ? 0 : (r.count ?? 0) };
        }),
      );
      for (const { section, n } of results) exactSectionCounts[section] = (exactSectionCounts[section] ?? 0) + n;
    }

    // A live resident request in the list: tag the entry and keep it 15 minutes at most (see REQUEST_CACHE_LIFE).
    if (hasRequestRows(rows)) cacheTag(REQUEST_CACHE_TAG);
    cacheLife(
      hasRequestRows(rows)
        ? REQUEST_CACHE_LIFE
        : { stale: 300, revalidate: 21600, expire: 86400 },
    );
    return summarize(slug, rows, nowIso, {
      limit: DEFAULT_ITEM_LIMIT,
      totalOverride: typeof count === 'number' ? count : rows.length,
      exactSectionCounts,
      truncated: typeof count === 'number' && count > rows.length,
    });
  } catch (e) {
    console.error('[seo] loadPlaceData failed:', slug, e instanceof Error ? e.message : 'unknown');
    cacheLife({ stale: 300, revalidate: 60, expire: 300 });
    return emptyPlaceData(slug, nowIso, false);
  }
}

export interface PlaceCounts {
  ok: boolean;
  /** place_slug to number of signals in the last WINDOW_DAYS days */
  counts: Record<string, number>;
  /** place_slug to ISO time of its newest signal (holler_place_counts.latest_at). Empty when the column is missing. */
  latest: Record<string, string>;
  /** true when the row cap was hit, so counts are lower bounds */
  partial: boolean;
}

const VIEW_ROW_CAP = 1000;

/**
 * Signals per place_slug over the window, read in ONE query from the holler_place_counts view
 * (migration 0001: one row per place_slug, security_invoker). Cached 6 hours; failures (including
 * missing env or a view that is not migrated yet) are cached 60 s and return ok:false.
 */
export async function loadPlaceCounts(): Promise<PlaceCounts> {
  'use cache';
  const sb = publicClient();
  if (!sb) {
    cacheLife({ stale: 300, revalidate: 60, expire: 300 });
    return { ok: false, counts: {}, latest: {}, partial: false };
  }
  try {
    let res: { data: unknown; error: { message: string } | null } = await sb
      .from('holler_place_counts')
      .select('place_slug, signals_60d, latest_at')
      .range(0, VIEW_ROW_CAP - 1)
      .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));
    if (res.error) {
      // latest_at arrives with migration 0003. Until then, read the counts without it (no lastmod in the sitemap).
      res = await sb
        .from('holler_place_counts')
        .select('place_slug, signals_60d')
        .range(0, VIEW_ROW_CAP - 1)
        .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));
    }
    if (res.error) throw new Error(res.error.message);
    const rows = (res.data ?? []) as unknown as { place_slug: string; signals_60d: number; latest_at?: string | null }[];
    const counts: Record<string, number> = {};
    const latest: Record<string, string> = {};
    const loadedAt = Date.now();
    for (const r of rows) {
      counts[r.place_slug] = r.signals_60d;
      // latest_at is the max occurred_at, which can be an event that has not happened yet. A sitemap lastmod must not be in the future.
      const past = newestPast([r.latest_at], loadedAt);
      if (past) latest[r.place_slug] = past;
    }
    cacheLife({ stale: 300, revalidate: 21600, expire: 86400 });
    // One row per place, so the cap is only hit if there are more than 1000 distinct places.
    return { ok: true, counts, latest, partial: rows.length >= VIEW_ROW_CAP };
  } catch (e) {
    console.error('[seo] loadPlaceCounts failed:', e instanceof Error ? e.message : 'unknown');
    cacheLife({ stale: 300, revalidate: 60, expire: 300 });
    return { ok: false, counts: {}, latest: {}, partial: false };
  }
}
