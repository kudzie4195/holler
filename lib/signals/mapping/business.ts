import type { CategoryId } from '@/lib/signals/categories';
import { STOREFRONT_LICENCES, storefrontKindOfName } from '@/lib/signals/lead-rules';
import { titleBodyOf } from '@/lib/signals/carry';
import { haversineMi, lookupZip } from '@/lib/geo';
import { SOCRATA_DATASETS, type SocrataDataset } from '@/lib/signals/adapters/socrata-datasets';
import { BUSINESS_TAG_FIX_FLAG, businessTagFixEnabled } from './business-flag';

export { BUSINESS_TAG_FIX_FLAG, businessTagFixEnabled };

/**
 * Round 33 (LA business licences): the trades a new business licence supports, from the licence's OWN type text and nothing else.
 *
 * Before: every row of a new-business feed carried the same fixed set (signs-printing, business-services, insurance,
 * janitorial-commercial, security, locksmith, and `cleaning` on rows stored before round 15), whatever the business was
 * (BUSINESS_RULES in lib/signals/adapters/socrata-datasets.ts, `re: /./`). 100% of the 1,632 stored rows of the five Socrata business
 * feeds carry it. The label engine already treats most of those pairs as context (lib/signals/lead-rules.ts), so the tags only added
 * noise and cross-counted one licence as four or five trades.
 *
 * After (switch on): the licence type is looked up in the SAME per-source list the label engine uses (STOREFRONT_LICENCES: exact
 * names from the live rows), so a tag exists only where an alert label can exist for it:
 *   shop, food, parking   signs-printing, janitorial-commercial, security (lead-rules line 23, business-storefront)
 *   storage               security only (the same rule makes the other two feed only for a storage facility)
 *   food (not mobile)     also pest-control (line 24, business-pests)
 *   anything else         NO trade. A contractor, a consultant, a home office or a vendor names no premises. The scan drops a row with
 *                         no trade (socrata.ts: categories.length === 0), and every feed, match and page reads trades by overlap, so
 *                         an untagged row is in no trade's feed anyway.
 * Never tagged from a licence: locksmith, insurance, business-services, cleaning and hvac. The label engine marks all five context
 * for every business licence (ctx-business-blanket, ctx-licence-hvac, ctx-mobile-business), so nothing is lost.
 */
/** Every trade a licence can be tagged with while the switch is on (shop, food, parking, storage). */
export const BUSINESS_FIX_TRADES: readonly CategoryId[] = ['signs-printing', 'janitorial-commercial', 'security', 'pest-control'];

/** A mobile food, cart, peddler or vending licence has no building (same words as lead-rules MOBILE_LICENCE_RE). */
const MOBILE_LICENCE_RE = /mobile food|food truck|peddl|\bcarts?\b|vending|stoop line stand|general vendor/i;

/** True when the source has a licence-type list, so the fix can tell a storefront from any other licence. Others (probation feeds) are unchanged. */
export function hasBusinessTypeList(source: string | null | undefined): boolean {
  return ((STOREFRONT_LICENCES[String(source ?? '').toLowerCase()] ?? []).length) > 0;
}

/** Trades for one licence type text (the title body). Empty when the type supports none. */
export function businessTradesForType(source: string | null | undefined, licenceType: string): CategoryId[] {
  const name = licenceType.trim();
  if (!name) return [];
  if (MOBILE_LICENCE_RE.test(name)) return [];
  const kind = storefrontKindOfName(source, name, true);
  if (!kind) return [];
  if (kind === 'storage') return ['security'];
  const trades: CategoryId[] = ['signs-printing', 'janitorial-commercial', 'security'];
  if (kind === 'food') trades.push('pest-control');
  return trades;
}

/**
 * A NAICS code (live San Francisco rows carry ONLY this: 17 of 17 rows of the 2026-11-16 capture have both description columns null) as the
 * type phrase the licence list reads. Retail 44-45 is "Retail" (not nonstore retail, 454), food service 722 is "Food service and lodging"
 * (the phrase the title and the list use), accommodation 721 is its own phrase (a hotel is no restaurant: no tag). Ranges ("4400-4599",
 * "7220-7229") are read by their first code. Anything else gives null.
 */
