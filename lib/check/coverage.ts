import { CHECK_RADIUS_MI, UNCOVERED_STATE_CODES } from '@/lib/check/scope';
import { cityBySlug, haversineMi, stateByCode } from '@/lib/geo';
import { enabledDatasets } from '@/lib/signals/capabilities';

/**
 * "Does Holler serve this ZIP yet?" for the area check and its waitlist card.
 *
 * Holler serves a ZIP when it is in a state Holler reads (not a territory or military mail code) AND at least one enabled local feed
 * (a verified Socrata or ArcGIS dataset: permits, 311, inspections, business licences, violations, event permits) has its centre
 * within CHECK_RADIUS_MI (25 miles, the default subscriber radius) of the ZIP. National hazard feeds (weather, storm reports) reach
 * every ZIP and are NOT counted: a ZIP with only those has no local source, and the card says so in those words.
 * Airport status alone is not counted either: it is not a record a trade can act on.
 *
 * Why not CITY_FEEDS[nearestCity(...)]: nearestCity returns the closest place in the city table, which is often a neighbourhood
 * (60614 gives lincoln-park-il, not chicago-il), and CITY_FEEDS is keyed by the feed's own city. This helper measures to each
 * dataset's own centre instead. Each dataset's centre is, in order: its county anchor, the city table entry for its city and state,
 * its fallback centre. A dataset with none of the three is skipped (tests/waitlist/coverage.test.ts lists none today).
 */
export const LOCAL_COVERAGE_RADIUS_MI = CHECK_RADIUS_MI;

export interface SourceCentre {
  id: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

let cache: SourceCentre[] | null = null;
let skipped: string[] = [];

function build(): SourceCentre[] {
  const out: SourceCentre[] = [];
  const skip: string[] = [];
  for (const ds of enabledDatasets()) {
    const centre =
      ds.countyAnchor ??
      cityBySlug(`${slugify(ds.city)}-${ds.state.toLowerCase()}`) ??
      ds.fallbackCenter ??
      null;
    if (!centre) {
      skip.push(ds.id);
      continue;
    }
    out.push({ id: ds.id, city: ds.city, state: ds.state, lat: centre.lat, lon: centre.lon });
  }
  skipped = skip;
  return out;
}

/** Centre of every enabled local feed, memoised. */
export function localSourceCentres(): readonly SourceCentre[] {
  return (cache ??= build());
}

/** Ids of enabled datasets whose centre could not be resolved (they count for nothing here). Used by tests. */
export function unresolvedSources(): readonly string[] {
  localSourceCentres();
  return skipped;
}

/** Enabled local feeds whose centre is within `maxMi` of the point, nearest first. */
export function localSourcesNear(lat: number, lon: number, maxMi: number = LOCAL_COVERAGE_RADIUS_MI): SourceCentre[] {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  return localSourceCentres()
    .map((c) => ({ c, d: haversineMi(lat, lon, c.lat, c.lon) }))
    .filter((x) => x.d <= maxMi)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.c);
}

/** True when Holler reads at least one local source for this ZIP's place. False = show the "coming to your area" waitlist. */
export function isServedZip(place: { lat: number; lon: number; state: string }): boolean {
  const state = place.state.toUpperCase();
  if (!stateByCode(state) || UNCOVERED_STATE_CODES.includes(state)) return false;
  return localSourcesNear(place.lat, place.lon).length > 0;
}
