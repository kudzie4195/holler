import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { matchScope, type ScopeInput } from '@/lib/plan';
import { expandCategoriesForRouting } from '@/lib/signals/permit-routing';
import { RETENTION_DAYS } from '@/lib/signals/store';
import { APPROX_LOCATION_SOURCES, approxReachMi } from '@/lib/signals/approx-location';
import type { OpportunityLabel } from '@/lib/signals/lead-rules';
import {
  AREA_LIST_DAYS,
  areaListTrades,
  buildList,
  createsWorkFor,
  MAX_STORM_LISTS,
  STORM_LIST_DAYS,
  STORM_RADIUS_MI,
  stormKindOf,
  stormListLabel,
  type BuiltList,
  type PermitRow,
  type StormKind,
  type StormRow,
} from './core';

/**
 * Reads for the address lists (lib/lists/core.ts). Server-side only, with the caller's client: the pages pass the member's own session
 * client (lib/supabase/server createClient), so holler_matches is read under RLS (own rows only) and holler_signals under its public read
 * policy. No service role, no holler_signal_contacts, no new table or view (no migration). Nothing here is cached: every call is a
 * request-time read for one member (no 'use cache'), so one member's list can never be served to another.
 *
 * Columns read: for storm reports the id, title, place, point, date, source link, trades and the SPC type, size, speed and remarks (the
 * remarks only to test for damage words, never returned); for permits the id, source, kind, title, summary (for the building address),
 * source link, point, place, ZIP, date and data->>subtype / approxLocation / loc / projectOf. Never data as a whole.
 */

export const STORM_COLUMNS =
  'id,source,kind,title,lat,lon,city,state,county,occurred_at,url,categories,stormType:data->>type,hailInches:data->>hailInches,windMph:data->>windMph,comments:data->>comments';
export const PERMIT_COLUMNS =
  'id,source,kind,title,summary,url,lat,lon,city,state,zip,occurred_at,subtype:data->>subtype,approxLocation:data->>approxLocation,loc:data->>loc,projectOf:data->>projectOf';

/** PostgREST returns at most this many rows per query. A storm or area read that hits it may miss addresses; the list then says so. */
export const ROW_CAP = 1000;
const MATCH_CAP = 1000;

const MI_PER_DEG = 68.5; // a little under the true 69.09, so the box is never smaller than the circle
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** A PostgREST `and(...)` box around a point, for `.or()`. */
export function boxFilter(lat: number, lon: number, radiusMi: number): string {
  const dLat = radiusMi / MI_PER_DEG;
  const dLon = radiusMi / (MI_PER_DEG * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  const f = (n: number) => n.toFixed(4);
  return `and(lat.gte.${f(lat - dLat)},lat.lte.${f(lat + dLat)},lon.gte.${f(lon - dLon)},lon.lte.${f(lon + dLon)})`;
}

/** What the list pages need from the member's profile row. */
export interface ListProfile extends ScopeInput {
  user_id: string;
  radius_mi: number | null;
}

export interface StormReportItem {
  id: number;
  kind: StormKind;
  label: OpportunityLabel;
  /** The stored English title ("1.75 inch hail reported near 2 ESE Longview, TX"); pages localise it with localizeTitle. */
  title: string;
  city: string | null;
  state: string | null;
  county: string | null;
  occurredAt: string;
  url: string | null;
  lat: number;
  lon: number;
}

interface MatchWithSignal {
  signal_id?: number;
  signal: StormRow | StormRow[] | null;
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

function toItem(s: StormRow, label: OpportunityLabel): StormReportItem {
  return {
    id: Number(s.id),
    kind: stormKindOf(s) as StormKind,
    label,
    title: s.title,
    city: s.city ?? null,
    state: s.state ?? null,
    county: s.county ?? null,
    occurredAt: s.occurred_at,
    url: s.url ?? null,
    lat: s.lat as number,
    lon: s.lon as number,
  };
}

/**
 * The storm reports that make a list for this member: SPC reports that reached the member as a match (holler_matches, own rows only), in
 * the last STORM_LIST_DAYS, qualifying (hail of 1 inch or more, wind damage) and act_now or coming_soon for the member's plan trades.
 * Newest first, at most MAX_STORM_LISTS. Any read error gives an empty list.
 */
export async function loadStormReports(
  db: SupabaseClient,
  profile: ListProfile,
  now: Date = new Date(),
  /** Only these signal ids (the feed's storm cards). Absent: every storm match of the window. */
  signalIds?: readonly number[],
): Promise<StormReportItem[]> {
  const trades = matchScope(profile).categories;
  const nowMs = now.getTime();
  // A report that occurred inside the window was matched after it occurred, so its match is at least this new.
  const since = new Date(nowMs - (STORM_LIST_DAYS + 1) * 86_400_000).toISOString();
  // !inner + signal.source = spc: only storm matches are read, so a member with many permit matches never loses a storm list to the row cap
  // (review P3-8). The filter uses the embed's alias, as PostgREST documents for aliased embeds.
  let q = db
    .from('holler_matches')
    .select(`signal_id,signal:holler_signals!inner(${STORM_COLUMNS})`)
    .eq('user_id', profile.user_id)
    .eq('signal.source', 'spc')
    .gte('created_at', since);
  if (signalIds) q = q.in('signal_id', [...signalIds]);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(MATCH_CAP);
  if (error) throw new Error(error.message);
  const out: StormReportItem[] = [];
  const seen = new Set<number>();
  for (const m of (data ?? []) as unknown as MatchWithSignal[]) {
    const s = one(m.signal);
    if (!s || s.source !== 'spc' || seen.has(Number(s.id))) continue;
    seen.add(Number(s.id));
    const label = stormListLabel(s, trades, nowMs);
    if (label) out.push(toItem(s, label));
  }
  out.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : b.id - a.id));
  return out.slice(0, MAX_STORM_LISTS);
}