export function naicsTypePhrase(code: string): string | null {
  const m = /^(\d{2,6})(?:\s*-\s*\d{2,6})?$/.exec(code.trim());
  if (!m) return null;
  const d = m[1];
  if (d.startsWith('722')) return 'Food service and lodging';
  if (d.startsWith('721')) return 'Accommodation';
  if (d.startsWith('454')) return 'Nonstore retail';
  if (d.startsWith('44') || d.startsWith('45')) return 'Retail';
  return null;
}

/**
 * Trades for a row whose classifier text is its type columns joined with " | ": any part that is a listed storefront type counts, and a
 * NAICS code part counts through its phrase (naicsTypePhrase).
 */
export function businessTradesForText(source: string | null | undefined, text: string): CategoryId[] {
  const out = new Set<CategoryId>();
  // A mobile word in ANY type column (SF lists several types in one column) means no building: no trade at all.
  if (MOBILE_LICENCE_RE.test(text)) return [];
  for (const raw of text.split(' | ')) {
    const part = naicsTypePhrase(raw) ?? raw;
    for (const t of businessTradesForType(source, part)) out.add(t);
  }
  return [...out];
}

// ---- area guard (pure; the parser and the stored-row re-tag share it) --------------------------------------------------------------------

export type AreaGuard = NonNullable<SocrataDataset['areaGuard']>;

/**
 * A point the feed can be believed about. The Los Angeles feed holds 32 of 175 stored rows whose longitude is a copy of the latitude
 * (34.06, 34.06): the latitude is right and the longitude is wrong. Such a point, or one outside the source's state box, is no point at
 * all: the row is then decided by its ZIP.
 */
export function trustedPoint(lat: number, lon: number, g: AreaGuard): boolean {
  if (lat === lon) return false;
  if (g.box && (lat < g.box.minLat || lat > g.box.maxLat || lon < g.box.minLon || lon > g.box.maxLon)) return false;
  return true;
}

/** 'none': no 5 digit ZIP ("7102", "N/A", "-"). 'out': the ZIP is unknown, in another state or farther than maxMi. 'in': inside the area. */
export function zipVerdict(zipText: string | null | undefined, g: AreaGuard, state: string): 'none' | 'in' | 'out' {
  const z5 = String(zipText ?? '').trim().slice(0, 5);
  if (!/^\d{5}$/.test(z5)) return 'none';
  const z = lookupZip(z5);
  if (!z || z.state !== state) return 'out';
  return haversineMi(g.near.lat, g.near.lon, z.lat, z.lon) > g.maxMi ? 'out' : 'in';
}

/**
 * What the re-tag of a STORED business row gives (the owner's UPDATE in the round 33 report, and the replay with the switch on). A stored
 * row keeps its title ("New business license in Los Angeles: Clothing stores"), a rounded point, its ZIP and data.approxLocation, so this
 * reads those and the same area rules as the parser: a trusted point farther than maxMi, or a ZIP outside the area, clears the trades; a
 * row whose point is not believable (lat = lon) is decided by its ZIP; a New York row sitting at the City Hall stand-in (approxLocation)
 * with no usable ZIP is cleared (the parser now gives it no point). A source with no licence-type list is returned unchanged. It only ever
 * REMOVES a stored tag: a stored row's hidden type columns are not in hand, so a tag the old rules did not give is not added here.
 */
export function retagStoredBusinessRow(row: {
  source: string;
  title: string | null;
  lat?: number | null;
  lon?: number | null;
  zip?: string | null;
  data?: { approxLocation?: unknown } | null;
  categories: string[] | null;
}): string[] {
  const old = row.categories ?? [];
  if (!hasBusinessTypeList(row.source)) return old;
  const ds = SOCRATA_DATASETS.find((d) => d.id === row.source);
  const g = ds?.areaGuard;
  if (g && ds) {
    const approx = row.data?.approxLocation === true;
    const real = typeof row.lat === 'number' && typeof row.lon === 'number' && !approx && trustedPoint(row.lat, row.lon, g);
    if (real && haversineMi(g.near.lat, g.near.lon, row.lat as number, row.lon as number) > g.maxMi) return [];
    const zv = zipVerdict(row.zip, g, ds.state);
    if (zv === 'out') return [];
    if (!real && zv === 'none' && approx) return [];
  }
  return businessTradesForType(row.source, titleBodyOf(row.title)).filter((c) => old.includes(c));
}
