/**
 * The 10 largest US metros Holler is going deep in. Pure and client-safe: it imports nothing (lib/geo/index.ts pulls in the ZIP dataset), so
 * the slugs and centers are written out here and tests/geo/metros.test.ts checks them against CITIES. `center` is the core city's coordinates from lib/geo CITIES;
 * `radiusMi` is the circle a record's coordinates must fall in to count for the metro; `cities` are the core city slugs (they must exist in
 * CITIES, tests/geo/metros.test.ts), used to place a record that has no coordinates by its city and state.
 * scripts/metro-scorecard.sql inlines the same ids, states, centers and radii (a test keeps them equal).
 */
export interface Metro {
  id: string;
  label: string;
  /** 2-letter codes of the states the metro spans */
  states: readonly string[];
  /** core city slugs (lib/geo CITIES) */
  cities: readonly string[];
  /** extra core city names with no CITIES entry of their own (how a source spells a borough), used only for records without coordinates; they belong to states[0] */
  cityNames?: readonly string[];
  center: { lat: number; lon: number };
  radiusMi: number;
}

export const METROS: readonly Metro[] = [
  {
    id: 'new-york',
    label: 'New York',
    states: ['NY', 'NJ'],
    cities: ['new-york-city-ny', 'brooklyn-ny', 'manhattan-ny', 'queens-ny', 'the-bronx-ny', 'staten-island-ny', 'newark-nj', 'jersey-city-nj'],
    cityNames: ['Bronx', 'New York'],
    center: { lat: 40.7143, lon: -74.006 },
    radiusMi: 35,
  },
  {
    id: 'los-angeles',
    label: 'Los Angeles',
    states: ['CA'],
    cities: ['los-angeles-ca', 'long-beach-ca', 'anaheim-ca', 'santa-ana-ca'],
    center: { lat: 34.0522, lon: -118.2437 },
    radiusMi: 45,
  },
  {
    id: 'chicago',
    label: 'Chicago',
    states: ['IL'],
    cities: ['chicago-il', 'aurora-il', 'naperville-il'],
    center: { lat: 41.85, lon: -87.65 },
    radiusMi: 40,
  },
  {
    id: 'dallas-fort-worth',
    label: 'Dallas–Fort Worth',
    states: ['TX'],
    cities: ['dallas-tx', 'fort-worth-tx', 'arlington-tx', 'plano-tx', 'irving-tx'],
    center: { lat: 32.7831, lon: -96.8067 },
    radiusMi: 40,
  },
  {
    id: 'houston',
    label: 'Houston',
    states: ['TX'],
    cities: ['houston-tx', 'pasadena-tx', 'sugar-land-tx'],
    center: { lat: 29.7633, lon: -95.3633 },
    radiusMi: 40,
  },
  {
    id: 'atlanta',
    label: 'Atlanta',
    states: ['GA'],
    cities: ['atlanta-ga', 'marietta-ga', 'sandy-springs-ga', 'roswell-ga', 'smyrna-ga'],
    center: { lat: 33.749, lon: -84.388 },
    radiusMi: 40,
  },
  {
    id: 'washington-dc',
    label: 'Washington, DC',
    states: ['DC', 'MD', 'VA'],
    cities: ['washington-dc', 'arlington-va', 'alexandria-va', 'silver-spring-md'],
    center: { lat: 38.8951, lon: -77.0364 },
    radiusMi: 30,
  },
  {
    id: 'philadelphia',
    label: 'Philadelphia',
    states: ['PA', 'NJ', 'DE'],
    cities: ['philadelphia-pa', 'camden-nj', 'wilmington-de'],
    center: { lat: 39.9523, lon: -75.1638 },
    radiusMi: 40,
  },
  {
    id: 'miami',
    label: 'Miami',
    states: ['FL'],
    cities: ['miami-fl', 'miami-beach-fl', 'hialeah-fl', 'fort-lauderdale-fl'],
    center: { lat: 25.7743, lon: -80.1937 },
    radiusMi: 40,
  },
  {
    id: 'phoenix',
    label: 'Phoenix',
    states: ['AZ'],
    cities: ['phoenix-az', 'tempe-az', 'mesa-az', 'scottsdale-az', 'chandler-az', 'glendale-az'],
    center: { lat: 33.4484, lon: -112.074 },
    radiusMi: 40,
  },
];

const EARTH_RADIUS_MI = 3958.76;

/** Great-circle distance in miles (the same formula as lib/geo haversineMi). */
function haversineMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Metro id whose center is within its radius of the point (the nearest center wins when circles overlap), else null.
 * When `state` is passed (2-letter code, any case) the metro must also span that state, the rule scripts/metro-scorecard.sql applies:
 * Stamford CT or Gary IN fall inside a circle but in no metro state, so they are null. A null or empty state passed explicitly matches nothing.
 */
export function metroFor(lat: number, lon: number, state?: string | null): string | null {
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best: string | null = null;
  let bestD = Infinity;
  const st = state === undefined ? undefined : (state ?? '').trim().toUpperCase();
  for (const m of METROS) {
    if (st !== undefined && !m.states.includes(st)) continue;
    const d = haversineMi(m.center.lat, m.center.lon, lat, lon);
    if (d <= m.radiusMi && d < bestD) {
      best = m.id;
      bestD = d;
    }
  }
  return best;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Metro id for a record without coordinates: its city (any spelling slugify maps to a core city slug) and 2-letter state (any case), else null.
 * A core city only counts in its own state: ('New York','NJ') is null. A cityNames entry belongs to the metro's first state (the SQL binds
 * it the same way). scripts/metro-scorecard.sql applies the same rule.
 */
export function metroForCityState(city: string | null | undefined, state: string | null | undefined): string | null {
  if (!city || !state) return null;
  const citySlug = slugify(city);
  const st = state.trim().toUpperCase();
  const slug = `${citySlug}-${st.toLowerCase()}`;
  for (const m of METROS) {
    if (m.cities.includes(slug)) return m.id;
    if (st === m.states[0] && m.cityNames?.some((n) => slugify(n) === citySlug)) return m.id;
  }
  return null;
}