/** One storm report by signal id, only when THIS member has a match for it and it makes a list. Null otherwise (the page answers 404). */
export async function loadStormReport(db: SupabaseClient, profile: ListProfile, signalId: number, now: Date = new Date()): Promise<StormReportItem | null> {
  if (!Number.isSafeInteger(signalId) || signalId <= 0) return null;
  const { data, error } = await db
    .from('holler_matches')
    .select(`signal_id,signal:holler_signals(${STORM_COLUMNS})`)
    .eq('user_id', profile.user_id)
    .eq('signal_id', signalId)
    .limit(1);
  if (error) throw new Error(error.message);
  const m = ((data ?? []) as unknown as MatchWithSignal[])[0];
  const s = one(m?.signal);
  if (!s || Number(s.id) !== signalId || s.source !== 'spc') return null;
  const label = stormListLabel(s, matchScope(profile).categories, now.getTime());
  return label ? toItem(s, label) : null;
}

export interface LoadedList extends BuiltList {
  /** True when a query returned ROW_CAP rows, so some addresses may be missing. */
  partial: boolean;
}

/** Permits Holler holds within STORM_RADIUS_MI of the report point. Building permits only, with their own map point. */
export async function loadStormList(db: SupabaseClient, report: Pick<StormReportItem, 'lat' | 'lon'>, now: Date = new Date()): Promise<LoadedList> {
  const since = new Date(now.getTime() - RETENTION_DAYS * 86_400_000).toISOString();
  const { data, error } = await db
    .from('holler_signals')
    .select(PERMIT_COLUMNS)
    .eq('kind', 'permit')
    .not('lat', 'is', null)
    .or(boxFilter(report.lat, report.lon, STORM_RADIUS_MI))
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(ROW_CAP);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as PermitRow[];
  return { ...buildList(rows, { center: { lat: report.lat, lon: report.lon, radiusMi: STORM_RADIUS_MI } }), partial: rows.length >= ROW_CAP };
}

/** Located areas of the member's plan (main area first, then the extra areas Pro allows) and the member's radius. Null when none. */
export function memberAreas(profile: ListProfile): { areas: { lat: number; lon: number }[]; radius: number; trades: string[] } | null {
  const scope = matchScope(profile);
  const areas = scope.areas.filter((a) => isNum(a.lat) && isNum(a.lon)).map((a) => ({ lat: a.lat as number, lon: a.lon as number }));
  const radius = isNum(profile.radius_mi) && profile.radius_mi > 0 ? profile.radius_mi : null;
  if (areas.length === 0 || radius === null) return null;
  return { areas, radius, trades: scope.categories };
}

/**
 * The permit rows of the last AREA_LIST_DAYS in the member's areas that carry one of `trades` or a permit tag routed to them. Two reads: rows
 * with their own point inside a box of the member's radius, and Cobb County rows (a stand-in point) inside a box of the scanner's wider
 * reach. buildList then applies the exact distance.
 */
