import { STATES } from '@/lib/geo';
import type { CategoryId } from '../categories';
import type { Adapter, AdapterContext, Severity, SignalInput } from '../types';

/**
 * USGS earthquake GeoJSON summary feed, M2.5+ past day.
 * Feed: https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson. Confirmed 2026-11-17 by a live WebFetch and by the
 * feed docs (earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php): FeatureCollection { metadata{generated,url,title,status,api,count}, bbox,
 * features[] }. Feature: { type, id ("hv75071182"), geometry{type:Point, coordinates:[lon, lat, depthKm]},
 * properties{mag, place, time (epoch ms), url, sig, tsunami, alert (null), status, type, ...} }.
 * Live rows can carry mag slightly below 2.5 (e.g. 2.46, the feed rounds); those are dropped by MIN_MAG on purpose.
 */
export const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson';
const MIN_MAG = 2.5;

const CODES = new Set(STATES.map((s) => s.code));
const BY_NAME = new Map(STATES.map((s) => [s.name.toLowerCase(), s.code]));

/** USGS place strings end with a state: "10 km SW of Ridgecrest, CA" or "...of Sand Point, Alaska". */
export function stateFromPlace(place: string): string | null {
  const tail = place.split(',').pop()?.trim() ?? '';
  if (/^[A-Z]{2}$/.test(tail) && CODES.has(tail)) return tail;
  const byName = BY_NAME.get(tail.toLowerCase());
  if (byName) return byName;
  // Offshore or region-only strings, e.g. "Alaska", "Oklahoma".
  const lower = place.trim().toLowerCase();
  for (const [name, code] of BY_NAME) if (lower === name || lower.endsWith(` ${name}`)) return code;
  return null;
}

export const QUAKE_TRADES: CategoryId[] = ['general-contractor', 'restoration', 'insurance', 'plumbing', 'electrical'];

export function parseUsgs(raw: unknown): SignalInput[] {
  const features = (raw as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const out: SignalInput[] = [];
  for (const f of features) {
    const feat = f as { id?: string; geometry?: { coordinates?: number[] }; properties?: Record<string, unknown> };
    const p = feat?.properties;
    const c = feat?.geometry?.coordinates;
    if (!p || !c || typeof feat.id !== 'string') continue;
    const mag = typeof p.mag === 'number' ? p.mag : NaN;
    const place = typeof p.place === 'string' ? p.place : '';
    const time = typeof p.time === 'number' ? p.time : NaN;
    if (!Number.isFinite(mag) || mag < MIN_MAG || !Number.isFinite(time)) continue;
    const [lon, lat, depth] = c;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const state = stateFromPlace(place);
    if (!state) continue; // US only
    const severity: Severity = mag >= 5 ? 3 : mag >= 4 ? 2 : 1;
    out.push({
      source: 'usgs',
      externalId: feat.id,
      kind: 'quake',
      title: `M${mag.toFixed(1)} earthquake ${place}`.trim(),
      summary: `Magnitude ${mag.toFixed(1)} earthquake ${place}${Number.isFinite(depth) ? `, depth ${Math.round(depth)} km` : ''}.`,
      url: typeof p.url === 'string' ? p.url : `https://earthquake.usgs.gov/earthquakes/eventpage/${feat.id}`,
      lat,
      lon,
      state,
      categories: mag >= 4 ? QUAKE_TRADES : [],
      severity,
      occurredAt: new Date(time).toISOString(),
      data: { mag, depthKm: depth ?? null, place, sig: p.sig ?? null, tsunami: p.tsunami ?? null, alert: p.alert ?? null },
    });
  }
  return out;
}

/** Structural counts for the silent-empty check. Non-US quakes are dropped on purpose and do not count as parse failures. */
export function usgsRowStats(raw: unknown): { rows: number; usable: number } | null {
  const features = (raw as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) return null;
  let usable = 0;
  for (const f of features) {
    const feat = f as { id?: unknown; geometry?: { coordinates?: unknown }; properties?: Record<string, unknown> } | null;
    const p = feat?.properties;
    if (p && typeof p.mag === 'number' && typeof p.time === 'number' && Array.isArray(feat?.geometry?.coordinates) && typeof feat?.id === 'string') usable++;
  }
  return { rows: features.length, usable };
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(/^\s*</.test(text) ? 'expected JSON but received an HTML page' : 'expected JSON but received non-JSON text');
  }
}

export const usgsAdapter: Adapter = {
  id: 'usgs',
  label: 'USGS earthquakes',
  kind: 'quake',
  cadenceMinutes: 30,
  sourceUrl: 'https://earthquake.usgs.gov/earthquakes/map/',
  async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
    try {
      const res = await ctx.fetch(USGS_URL, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await readJson(res);
      const stats = usgsRowStats(json);
      if (!stats) {
        const keys = json && typeof json === 'object' ? Object.keys(json as object).slice(0, 8).join(',') : typeof json;
        ctx.log(`error: usgs response has no features array, wrapper may have changed (top-level keys: ${keys})`);
        return [];
      }
      const out = parseUsgs(json);
      if (stats.rows > 0 && stats.usable === 0) ctx.log(`error: parsed 0 of ${stats.rows} rows, shape may have changed`);
      return out;
    } catch (e) {
      ctx.log(`error: usgs fetch failed: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  },
};

export const adapters: Adapter[] = [usgsAdapter];
