import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CATEGORY_IDS, categoryById, isCategoryId, type CategoryId } from '@/lib/signals/categories';
import { enabledDatasets } from '@/lib/signals/capabilities';
import { getSourceMeta } from '@/lib/signals/source-meta';
import { HOLLER_REQUEST_SOURCE } from '@/lib/signals/request-visibility';
import { matchScope, type ScopeInput } from '@/lib/plan';
import { cityBySlug, haversineMi, lookupZip } from '@/lib/geo';
import { deriveScope } from '@/lib/check/scope';
import { loadCheck as loadCheckCached, type CheckData } from '@/lib/check/load';
import type { CheckItem } from '@/lib/check/group';
import { typeKeyOf } from './recent';
import { APPROX_LOCATION_SOURCES, APPROX_MATCH_SLACK_MI } from '@/lib/signals/approx-location';

/**
 * What an empty feed shows instead of a bare "nothing yet" (round 7): only real rows, never an invented number.
 *  (a) the free public area check for the member's ZIP and trades (lib/check/load.ts loadCheck, the same cached reads /check uses);
 *  (b) the city and county feeds that cover the member's area with their newest record date, the storm and federal feeds, and counts of
 *      records inside the member's radius in the last 14 days for trades the member did NOT pick, by record type;
 *  (c) the 90-day RecentActivity block (rendered by the component, not read here).
 * Reads public signal columns with the service role (the same as RecentActivity) plus holler_source_health (service role only).
 * Never throws: a failed read leaves its part empty and says so.
 */

export const EMPTY_FEED_DAYS = 14;
/** Rows per page and pages per area of the 14-day read (the newest 1500 records inside the radius). */
export const EMPTY_FEED_PAGE = 500;
export const EMPTY_FEED_PAGES = 3;
/** The public check is per trade: at most this many of the member's trades are checked. */
export const EMPTY_FEED_CHECK_TRADES = 3;
/**
 * How far past the radius a feed's anchor point may sit and still be listed under "What Holler is watching near you". A city or county
 * feed with real coordinates is listed only when its anchor is inside the radius (or a row of it landed inside the radius); a 30 mile
 * slack listed feeds that cannot put a row inside a small radius (review r1: DeKalb and Atlanta feeds for Smyrna at 5 miles). A feed
 * whose rows sit at a stand-in point (Cobb County) matches within radius + APPROX_MATCH_SLACK_MI, so it is listed on the same terms.
 */
export function feedReachMi(sourceId: string, radius: number): number {
  return APPROX_LOCATION_SOURCES.has(sourceId) ? radius + APPROX_MATCH_SLACK_MI : radius;
}
/** Keyless national feeds that cover every US address. */
export const NATIONAL_SOURCES = ['nws', 'spc', 'fema', 'usgs', 'usaspending'] as const;

type Db = Pick<SupabaseClient, 'from' | 'rpc'>;

export interface EmptyFeedProfile extends ScopeInput {
  zip: string | null;
  radius_mi: number | null;
}

export interface FeedSource {
  id: string;
  label: string;
  /** ISO time of the newest record: from rows inside the radius when there are any, else from the source health table. Null when unknown. */
  newest: string | null;
}

export interface TradeCount {
  trade: CategoryId;
  label: string;
  /** Biggest first. `key` is a record type key (lib/preview/recent.ts typeKeyOf). */
  byType: { key: string; count: number }[];
  total: number;
}

export interface EmptyFeedData {
  placeLabel: string | null;
  zip: string | null;
  radius: number;
  /** Null when the member has no usable ZIP; `uncovered` for territories. */
  check: { ok: boolean; uncovered: boolean; items: CheckItem[]; checkedAt: string; trades: CategoryId[]; origin: { lat: number; lon: number } } | null;
  local: FeedSource[];
  national: FeedSource[];
  /** Counts for trades the member has NOT saved. A saved trade is never listed here, even when the plan leaves it out of alerts. */
  otherTrades: TradeCount[];
  /** Saved trades the current plan leaves out of alerts (Solo covers the first 5). Worded on its own line, never as "not picked". */
  planLimited: CategoryId[];
  /** How many saved trades the plan covers (scope.categories). */
  planTrades: number;
  /** False when the 14-day read failed: the page then says it could not count, never "0". */
  countsOk: boolean;
  /** True when a 14-day read hit its row limit: every count is a floor ("At least"). */
  capped: boolean;
}

