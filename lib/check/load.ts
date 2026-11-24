import { cacheLife, cacheTag } from 'next/cache';
import { publicClient } from '@/lib/seo/client';
import { UPCOMING_DAYS } from '@/lib/time';
import { CHECK_CORE_RADIUS_MI, CHECK_SEARCH_RADIUS_MI, CHECK_WINDOW_DAYS } from './scope';
import type { CheckItem } from './group';
import { withoutHiddenBids } from '@/lib/signals/bid-sources';
import { REQUEST_CACHE_LIFE, REQUEST_CACHE_TAG, hasRequestRows, withoutEndedRequests } from '@/lib/signals/request-visibility';
import { expandCategoriesForRouting } from '@/lib/signals/permit-routing';
import { deliveryFor, memberTrades, type CheckSignal } from './delivery';

const DAY = 86_400_000;
const WINDOW_DAYS = CHECK_WINDOW_DAYS;
/**
 * Round 25: 500 (was 100), the most holler_signals_near returns (it clamps p_limit to 1..500). The page now counts every record a member at
 * the ZIP would have been emailed, not only the 20 listed, so the reads must hold the whole recent window where they can. Measured on the
 * 14-day export (tests/r25/check-verdict.test.ts): with 100/30 the Charlotte landscaping count read 22 of 91; with 500/200 every marketed
 * cell but Austin landscaping and lawn care is read in full, and those two say "at least". The query plan does not change with the limit
 * (the distance test and the sort run on every row in the box either way); what grows is the transfer, at about 0.6 KB a row.
 */
const ROW_LIMIT = 500;
/** The close-to-home read (within 25 miles of every ZIP in the cell): the records a 25 mile subscription would actually send. Round 25: 200 (was 30). */
const CORE_LIMIT = 200;
/** Severity 2 and 3 records inside the whole search radius: warnings with a coordinate (polygon centroids) and hail or wind reports. */
const SEVERE_LIMIT = 20;
/** State-level rows (no coordinates, severity 2+): their own small query so they can never be crowded out by a dense metro feed. */
const STATE_LIMIT = 20;
/** Rows that have not started yet (events, event permits). Read separately so they cannot crowd out the recent records. */
const UPCOMING_LIMIT = 12;
/**
 * Round 24 FIX2 (review D1): records tagged with OTHER trades that this trade still sees (a roof permit for a gutter crew, the downstream
 * permits matching routes to it, lib/signals/permit-routing.ts expandCategoriesForRouting). Their own two reads, so the trade's own records
 * and the routed ones cannot crowd each other out. A fixed number of reads per cell, never one per row.
 */
const ROUTED_LIMIT = 500;
const ROUTED_CORE_LIMIT = 200;
const QUERY_TIMEOUT_MS: number = 8000;
/** A failed read, or an entry built with one read missing: kept a minute only (R25 check fix, review R25CHECK P2-4). */
const PARTIAL_CACHE_LIFE = { stale: 60, revalidate: 60, expire: 300 };
// summary, categories and data are read for the member view only (lib/check/delivery.ts: matching, the label and the contact gate). They are
// never rendered: the page keeps the fields it showed before.
const COLUMNS = 'id,source,kind,title,summary,url,city,state,lat,lon,severity,occurred_at,expires_at,categories,data';

export interface CheckData {
  /** false when the database could not be read (env missing, timeout, error). Render the empty state. */
  ok: boolean;
  items: CheckItem[];
  /** ISO time this entry was built (at most one hour old). */
  checkedAt: string;
  /**
   * Round 25: true when at least one read returned as many rows as its limit, so older matching records may exist that were not read. The
   * page then says "at least N" (lib/check/delivery.ts alertTotals). Absent on entries cached before this field existed: read as false.
   * R25 check fix (review R25CHECK P2-4): also true when an extra read failed (its rows are missing).
   */
  clipped?: boolean;
}

