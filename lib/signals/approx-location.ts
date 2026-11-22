import { BID_SOURCE_IDS } from './bid-sources';

/**
 * Records whose coordinates are a stand-in for the real site (a county centre, not the address). The matcher still uses the stand-in to
 * decide whether a record is "in the area", but no screen may call it a distance or draw it as a pin.
 *
 * Adapters mark such rows with data.loc = 'approx'. Pages that only have a source id (feed rows, check items) use APPROX_LOCATION_SOURCES.
 * Keep the two in step: tests/coverage/cobb-approx.test.ts checks that every source listed here emits data.loc = 'approx'.
 */
export const APPROX_LOCATION_SOURCES: ReadonlySet<string> = new Set([
  'arcgis-cobb-residential-permits',
  'arcgis-cobb-commercial-permits',
  'arcgis-cobb-multiunit-permits',
]);

/** True when the record's lat/lon is a stand-in. Accepts a feed row, a check item or a stored signal (any of source, data). */
export function hasApproxLocation(
  s: { source?: string | null; data?: { loc?: unknown; approxLocation?: unknown } | null; approxLocation?: unknown } | null | undefined,
): boolean {
  if (!s) return false;
  if (s.data && s.data.loc === 'approx') return true;
  // Socrata rows with no coordinates sit at the city centre and carry data.approxLocation: true (adapters/socrata.ts fallbackCenter). Round 15
  // quality gate: a Bronx street event printed "under 1 mi away" for a Manhattan member. A select that cannot read nested data aliases the
  // flag flat as `approxLocation:data->>approxLocation` (the value then arrives as the string "true").
  if ((s.data && s.data.approxLocation === true) || s.approxLocation === true || s.approxLocation === 'true') return true;
  // City open bids sit at the city centre, because the record names a buyer, not a job site (lib/signals/adapters/city-bids.ts). They are
  // kept out of APPROX_LOCATION_SOURCES on purpose: the readers that build SQL from that list (backfill, missed, preview) are for the Cobb
  // feeds. A bid read by its own box still matches with the same reach through matchOne.
  return typeof s.source === 'string' && (APPROX_LOCATION_SOURCES.has(s.source) || BID_SOURCE_IDS.includes(s.source));
}

/**
 * True when the stand-in can be up to a county from the real site, so the matcher widens its reach: data.loc = 'approx' (Cobb, county-level
 * weather alerts), or a source in APPROX_LOCATION_SOURCES or BID_SOURCE_IDS. A row flagged only with data.approxLocation (a Socrata row placed at
 * the city centre) shows no distance but is matched by the member's own radius.
 */
export function hasApproxReach(s: { source?: string | null; data?: { loc?: unknown } | null } | null | undefined): boolean {
  if (!s) return false;
  if (s.data && s.data.loc === 'approx') return true;
  return typeof s.source === 'string' && (APPROX_LOCATION_SOURCES.has(s.source) || BID_SOURCE_IDS.includes(s.source));
}

/**
 * How far the real site of an approximate-location record can be from its stand-in point. Cobb County rows sit at the county seat
 * (lib/signals/adapters/arcgis-datasets.ts COBB_CENTER) and the county reaches about 15 miles from it (coverage report). The matcher
 * lets such a record match a member whose point is within (member radius + this) of the stand-in, so a member anywhere in or near the
 * county is not missed. No distance is ever shown for these rows.
 */
export const APPROX_MATCH_SLACK_MI = 15;

/**
 * The matcher's reach for an approximate-location record: a member's radius plus APPROX_MATCH_SLACK_MI, measured from the stand-in.
 * Readers that pre-filter rows by a box around the member (lib/lifecycle/missed.ts, lib/preview/recent.ts) use it for these sources so
 * their counts see what the scanner matches.
 */
export function approxReachMi(radiusMi: number): number {
  return radiusMi + APPROX_MATCH_SLACK_MI;
}

/**
 * The sentence after the place, on every surface (web feed card, app feed via lib/mobile/feed.ts, digest email, check page). The card
 * prints the street address the county gives, so the wording says what is missing (a map point), not that the location is unknown
 * (commander decision 4, verify-v1 finding 9).
 */
export const APPROX_LOCATION_REASON = "The county's feed has a street address but no map point, so no distance is shown.";

/** The whole note for a Cobb County row: "In Cobb County. The county's feed has a street address but no map point, so no distance is shown." */
export const COBB_APPROX_NOTE = `In Cobb County. ${APPROX_LOCATION_REASON}`;

/**
 * Plain wording shown wherever an approximate-location row is shown to a member (feed card, app feed, digest email), in place of a
 * distance. `place` is the record's city field ("Cobb County"); a row without one gets the generic county wording.
 */
export function approxLocationNote(s: { city?: string | null; source?: string | null; subtype?: string | null } | null | undefined): string {
  // A city bid: the row names a buyer and a city, not a site. Never the county wording.
  if (s && (s.subtype === 'bid' || (typeof s.source === 'string' && BID_SOURCE_IDS.includes(s.source)))) {
    const where = typeof s.city === 'string' && s.city.trim() ? s.city.trim() : 'the city';
    return `Buyer in ${where}. A bid names the buyer, not a job site, so no distance is shown.`;
  }
  // A county-level weather alert (adapters/nws.ts places it at the county centroid): the alert covers an area, not a point.
  if (s && s.source === 'nws') return 'This alert covers a county or zone, not a point, so no distance is shown.';
  // A city feed whose rows have no map point (NYC special events: the row is placed at the city centre): city wording, never "the county".
  if (s && typeof s.source === 'string' && !APPROX_LOCATION_SOURCES.has(s.source)) {
    const where = typeof s.city === 'string' && s.city.trim() ? s.city.trim() : 'the city';
    return `In ${where}. The city's feed has no map point for this record, so no distance is shown.`;
  }
  const place = typeof s?.city === 'string' && /\bcounty\b/i.test(s.city) ? s.city.trim() : 'the county';
  return `In ${place}. ${APPROX_LOCATION_REASON}`;
}
