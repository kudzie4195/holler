import { cacheLife } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cityBySlug, cityPath } from '@/lib/geo';
import { publicClient } from './client';
import { tradeLabel } from './trades';
import { liveRequestsFilter, withoutEndedRequests } from '@/lib/signals/request-visibility';

/**
 * The numbers behind /data. Every figure is read from holler_signals (or the holler_place_counts view) with the anonymous client.
 * No aggregate RPC exists in this database, so the work is bounded count queries and one small sample:
 *   2 totals (7 and 30 days), 8 counts by kind (4 kinds x 2 windows), 1 view read (places, with their newest record),
 *   10 per-city 30 day counts, 1 sample of the newest 1,000 records. 22 queries in all, run in parallel, once an hour.
 * Nothing reads a whole table. A failed query anywhere turns the whole result into the "unavailable" state.
 *
 * Limits that the page says out loud:
 *   - Counts are records Holler read and stored, dated inside the window and not in the future. They are not all local activity.
 *   - Cities are ranked among the ten with the most records over 60 days (the view holds 60 days), so the ranking is by 30 day count
 *     inside that group.
 *   - Sources and trades come from the newest 1,000 records, a sample, so the source count is a lower bound.
 */

const DAY = 86_400_000;
const QUERY_TIMEOUT_MS = 10_000;
export const SAMPLE_SIZE = 1000;
export const TOP_CITIES = 10;
export const TOP_TRADES = 8;
const VIEW_ROWS = 1000;

/** The kinds that get their own row. Everything else is added up as "Other records". */
export const KIND_ROWS: { id: string; label: string }[] = [
  { id: 'alert', label: 'Weather alerts' },
  { id: 'report', label: 'Storm reports' },
  { id: 'permit', label: 'Building permits' },
  { id: 'civic', label: 'City service records' },
];
export const OTHER_LABEL = 'Other records';

export interface KindCount {
  id: string;
  label: string;
  last7: number;
  last30: number;
}

export interface CityCount {
  slug: string;
  name: string;
  state: string | null;
  /** Null when the place is not one of the city pages. */
  path: string | null;
  last30: number;
}

export interface TradeCount {
  id: string;
  label: string;
  count: number;
}

export interface NationalStats {
  /** False when the database could not be read. Every other field is then empty. */
  ok: boolean;
  /** When the numbers were computed. */
  asOf: string;
  /** Time of the newest record dated up to now, or null when there is none. */
  newestAt: string | null;
  total7: number;
  total30: number;
  kinds: KindCount[];
  /** Cities with at least one record in the last 30 days. Null when the view cannot say. */
  citiesActive30: number | null;
  topCities: CityCount[];
  topTrades: TradeCount[];
  /** Records the trade and source figures were read from. */
  sampleSize: number;
  /** Distinct sources in the sample: a lower bound for the true number. */
  sourcesSeen: number;
}

export function unavailableStats(asOf: string): NationalStats {
  return {
    ok: false,
    asOf,
    newestAt: null,
    total7: 0,
    total30: 0,
    kinds: [],
    citiesActive30: null,
    topCities: [],
    topTrades: [],
    sampleSize: 0,
    sourcesSeen: 0,
  };
}

type Window = { since: string; until: string };

/** Every read here leaves out resident requests that have ended (w.until is "now"), so /data never counts a closed request. */
async function count(sb: SupabaseClient, w: Window, filter?: { kind?: string; place?: string }): Promise<number> {
  let q = sb
    .from('holler_signals')
    .select('id', { count: 'exact', head: true })
    .gte('occurred_at', w.since)
    .lte('occurred_at', w.until)
    .or(liveRequestsFilter(w.until));
  if (filter?.kind) q = q.eq('kind', filter.kind);
  if (filter?.place) q = q.eq('place_slug', filter.place);
  const r = await q.abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));
  if (r.error) throw new Error(r.error.message);
  return r.count ?? 0;
}

interface ViewRow {
  place_slug: string;
  signals_60d: number;
  latest_at?: string | null;
}

async function readPlaces(sb: SupabaseClient): Promise<{ rows: ViewRow[]; hasLatest: boolean }> {
  let res: { data: unknown; error: { message: string } | null } = await sb
    .from('holler_place_counts')
    .select('place_slug, signals_60d, latest_at')
    .order('signals_60d', { ascending: false })
    .range(0, VIEW_ROWS - 1)
    .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));
  let hasLatest = true;
  if (res.error) {
    // latest_at arrives with migration 0003. Without it the number of active cities cannot be told.
    hasLatest = false;
    res = await sb
      .from('holler_place_counts')
      .select('place_slug, signals_60d')
      .order('signals_60d', { ascending: false })
      .range(0, VIEW_ROWS - 1)
      .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));
  }
  if (res.error) throw new Error(res.error.message);
  return { rows: (res.data ?? []) as unknown as ViewRow[], hasLatest };
}

