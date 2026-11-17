import { cacheLife } from 'next/cache';
import { publicClient } from '@/lib/seo/client';
import { UPCOMING_DAYS } from '@/lib/time';
import { CHECK_SEARCH_RADIUS_MI } from './scope';
import type { CheckItem } from './group';

const DAY = 86_400_000;
const WINDOW_DAYS = 30;
const ROW_LIMIT = 100;
/** State-level rows (no coordinates, severity 2+): their own small query so they can never be crowded out by a dense metro feed. */
const STATE_LIMIT = 20;
/** Rows that have not started yet (events, event permits). Read separately so they cannot crowd out the recent records. */
const UPCOMING_LIMIT = 12;
const QUERY_TIMEOUT_MS: number = 8000;
const COLUMNS = 'id,source,kind,title,url,city,state,lat,lon,severity,occurred_at';

export interface CheckData {
  /** false when the database could not be read (env missing, timeout, error). Render the empty state. */
  ok: boolean;
  items: CheckItem[];
  /** ISO time this entry was built (at most one hour old). */
  checkedAt: string;
}

interface Row {
  id: number;
  source: string;
  kind: string;
  title: string;
  url: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lon: number | null;
  severity: number;
  occurred_at: string;
}


/**
 * Recent holler_signals for one trade around one grid cell. Stored in the remote cache ('use cache: remote', shared by
 * every server instance; plain 'use cache' keeps entries in per-instance memory that serverless does not reuse, see
 * node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-cache-remote.md). One hour lifetime.
 * Keyed on (grid cell, state, trade), never on the raw ZIP: a few thousand cells, 41 trades, 51 states.
 * Three small indexed reads, none of which can crowd out another:
 *  1. recent records with coordinates, by great-circle distance from the CELL CENTRE (CHECK_SEARCH_RADIUS_MI), computed in SQL by
 *     holler_signals_near before its row limit, so a dense feed (NYC 311) 26 to 60 miles away cannot use up the limit;
 *  2. upcoming records (events, event permits) through the same function, soonest first;
 *  3. state-level records (no coordinates, severity 2 or more) for the ZIP's own state.
 * Nothing is trimmed in memory afterwards: what the function returns is what the page shows ("within about 40 miles").
 */
export async function loadCheck(cellLat: number, cellLon: number, state: string, trade: string): Promise<CheckData> {
  'use cache: remote';
  const now = new Date();
  const checkedAt = now.toISOString();
  // A failed read is cached for a minute only, so a blip does not pin an empty page for an hour.
  const fail = (): CheckData => {
    cacheLife({ stale: 60, revalidate: 60, expire: 300 });
    return { ok: false, items: [], checkedAt };
  };

  const sb = publicClient();
  if (
    !sb ||
    !/^[A-Z]{2}$/.test(state) ||
    !/^[a-z0-9-]{1,40}$/.test(trade) ||
    !Number.isFinite(cellLat) ||
    !Number.isFinite(cellLon) ||
    Math.abs(cellLat) > 90 ||
    Math.abs(cellLon) > 180
  ) {
    return fail();
  }
  try {
    const since = new Date(now.getTime() - WINDOW_DAYS * DAY).toISOString();
    const near = (from: string, until: string, limit: number, soonestFirst: boolean) =>
      sb
        .rpc('holler_signals_near', {
          p_lat: cellLat,
          p_lon: cellLon,
          p_radius_mi: CHECK_SEARCH_RADIUS_MI,
          p_categories: [trade],
          p_since: from,
          p_until: until,
          p_limit: limit,
          p_soonest_first: soonestFirst,
        })
        .select(COLUMNS)
        .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));

    const [recent, upcoming, stateLevel] = await Promise.all([
      near(since, checkedAt, ROW_LIMIT, false),
      // What starts in the next UPCOMING_DAYS, soonest first: one combined newest-first read would let far-future events fill the limit.
      near(checkedAt, new Date(now.getTime() + UPCOMING_DAYS * DAY).toISOString(), UPCOMING_LIMIT, true),
      sb
        .from('holler_signals')
        .select(COLUMNS)
        .is('lat', null)
        .eq('state', state)
        .gte('severity', 2)
        .overlaps('categories', [trade])
        .or(`expires_at.is.null,expires_at.gt.${checkedAt}`)
        .gte('occurred_at', since)
        .lte('occurred_at', checkedAt)
        .order('occurred_at', { ascending: false })
        .limit(STATE_LIMIT)
        .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS)),
    ]);
    if (recent.error) {
      console.error('[check] loadCheck query failed:', recent.error.code ?? recent.error.message);
      return fail();
    }
    // A failed upcoming or state-level read only drops those rows; the page still has the nearby records.
    if (upcoming.error) console.error('[check] upcoming read failed:', upcoming.error.code ?? upcoming.error.message);
    if (stateLevel.error) console.error('[check] state-level read failed:', stateLevel.error.code ?? stateLevel.error.message);
    const rowsOf = (r: { error: unknown; data: unknown }): Row[] => (r.error || !Array.isArray(r.data) ? [] : (r.data as Row[]));
    const data: Row[] = [...rowsOf(upcoming), ...rowsOf(stateLevel), ...rowsOf(recent)];

    const seen = new Set<number>();
    const items: CheckItem[] = [];
    for (const r of data) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      items.push({
        id: r.id,
        kind: r.kind,
        source: r.source,
        title: r.title,
        url: r.url,
        place: [r.city, r.state].filter(Boolean).join(', ') || null,
        lat: r.lat,
        lon: r.lon,
        occurredAt: r.occurred_at,
        severity: r.severity,
      });
    }
    cacheLife({ stale: 300, revalidate: 3600, expire: 7200 });
    return { ok: true, items, checkedAt };
  } catch (e) {
    console.error('[check] loadCheck failed:', e instanceof Error ? e.message : 'unknown');
    return fail();
  }
}
