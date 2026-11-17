/** Extra service areas, stored in holler_profiles.extra_areas (jsonb array, migration 0004). Pure. */
export interface ExtraArea {
  zip: string;
  city: string | null;
  state: string | null;
  lat: number;
  lon: number;
}

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Reads extra_areas as stored. Anything that is not an array of {zip, lat, lon} objects is dropped, never trusted,
 * so a hand-edited or half-written row can never break matching.
 */
export function parseExtraAreas(raw: unknown): ExtraArea[] {
  if (!Array.isArray(raw)) return [];
  const out: ExtraArea[] = [];
  for (const a of raw) {
    if (!a || typeof a !== 'object' || Array.isArray(a)) continue;
    const r = a as Record<string, unknown>;
    if (typeof r.zip !== 'string' || !/^\d{5}$/.test(r.zip)) continue;
    if (!finite(r.lat) || !finite(r.lon) || Math.abs(r.lat) > 90 || Math.abs(r.lon) > 180) continue;
    out.push({
      zip: r.zip,
      city: typeof r.city === 'string' ? r.city : null,
      state: typeof r.state === 'string' ? r.state : null,
      lat: r.lat,
      lon: r.lon,
    });
  }
  return out;
}

/** Limits for a stored extra area. Migration 0004 (trigger holler_profiles_plan_limits) applies the same rules. */
export const EXTRA_AREA_KEYS = ['city', 'lat', 'lon', 'state', 'zip'] as const;
export const EXTRA_AREA_CITY_MAX = 80;
/** Bytes of the whole extra_areas value as JSON text. Two real areas take about 200. */
export const EXTRA_AREAS_MAX_BYTES = 1000;

/**
 * True when a value may be written to holler_profiles.extra_areas: an array of at most `max` objects, each with exactly the keys
 * zip (5 digits), city (a string of at most 80 characters), state (2 letters), lat (-90 to 90) and lon (-180 to 180), and at most
 * 1000 bytes in all. Stricter than parseExtraAreas, which only has to read safely.
 */
export function storableExtraAreas(raw: unknown, max = 2): boolean {
  if (!Array.isArray(raw) || raw.length > max) return false;
  if (new TextEncoder().encode(JSON.stringify(raw)).length > EXTRA_AREAS_MAX_BYTES) return false;
  return raw.every((a) => {
    if (!a || typeof a !== 'object' || Array.isArray(a)) return false;
    const r = a as Record<string, unknown>;
    const keys = Object.keys(r).sort();
    if (keys.length !== EXTRA_AREA_KEYS.length || keys.some((k, i) => k !== EXTRA_AREA_KEYS[i])) return false;
    return (
      typeof r.zip === 'string' &&
      /^\d{5}$/.test(r.zip) &&
      typeof r.city === 'string' &&
      r.city.length <= EXTRA_AREA_CITY_MAX &&
      typeof r.state === 'string' &&
      /^[A-Za-z]{2}$/.test(r.state) &&
      finite(r.lat) &&
      finite(r.lon) &&
      r.lat >= -90 &&
      r.lat <= 90 &&
      r.lon >= -180 &&
      r.lon <= 180
    );
  });
}
