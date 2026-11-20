import { cacheLife } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { haversineMi, lookupZip } from '@/lib/geo';
import { HOLLER_REQUEST_SOURCE } from '@/lib/signals/request-visibility';
import { publicClient } from './client';
import { labelPhrase, mapLabel } from './home-label';
import { EXAMPLE_DEGREES, MAP_RADIUS_MI, placeMarkers, placeNear, type Placement } from './home-place';

/**
 * The radius map on the home page: real records from the last 7 days within MAP_RADIUS_MI of MAP_ZIP.
 *
 * The centre comes from the repo's own ZIP lookup (lib/geo lookupZip, the zipcodes dataset); no coordinate is typed here.
 * Three bounded reads of holler_signals with the anonymous client, all inside the bounding box of the circle, dated in the last
 * 7 days and not in the future, not expired, never a resident request (source 'holler-request') and never kind 'ask', newest first:
 *   permits (at most PERMIT_SCAN rows), city service records (CIVIC_SCAN) and weather (WEATHER_SCAN).
 * The rows are re-checked here (pickMapRecords): inside the circle, a valid http(s) source URL, at least one trade, a family the
 * map draws. Then MAP_SHOWN are picked to show range (see pickMapRecords) and placed (lib/seo/home-place.ts).
 * Fewer than MAP_MIN usable records, no database, or any failure: null, and the page draws the labelled example set instead.
 * Cached about 15 minutes ('use cache'); a failure is remembered for a minute only.
 */

export const MAP_ZIP = '60614';
export const MAP_SHOWN = 6;
export const MAP_MIN = 4;
export const PERMIT_SCAN = 150;
export const CIVIC_SCAN = 300;
export const WEATHER_SCAN = 30;
/** The most permits picked while other families have records to show. */
const PERMIT_SHARE = 3;
const DAY = 86_400_000;
const QUERY_TIMEOUT_MS = 8_000;
/** All home page dates are Chicago dates: the map's ZIP is in Chicago. */
export const HOME_TZ = 'America/Chicago';

export type Family = 'weather' | 'permit' | 'civic';
export const FAMILIES: Family[] = ['weather', 'permit', 'civic'];

/** The three record families of the design (same grouping as the kind badges). */
export function familyOf(kind: string): Family | null {
  if (kind === 'alert' || kind === 'report' || kind === 'disaster' || kind === 'quake') return 'weather';
  if (kind === 'permit' || kind === 'contract') return 'permit';
  if (kind === 'civic' || kind === 'event' || kind === 'travel' || kind === 'ask') return 'civic';
  return null;
}

export interface MapRecord {
  id: string;
  family: Family;
  /** The record's own title. */
  title: string;
  /** Short phrase in the record's own case, at most 16 characters ("Roof permit"). */
  phrase: string;
  /** The phrase in capitals ("ROOF PERMIT"). */
  label: string;
  /** Miles from the centre, one decimal. */
  mi: number;
  /** When it happened. Null for the example set, which has no dates. */
  occurredAt: string | null;
  /** The public source page the record came from (for city data, the dataset page). Null for the example set. */
  url: string | null;
  /** "Chicago, IL". */
  place: string;
}

export interface HomeMap {
  /** True for real records, false for the labelled example set. */
  live: boolean;
  zip: string;
  /** "Chicago". */
  city: string;
  /** Records by distance, nearest first; numbered 1 to n on the map in this order. */
  records: MapRecord[];
  /** Where each record is drawn, same order as records. */
  placed: Placement[];
}

/** The label drawn next to a dot: "ROOF PERMIT 2.6 MI". */
export function dotText(r: Pick<MapRecord, 'label' | 'mi'>): string {
  return `${r.label} ${r.mi.toFixed(1)} MI`;
}

// ---- Dates -------------------------------------------------------------------------------------------------------------------

function parts(iso: string, month: 'short' | 'long', tz: string = HOME_TZ): { m: string; d: string; y: string } {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, month, day: 'numeric', year: 'numeric' }).formatToParts(new Date(iso));
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? '';
  return { m: get('month'), d: get('day'), y: get('year') };
}