export interface EmptyFeedDeps {
  db?: Db;
  now?: Date;
  loadCheck?: (cellLat: number, cellLon: number, state: string, trade: string) => Promise<CheckData>;
}

interface NearRow {
  id: number;
  source: string;
  kind: string;
  categories: string[] | null;
  occurred_at: string;
  data?: { subtype?: unknown } | null;
}

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** The newest records inside the radius (all trades), paged with the same keyset cursor as the backfill. */
async function readArea(db: Db, lat: number, lon: number, radius: number, since: string, until: string): Promise<{ rows: NearRow[]; capped: boolean }> {
  const rows: NearRow[] = [];
  const seen = new Set<number>();
  let pageUntil = until;
  let beforeId: number | null = null;
  for (let page = 0; page < EMPTY_FEED_PAGES; page++) {
    const { data, error } = await db
      .rpc('holler_signals_near', {
        p_lat: lat,
        p_lon: lon,
        p_radius_mi: radius,
        p_categories: CATEGORY_IDS,
        p_since: since,
        p_until: pageUntil,
        p_limit: EMPTY_FEED_PAGE,
        p_soonest_first: false,
        p_min_severity: 1,
        p_before_id: beforeId,
      })
      .select('id,source,kind,categories,occurred_at,data');
    if (error) throw new Error(error.message);
    const got = (data ?? []) as NearRow[];
    let fresh = 0;
    for (const r of got) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      rows.push(r);
      fresh++;
    }
    if (got.length < EMPTY_FEED_PAGE || fresh === 0) return { rows, capped: false };
    const last = got[got.length - 1];
    pageUntil = last.occurred_at;
    beforeId = last.id;
  }
  return { rows, capped: true };
}

/** Where a city or county dataset sits: the county anchor, the city centre, or the dataset's own fallback point. */
function anchorOf(ds: { city: string; state: string; countyAnchor?: { lat: number; lon: number }; fallbackCenter?: { lat: number; lon: number } }) {
  if (ds.countyAnchor) return ds.countyAnchor;
  const slug = `${ds.city.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}-${ds.state.toLowerCase()}`;
  const c = cityBySlug(slug);
  if (c) return { lat: c.lat, lon: c.lon };
  return ds.fallbackCenter ?? null;
}

async function healthNewest(db: Db, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  try {
    const { data, error } = await db.from('holler_source_health').select('source,last_record_at').in('source', ids);
    if (error) return out;
    for (const r of (data ?? []) as { source: string; last_record_at: string | null }[]) if (r.last_record_at) out.set(r.source, r.last_record_at);
  } catch {
    // table missing (migration 0010 not applied): dates stay unknown
  }
  return out;
}

