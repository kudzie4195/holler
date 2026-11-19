import { cacheLife } from 'next/cache';
import { lookupZip } from '@/lib/geo';
import { HOLLER_REQUEST_SOURCE } from '@/lib/signals/request-visibility';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import type { Adapter } from '@/lib/signals/types';
import { publicClient } from './client';
import { loadNationalStats, type NationalStats } from './national-data';
import { MAP_ZIP, homeMapFrom, loadHomeMap, pickMapRecords, type ClientSource, type HomeMap, type MapRow } from './home-map';

/**
 * Everything live on the home page. Real data only; each part is null when it cannot be stated, and the page then leaves that
 * part out (proof strip, latest band, ledger example lines) or draws the labelled example (map, alert card, phone preview).
 *
 *  - proof: records read in the last 7 days (loadNationalStats, the /data loader, cached an hour: no new query), the number of
 *    city, county and weather feeds switched on in the code registry (feedCount), and when the numbers were read.
 *  - map: lib/seo/home-map.ts (real records around ZIP 60614).
 *  - weather: the newest storm report or weather alert in the country, for the ledger's weather row. One bounded query, cached
 *    about 15 minutes.
 */

const DAY = 86_400_000;
const QUERY_TIMEOUT_MS = 8_000;
export const WEATHER_EXAMPLE_SCAN = 40;
const TITLE_MAX = 64;

/** The window of the records figure: national-data.ts total7 counts records dated in the last 7 days. */
export const PROOF_WINDOW_DAYS = 7;

export interface HomeProof {
  /** Records read and dated in the last 7 days. Above zero. */
  total7: number;
  /** City, county and weather feeds switched on (feedCount). Above zero. */
  feeds: number;
  /** When the numbers were read. */
  asOf: string;
}

export interface LedgerExample {
  title: string;
  occurredAt: string;
  /** Miles from the map's ZIP, when the record is on the map. */
  mi: number | null;
}

export interface HomeLive {
  proof: HomeProof | null;
  map: HomeMap | null;
  weather: LedgerExample | null;
}

export const NO_LIVE: HomeLive = { proof: null, map: null, weather: null };

/**
 * The feeds figure: adapters in lib/signals/registry.ts ALL_ADAPTERS that read city or county open data (ids "socrata-*" and
 * "arcgis-*") or weather (kinds 'alert' and 'report': the National Weather Service and the NOAA Storm Prediction Center), and whose
 * required keys are set in this environment (the same test runScan uses, lib/signals/run.ts missingEnvFor). Exact, not a sample.
 */
export function feedCount(adapters: Pick<Adapter, 'id' | 'kind' | 'requiresEnv'>[], env: Record<string, string | undefined>): number {
  return adapters.filter((a) => {
    const cityOrCounty = a.id.startsWith('socrata-') || a.id.startsWith('arcgis-');
    const weather = a.kind === 'alert' || a.kind === 'report';
    return (cityOrCounty || weather) && (a.requiresEnv ?? []).every((k) => !!env[k]);
  }).length;
}

/** Pure: the proof strip, or null when there is nothing true to show. */
export function proofFrom(stats: NationalStats, feeds: number): HomeProof | null {
  if (!stats.ok || !(stats.total7 > 0) || !(feeds > 0)) return null;
  return { total7: stats.total7, feeds, asOf: stats.asOf };
}

