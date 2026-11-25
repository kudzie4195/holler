import type { CategoryId } from '@/lib/signals/categories';
import { STOREFRONT_LICENCES, storefrontKindOfName } from '@/lib/signals/lead-rules';
import { titleBodyOf } from '@/lib/signals/carry';
import { haversineMi } from '@/lib/geo';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';

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
export const BUSINESS_TAG_FIX_FLAG = 'HOLLER_BUSINESS_TAG_FIX_ENABLED';

/** Off unless "1", "true", "on" or "yes" (any case). Read at call time; a client bundle (undefined) always sees it off. */
export function businessTagFixEnabled(value: string | undefined = typeof process !== 'undefined' ? process.env?.HOLLER_BUSINESS_TAG_FIX_ENABLED : undefined): boolean {
  return typeof value === 'string' && /^(?:1|true|on|yes)$/i.test(value.trim());
}

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
  const kind = storefrontKindOfName(source, name);
  if (!kind) return [];
  if (kind === 'storage') return ['security'];
  const trades: CategoryId[] = ['signs-printing', 'janitorial-commercial', 'security'];
  if (kind === 'food') trades.push('pest-control');
  return trades;
}

/** Trades for a row whose classifier text is its type columns joined with " | ": any part that is a listed storefront type counts. */
export function businessTradesForText(source: string | null | undefined, text: string): CategoryId[] {
  const out = new Set<CategoryId>();
  // A mobile word in ANY type column (SF lists several types in one column) means no building: no trade at all.
  if (MOBILE_LICENCE_RE.test(text)) return [];
  for (const part of text.split(' | ')) for (const t of businessTradesForType(source, part)) out.add(t);
  return [...out];
}

/**
 * What the re-tag of a STORED business row gives (the owner's UPDATE in the round 33 report, and the replay with the switch on). A stored
 * row keeps only its title ("New business license in Los Angeles: Clothing stores"), a rounded point and a ZIP, so this reads the title
 * body and the point. Out of the dataset's area (areaGuard, by the stored point) the row gets no trade. A source with no licence-type list
 * is returned unchanged.
 */
export function retagStoredBusinessRow(row: { source: string; title: string | null; lat?: number | null; lon?: number | null; categories: string[] | null }): string[] {
  const old = row.categories ?? [];
  if (!hasBusinessTypeList(row.source)) return old;
  const g = SOCRATA_DATASETS.find((d) => d.id === row.source)?.areaGuard;
  if (g && typeof row.lat === 'number' && typeof row.lon === 'number' && haversineMi(g.near.lat, g.near.lon, row.lat, row.lon) > g.maxMi) return [];
  // Only ever removes a stored tag: a stored row's hidden type columns (SF lists several licence types in one) are not in hand, so a tag the
  // old rules did not give is not added here (the re-tag must not create an alert).
  return businessTradesForType(row.source, titleBodyOf(row.title)).filter((c) => old.includes(c));
}
