import { haversineMi } from '@/lib/geo';
import { hasApproxLocation, hasApproxReach, approxReachMi } from '@/lib/signals/approx-location';
import { isAlertLabel, labelForMember, ruleFor, type OpportunityLabel } from '@/lib/signals/lead-rules';
import { DOWNSTREAM, KIND_DOERS, routeFor, ROUTE_KINDS, type RouteKind } from '@/lib/signals/permit-routing';
import { siteAddressFromSummary } from '@/lib/signals/permit-value';
import { buildingStreetFromPart, isHundredBlock, isZeroHouseNumber } from '@/lib/signals/site-address';
import { textShowsPlace } from '@/lib/signals/alert-gate';
import { remarkNamesWindDamage, stormFactsOf } from '@/lib/signals/wind-damage';
import { isProbationSource } from '@/lib/signals/probation';

/**
 * Address lists (PLAN-2.0 item 3.3, round 18 unit LISTS). Trades that sell to homeowners (roofers, painters, landscapers, fencing, tree
 * service) work by door-knocking and mailers. Holler never gives them a homeowner's name or phone, and never will. What it can give is the
 * street address of PERMITTED work, which is public record, read from rows Holler already stores:
 *
 *   storm lists         for a hail report of 1.00 inch or more, or a wind-damage report, from SPC in the last 14 days that already reached
 *                       the member as an act_now or coming_soon card: the permits Holler holds within STORM_RADIUS_MI of the report point.
 *                       Every storm list carries DAMAGE_LINE in English and Spanish. NWS alerts (county level) never make a list.
 *   neighborhood lists for a trade of the member's plan: the permits of the last AREA_LIST_DAYS in the member's area that the existing
 *                       downstream rules (lib/signals/lead-rules.ts soon-permit-downstream, soon-new-home-downstream) send to that trade
 *                       as coming_soon. Commercial fit-outs are left out: these lists are for homeowner trades.
 *
 * What a list may hold, and nothing else: a building's street address, its ZIP and city, the permit type Holler's own title names, the
 * permit date and the public source link. Never a title or summary as such, never an owner, applicant or contractor name, never anything
 * from holler_signal_contacts. Addresses come only from building permits (kind and data.subtype both 'permit'): a 311 request, a code
 * violation, an inspection or any other complaint record could single out one household and is never read. A unit ("APT 4", "#5B") is cut,
 * so a multi-unit building appears once, by its building address.
 *
 * Pure: no server imports, no clock, no I/O. lib/lists/load.ts reads the rows; the pages render them.
 */

/** Storm reports older than this make no list. */
export const STORM_LIST_DAYS = 14;

/**
 * How far from an SPC report point a permit may be. 2 miles, because:
 *  - SPC places a report by distance and direction from a named town ("2 ESE Longview") and publishes the point to hundredths of a degree
 *    (about 0.7 mile), so the point itself can be about a mile from where the hail or wind was seen;
 *  - a hail swath or a damaging wind gust is commonly one to a few miles wide, so another mile either side of the corrected point covers a
 *    typical half-width without reaching the next town.
 * The page says so in plain words: the point is approximate, some listed addresses may be outside the storm's path and some inside it may
 * be missing. ASSUMED (documented reasoning, not a measured calibration).
 */
export const STORM_RADIUS_MI = 2;

/** SPC hail size threshold for a list, in inches (the adapter already drops smaller hail). */
export const MIN_HAIL_INCHES = 1;

/** A neighborhood list covers permits of this many days ("weekly"). */
export const AREA_LIST_DAYS = 7;

/** The most addresses one list shows (newest first). The page says when the list was cut. */
export const MAX_LIST_ADDRESSES = 100;

/** The most storm lists shown at once (newest report first). */
export const MAX_STORM_LISTS = 10;

/** The line every storm list carries, in both languages, whatever the member's language. Weather never proves damage. */
export const DAMAGE_LINE = {
  en: 'Damage not confirmed. These are addresses near a public storm report.',
  es: 'Daño no confirmado. Son direcciones cerca de un reporte público de tormenta.',
} as const;

// ---- storm reports ---------------------------------------------------------------------------------------------------------------

export type StormKind = 'hail' | 'wind';