export async function loadEmptyFeedData(profile: EmptyFeedProfile, deps: EmptyFeedDeps = {}): Promise<EmptyFeedData> {
  const now = deps.now ?? new Date();
  const radius = isNum(profile.radius_mi) && profile.radius_mi > 0 ? profile.radius_mi : 25;
  const scope = matchScope(profile);
  // Every saved trade counts as picked, including the ones the plan leaves out of alerts (review r1: a Solo member's 6th trade was
  // listed under "trades you have not picked"). Those are reported separately in planLimited.
  const saved = (Array.isArray(profile.categories) ? profile.categories : []).filter(isCategoryId) as CategoryId[];
  const picked = new Set<string>([...saved, ...scope.categories]);
  const planLimited = saved.filter((c) => !scope.categories.includes(c));
  const areas = scope.areas.filter((a) => isNum(a.lat) && isNum(a.lon)) as { lat: number; lon: number; state: string | null }[];
  const place = profile.zip ? lookupZip(profile.zip) : null;
  const data: EmptyFeedData = {
    placeLabel: place ? `${place.city}, ${place.state}` : null,
    zip: place?.zip ?? null,
    radius,
    check: null,
    local: [],
    national: [],
    otherTrades: [],
    planLimited,
    planTrades: scope.categories.length,
    countsOk: false,
    capped: false,
  };
  let db: Db;
  try {
    db = deps.db ?? (await import('@/lib/supabase/admin')).createAdminClient();
  } catch {
    return data;
  }

  // (a) the public area check, per trade, merged
  const checkTask = (async () => {
    if (!place) return;
    const sc = deriveScope(place);
    const trades = scope.categories.filter(isCategoryId).slice(0, EMPTY_FEED_CHECK_TRADES) as CategoryId[];
    const origin = { lat: place.lat, lon: place.lon };
    if (!sc.covered || trades.length === 0) {
      data.check = { ok: true, uncovered: !sc.covered, items: [], checkedAt: now.toISOString(), trades, origin };
      return;
    }
    try {
      const load = deps.loadCheck ?? loadCheckCached;
      const results = await Promise.all(trades.map((t) => load(sc.cellLat, sc.cellLon, sc.state, t)));
      const seen = new Set<number>();
      const items: CheckItem[] = [];
      for (const r of results) {
        for (const it of r.items) {
          if (seen.has(it.id)) continue;
          seen.add(it.id);
          items.push(it);
        }
      }
      const checkedAt = results.map((r) => r.checkedAt).sort()[0] ?? now.toISOString();
      data.check = { ok: results.some((r) => r.ok), uncovered: false, items, checkedAt, trades, origin };
    } catch {
      data.check = { ok: false, uncovered: false, items: [], checkedAt: now.toISOString(), trades, origin };
    }
  })();

  // (b) the 14-day read inside the radius: counts for other trades and the newest record per feed
  const since = new Date(now.getTime() - EMPTY_FEED_DAYS * 86_400_000).toISOString();
  const rows: NearRow[] = [];
  try {
    const reads = await Promise.all(areas.map((a) => readArea(db, a.lat, a.lon, radius, since, now.toISOString())));
    const seen = new Set<number>();
    for (const r of reads) {
      if (r.capped) data.capped = true;
      for (const row of r.rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        rows.push(row);
      }
    }
    data.countsOk = areas.length > 0;
  } catch (e) {
    console.error('[empty-feed] 14-day read failed:', e instanceof Error ? e.message : 'unknown');
  }

  const counts = new Map<CategoryId, Map<string, number>>();
  const newestBySource = new Map<string, string>();
  for (const r of rows) {
    if (r.source === HOLLER_REQUEST_SOURCE || r.kind === 'ask') continue;
    if (!newestBySource.has(r.source) || r.occurred_at > newestBySource.get(r.source)!) newestBySource.set(r.source, r.occurred_at);
    const subtype = typeof r.data?.subtype === 'string' ? r.data.subtype : null;
    const key = typeKeyOf({ kind: r.kind, subtype, source: r.source });
    for (const c of new Set(r.categories ?? [])) {
      if (!isCategoryId(c) || picked.has(c)) continue;
      const m = counts.get(c) ?? new Map<string, number>();
      m.set(key, (m.get(key) ?? 0) + 1);
      counts.set(c, m);
    }
  }
  data.otherTrades = [...counts.entries()]
    .map(([trade, m]) => {
      const byType = [...m.entries()].map(([key, count]) => ({ key, count })).sort((x, y) => y.count - x.count || x.key.localeCompare(y.key));
      return { trade, label: categoryById(trade)?.label ?? trade, byType, total: byType.reduce((n, t) => n + t.count, 0) };
    })
    .filter((t) => t.total > 0)
    .sort((x, y) => y.total - x.total || x.trade.localeCompare(y.trade));

  // City and county feeds that reach the area: a dataset near enough, or any non-national source with a row inside the radius.
  const national = new Set<string>(NATIONAL_SOURCES);
  const localIds = new Set<string>();
  for (const ds of enabledDatasets()) {
    const at = anchorOf(ds);
    if (!at) continue;
    if (areas.some((a) => haversineMi(a.lat, a.lon, at.lat, at.lon) <= feedReachMi(ds.id, radius))) localIds.add(ds.id);
  }
  for (const id of newestBySource.keys()) if (!national.has(id) && id !== HOLLER_REQUEST_SOURCE && getSourceMeta(id)) localIds.add(id);
  const health = await healthNewest(db, [...localIds, ...national].filter((id) => !newestBySource.has(id)));
  const feed = (id: string): FeedSource | null => {
    const meta = getSourceMeta(id);
    if (!meta) return null;
    return { id, label: meta.label, newest: newestBySource.get(id) ?? health.get(id) ?? null };
  };
  data.local = [...localIds].map(feed).filter((x): x is FeedSource => x !== null).sort((a, b) => a.label.localeCompare(b.label));
  data.national = [...national].map(feed).filter((x): x is FeedSource => x !== null);

  await checkTask;
  return data;
}
