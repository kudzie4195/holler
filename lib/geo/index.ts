import zipcodes from 'zipcodes';
import citiesJson from './cities.json';

export interface City {
  slug: string;
  name: string;
  state: string; // 2-letter code
  stateName: string;
  lat: number;
  lon: number;
  population: number;
}

export interface StateInfo {
  code: string;
  name: string;
  slug: string;
}

export interface ZipInfo {
  zip: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
}

const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

export const STATES: StateInfo[] = Object.entries(STATE_NAMES)
  .map(([code, name]) => ({ code, name, slug: name.toLowerCase().replace(/\s+/g, '-') }))
  .sort((a, b) => a.name.localeCompare(b.name));

const stateBySlugMap = new Map(STATES.map((s) => [s.slug, s]));
const stateByCodeMap = new Map(STATES.map((s) => [s.code, s]));

/** Cities sorted by population, biggest first (sorted once at generation time). */
export const CITIES: City[] = citiesJson as City[];

const citySlugMap = new Map(CITIES.map((c) => [c.slug, c]));
const citiesByStateMap = new Map<string, City[]>();
for (const c of CITIES) {
  const list = citiesByStateMap.get(c.state);
  if (list) list.push(c);
  else citiesByStateMap.set(c.state, [c]);
}

export function cityBySlug(slug: string): City | undefined {
  return citySlugMap.get(slug);
}

/** Cities in a state (2-letter code), biggest first. */
export function citiesInState(code: string): City[] {
  return citiesByStateMap.get(code.toUpperCase()) ?? [];
}

export function stateBySlug(slug: string): StateInfo | undefined {
  return stateBySlugMap.get(slug);
}

export function stateByCode(code: string): StateInfo | undefined {
  return stateByCodeMap.get(code.toUpperCase());
}

export function stateSlugFor(code: string): string | undefined {
  return stateByCodeMap.get(code.toUpperCase())?.slug;
}

/** Public URL path for a city page, e.g. /local/georgia/atlanta-ga */
export function cityPath(city: Pick<City, 'slug' | 'state'>): string {
  return `/local/${stateSlugFor(city.state) ?? 'unknown'}/${city.slug}`;
}

const EARTH_RADIUS_MI = 3958.7613;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Nearest city within maxMi miles, or null. Single linear pass, no sorting. */
export function nearestCity(lat: number, lon: number, maxMi = 40): City | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // Cheap latitude prefilter: 1 degree of latitude is about 69 miles.
  const latWindow = maxMi / 69 + 0.01;
  let best: City | null = null;
  let bestD = Infinity;
  for (const c of CITIES) {
    if (Math.abs(c.lat - lat) > latWindow) continue;
    const d = haversineMi(lat, lon, c.lat, c.lon);
    if (d <= maxMi && d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

const nearbyCache = new Map<string, City[]>();

/** The n nearest other cities to a city (internal linking). Cached per slug. */
export function nearbyCities(slug: string, n = 6): City[] {
  const key = `${slug}:${n}`;
  const hit = nearbyCache.get(key);
  if (hit) return hit;
  const origin = citySlugMap.get(slug);
  if (!origin) return [];
  const result = CITIES.filter((c) => c.slug !== slug)
    .map((c) => ({ c, d: haversineMi(origin.lat, origin.lon, c.lat, c.lon) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((x) => x.c);
  nearbyCache.set(key, result);
  return result;
}

/** ZIP to place. Server-side only (the zipcodes dataset is large). */
export function lookupZip(zip: string): ZipInfo | null {
  const z = String(zip ?? '').trim().slice(0, 5);
  if (!/^\d{5}$/.test(z)) return null;
  const rec = zipcodes.lookup(z);
  if (!rec || typeof rec.latitude !== 'number' || typeof rec.longitude !== 'number') return null;
  return { zip: rec.zip, city: rec.city, state: rec.state, lat: rec.latitude, lon: rec.longitude };
}
