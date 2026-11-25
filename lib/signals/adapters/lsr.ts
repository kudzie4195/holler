import { HOLLER_UA } from '@/lib/user-agent';
import type { CategoryId } from '../categories';
import type { Adapter, AdapterContext, Severity, SignalInput } from '../types';
import { WIND_CATS } from './spc';
import { LSR_DAMAGE_PART, LSR_TREE_PART, lsrFactsOf, lsrSummaryOf } from './lsr-parts';

/**
 * Round 33 (HAIL): National Weather Service Local Storm Reports (LSRs), the reports SPC's preliminary storm reports do NOT carry.
 *
 * Feed: the Iowa Environmental Mesonet (Iowa State University) LSR GeoJSON, https://mesonet.agron.iastate.edu/geojson/lsr.geojson with
 * wfos=<comma list>&sts=<ISO UTC>&ets=<ISO UTC> (checked 2026-11-25: wfos=FFC with a two-day window answered 8 features; wfos=FFC,RAH answered
 * both offices). IEM robots.txt disallows only /usage/, /tmp/, /archive/nexrad/ and /archive/raw/, so /geojson/ may be read. No key, no account.
 * The reports themselves are NWS public products. Feature properties (real capture, tests/fixtures/lsr/): wfo, type (one letter), typetext
 * ("NON-TSTM WND DMG", "TSTM WND GST", "HAIL" ...), magnitude (text), unit, magf, qualifier, county, state, st, city ("1 W CHOKIO"), remark,
 * source (reporter kind), valid (UTC), lat, lon, product_id.
 *
 * Why only the non-thunderstorm wind types: SPC's preliminary reports (adapters/spc.ts) are compiled from these same LSRs for hail,
 * thunderstorm wind damage, thunderstorm gusts and tornadoes, so storing them again here would send every such report twice. The types SPC
 * never lists are the wind damage and gusts NOT caused by a thunderstorm (winter storms, ice, strong gradient wind), which is where many
 * "tree down" reports come from. LSR_TYPES below lists every type and says why it is or is not kept; changing `keep` is a one-line change.
 *
 * Privacy: the remark is free text and can name a street or a person, so it is NEVER stored. It is read in memory only, word by word
 * (lsr-parts.ts lsrFactsOf: trees, power lines, road, roof or siding, shingles or gutters, home, yard, building), stored as flags
 * (data.treeDown, powerLines, blocksRoad, roofNamed, onStructure, homeOrYard) and written back as fixed phrases (lsrSummaryOf) from which the
 * wind damage rule reads the label an SPC report with the same words gets (reviews 1 P1-3 and 2 P2-2, P2-3). The place must look like "N DIR PLACE" or a plain place name, else the county
 * is used (review P2-4). The point is rounded to 3 decimals (about a city block); LSR points are usually given to 2 decimals.
 *
 * Behind HOLLER_LSR_ENABLED (default off): the scan skips the adapter while it is off (no request at all).
 */
export const LSR_FLAG = 'HOLLER_LSR_ENABLED';

export function lsrEnabled(value: string | undefined = typeof process !== 'undefined' ? process.env?.HOLLER_LSR_ENABLED : undefined): boolean {
  return typeof value === 'string' && /^(?:1|true|on|yes)$/i.test(value.trim());
}

export const LSR_BASE = 'https://mesonet.agron.iastate.edu/geojson/lsr.geojson';
/** Public page of one LSR product on IEM (the "public source" link). */
export const LSR_PRODUCT_PAGE = 'https://mesonet.agron.iastate.edu/p.php?pid=';

/**
 * Weather forecast offices read: the four launch metros (Atlanta FFC, Austin EWX, Charlotte GSP, Raleigh RAH) and the three other replay
 * metros (New York OKX, Chicago LOT, Los Angeles LOX). One request names them all.
 */
export const LSR_WFOS: readonly string[] = ['FFC', 'EWX', 'GSP', 'RAH', 'OKX', 'LOT', 'LOX'];

/** How far back each run reads (the reports of a day keep arriving for hours; the store keeps one row per report). */
export const LSR_LOOKBACK_HOURS = 36;

/**
 * Review 2 P2-1: quiet weather is normal. The live feed for these seven offices had reports on only three bursts of days in a two-week
 * window, so an answer with 0 features is a healthy run: nothing is logged and the source is never marked unavailable for it. The only
 * check: once a day (the run in hour LSR_WEEK_PROBE_UTC_HOUR), when the normal answer is empty, one more request reads the last 7 days.
 * If that is empty too (no report of any kind, snow, rain, wind or hail, from seven offices for a week), the request format has most
 * likely stopped working, and that one run logs LSR_EMPTY_WEEK_LOG as an error (the monitor's scan_error email names it the same hour).
 */
