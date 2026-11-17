import { CITIES, haversineMi, nearestCity, type City } from '@/lib/geo';

export const NEARBY_MILES = 40;

export interface CheckScope {
  /** Nearest city slug within 40 mi, or null when the ZIP is far from every tracked city. */
  citySlug: string | null;
  /** Two-letter state code used for state-level signals. */
  state: string;
}

/**
 * Cache scope for a ZIP. The cached query is keyed on this, never on the raw ZIP:
 * every ZIP that resolves to the same city shares one entry.
 */
export function deriveScope(zip: { lat: number; lon: number; state: string }): CheckScope {
  const city = nearestCity(zip.lat, zip.lon, NEARBY_MILES);
  return city ? { citySlug: city.slug, state: city.state } : { citySlug: null, state: zip.state.toUpperCase() };
}

/** Stable string form of the cache key (before the trade is added). */
export function scopeKey(scope: CheckScope, trade: string): string {
  return `${scope.citySlug ?? `state:${scope.state}`}|${trade}`;
}

/** Slugs of the city itself plus tracked cities within `miles` of it. */
export function nearbySlugs(city: City, miles = NEARBY_MILES): string[] {
  const out = [city.slug];
  for (const c of CITIES) {
    if (c.slug === city.slug) continue;
    if (Math.abs(c.lat - city.lat) > miles / 69 + 0.01) continue;
    if (haversineMi(city.lat, city.lon, c.lat, c.lon) <= miles) out.push(c.slug);
  }
  return out;
}