export function shortTitle(title: string, max = TITLE_MAX): string {
  const t = title.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max / 2 ? cut.slice(0, at) : cut).replace(/[\s,.;:-]+$/, '')}…`;
}

interface WeatherRow {
  source: string | null;
  kind: string;
  title: string | null;
  severity: number | null;
  occurred_at: string;
  expires_at: string | null;
}

/** Pure: storm reports first (they say what happened and where), then the most severe, then the newest. Re-checks the query's rules. */
export function pickWeather(rows: WeatherRow[], nowMs: number): LedgerExample | null {
  const ok = rows.filter((r) => {
    if (!r.source || r.source === HOLLER_REQUEST_SOURCE) return false;
    if (r.kind !== 'report' && r.kind !== 'alert') return false;
    if (!r.title || !r.title.trim()) return false;
    const t = Date.parse(r.occurred_at);
    if (!Number.isFinite(t) || t > nowMs || t < nowMs - 7 * DAY) return false;
    if (r.expires_at) {
      const e = Date.parse(r.expires_at);
      if (!Number.isFinite(e) || e <= nowMs) return false;
    }
    return true;
  });
  ok.sort(
    (a, b) =>
      Number(b.kind === 'report') - Number(a.kind === 'report') ||
      (b.severity ?? 1) - (a.severity ?? 1) ||
      Date.parse(b.occurred_at) - Date.parse(a.occurred_at),
  );
  const r = ok[0];
  return r ? { title: shortTitle(r.title!), occurredAt: r.occurred_at, mi: null } : null;
}

/** One bounded query. Never throws: no client, a client that fails to build or a failed read returns null. Exported for tests. */
export async function buildWeatherExample(client: ClientSource, now: Date): Promise<LedgerExample | null> {
  try {
    const sb = typeof client === 'function' ? client() : client;
    if (!sb) return null;
    const nowIso = now.toISOString();
    const r = await sb
      .from('holler_signals')
      .select('source,kind,title,severity,occurred_at,expires_at')
      .in('kind', ['report', 'alert'])
      .neq('source', HOLLER_REQUEST_SOURCE)
      .gte('occurred_at', new Date(now.getTime() - 7 * DAY).toISOString())
      .lte('occurred_at', nowIso)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order('occurred_at', { ascending: false })
      .limit(WEATHER_EXAMPLE_SCAN)
      .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));
    if (r.error) throw new Error(r.error.message);
    return pickWeather((r.data ?? []) as unknown as WeatherRow[], now.getTime());
  } catch (e) {
    console.error('[seo] buildWeatherExample failed:', e instanceof Error ? e.message : 'unknown');
    return null;
  }
}

/** Cached about 15 minutes; a failure is remembered for a minute only. */
export async function loadWeatherExample(): Promise<LedgerExample | null> {
  'use cache';
  const w = await buildWeatherExample(publicClient, new Date());
  cacheLife(w ? { stale: 300, revalidate: 900, expire: 3600 } : { stale: 60, revalidate: 60, expire: 300 });
  return w;
}

// ---- Local preview fixture -------------------------------------------------------------------------------------------------
// FIXTURE DATA, NOT REAL. Used only to look at the live page on a machine without database access. It is returned only when
// HOLLER_PREVIEW_FIXTURES is exactly "1" AND the VERCEL variable is not set (Vercel sets VERCEL=1 on every build and runtime),
// so it can never reach a deployed page. Every fixture title ends in "(fixture)". tests/seo/home-live.test.ts proves the guard.

export function previewFixturesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.HOLLER_PREVIEW_FIXTURES === '1' && !env.VERCEL;
}

/** [title, kind, source dataset URL, miles, bearing in degrees, hours ago, categories] around ZIP 60614. */
const FIXTURE_NEAR: [string, string, string, number, number, number, string[]][] = [
  ['Roof permit in Chicago (fixture)', 'permit', 'https://data.cityofchicago.org/d/ydr8-5enu', 2.6, 30, 30, ['roofing']],
  ['HVAC permit in Chicago (fixture)', 'permit', 'https://data.cityofchicago.org/d/ydr8-5enu', 1.7, 200, 44, ['hvac']],
  ['Plumbing permit in Chicago (fixture)', 'permit', 'https://data.cityofchicago.org/d/ydr8-5enu', 3.5, 120, 50, ['plumbing']],
  ['Window and door permit in Chicago (fixture)', 'permit', 'https://data.cityofchicago.org/d/ydr8-5enu', 4.9, 300, 52, ['windows-doors']],
  ['311 request in Chicago: Tree Emergency (fixture)', 'civic', 'https://data.cityofchicago.org/d/v6vf-nfxy', 4.9, 80, 9, ['tree-service']],
  ['Code violation in Chicago: Roof repair order (fixture)', 'civic', 'https://data.cityofchicago.org/d/22u3-xenr', 5.0, 160, 70, ['roofing']],
  ['Code violation in Chicago: Porch repair order (fixture)', 'civic', 'https://data.cityofchicago.org/d/22u3-xenr', 5.5, 250, 100, ['general-contractor']],
  ['311 request in Chicago: Graffiti Removal Request (fixture)', 'civic', 'https://data.cityofchicago.org/d/v6vf-nfxy', 3.1, 10, 3, ['painting']],
  ['311 request in Chicago: Rodent Baiting/Rat Complaint (fixture)', 'civic', 'https://data.cityofchicago.org/d/v6vf-nfxy', 2.2, 270, 5, ['pest-control']],
  // Left out by the rules: too far, too old, an ask, a resident request, no trade.
  ['Electrical permit in Evanston (fixture)', 'permit', 'https://data.cityofchicago.org/d/ydr8-5enu', 7.5, 0, 6, ['electrical']],
  ['Sign permit in Chicago (fixture)', 'permit', 'https://data.cityofchicago.org/d/ydr8-5enu', 2.0, 90, 24 * 9, ['signs-printing']],
  ['Anyone know a roofer? (fixture)', 'ask', 'https://example.com/post', 1.5, 45, 2, ['roofing']],
  ['311 request in Chicago: Pothole in Street Complaint (fixture)', 'civic', 'https://data.cityofchicago.org/d/v6vf-nfxy', 3.0, 140, 4, []],
];

function offset(lat: number, lon: number, mi: number, deg: number): { lat: number; lon: number } {
  const R = 3958.7613;
  const d = mi / R;
  const b = (deg * Math.PI) / 180;
  const p1 = (lat * Math.PI) / 180;
  const l1 = (lon * Math.PI) / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: (p2 * 180) / Math.PI, lon: (l2 * 180) / Math.PI };
}

/** Fixture rows in the database's shape, dated relative to `now`. They go through the real picking code. */
export function fixtureMapRows(now: Date): MapRow[] {
  const c = lookupZip(MAP_ZIP)!;
  return FIXTURE_NEAR.map(([title, kind, url, mi, deg, hoursAgo, categories], i) => {
    const p = offset(c.lat, c.lon, mi, deg);
    return {
      id: `fixture-${i + 1}`,
      source: kind === 'ask' ? 'bluesky' : 'fixture',
      kind,
      title,
      url,
      city: 'Chicago',
      state: 'IL',
      lat: p.lat,
      lon: p.lon,
      categories,
      occurred_at: new Date(now.getTime() - hoursAgo * 3_600_000).toISOString(),
      expires_at: null,
    };
  });
}

export function homeLivePreviewFixture(now: Date = new Date()): HomeLive {
  const c = lookupZip(MAP_ZIP)!;
  return {
    proof: { total7: 12840, feeds: feedCount(ALL_ADAPTERS, process.env), asOf: now.toISOString() },
    map: homeMapFrom(pickMapRecords(fixtureMapRows(now), c, now.getTime()), 'Chicago'),
    weather: {
      title: '1.00 inch hail reported near Hollywood, FL (fixture)',
      occurredAt: new Date(now.getTime() - 10 * 3_600_000).toISOString(),
      mi: null,
    },
  };
}

/** What the home page renders. Fixture only behind the local guard; otherwise real data, with each part null when unknown. */
/** The fixture, read through a cache like the real loaders (a prerendered page may not read the clock outside one). */
async function loadPreviewFixture(): Promise<HomeLive> {
  'use cache';
  cacheLife({ stale: 60, revalidate: 60, expire: 300 });
  return homeLivePreviewFixture();
}

export async function loadHomeLive(env: Record<string, string | undefined> = process.env): Promise<HomeLive> {
  if (previewFixturesEnabled(env)) return loadPreviewFixture();
  const [stats, map, weather] = await Promise.all([loadNationalStats(), loadHomeMap(), loadWeatherExample()]);
  return { proof: proofFrom(stats, feedCount(ALL_ADAPTERS, env)), map, weather };
}