/** "Nov 18": Chicago date, or the date in the given IANA time zone. */
export function shortDay(iso: string, tz: string = HOME_TZ): string {
  const p = parts(iso, 'short', tz);
  return `${p.m} ${p.d}`;
}

/** "Nov 19, 2026" (Chicago date). */
export function shortDate(iso: string): string {
  const p = parts(iso, 'short');
  return `${p.m} ${p.d}, ${p.y}`;
}

/** "Nov 13 to 18", "Oct 30 to Nov 2", "Nov 18"; month 'long' gives "November 13 to 18". Empty for no dates. */
export function dayRange(isos: (string | null)[], month: 'short' | 'long' = 'short'): string {
  const ms = isos.filter((x): x is string => !!x).map((x) => Date.parse(x)).filter(Number.isFinite);
  if (!ms.length) return '';
  const a = parts(new Date(Math.min(...ms)).toISOString(), month);
  const b = parts(new Date(Math.max(...ms)).toISOString(), month);
  if (a.y === b.y && a.m === b.m && a.d === b.d) return `${a.m} ${a.d}`;
  if (a.y === b.y && a.m === b.m) return `${a.m} ${a.d} to ${b.d}`;
  return `${a.m} ${a.d} to ${b.m} ${b.d}`;
}

// ---- Example set -------------------------------------------------------------------------------------------------------------

/**
 * EXAMPLE, NOT LIVE DATA: the six records of the approved design, drawn when there is no live data. The page labels them as an
 * example and shows no dates and no source links for them. Titles follow the adapters' shapes so the label rule makes the labels.
 */
export const EXAMPLE_RECORDS: { title: string; family: Family; mi: number }[] = [
  { title: 'HVAC permit in Chicago', family: 'permit', mi: 1.7 },
  { title: 'Roof permit in Chicago', family: 'permit', mi: 2.6 },
  { title: 'Plumbing permit in Chicago', family: 'permit', mi: 3.5 },
  { title: '311 request in Chicago: Tree Emergency', family: 'civic', mi: 4.9 },
  { title: 'Code violation in Chicago: Roof repair order', family: 'civic', mi: 5.0 },
  { title: 'Code violation in Chicago: Porch repair order', family: 'civic', mi: 5.5 },
];

function toRecord(id: string, title: string, family: Family, mi: number, occurredAt: string | null, url: string | null, place: string): MapRecord {
  return { id, family, title, phrase: labelPhrase(title), label: mapLabel(title), mi, occurredAt, url, place };
}

function withPlacement(records: MapRecord[], zip: string): { records: MapRecord[]; placed: Placement[] } {
  const sorted = [...records].sort((a, b) => a.mi - b.mi || a.id.localeCompare(b.id));
  const res = placeMarkers(
    sorted.map((r) => ({ id: r.id, mi: r.mi, text: dotText(r) })),
    zip,
  );
  const keep = new Set(res.placed.map((p) => p.id));
  return { records: sorted.filter((r) => keep.has(r.id)), placed: res.placed };
}

/** The example set at its hand-picked angles (lib/seo/home-place.ts EXAMPLE_DEGREES, checked by placeNear), nearest first. */
export function exampleMap(): HomeMap {
  const records = EXAMPLE_RECORDS.map((e, i) => toRecord(`example-${i + 1}`, e.title, e.family, e.mi, null, null, 'Chicago, IL'));
  const res = placeNear(
    records.map((r) => ({ id: r.id, mi: r.mi, text: dotText(r) })),
    EXAMPLE_DEGREES,
    MAP_ZIP,
  );
  const keep = new Set(res.placed.map((p) => p.id));
  return { live: false, zip: MAP_ZIP, city: 'Chicago', records: records.filter((r) => keep.has(r.id)), placed: res.placed };
}

// ---- Picking real records ----------------------------------------------------------------------------------------------------

export interface MapRow {
  id: string | number;
  source: string | null;
  kind: string;
  title: string | null;
  url: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lon: number | null;
  categories: string[] | null;
  occurred_at: string;
  expires_at: string | null;
}

function safeUrl(u: unknown): string | null {
  if (typeof u !== 'string' || !u) return null;
  try {
    const p = new URL(u);
    return p.protocol === 'https:' || p.protocol === 'http:' ? p.toString() : null;
  } catch {
    return null;
  }
}