function prettySlug(slug: string): string {
  return slug.replace(/-[a-z]{2}$/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Pure part: reduce the sample rows to the trade list and the source count. */
export function summarizeSample(rows: { source?: string | null; categories?: string[] | null }[]): { trades: TradeCount[]; sources: number } {
  const trades = new Map<string, number>();
  const sources = new Set<string>();
  for (const r of rows) {
    if (r.source) sources.add(r.source);
    for (const c of r.categories ?? []) trades.set(c, (trades.get(c) ?? 0) + 1);
  }
  const list = [...trades.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_TRADES)
    .map(([id, n]) => ({ id, label: tradeLabel(id), count: n }));
  return { trades: list, sources: sources.size };
}

/**
 * Build the stats with the given client. Never throws: any failure (no client, a query error, a timeout) returns the unavailable state.
 * Exported so tests can pass a fake client.
 */
export async function buildNationalStats(sb: SupabaseClient | null, now: Date): Promise<NationalStats> {
  const asOf = now.toISOString();
  if (!sb) return unavailableStats(asOf);
  try {
    const until = asOf;
    const w7: Window = { since: new Date(now.getTime() - 7 * DAY).toISOString(), until };
    const w30: Window = { since: new Date(now.getTime() - 30 * DAY).toISOString(), until };

    const [total7, total30, kindCounts, places, sample] = await Promise.all([
      count(sb, w7),
      count(sb, w30),
      Promise.all(
        KIND_ROWS.map(async (k) => ({
          id: k.id,
          label: k.label,
          last7: await count(sb, w7, { kind: k.id }),
          last30: await count(sb, w30, { kind: k.id }),
        })),
      ),
      readPlaces(sb),
      (async () => {
        const r = await sb
          .from('holler_signals')
          .select('source, categories, occurred_at, expires_at')
          .gte('occurred_at', w30.since)
          .lte('occurred_at', w30.until)
          .or(liveRequestsFilter(w30.until))
          .order('occurred_at', { ascending: false })
          .limit(SAMPLE_SIZE)
          .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));
        if (r.error) throw new Error(r.error.message);
        return withoutEndedRequests(
          (r.data ?? []) as unknown as { source: string | null; categories: string[] | null; occurred_at: string; expires_at?: string | null }[],
          now.getTime(),
        );
      })(),
    ]);

    // Cities: active ones first, then the ten with the most records over 60 days, then their exact 30 day counts.
    const since30 = Date.parse(w30.since);
    const active = places.hasLatest
      ? places.rows.filter((r) => r.latest_at && Date.parse(r.latest_at) >= since30)
      : places.rows;
    const candidates = [...active].sort((a, b) => b.signals_60d - a.signals_60d || a.place_slug.localeCompare(b.place_slug)).slice(0, TOP_CITIES);
    const counted = await Promise.all(candidates.map(async (c) => ({ slug: c.place_slug, n: await count(sb, w30, { place: c.place_slug }) })));
    const topCities: CityCount[] = counted
      .filter((c) => c.n > 0)
      .sort((a, b) => b.n - a.n || a.slug.localeCompare(b.slug))
      .map((c) => {
        const city = cityBySlug(c.slug);
        return {
          slug: c.slug,
          name: city?.name ?? prettySlug(c.slug),
          state: city?.state ?? null,
          path: city ? cityPath(city) : null,
          last30: c.n,
        };
      });

    const known = kindCounts.reduce((a, k) => ({ last7: a.last7 + k.last7, last30: a.last30 + k.last30 }), { last7: 0, last30: 0 });
    const kinds: KindCount[] = [...kindCounts];
    const other = { id: 'other', label: OTHER_LABEL, last7: Math.max(0, total7 - known.last7), last30: Math.max(0, total30 - known.last30) };
    if (other.last7 > 0 || other.last30 > 0) kinds.push(other);

    const { trades, sources } = summarizeSample(sample);
    const newest = sample.find((r) => Date.parse(r.occurred_at) <= now.getTime());

    return {
      ok: true,
      asOf,
      newestAt: newest ? newest.occurred_at : null,
      total7,
      total30,
      kinds,
      citiesActive30: places.hasLatest ? active.length : null,
      topCities,
      topTrades: trades,
      sampleSize: sample.length,
      sourcesSeen: sources,
    };
  } catch (e) {
    console.error('[seo] buildNationalStats failed:', e instanceof Error ? e.message : 'unknown');
    return unavailableStats(asOf);
  }
}

/**
 * Cached for about an hour. A failed read is remembered for a minute only, so a database blip does not pin the
 * "unavailable" note for an hour. The lifetime is chosen after the reads, as in the sitemap.
 */
export async function loadNationalStats(): Promise<NationalStats> {
  'use cache';
  const stats = await buildNationalStats(publicClient(), new Date());
  cacheLife(stats.ok ? { stale: 300, revalidate: 3600, expire: 7200 } : { stale: 60, revalidate: 60, expire: 300 });
  return stats;
}