/** A stored SPC row, as lib/lists/load.ts selects it (data fields aliased flat). */
export interface StormRow {
  id: number;
  source: string;
  kind?: string | null;
  title: string;
  lat: number | null;
  lon: number | null;
  city: string | null;
  state: string | null;
  county?: string | null;
  occurred_at: string;
  url: string | null;
  categories?: string[] | null;
  /** data->>day: SPC's report day (YYYY-MM-DD, the convective day starting 12:00 UTC). */
  spcDay?: string | null;
  /** data->>type: 'hail' | 'wind' | 'torn'. */
  stormType?: string | null;
  /** data->>hailInches (text). */
  hailInches?: string | number | null;
  /** data->>windMph (text), absent when SPC printed UNK. */
  windMph?: string | number | null;
  /** data->>comments: read ONLY to test for damage words (WIND_DAMAGE_RE). Never shown, never returned by a loader. */
  comments?: string | null;
}

/**
 * Wind damage (review 2): a remark makes a wind list only when lib/signals/wind-damage.ts remarkNamesWindDamage says it reports damage to a
 * named thing. Re-exported for the tests and pages that already import it from here.
 */
export { remarkNamesWindDamage, UNASSESSED_RE, DAMAGED_THING_RE } from '@/lib/signals/wind-damage';

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * 'hail' for an SPC hail report of MIN_HAIL_INCHES or more, 'wind' for an SPC wind report that names damage (no measured speed, or remarks
 * with a damage word, the adapter's own test), else null. Tornado reports, measured gusts with no damage words, NWS alerts and every other
 * source give null: they make no list.
 */
export function stormKindOf(r: Pick<StormRow, 'source' | 'title' | 'stormType' | 'hailInches' | 'windMph' | 'comments'>): StormKind | null {
  if (r.source !== 'spc') return null;
  const type = (r.stormType ?? '').toLowerCase() || (/\bhail\b/i.test(r.title) ? 'hail' : /\bwind\b/i.test(r.title) ? 'wind' : '');
  if (type === 'hail') {
    const inches = num(r.hailInches) ?? num(/^(\d+(?:\.\d+)?) inch hail/i.exec(r.title)?.[1]);
    return inches !== null && inches >= MIN_HAIL_INCHES ? 'hail' : null;
  }
  if (type === 'wind') {
    // Measured gust or "UNK" speed alike: only the remark's own damage wording makes a list. The stored title is not read: rows stored
    // before the round 18 integration got "Wind damage reported" from the adapter's old loose word test; new rows use this same rule.
    return remarkNamesWindDamage(r.comments) ? 'wind' : null;
  }
  return null;
}

/**
 * A storm report makes a list for this member only when it qualifies (stormKindOf), is at most STORM_LIST_DAYS old, has a real point, and
 * is an act_now or coming_soon card for the member's plan trades: the alert the member already receives. No new alert volume.
 */
export function stormListLabel(r: StormRow, memberTrades: readonly string[], nowMs: number): OpportunityLabel | null {
  if (!stormKindOf(r) || !isNum(r.lat) || !isNum(r.lon) || (r.lat === 0 && r.lon === 0)) return null;
  const at = Date.parse(r.occurred_at);
  if (!Number.isFinite(at) || at < nowMs - STORM_LIST_DAYS * 86_400_000 || at > nowMs + 86_400_000) return null;
  const label = labelForMember(
    { source: r.source, kind: r.kind ?? 'report', title: r.title, categories: r.categories ?? [], storm: stormFactsOf(r.source, { type: r.stormType, hailInches: r.hailInches, comments: r.comments }) },
    memberTrades,
  );
  return isAlertLabel(label) ? label : null;
}

// ---- permits and entries ---------------------------------------------------------------------------------------------------------

/** A stored permit row, as lib/lists/load.ts selects it. */
export interface PermitRow {
  id: number;
  source: string;
  kind: string;
  title: string | null;
  summary: string | null;
  url: string | null;
  lat: number | null;
  lon: number | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  occurred_at: string;
  /** data->>subtype */
  subtype: string | null;
  /** data->>approxLocation ('true' for a city-centre stand-in) */
  approxLocation?: string | boolean | null;
  /** data->>loc ('approx' for Cobb County rows) */
  loc?: string | null;
  /** data->>projectOf: a second listing of a project already held. */
  projectOf?: string | null;
}

/** One line of a list. Only these fields ever leave the server. */
export interface ListEntry {
  /** Building street address ("1584 ABNER NW"), no unit. */
  address: string;
  zip: string | null;
  city: string | null;
  state: string | null;
  /** The permit type Holler's own title names, in English ("Roof", "New home"), or null for a plain "Permit in X". */
  permitType: string | null;
  /** YYYY-MM-DD */
  date: string;
  /** The public source page of the record. */
  url: string | null;
  /** Miles from the storm report point (storm lists only), one decimal. */
  distanceMi: number | null;
}

/** Record kinds that are complaints about a place, never read for a list (a household could be singled out). */
export const NEVER_LISTED_SUBTYPES: readonly string[] = ['311', 'violation', 'inspection', 'business', 'event-permit'];

/**
 * True only for a building permit: kind 'permit' AND data.subtype 'permit', not a resident request, not a follower listing. Anything else
 * (a 311 request, a code violation, an inspection, a licence, an event) is never listed, whatever its kind says.
 */
export function isListablePermit(r: Pick<PermitRow, 'source' | 'kind' | 'subtype' | 'projectOf'>): boolean {
  if (r.kind !== 'permit') return false;
  if ((r.subtype ?? '').toLowerCase() !== 'permit') return false;
  if (NEVER_LISTED_SUBTYPES.includes((r.subtype ?? '').toLowerCase())) return false;
  if (r.source === 'holler-request' || /-(?:311|violations|inspections|business|events)$/.test(r.source)) return false;
  // A source on probation (round 19) is never listed, even if one of its rows reached holler_signals.
  if (isProbationSource(r.source)) return false;
  return !r.projectOf;
}

const UNIT_TAIL_RE = /\s+(?:#\s*[A-Za-z0-9-]+|(?:apt|apartment|unit|ste|suite|fl|floor|bldg|rm|room)(?![A-Za-z])\.?\s*#?\s*[A-Za-z0-9-]+)\s*$/i;
/**
 * A unit (and anything typed after it) inside an address part: "APT 204", "#305", "UNIT 7", ", STE 100", "LOT 34". Cut BEFORE the street
 * cutter runs, because the cutter rejects a part with a 3-digit token or the word "unit" (review redo 1, defect 5: those buildings were
 * dropped instead of collapsed).
 */
const UNIT_ANY_RE = /[\s,]+(?:#\s*[A-Za-z0-9-]+|\d+(?:st|nd|rd|th)\s+(?:fl|floor)\b|(?:apt|apartment|unit|ste|suite|fl|floor|bldg|rm|room|lot)(?![A-Za-z])\.?\s*#?\s*[A-Za-z0-9-]+)\b.*$/i;

/**
 * The building's street address from a stored permit summary, or null. The unit is cut first from every part that starts with a house
 * number, then siteAddressFromSummary finds the part that starts with a house number and cuts it after the street (a name typed after the
 * street is never returned), then any unit left and trailing punctuation go. "12 OAK ST APT 204", "12 OAK ST #305" and "12 OAK STREET, APT 4"
 * all give the one building line. A block-level address ("2300 block of ...", violations only) is not a permit address and gives null.
 */
export function buildingAddress(summary: string | null | undefined): string | null {
  if (typeof summary !== 'string') return null;
  const cleaned = summary
    .split(' | ')
    .map((p) =>
      /^\s*\d/.test(p)
        ? p
            .replace(/^(\s*\d+[A-Za-z]?)\s+1\/2(?=\s)/, '$1') // "123 1/2 MAIN ST": the half address is listed at its lot, 123 MAIN ST
            .replace(/[\s,]*\((?:rear|front|upper|lower|basement)\)\s*$/i, '') // "12 OAK ST (REAR)"
            .replace(UNIT_ANY_RE, '')
        : p,
    )
    .join(' | ');
  const site = siteAddressFromSummary(cleaned);
  // Round 18 integration: a part the contact gate reads as a job-site address but the display cutter does not cut ("6344 TILLEY WY
  // MATTHEWS NC 28105", "346 HENRY AARON SW, ATLANTA, GA 30310") is listed with the shared strict street rule (lib/signals/site-address.ts),
  // so a card alerted for its address is not missing from the list. Only a street that ends in a street type or a quadrant is printed.
  const fallback = site ? null : cleaned.split(' | ').map((p) => (textShowsPlace(p) ? buildingStreetFromPart(p) : null)).find((x) => x) ?? null;
  if (!site && !fallback) return null;
  let a = (site ? site.address : (fallback as string)).replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 2 && UNIT_TAIL_RE.test(a); i++) a = a.replace(UNIT_TAIL_RE, '').trim();
  a = a.replace(/[.,;]+$/, '').trim();
  // The shared site-address rule (lib/signals/site-address.ts): never house number 0, never a hundred-block (round 18 integration).
  if (!/^\d+[A-Za-z]?\s+\S+/.test(a) || /\bblock of\b/i.test(a) || isHundredBlock(a) || isZeroHouseNumber(a.split(' ')[0])) return null;
  return a;
}

/** "Roof, HVAC and plumbing permit in Chicago" gives "Roof, HVAC and plumbing". "Permit in Chicago" gives null. */
export function permitTypeOf(title: string | null | undefined): string | null {
  const m = /^(.{2,80}?)\s+permit\s+in\s+/i.exec((title ?? '').trim());
  if (!m) return null;
  // Only Holler's own work-kind vocabulary (lib/signals/permit-routing.ts KIND_DOERS) is printed; anything else is just "Permit" (review P3-11).
  const parts = m[1].split(/\s*,\s*|\s+and\s+/i).map((p) => p.trim().toLowerCase()).filter(Boolean);
  return parts.length > 0 && parts.every((p) => p in KIND_DOERS) ? m[1].trim() : null;
}

const addressKey = (e: Pick<ListEntry, 'address' | 'zip' | 'city'>) => `${e.address.toUpperCase().replace(/[.,]/g, '').replace(/\s+/g, ' ')}|${e.zip ?? e.city ?? ''}`;

/** One entry from one permit row, or null when the row has no usable building address. */
export function entryOf(r: PermitRow, distanceMi: number | null = null): ListEntry | null {
  const address = buildingAddress(r.summary);
  if (!address) return null;
  const zip = typeof r.zip === 'string' && /^\d{5}/.test(r.zip) ? r.zip.slice(0, 5) : null;
  return {
    address,
    zip,
    city: r.city?.trim() || null,
    state: r.state?.trim() || null,
    permitType: permitTypeOf(r.title),
    date: r.occurred_at.slice(0, 10),
    url: r.url ?? null,
    distanceMi: distanceMi === null ? null : Math.round(distanceMi * 10) / 10,
  };
}

export interface BuiltList {
  entries: ListEntry[];
  /** Distinct addresses found before the cap. */
  total: number;
  /** True when total > MAX_LIST_ADDRESSES (only the newest are shown). */
  capped: boolean;
  /** True when at least one entry is placed by a county or city stand-in, not a map point (neighborhood lists only). */
  hasApprox: boolean;
}

export interface BuildOptions {
  /** Storm lists: the report point and radius. A row without its own map point is never in a storm list. */
  center?: { lat: number; lon: number; radiusMi: number } | null;
  /** Neighborhood lists: the member's located areas and radius (a stand-in row is matched as the scanner matches it). */
  areas?: { lat: number; lon: number }[] | null;
  areaRadiusMi?: number | null;
  /** Neighborhood lists: the earliest permit date (ISO). */
  sinceIso?: string | null;
  /** Extra test (the trade's downstream rule). */
  accept?: (r: PermitRow) => boolean;
  /** Defaults to MAX_LIST_ADDRESSES. */
  max?: number;
}

/**
 * Rows to a list: building permits only, inside the circle (storm) or the member's area (neighborhood), with a building address, one entry
 * per address (the newest permit wins), newest first, at most `max`.
 */
export function buildList(rows: readonly PermitRow[], opts: BuildOptions): BuiltList {
  const max = opts.max ?? MAX_LIST_ADDRESSES;
  const byAddress = new Map<string, { e: ListEntry; approx: boolean }>();
  const seen = new Set<number>();
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    if (!isListablePermit(r)) continue;
    // Compared as instants: PostgREST prints "+00:00" (or the session's offset), the cut is "...Z" (review P3-7).
    if (opts.sinceIso && !(Date.parse(r.occurred_at) >= Date.parse(opts.sinceIso))) continue;
    if (!isNum(r.lat) || !isNum(r.lon) || (r.lat === 0 && r.lon === 0)) continue;
    let distance: number | null = null;
    let approx = false;
    if (opts.center) {
      // A stand-in point (a county seat, a city centre) says nothing about where the building is relative to the storm.
      if (hasApproxLocation(r)) continue;
      distance = haversineMi(opts.center.lat, opts.center.lon, r.lat, r.lon);
      if (distance > opts.center.radiusMi) continue;
    } else if (opts.areas && opts.areas.length > 0 && isNum(opts.areaRadiusMi)) {
      approx = hasApproxLocation(r);
      const reach = hasApproxReach({ source: r.source, data: { loc: r.loc } }) ? approxReachMi(opts.areaRadiusMi) : opts.areaRadiusMi;
      if (!opts.areas.some((a) => haversineMi(a.lat, a.lon, r.lat as number, r.lon as number) <= reach)) continue;
    } else {
      continue;
    }
    if (opts.accept && !opts.accept(r)) continue;
    const e = entryOf(r, distance);
    if (!e) continue;
    const k = addressKey(e);
    const had = byAddress.get(k);
    if (!had || had.e.date < e.date) byAddress.set(k, { e, approx });
  }
  const all = [...byAddress.values()].sort((a, b) => (a.e.date < b.e.date ? 1 : a.e.date > b.e.date ? -1 : a.e.address.localeCompare(b.e.address)));
  const kept = all.slice(0, max);
  return { entries: kept.map((x) => x.e), total: all.length, capped: all.length > max, hasApprox: kept.some((x) => x.approx) };
}

export interface ListGroup {
  /** The ZIP, or '' for the one group of addresses with no ZIP. */
  key: string;
  kind: 'zip' | 'street';
  entries: ListEntry[];
}

/** The street name of an address: "1584 ABNER NW" gives "ABNER NW". */
export function streetOf(address: string): string {
  return address.replace(/^\d+[A-Za-z]?(?:-\d+)?\s+/, '').trim().toUpperCase();
}

/**
 * Grouped by ZIP; every address with no ZIP goes in ONE last group, sorted by street then house number (review P3-14: one table per street
 * made eight misaligned tables). ZIP groups by their newest entry, entries newest first inside each.
 */
export function groupEntries(entries: readonly ListEntry[]): ListGroup[] {
  const groups = new Map<string, ListGroup>();
  const noZip: ListEntry[] = [];
  for (const e of entries) {
    if (!e.zip) {
      noZip.push(e);
      continue;
    }
    const g = groups.get(e.zip) ?? { key: e.zip, kind: 'zip' as const, entries: [] };
    g.entries.push(e);
    groups.set(e.zip, g);
  }
  const newest = (g: ListGroup) => g.entries.reduce((m, e) => (e.date > m ? e.date : m), '');
  for (const g of groups.values()) g.entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.address.localeCompare(b.address)));
  const out = [...groups.values()].sort((a, b) => (newest(a) < newest(b) ? 1 : newest(a) > newest(b) ? -1 : a.key.localeCompare(b.key)));
  if (noZip.length > 0) {
    const house = (a: string) => Number(/^(\d+)/.exec(a)?.[1] ?? 0);
    noZip.sort((a, b) => streetOf(a.address).localeCompare(streetOf(b.address)) || house(a.address) - house(b.address) || (a.date < b.date ? 1 : -1));
    out.push({ key: '', kind: 'street', entries: noZip });
  }
  return out;
}

