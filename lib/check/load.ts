import { cacheLife, cacheTag } from 'next/cache';
import { publicClient } from '@/lib/seo/client';
import { UPCOMING_DAYS } from '@/lib/time';
import { CHECK_CORE_RADIUS_MI, CHECK_SEARCH_RADIUS_MI, CHECK_WINDOW_DAYS } from './scope';
import type { CheckItem } from './group';
import { withoutHiddenBids } from '@/lib/signals/bid-sources';
import { REQUEST_CACHE_LIFE, REQUEST_CACHE_TAG, hasRequestRows, withoutEndedRequests } from '@/lib/signals/request-visibility';

const DAY = 86_400_000;
const WINDOW_DAYS = CHECK_WINDOW_DAYS;
const ROW_LIMIT = 100;
/** The close-to-home read (within 25 miles of every ZIP in the cell): the records a 25 mile subscription would actually send. */
const CORE_LIMIT = 30;
/** Severity 2 and 3 records inside the whole search radius: warnings with a coordinate (polygon centroids) and hail or wind reports. */
const SEVERE_LIMIT = 20;
/** State-level rows (no coordinates, severity 2+): their own small query so they can never be crowded out by a dense metro feed. */
const STATE_LIMIT = 20;
/** Rows that have not started yet (events, event permits). Read separately so they cannot crowd out the recent records. */
const UPCOMING_LIMIT = 12;
const QUERY_TIMEOUT_MS: number = 8000;
const COLUMNS = 'id,source,kind,title,url,city,state,lat,lon,severity,occurred_at,expires_at';

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
  expires_at?: string | null;
}


/**
 * Recent holler_signals for one trade around one grid cell. Stored in the remote cache ('use cache: remote', shared by
 * every server instance; plain 'use cache' keeps entries in per-instance memory that serverless does not reuse, see
 * node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-cache-remote.md). One hour lifetime.
 * Keyed on (grid cell, state, trade), never on the raw ZIP: a few thousand cells, 41 trades, 51 states.
 * Five small indexed reads, none of which can crowd out another:
 *  1. the newest records with coordinates, by great-circle distance from the CELL CENTRE (CHECK_SEARCH_RADIUS_MI), computed in SQL by
 *     holler_signals_near before its row limit, so a dense feed (NYC 311) 26 to 60 miles away cannot use up the limit;
 *  2. the newest records close to home (CHECK_CORE_RADIUS_MI from the centre, so within 25 miles of any ZIP in the cell), because a
 *     dense feed 30 to 38 miles out can still fill read 1 with rows a 25 mile subscription would never send;
 *  3. severity 2 or more inside the whole radius (p_min_severity), so a warning or a hail report is never buried under routine rows;
 *  4. upcoming records (events, event permits) through the same function, soonest first;
 *  5. state-level records (no coordinates, severity 2 or more) for the ZIP's own state.
 * The page decides what to show first (lib/check/group.ts): active severe alerts, then the closest records, then the rest newest first.
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
    const near = (from: string, until: string, limit: number, soonestFirst: boolean, radiusMi: number = CHECK_SEARCH_RADIUS_MI, minSeverity = 1) =>
      sb
        .rpc('holler_signals_near', {
          p_lat: cellLat,
          p_lon: cellLon,
          p_radius_mi: radiusMi,
          p_categories: [trade],
          p_since: from,
          p_until: until,
          p_limit: limit,
          p_soonest_first: soonestFirst,
          p_min_severity: minSeverity,
        })
        .select(COLUMNS)
        .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));

    const [recent, core, severe, upcoming, stateLevel] = await Promise.all([
      near(since, checkedAt, ROW_LIMIT, false),
      near(since, checkedAt, CORE_LIMIT, false, CHECK_CORE_RADIUS_MI),
      near(since, checkedAt, SEVERE_LIMIT, false, CHECK_SEARCH_RADIUS_MI, 2),
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
    // A failed extra read only drops its own rows; the page still has the nearby records.
    if (core.error) console.error('[check] close-to-home read failed:', core.error.code ?? core.error.message);
    if (severe.error) console.error('[check] severe read failed:', severe.error.code ?? severe.error.message);
    if (upcoming.error) console.error('[check] upcoming read failed:', upcoming.error.code ?? upcoming.error.message);
    if (stateLevel.error) console.error('[check] state-level read failed:', stateLevel.error.code ?? stateLevel.error.message);
    const rowsOf = (r: { error: unknown; data: unknown }): Row[] => (r.error || !Array.isArray(r.data) ? [] : (r.data as Row[]));
    // holler_signals_near and the state read already drop expired rows; this guards resident requests again on the rows themselves.
    // City bids: every stored bid is left out while HOLLER_BIDS_ENABLED is off, and a closed bid always (review P2-13, P2-14).
    const data: Row[] = withoutHiddenBids(
      withoutEndedRequests([...rowsOf(upcoming), ...rowsOf(stateLevel), ...rowsOf(severe), ...rowsOf(core), ...rowsOf(recent)], now.getTime()),
      now.getTime(),
    );

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
    // A live resident request in the list: tag the entry and keep it 15 minutes at most, so a closed request leaves /check promptly.
    if (hasRequestRows(data)) cacheTag(REQUEST_CACHE_TAG);
    cacheLife(
      hasRequestRows(data)
        ? REQUEST_CACHE_LIFE
        : { stale: 300, revalidate: 3600, expire: 7200 },
    );
    return { ok: true, items, checkedAt };
  } catch (e) {
    console.error('[check] loadCheck failed:', e instanceof Error ? e.message : 'unknown');
    return fail();
  }
}