async function areaRows(db: SupabaseClient, areas: { lat: number; lon: number }[], radius: number, trades: readonly string[], now: Date) {
  const since = new Date(now.getTime() - AREA_LIST_DAYS * 86_400_000).toISOString();
  const base = () =>
    db
      .from('holler_signals')
      .select(PERMIT_COLUMNS)
      .eq('kind', 'permit')
      .overlaps('categories', expandCategoriesForRouting(trades))
      .gte('occurred_at', since)
      .lte('occurred_at', new Date(now.getTime() + 86_400_000).toISOString())
      .not('lat', 'is', null)
      .order('occurred_at', { ascending: false })
      .limit(ROW_CAP);
  const approxSources = [...APPROX_LOCATION_SOURCES];
  const [a, c] = await Promise.all([
    base().or(areas.map((x) => boxFilter(x.lat, x.lon, radius)).join(',')),
    base().in('source', approxSources).or(areas.map((x) => boxFilter(x.lat, x.lon, approxReachMi(radius))).join(',')),
  ]);
  if (a.error || c.error) throw new Error((a.error ?? c.error)?.message ?? 'query failed');
  const ra = (a.data ?? []) as unknown as PermitRow[];
  const rc = (c.data ?? []) as unknown as PermitRow[];
  return { rows: [...ra, ...rc], partial: ra.length >= ROW_CAP || rc.length >= ROW_CAP, since };
}

/**
 * The neighborhood list of one trade for this member, or null when the trade is not one of the member's plan trades with a list, or the
 * member has no located area. The areas and trades come from the member's own profile through matchScope, never from the request.
 */
export async function loadAreaList(db: SupabaseClient, profile: ListProfile, trade: string, now: Date = new Date()): Promise<LoadedList | null> {
  const m = memberAreas(profile);
  if (!m || !areaListTrades(m.trades).includes(trade)) return null;
  const { rows, partial, since } = await areaRows(db, m.areas, m.radius, [trade], now);
  const built = buildList(rows, { areas: m.areas, areaRadiusMi: m.radius, sinceIso: since, accept: (r) => createsWorkFor(r, trade) });
  return { ...built, partial };
}

/**
 * Address counts of every neighborhood list of the member (one read for all trades). Empty when the member has none. `partial` is true when
 * the shared read hit the row cap, so a count may be lower than its list (the index then prints "N+", review P3-9).
 */
export async function loadAreaCounts(
  db: SupabaseClient,
  profile: ListProfile,
  now: Date = new Date(),
): Promise<{ trade: string; total: number; partial: boolean }[]> {
  const m = memberAreas(profile);
  const trades = m ? areaListTrades(m.trades) : [];
  if (!m || trades.length === 0) return [];
  const { rows, since, partial } = await areaRows(db, m.areas, m.radius, trades, now);
  return trades.map((trade) => ({
    trade,
    total: buildList(rows, { areas: m.areas, areaRadiusMi: m.radius, sinceIso: since, accept: (r) => createsWorkFor(r, trade) }).total,
    partial,
  }));
}

/** How many storm cards in the feed get a list line (each costs one read). */
export const MAX_CARD_LINKS = 5;

/**
 * For the feed: the storm cards of this member that have a list with at least one address, by signal id, with the address count.
 * Only reports among `signalIds` (cards the member already has) and only the newest MAX_CARD_LINKS of them are read. Any failure gives an
 * empty map (no line, the feed renders as before).
 */
export async function stormCardLinks(
  db: SupabaseClient,
  profile: ListProfile,
  signalIds: readonly number[],
  now: Date = new Date(),
): Promise<Map<number, { kind: StormKind; count: number }>> {
  const out = new Map<number, { kind: StormKind; count: number }>();
  if (signalIds.length === 0) return out;
  try {
    const wanted = new Set(signalIds);
    const reports = (await loadStormReports(db, profile, now, signalIds)).filter((r) => wanted.has(r.id)).slice(0, MAX_CARD_LINKS);
    const lists = await Promise.all(reports.map((r) => loadStormList(db, r, now).catch(() => null)));
    reports.forEach((r, i) => {
      const l = lists[i];
      if (l && l.total > 0) out.set(r.id, { kind: r.kind, count: l.total });
    });
  } catch {
    return new Map();
  }
  return out;
}