// ---- neighborhood lists: which trades, which permits ------------------------------------------------------------------------------

/** Route kinds a neighborhood list uses. A commercial fit-out is not homeowner work. */
export const AREA_ROUTE_KINDS: readonly RouteKind[] = ROUTE_KINDS.filter((k) => k !== 'fit-out');

/** Trades a new-home permit is sent to by the soon-new-home-downstream rule (lib/signals/lead-rules.ts). */
const NEW_HOME_TRADES: readonly string[] = ['real-estate', 'moving'];

/** Every trade a neighborhood list exists for: the downstream trades of the homeowner route kinds, plus the new-home trades. */
export const AREA_LIST_TRADES: readonly string[] = [...new Set([...AREA_ROUTE_KINDS.flatMap((k) => DOWNSTREAM[k] as readonly string[]), ...NEW_HOME_TRADES])];

/** The member's plan trades that have a neighborhood list, in the member's own order. */
export function areaListTrades(memberTrades: readonly string[]): string[] {
  return memberTrades.filter((t) => AREA_LIST_TRADES.includes(t));
}

/**
 * True when this permit creates work for `trade` under the existing downstream rules: the rule lib/signals/lead-rules.ts picks for the pair
 * is a downstream coming_soon rule, and the route is not a commercial fit-out. The trade that does the permitted work (market insight) and
 * every non-permit record give false.
 */
export function createsWorkFor(r: Pick<PermitRow, 'source' | 'kind' | 'subtype' | 'title' | 'summary'>, trade: string): boolean {
  const input = { source: r.source, kind: r.kind, subtype: r.subtype, title: r.title, summary: r.summary };
  const rule = ruleFor(input, trade as never);
  if (!rule || !rule.downstream || rule.label !== 'coming_soon') return false;
  const kind = routeFor(r.title, trade, { summary: r.summary, source: r.source });
  return kind === null ? NEW_HOME_TRADES.includes(trade) : kind !== 'fit-out';
}