function tidyCity(city: string): string {
  const c = city.trim();
  if (c !== c.toUpperCase()) return c;
  return c.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
}

/** Which family the map draws a row as, or null when the map leaves it out (inspections, business licenses, events, contracts). */
function mapFamily(r: MapRow): Family | null {
  const t = r.title ?? '';
  if (r.kind === 'permit' && /\bpermit in\b/i.test(t)) return 'permit';
  if (r.kind === 'civic' && /^(311 request|code violation) in\b/i.test(t)) return 'civic';
  if (r.kind === 'alert' || r.kind === 'report') return 'weather';
  return null;
}

const ring = (mi: number) => (mi <= 2 ? 0 : mi <= 4 ? 1 : 2);

/**
 * Pure: choose up to MAP_SHOWN records that show range.
 *  1. Every rule of the query again: not a resident request or an ask, dated in the last 7 days and not in the future, not expired,
 *     a title, a valid source URL, at least one trade, coordinates inside the circle, a family the map draws.
 *  2. At most one record per label.
 *  3. One record from each family that has any (permits first), each in a ring not yet used where it can.
 *  4. Then fill: permits first up to PERMIT_SHARE while other families have records, then 311 and code cases, then weather, then
 *     any family. Within a family the next pick is in the ring with the fewest picks so far, newest first.
 *  5. A record is only taken if the whole set can still be placed on the map with no overlap (lib/seo/home-place.ts).
 * Returns the picked records nearest first, or fewer than MAP_MIN when there is not enough (the caller then shows the example).
 */