export const LSR_WEEK_PROBE_UTC_HOUR = 12;
export const LSR_WEEK_HOURS = 7 * 24;
export const LSR_EMPTY_WEEK_LOG = `error: lsr returned 0 reports of any kind from ${LSR_WFOS.length} NWS offices for 7 days; the request format may no longer work (check one busy day by hand)`;

export const LSR_TYPES: ReadonlyArray<{ typetext: string; keep: boolean; kind: 'damage' | 'gust' | 'other'; why: string }> = [
  { typetext: 'NON-TSTM WND DMG', keep: true, kind: 'damage', why: 'Wind damage not from a thunderstorm (tree and limb reports in winter and gradient wind); SPC never lists it.' },
  { typetext: 'NON-TSTM WND GST', keep: true, kind: 'gust', why: 'A measured gust not from a thunderstorm; SPC never lists it. Kept from 50 mph, like SPC gusts.' },
  { typetext: 'HAIL', keep: false, kind: 'other', why: 'Already stored from SPC (spc.ts), which is built from these LSRs: keeping it would send the report twice.' },
  { typetext: 'TSTM WND DMG', keep: false, kind: 'other', why: 'Already stored from SPC: a second copy would be a duplicate card.' },
  { typetext: 'TSTM WND GST', keep: false, kind: 'other', why: 'Already stored from SPC: a second copy would be a duplicate card.' },
  { typetext: 'TORNADO', keep: false, kind: 'other', why: 'Already stored from SPC.' },
  { typetext: 'SNOW/ICE DMG', keep: false, kind: 'other', why: 'Not wind: it needs its own title and card wording (ice on limbs), a later round.' },
];

/** Gusts below this are not kept (the SPC adapter's floor). */
export const LSR_MIN_GUST_MPH = 50;

/** Summary parts Holler writes (fixed words, translated in lib/signals/summary-i18n.ts). The remark itself is never stored. */
export { LSR_DAMAGE_PART, LSR_TREE_PART, lsrFactsOf, lsrSummaryOf };

const TREE_RE = /\btrees?\b|\blimbs?\b|\bbranch(?:es)?\b|uproot|snapped/i;

