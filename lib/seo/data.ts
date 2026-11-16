import { cacheLife } from 'next/cache';
import { publicClient } from './client';
import { WINDOW_DAYS } from './threshold';
import { emptyPlaceData, summarize, DEFAULT_ITEM_LIMIT, type PlaceData, type SignalRowDb } from './summarize';
import type { SectionId } from './sections';

const DAY = 86_400_000;
const ROW_COLUMNS = 'id,source,kind,title,summary,url,categories,severity,occurred_at,expires_at';
const ROW_CAP = 1000;
const QUERY_TIMEOUT_MS = 10_000;

/**
 * Everything a city page needs, read with the anon client from holler_signals only.
 * Cached for 6 hours (SPEC: revalidate = 21600). `export const revalidate` is removed in this
 * Next.js version when cacheComponents is on, so the 6 h lifetime is set here with cacheLife.
 * Failures are cached for only 60 s so a DB blip does not pin an empty page for 6 hours.
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
    const { data, error, count } = await sb
      .from('holler_signals')
      .select(ROW_COLUMNS, { count: 'exact' })
      .eq('place_slug', slug)
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .limit(ROW_CAP)
      .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as SignalRowDb[];

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
            .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));
          return { section, n: r.error ? 0 : (r.count ?? 0) };
        }),
      );
      for (const { section, n } of results) exactSectionCounts[section] = (exactSectionCounts[section] ?? 0) + n;
    }

    cacheLife({ stale: 300, revalidate: 21600, expire: 86400 });
    return summarize(slug, rows, nowIso, {
      limit: DEFAULT_ITEM_LIMIT,
      totalOverride: typeof count === 'number' ? count : rows.length,
      exactSectionCounts,
    });
  } catch {
    cacheLife({ stale: 300, revalidate: 60, expire: 300 });
    return emptyPlaceData(slug, nowIso, false);
  }
}

export interface PlaceCounts {
  ok: boolean;
  /** place_slug to number of signals in the last WINDOW_DAYS days */
  counts: Record<string, number>;
  /** true when the row cap was hit, so counts are lower bounds */
  partial: boolean;
}

const PAGE = 1000;
const MAX_PAGES = 40;

/**
 * Signals per place_slug over the window. PostgREST aggregates are not enabled by default on
 * Supabase and W4 may not add migrations, so this pages through place_slug values (one narrow
 * column) and tallies in memory. Cached 6 hours; failures cached 60 s.
 */
export async function loadPlaceCounts(): Promise<PlaceCounts> {
  'use cache';
  const sb = publicClient();
  if (!sb) {
    cacheLife({ stale: 300, revalidate: 60, expire: 300 });
    return { ok: false, counts: {}, partial: false };
  }
  try {
    const since = new Date(Date.now() - WINDOW_DAYS * DAY).toISOString();
    const base = () =>
      sb.from('holler_signals').select('place_slug', { count: 'exact' }).not('place_slug', 'is', null).gte('occurred_at', since).order('id', { ascending: true });
    const first = await base().range(0, PAGE - 1).abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));
    if (first.error) throw new Error(first.error.message);
    const total = first.count ?? first.data?.length ?? 0;
    const pages = Math.min(MAX_PAGES, Math.ceil(total / PAGE));
    const rest = await Promise.all(
      Array.from({ length: Math.max(0, pages - 1) }, (_, i) =>
        base()
          .range((i + 1) * PAGE, (i + 2) * PAGE - 1)
          .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS)),
      ),
    );
    const counts: Record<string, number> = {};
    for (const batch of [first, ...rest]) {
      if (batch.error) throw new Error(batch.error.message);
      for (const r of (batch.data ?? []) as unknown as { place_slug: string }[]) {
        counts[r.place_slug] = (counts[r.place_slug] ?? 0) + 1;
      }
    }
    cacheLife({ stale: 300, revalidate: 21600, expire: 86400 });
    return { ok: true, counts, partial: total > pages * PAGE };
  } catch {
    cacheLife({ stale: 300, revalidate: 60, expire: 300 });
    return { ok: false, counts: {}, partial: false };
  }
}