export function pickMapRecords(rows: MapRow[], centre: { lat: number; lon: number }, nowMs: number, zip = MAP_ZIP): MapRecord[] {
  const pools: Record<Family, (MapRecord & { t: number })[]> = { permit: [], civic: [], weather: [] };
  const seenLabel = new Set<string>();
  const sorted = [...rows].sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
  for (const r of sorted) {
    if (!r.source || r.source === HOLLER_REQUEST_SOURCE || r.kind === 'ask') continue;
    if (!r.title || !r.title.trim()) continue;
    const t = Date.parse(r.occurred_at);
    if (!Number.isFinite(t) || t > nowMs || t < nowMs - 7 * DAY) continue;
    if (r.expires_at) {
      const e = Date.parse(r.expires_at);
      if (!Number.isFinite(e) || e <= nowMs) continue;
    }
    const url = safeUrl(r.url);
    if (!url) continue;
    if (!r.categories || r.categories.length === 0) continue;
    if (typeof r.lat !== 'number' || typeof r.lon !== 'number' || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
    const fam = mapFamily(r);
    if (!fam) continue;
    const mi = Math.round(haversineMi(centre.lat, centre.lon, r.lat, r.lon) * 10) / 10;
    if (!(mi > 0 && mi <= MAP_RADIUS_MI)) continue;
    const label = mapLabel(r.title);
    if (seenLabel.has(label)) continue;
    seenLabel.add(label);
    const city = r.city ? tidyCity(r.city) : '';
    const place = city ? (r.state ? `${city}, ${r.state.toUpperCase()}` : city) : '';
    pools[fam].push({ ...toRecord(String(r.id), r.title.trim(), fam, mi, r.occurred_at, url, place), t });
  }

  const picked: (MapRecord & { t: number })[] = [];
  const ringCount = [0, 0, 0];
  const fits = (c: MapRecord) => {
    const set = [...picked, c];
    return placeMarkers(
      set.map((x) => ({ id: x.id, mi: x.mi, text: dotText(x) })),
      zip,
    ).dropped.length === 0;
  };
  const take = (fam: Family, preferNewRing: boolean): boolean => {
    const used = new Set(picked.map((p) => p.id));
    const cands = pools[fam]
      .filter((c) => !used.has(c.id))
      .sort((a, b) =>
        preferNewRing
          ? Number(ringCount[ring(a.mi)] > 0) - Number(ringCount[ring(b.mi)] > 0) || b.t - a.t
          : ringCount[ring(a.mi)] - ringCount[ring(b.mi)] || b.t - a.t,
      );
    for (const c of cands) {
      if (fits(c)) {
        picked.push(c);
        ringCount[ring(c.mi)]++;
        return true;
      }
    }
    return false;
  };

  const present = (['permit', 'civic', 'weather'] as Family[]).filter((f) => pools[f].length > 0);
  for (const f of present) take(f, true);
  const others = present.some((f) => f !== 'permit');
  const count = (f: Family) => picked.filter((p) => p.family === f).length;
  while (picked.length < MAP_SHOWN) {
    const order: Family[] = [];
    if (!others || count('permit') < PERMIT_SHARE) order.push('permit');
    order.push('civic', 'weather', 'permit');
    let ok = false;
    for (const f of order) {
      if (take(f, false)) {
        ok = true;
        break;
      }
    }
    if (!ok) break;
  }
  return picked.map(({ t: _t, ...r }) => (void _t, r)).sort((a, b) => a.mi - b.mi || a.id.localeCompare(b.id));
}

/** Pure: the map from picked records, or null when there are fewer than MAP_MIN. */
export function homeMapFrom(records: MapRecord[], city: string, zip = MAP_ZIP): HomeMap | null {
  if (records.length < MAP_MIN) return null;
  const m = withPlacement(records, zip);
  if (m.records.length < MAP_MIN) return null;
  return { live: true, zip, city, ...m };
}

const COLUMNS = 'id,source,kind,title,url,city,state,lat,lon,categories,occurred_at,expires_at';

/** The bounding box of the circle (a little larger than the circle; pickMapRecords keeps only rows inside it). */
export function mapBox(lat: number, lon: number, mi = MAP_RADIUS_MI) {
  const dLat = mi / 68.9;
  const dLon = mi / (68.9 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  return { latLo: lat - dLat, latHi: lat + dLat, lonLo: lon - dLon, lonHi: lon + dLon };
}

/** A client, or a function that makes one. The function is called inside the loader's try block, so a bad setting cannot throw out. */
export type ClientSource = SupabaseClient | null | (() => SupabaseClient | null);

/**
 * The three reads. Never throws: no client, a client that fails to build (a malformed URL), an error or a timeout gives null.
 * Exported for tests.
 */
export async function buildHomeMap(client: ClientSource, now: Date, zip = MAP_ZIP): Promise<HomeMap | null> {
  const centre = lookupZip(zip);
  if (!centre) return null;
  try {
    const sb = typeof client === 'function' ? client() : client;
    if (!sb) return null;
    const nowIso = now.toISOString();
    const since = new Date(now.getTime() - 7 * DAY).toISOString();
    const box = mapBox(centre.lat, centre.lon);
    const read = (kinds: string[], limit: number) =>
      sb
        .from('holler_signals')
        .select(COLUMNS)
        .in('kind', kinds)
        .neq('source', HOLLER_REQUEST_SOURCE)
        .neq('kind', 'ask')
        .gte('lat', box.latLo)
        .lte('lat', box.latHi)
        .gte('lon', box.lonLo)
        .lte('lon', box.lonHi)
        .gte('occurred_at', since)
        .lte('occurred_at', nowIso)
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
        .order('occurred_at', { ascending: false })
        .limit(limit)
        .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));
    const [permits, civic, weather] = await Promise.all([
      read(['permit'], PERMIT_SCAN),
      read(['civic'], CIVIC_SCAN),
      read(['alert', 'report'], WEATHER_SCAN),
    ]);
    for (const r of [permits, civic, weather]) if (r.error) throw new Error(r.error.message);
    const rows = [...(permits.data ?? []), ...(civic.data ?? []), ...(weather.data ?? [])] as unknown as MapRow[];
    const city = tidyCity(centre.city);
    return homeMapFrom(pickMapRecords(rows, centre, now.getTime(), zip), city, zip);
  } catch (e) {
    console.error('[seo] buildHomeMap failed:', e instanceof Error ? e.message : 'unknown');
    return null;
  }
}

/** Cached about 15 minutes; a failure is remembered for a minute only. */
export async function loadHomeMap(): Promise<HomeMap | null> {
  'use cache';
  const map = await buildHomeMap(publicClient, new Date());
  cacheLife(map ? { stale: 300, revalidate: 900, expire: 3600 } : { stale: 60, revalidate: 60, expire: 300 });
  return map;
}