/** Does a remark name trees or limbs? Read in memory only. */
export function remarkNamesTrees(remark: string | null | undefined): boolean {
  return typeof remark === 'string' && TREE_RE.test(remark);
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

/**
 * "1 W CHOKIO" gives "Chokio" (the place; the distance and bearing are dropped, as SPC's placeName does). Anything that is not a plain place
 * name (digits, an "@", more than 40 characters, odd punctuation) gives null, so a free-text location never reaches a title.
 */
export function lsrPlace(city: string | null | undefined): string | null {
  const c = (city ?? '').replace(/^\d+(?:\.\d+)?\s+[NSEW]{1,3}\s+/i, '').trim();
  if (!c || c.length > 40 || !/^[a-z][a-z .'-]*$/i.test(c)) return null;
  return titleCase(c);
}

/** A gust magnitude in mph from the feature's magnitude and unit (review P2-4). Knots are converted; an unknown unit gives null. */
export function lsrGustMph(magnitude: unknown, unit: unknown): number | null {
  const n = parseFloat(str(magnitude));
  if (!Number.isFinite(n)) return null;
  const u = str(unit).toUpperCase();
  if (!u || u === 'MPH') return Math.round(n);
  if (u === 'KT' || u === 'KTS' || u === 'KNOTS' || u === 'KNOT') return Math.round(n * 1.15078);
  return null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
}

export interface LsrScan {
  signals: SignalInput[];
  rows: number;
  usable: number;
}

export function scanLsr(raw: unknown): LsrScan {
  const features = (raw as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) return { signals: [], rows: 0, usable: 0 };
  const out: LsrScan = { signals: [], rows: features.length, usable: 0 };
  const seen = new Set<string>();
  for (const f of features) {
    const p = (f as { properties?: Record<string, unknown> } | null)?.properties;
    if (!p) continue;
    const typetext = str(p.typetext).toUpperCase();
    const lat = typeof p.lat === 'number' ? p.lat : Number(p.lat);
    const lon = typeof p.lon === 'number' ? p.lon : Number(p.lon);
    const valid = Date.parse(str(p.valid));
    if (!typetext || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !Number.isFinite(valid)) continue;
    out.usable++;
    const type = LSR_TYPES.find((t) => t.typetext === typetext);
    if (!type || !type.keep) continue;
    const state = str(p.state || p.st).toUpperCase() || null;
    const county = str(p.county) ? titleCase(str(p.county)) : null;
    const city = lsrPlace(str(p.city));
    const where = [city ?? county, state].filter(Boolean).join(', ');
    if (!city && !county) continue;
    if (!where) continue;
    const remark = str(p.remark);
    const occurredAt = new Date(valid).toISOString();
    const la = Math.round(lat * 1000) / 1000;
    const lo = Math.round(lon * 1000) / 1000;
    const data: Record<string, unknown> = { type: 'wind', lsrType: typetext, wfo: str(p.wfo) || null };
    const productId = str(p.product_id);
    if (productId) data.productId = productId;
    let title: string;
    let summary: string | null = null;
    let severity: Severity;
    if (type.kind === 'gust') {
      const mph = lsrGustMph(p.magnitude, p.unit);
      if (mph === null || mph < LSR_MIN_GUST_MPH || mph > 250) continue;
      title = `${mph} mph wind gust reported near ${where}`;
      severity = mph >= 75 ? 3 : mph >= 58 ? 2 : 1;
      data.windMph = mph;
      data.windDamage = false;
    } else {
      // A non-thunderstorm wind damage report: the type itself says damage. The flags say what the remark names; the remark is not kept.
      const f = lsrFactsOf(remark);
      title = `Wind damage reported near ${where}`;
      summary = lsrSummaryOf(f);
      severity = 2;
      data.windDamage = true;
      data.treeDown = f.trees;
      data.powerLines = f.powerLines;
      data.blocksRoad = f.road;
      data.treeOnRoad = f.roadTree;
      data.roofNamed = f.roofOrSiding || f.shinglesOrGutters;
      data.onStructure = f.roofOrSiding || f.home || f.building;
      data.homeOrYard = f.home || f.yard;
    }
    // One row per report: the same report is often repeated in a later summary product, so the id leaves the product out.
    const externalId = `${typetext}:${occurredAt}:${la.toFixed(2)}:${lo.toFixed(2)}:${str(p.magnitude)}`;
    if (seen.has(externalId)) continue;
    seen.add(externalId);
    const categories: CategoryId[] = [...WIND_CATS];
    out.signals.push({
      source: 'lsr',
      externalId,
      kind: 'report',
      title,
      summary,
      url: productId ? `${LSR_PRODUCT_PAGE}${encodeURIComponent(productId)}` : null,
      lat: la,
      lon: lo,
      city,
      state,
      county,
      categories,
      severity,
      occurredAt,
      data,
    });
  }
  return out;
}

export function parseLsr(raw: unknown): SignalInput[] {
  return scanLsr(raw).signals;
}

/** "2026-11-25T06:00Z": the time format the IEM endpoint was checked with. */
function iemTime(d: Date): string {
  return `${d.toISOString().slice(0, 16)}Z`;
}

export function lsrUrl(now: Date, wfos: readonly string[] = LSR_WFOS, hours = LSR_LOOKBACK_HOURS): string {
  const sts = iemTime(new Date(now.getTime() - hours * 3600_000));
  return `${LSR_BASE}?wfos=${wfos.join(',')}&sts=${sts}&ets=${iemTime(now)}`;
}

export const lsrAdapter: Adapter = {
  id: 'lsr',
  label: 'NWS local storm reports',
  kind: 'report',
  cadenceMinutes: 60,
  sourceUrl: 'https://mesonet.agron.iastate.edu/lsr/',
  enabled: () => lsrEnabled(),
  flag: LSR_FLAG,
  async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
    if (!lsrEnabled(ctx.env[LSR_FLAG] ?? process.env[LSR_FLAG])) return [];
    try {
      const res = await ctx.fetch(lsrUrl(ctx.now ?? new Date()), { headers: { 'User-Agent': HOLLER_UA, Accept: 'application/geo+json, application/json' }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(/^\s*</.test(text) ? 'expected GeoJSON but received an HTML page' : 'expected GeoJSON but received non-JSON text');
      }
      const scan = scanLsr(json);
      if (!Array.isArray((json as { features?: unknown } | null)?.features)) ctx.log('error: lsr response has no features array, wrapper may have changed');
      else if (scan.rows === 0) {
        const now = ctx.now ?? new Date();
        if (now.getUTCHours() === LSR_WEEK_PROBE_UTC_HOUR) {
          const week = await ctx.fetch(lsrUrl(now, LSR_WFOS, LSR_WEEK_HOURS), { headers: { 'User-Agent': HOLLER_UA, Accept: 'application/geo+json, application/json' }, signal: AbortSignal.timeout(20000) });
          const body = week.ok ? ((JSON.parse(await week.text()) as { features?: unknown[] } | null)?.features ?? null) : null;
          if (Array.isArray(body) && body.length === 0) ctx.log(LSR_EMPTY_WEEK_LOG);
        }
      }
      else if (scan.rows > 0 && scan.usable === 0) ctx.log(`error: lsr parsed 0 of ${scan.rows} rows, shape may have changed`);
      return scan.signals;
    } catch (e) {
      ctx.log(`error: lsr fetch failed: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  },
};

export const adapters: Adapter[] = [lsrAdapter];