/** One record as the check reads it. */
export interface CheckRow {
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
  summary?: string | null;
  categories?: string[] | null;
  data?: Record<string, unknown> | null;
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
    cacheLife(PARTIAL_CACHE_LIFE);
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
    // Round 25: the member's trades. One trade is itself; 'pressure-washing' is the two trades sign-up saves for that chip
    // (lib/plan/composite-trades.ts), so the reads, the delivery marks and the count are those of that member.
    const own = memberTrades(trade);
    // The trades whose records this trade sees, besides its own (the same expansion matching uses for its reads). Empty for most trades.
    const routed = expandCategoriesForRouting(own).filter((c) => !own.includes(c));
    const near = (from: string, until: string, limit: number, soonestFirst: boolean, radiusMi: number = CHECK_SEARCH_RADIUS_MI, minSeverity = 1, categories: string[] = own) =>
      sb
        .rpc('holler_signals_near', {
          p_lat: cellLat,
          p_lon: cellLon,
          p_radius_mi: radiusMi,
          p_categories: categories,
          p_since: from,
          p_until: until,
          p_limit: limit,
          p_soonest_first: soonestFirst,
          p_min_severity: minSeverity,
        })
        .select(COLUMNS)
        .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));

    const none = Promise.resolve({ data: [] as CheckRow[], error: null });
    const [recent, core, severe, upcoming, stateLevel, routedRecent, routedCore] = await Promise.all([
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
        .overlaps('categories', own)
        .or(`expires_at.is.null,expires_at.gt.${checkedAt}`)
        .gte('occurred_at', since)
        .lte('occurred_at', checkedAt)
        .order('occurred_at', { ascending: false })
        .limit(STATE_LIMIT)
        .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS)),
      routed.length ? near(since, checkedAt, ROUTED_LIMIT, false, CHECK_SEARCH_RADIUS_MI, 1, routed) : none,
      routed.length ? near(since, checkedAt, ROUTED_CORE_LIMIT, false, CHECK_CORE_RADIUS_MI, 1, routed) : none,
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
    if (routedRecent.error) console.error('[check] routed read failed:', routedRecent.error.code ?? routedRecent.error.message);
    if (routedCore.error) console.error('[check] routed close-to-home read failed:', routedCore.error.code ?? routedCore.error.message);
    const rowsOf = (r: { error: unknown; data: unknown }): CheckRow[] => (r.error || !Array.isArray(r.data) ? [] : (r.data as CheckRow[]));
    // R25 check fix (review R25CHECK P2-4): a read that failed (or answered no rows array) leaves out rows that may exist, so the entry is a
    // lower bound like a read that stopped at its limit: it is marked clipped (the page says "at least", or at zero prints the head only)
    // and cached for a minute only, so one blip does not pin a wrong answer on the whole grid cell for an hour.
    const partial = [core, severe, upcoming, stateLevel, routedRecent, routedCore].some((r) => r.error || !Array.isArray(r.data));
    const { items, clipped, data } = assembleCheck(
      {
        upcoming: [rowsOf(upcoming), UPCOMING_LIMIT],
        stateLevel: [rowsOf(stateLevel), STATE_LIMIT],
        severe: [rowsOf(severe), SEVERE_LIMIT],
        core: [rowsOf(core), CORE_LIMIT],
        recent: [rowsOf(recent), ROW_LIMIT],
        routedCore: [rowsOf(routedCore), ROUTED_CORE_LIMIT],
        routedRecent: [rowsOf(routedRecent), ROUTED_LIMIT],
      },
      trade,
      now.getTime(),
    );
    // A live resident request in the list: tag the entry and keep it 15 minutes at most, so a closed request leaves /check promptly.
    if (hasRequestRows(data)) cacheTag(REQUEST_CACHE_TAG);
    cacheLife(
      partial
        ? PARTIAL_CACHE_LIFE
        : hasRequestRows(data)
          ? REQUEST_CACHE_LIFE
          : { stale: 300, revalidate: 3600, expire: 7200 },
    );
    return { ok: true, items, checkedAt, clipped: clipped || partial };
  } catch (e) {
    console.error('[check] loadCheck failed:', e instanceof Error ? e.message : 'unknown');
    return fail();
  }
}

/** The row limit of each read (exported for the export-based tests, which run the same reads on the 14-day export). */
export const CHECK_READ_LIMITS = {
  upcoming: UPCOMING_LIMIT,
  stateLevel: STATE_LIMIT,
  severe: SEVERE_LIMIT,
  core: CORE_LIMIT,
  recent: ROW_LIMIT,
  routedCore: ROUTED_CORE_LIMIT,
  routedRecent: ROUTED_LIMIT,
} as const;

