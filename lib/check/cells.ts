import { cityBySlug, haversineMi } from '@/lib/geo';
import { METROS } from '@/lib/geo/metros';
import { CHECK_RADIUS_MI } from './scope';

/**
 * Honest coverage, per CITY and per TRADE (round 23).
 *
 * Until now a ZIP was "served" when any enabled local feed sat within 25 miles of it (lib/check/coverage.ts isServedZip), and every
 * served ZIP got the same trial CTA whatever the trade. That sold a trial into 46 of 112 measured cells where the member's first week
 * holds nothing: Dallas lawn care (0 actionable cards, one 311 feed) got a trial CTA, and an uncovered town got the waitlist card AND
 * "Holler is watching near Valdosta" AND the trial offer on one page.
 *
 * Three states now, from the measured table below:
 *   live      the feed is worth paying for here: the trial CTA shows, as before.
 *   limited   there are some records but few: sign-up is still offered, with a line that says so in those words
 *             ("few records for this trade here yet"), so nobody starts a trial expecting a full week.
 *   waitlist  nothing a member could act on: NO trial CTA, no "Holler is watching near X" block. The waitlist card is the whole answer.
 *
 * WHERE THE TABLE COMES FROM. /home/claude/gates/r22/data/verdict-25mi.json, the r22 measurement of every trade x city cell over 14 days
 * of live records, inside 25 miles of each centre, counting only cards an owner could act on (an exact address, or a block he can drive).
 * The thresholds are the owner's (VERDICT.md section 5): live = 5 or more actionable cards a week AND 10 or more distinct places in
 * 14 days; limited = 1 or more a week; otherwise waitlist. The file's own `verdict` field already applies them, so each cell below is
 * that field: "worth $8 today" -> live, "thin" -> limited, "empty" -> left out (waitlist).
 * Rerun scripts/verdict.py on the 1st of each month and update this table (FIXLIST row 44).
 *
 * WHAT IS NOT IN THE TABLE. The measurement covers 19 centres and the 10 trades the launch plan considered. A trade with no row here
 * (roofing, HVAC, auto glass, restoration and the rest) keeps the old behaviour exactly: served ZIP -> live, unserved -> waitlist. We
 * only step a cell down where there is evidence to step it down; nothing is downgraded on a guess.
 *
 * Marketing is a separate decision and is NOT encoded here. The owner markets Atlanta, Austin, Charlotte and Raleigh and the trades
 * landscaping, lawn care, gutters and pressure washing; the other cities stay open for sign-up, and this table simply tells each visitor
 * the truth about their own cell.
 */
export type CoverageState = 'live' | 'limited' | 'waitlist';

/** Centres of the 19 measured areas, as scripts/week1.ts used them: a metro centre, or the core city's own point. */
const CENTRE_SOURCE: { id: string; metro?: string; city?: string }[] = [
  { id: 'chicago', metro: 'chicago' },
  { id: 'atlanta', metro: 'atlanta' },
  { id: 'new-york', metro: 'new-york' },
  { id: 'washington-dc', metro: 'washington-dc' },
  { id: 'los-angeles', metro: 'los-angeles' },
  { id: 'seattle', city: 'seattle-wa' },
  { id: 'austin', city: 'austin-tx' },
  { id: 'raleigh', city: 'raleigh-nc' },
  { id: 'cincinnati', city: 'cincinnati-oh' },
  { id: 'baton-rouge', city: 'baton-rouge-la' },
  { id: 'san-francisco', city: 'san-francisco-ca' },
  { id: 'charlotte', city: 'charlotte-nc' },
  { id: 'new-orleans', city: 'new-orleans-la' },
  { id: 'buffalo', city: 'buffalo-ny' },
  { id: 'dallas', metro: 'dallas-fort-worth' },
  { id: 'houston', metro: 'houston' },
  { id: 'phoenix', metro: 'phoenix' },
  { id: 'miami', metro: 'miami' },
  { id: 'philadelphia', metro: 'philadelphia' },
];

/**
 * The measured cells. A trade left out of a centre's entry is 'waitlist' for that centre: the measurement found nothing an owner there
 * could act on in 14 days. Dallas, Houston, Phoenix, Miami and Philadelphia have no entry at all: 0 actionable cards in every trade.
 */
