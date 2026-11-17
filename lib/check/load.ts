import { cacheLife } from 'next/cache';
import { publicClient } from '@/lib/seo/client';
import { UPCOMING_DAYS } from '@/lib/time';
import { cellBox } from './scope';
import type { CheckItem } from './group';

const DAY = 86_400_000;
const WINDOW_DAYS = 30;
const ROW_LIMIT = 100;
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
 * Scope: records with coordinates inside the cell's bounding box (cell plus the 25 mile default radius), plus state-level
 * records (no coordinates, severity 2 or more) for the ZIP's own state. The page trims the box to the ZIP's own radius.
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
    const box = cellBox(cellLat, cellLon);
    const n = (v: number) => v.toFixed(3);
    const inBox = `and(lat.gte.${n(box.latMin)},lat.lte.${n(box.latMax)},lon.gte.${n(box.lonMin)},lon.lte.${n(box.lonMax)})`;
    const stateLevel = `and(lat.is.null,state.eq.${state},severity.gte.2)`;
    const scope = `${inBox},${stateLevel}`;

    const base = () =>
      sb
        .from('holler_signals')
        .select(COLUMNS)
        .or(scope)
        .or(`expires_at.is.null,expires_at.gt.${checkedAt}`)
        .overlaps('categories', [trade]);
    // Two small indexed queries on the same key: what already happened (newest first) and what starts in the next
    // UPCOMING_DAYS (soonest first). One combined newest-first query would let far-future events fill the row limit.
    const [recent, upcoming] = await Promise.all([
      base()
        .gte('occurred_at', new Date(now.getTime() - WINDOW_DAYS * DAY).toISOString())
        .lte('occurred_at', checkedAt)
        .order('occurred_at', { ascending: false })
        .limit(ROW_LIMIT)
        .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS)),
      base()
        .gt('occurred_at', checkedAt)
        .lte('occurred_at', new Date(now.getTime() + UPCOMING_DAYS * DAY).toISOString())
        .order('occurred_at', { ascending: true })
        .limit(UPCOMING_LIMIT)
        .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS)),
    ]);
    if (recent.error) {
      console.error('[check] loadCheck query failed:', recent.error.code ?? recent.error.message);
      return fail();
    }
    // A failed upcoming read only drops the upcoming rows.
    const data = [...((upcoming.error ? [] : upcoming.data) ?? []), ...(recent.data ?? [])];

    const items: CheckItem[] = (data as unknown as Row[]).map((r) => ({
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
    }));
    cacheLife({ stale: 300, revalidate: 3600, expire: 7200 });
    return { ok: true, items, checkedAt };
  } catch (e) {
    console.error('[check] loadCheck failed:', e instanceof Error ? e.message : 'unknown');
    return fail();
  }
}