export type CheckReadName = keyof typeof CHECK_READ_LIMITS;

/**
 * R25 check fix (review R25CHECK P3-2): the reads whose limit can hide a row the count would include. The close-to-home and severe reads
 * ask for a subset of what the recent read asks for (same window and trades, a smaller radius or a higher severity), and the routed
 * close-to-home read a subset of the routed read: when the wider read did not stop at its limit it already returned every row the subset
 * could have, and when it did, the count is a lower bound anyway. So only these four decide "at least", and only when a read returned
 * exactly its limit (the database clamps the limit, so a full read returns exactly that many rows).
 */
const WIDE_READS: readonly CheckReadName[] = ['recent', 'routedRecent', 'upcoming', 'stateLevel'];

/**
 * The rows of loadCheck's reads as check items, in the order loadCheck has always merged them (upcoming, state level, severe, close to home,
 * recent, then the routed reads). Pure, so the export-based tests run exactly this on their simulated reads. `clipped` is true when one of
 * WIDE_READS returned exactly its limit: rows past the limit may exist, so a count from these items is a lower bound.
 */
export function assembleCheck(
  reads: Record<CheckReadName, [rows: CheckRow[], limit: number]>,
  trade: string,
  nowMs: number,
): { items: CheckItem[]; clipped: boolean; data: CheckRow[] } {
  const order: CheckReadName[] = ['upcoming', 'stateLevel', 'severe', 'core', 'recent', 'routedCore', 'routedRecent'];
  const clipped = WIDE_READS.some((k) => reads[k][0].length === reads[k][1]);
  // holler_signals_near and the state read already drop expired rows; this guards resident requests again on the rows themselves.
  // City bids: every stored bid is left out while HOLLER_BIDS_ENABLED is off, and a closed bid always (review P2-13, P2-14).
  const data: CheckRow[] = withoutHiddenBids(
    withoutEndedRequests(
      order.flatMap((k) => reads[k][0]),
      nowMs,
    ),
    nowMs,
  );
  const seen = new Set<number>();
  const items: CheckItem[] = [];
  for (const r of data) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const item = checkItemFor(r, trade, nowMs);
    if (item) items.push(item);
  }
  return { items, clipped, data };
}

/**
 * One row as a check item, for a member with this one trade (round 24 FIX2, review D1): null when the record would never be in that
 * member's feed (lib/check/delivery.ts deliveryFor: context, a record the trade does not see, a follower, a probation source). Otherwise
 * the item carries its delivery ('email' or 'feed') and the record fields the page needs for its ZIP area test (memberItems).
 */
export function checkItemFor(r: CheckRow, trade: string | readonly string[], nowMs: number): CheckItem | null {
  const signal: CheckSignal = {
    id: r.id,
    source: r.source,
    kind: r.kind,
    title: r.title,
    summary: r.summary ?? null,
    categories: Array.isArray(r.categories) ? r.categories : [],
    lat: r.lat,
    lon: r.lon,
    state: r.state,
    severity: r.severity,
    occurred_at: r.occurred_at,
    expires_at: r.expires_at ?? null,
    data: r.data && typeof r.data === 'object' ? r.data : null,
  };
  const delivery = deliveryFor(signal, trade, nowMs);
  if (!delivery) return null;
  return {
    id: r.id,
    kind: r.kind,
    source: r.source,
    title: r.title,
    url: r.url,
    place: placeOf(r.city, r.state),
    lat: r.lat,
    lon: r.lon,
    occurredAt: r.occurred_at,
    severity: r.severity,
    delivery,
    signal,
  };
}

/** "City, ST". A city stored as "0", "-" or blank is not a place (round 24 FIX2, review P3-6): the state alone, or null. */
export function placeOf(city: string | null | undefined, state: string | null | undefined): string | null {
  const c = typeof city === 'string' && /[A-Za-z]/.test(city) ? city.trim() : '';
  return [c, state].filter(Boolean).join(', ') || null;
}