const CELLS: Record<string, Partial<Record<string, CoverageState>>> = {
  'chicago': { 'lawn-care': 'limited', 'landscaping': 'live', 'junk-removal': 'limited', 'handyman': 'live', 'siding-gutters': 'live', 'fencing': 'live', 'painting': 'live' },
  // Atlanta exterior is the one OWNER OVERRIDE of the engine (VERDICT.md conflict 5, settled by the owner for round 23). The engine calls
  // Atlanta cleaning "worth $8" on 17 actionable cards at 12 places, but a hand reading of those very cards (DATA-reality section 3b)
  // found exactly ONE a pressure washer could act on this week; the rest are new-build cleans months away. The hand reading wins, so
  // cleaning is 'limited' here, not 'live'. Siding and gutters measured 'thin' on its own anyway (1 card in 14 days).
  'atlanta': { 'lawn-care': 'limited', 'landscaping': 'live', 'cleaning': 'limited', 'siding-gutters': 'limited', 'fencing': 'limited' },
  'new-york': { 'lawn-care': 'limited', 'landscaping': 'live', 'cleaning': 'limited', 'siding-gutters': 'live', 'fencing': 'limited', 'painting': 'limited' },
  'washington-dc': { 'lawn-care': 'limited', 'landscaping': 'live', 'cleaning': 'limited', 'siding-gutters': 'live', 'fencing': 'limited', 'painting': 'live' },
  'los-angeles': { 'lawn-care': 'live', 'landscaping': 'live', 'cleaning': 'live', 'siding-gutters': 'live', 'fencing': 'live', 'painting': 'limited' },
  'seattle': { 'lawn-care': 'limited', 'landscaping': 'live', 'cleaning': 'live', 'siding-gutters': 'limited' },
  'austin': { 'lawn-care': 'live', 'landscaping': 'live', 'cleaning': 'limited', 'junk-removal': 'live', 'siding-gutters': 'limited' },
  'raleigh': { 'lawn-care': 'live', 'landscaping': 'live', 'cleaning': 'live', 'siding-gutters': 'limited', 'fencing': 'limited', 'painting': 'live' },
  'cincinnati': { 'lawn-care': 'limited', 'landscaping': 'limited', 'cleaning': 'limited', 'siding-gutters': 'limited', 'painting': 'limited' },
  'baton-rouge': { 'lawn-care': 'limited', 'landscaping': 'limited', 'cleaning': 'limited', 'siding-gutters': 'live', 'fencing': 'limited' },
  'san-francisco': { 'siding-gutters': 'live', 'fencing': 'limited', 'painting': 'limited' },
  'charlotte': { 'landscaping': 'live', 'siding-gutters': 'live', 'fencing': 'live' },
  'new-orleans': { 'landscaping': 'live', 'siding-gutters': 'live', 'fencing': 'limited' },
  'buffalo': { 'siding-gutters': 'limited', 'painting': 'limited' },
};

/** Every trade the measurement covered. A trade outside this set is never stepped down by this module. */
export const MEASURED_TRADES: readonly string[] = [
  'lawn-care',
  'landscaping',
  'cleaning',
  'junk-removal',
  'handyman',
  'siding-gutters',
  'fencing',
  'painting',
  'pest-control',
  'plumbing',
];

export interface Centre {
  id: string;
  lat: number;
  lon: number;
}

let centres: Centre[] | null = null;

/** The 19 measured centres with their coordinates, memoised. A centre whose place cannot be resolved is skipped (tests check none is). */
export function measuredCentres(): readonly Centre[] {
  if (centres) return centres;
  const out: Centre[] = [];
  for (const c of CENTRE_SOURCE) {
    const point = c.metro ? METROS.find((m) => m.id === c.metro)?.center : c.city ? cityBySlug(c.city) : null;
    if (point) out.push({ id: c.id, lat: point.lat, lon: point.lon });
  }
  centres = out;
  return out;
}

/** The measured centre nearest this point inside `maxMi`, or null. */
export function nearestMeasuredCentre(lat: number, lon: number, maxMi: number = CHECK_RADIUS_MI): Centre | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best: Centre | null = null;
  let bestD = Infinity;
  for (const c of measuredCentres()) {
    const d = haversineMi(lat, lon, c.lat, c.lon);
    if (d <= maxMi && d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

/** The measured state of one cell, or null when the centre or the trade was never measured. */
export function measuredCell(centreId: string, trade: string): CoverageState | null {
  if (!MEASURED_TRADES.includes(trade)) return null;
  return CELLS[centreId]?.[trade] ?? 'waitlist';
}

/**
 * What this ZIP and this trade get. `served` is the old whole-ZIP answer (lib/check/coverage.ts isServedZip), passed in so this module
 * stays free of the feed catalogue and can be tested on its own.
 *   - no local source at all -> waitlist, whatever the trade;
 *   - a measured trade -> the table's answer for the nearest measured centre; no centre within 25 miles -> waitlist;
 *   - any other trade -> live when the ZIP has a local source (unchanged behaviour).
 */
export function coverageFor(place: { lat: number; lon: number }, trade: string, served: boolean): { state: CoverageState; centre: string | null } {
  if (!served) return { state: 'waitlist', centre: null };
  if (!MEASURED_TRADES.includes(trade)) return { state: 'live', centre: null };
  const centre = nearestMeasuredCentre(place.lat, place.lon);
  if (!centre) return { state: 'waitlist', centre: null };
  return { state: measuredCell(centre.id, trade) ?? 'waitlist', centre: centre.id };
}

/**
 * Is this place worth a marketing claim for ANY measured trade? Used by the city pages: a city with no live measured cell gets the
 * waitlist CTA instead of "Get alerts for X from $7.99/mo". A place outside every measured centre is judged by `served` alone, as before.
 */
export function anyTradeLive(place: { lat: number; lon: number }, served: boolean): boolean {
  if (!served) return false;
  const centre = nearestMeasuredCentre(place.lat, place.lon);
  if (!centre) return true; // never measured: no evidence to step it down
  return Object.values(CELLS[centre.id] ?? {}).includes('live');
}
