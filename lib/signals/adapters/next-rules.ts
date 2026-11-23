import { keyedId } from '@/lib/signals/id-key';
import { extractContacts, type ContactSpec } from '@/lib/contacts/extract';
import type { CategoryId } from '@/lib/signals/categories';
import { scrubText } from './permit-privacy';
import { HOME_BASED_RE, HOME_PRONE_RE } from '@/lib/contacts/trade-name';
import { cleanAddress } from '@/lib/contacts/sanitize';
import { blockOfAddress } from '@/lib/signals/site-311';

/**
 * Round 20 (NEXT): the shared pieces of the new-business, certificate-of-occupancy and Texas feeds, used by the Socrata and the ArcGIS
 * parsers alike (socrata.ts parseSocrataReport, arcgis.ts parseArcgisReport) and by the Houston permit report reader. Pure: no I/O.
 */

/**
 * The business PREMISES address a new-business row may print in its public summary (socrata-datasets.ts `premises`). It is the site address
 * of `spec`, run through the same extraction as the private contacts (extractContacts: the licence name rule, home-based activities, the
 * owner-name comparison, onlyWithOrganisation, then sanitizeContacts / cleanAddress), but apart from the row's private contact spec. '' when
 * no business name passed or the address did not survive.
 */
export function premisesAddressOf(
  read: (field: string) => string,
  spec: ContactSpec | undefined,
  place: { city: string; state: string },
  when?: (get: (field: string) => string) => boolean,
): string {
  if (!spec?.site?.onlyWithOrganisation) return '';
  // Review fix P2-2: a dataset may print the premises only for some classes (a commercial-premises NAICS class).
  if (when && !when(read)) return '';
  // REVIEW FIX (P0-1): a home-based or home-prone activity never prints an address, legal form or not (the private contact rule lets a
  // name with a legal form through; a public page must not). The raw address must also be exactly what the address rule keeps: a cut
  // tail (a unit, a floor, "REAR") or a unit word means a dwelling or a part of a building, and prints nothing.
  const homeText = [...(spec.orgs ?? []).flatMap((o) => [...(o.homeFields ?? []), ...o.nameFields])].map((f) => read(f)).filter(Boolean).join(' | ');
  if (HOME_BASED_RE.test(homeText) || HOME_PRONE_RE.test(homeText)) return '';
  const rawAddress = spec.site.addressFields.map((f) => read(f)).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (!rawAddress || /#|\b(?:apt|apartment|unit|fl|flr|floor|rear|bsmt|basement|lot|trlr|trailer|coach house|garden)\b/i.test(rawAddress)) return '';
  const found = extractContacts(read, spec, place, 'business');
  if (!found.some((c) => c.role === 'business' && c.name)) return '';
  const site = found.find((c) => c.role === 'site' && typeof c.address === 'string' && c.address.trim());
  const kept = site?.address?.trim() ?? '';
  return kept && kept.toUpperCase() === rawAddress.toUpperCase() ? kept : '';
}

/** The trades a certificate of occupancy is a heads-up for (proposed labels: cleaning, moving, security, landscaping). */
export const OCCUPANCY_TRADES: readonly CategoryId[] = ['cleaning', 'moving', 'security', 'landscaping'];

/** The building type words a CO title may print: letters, digits and simple punctuation only, at most 60 characters, or ''. */
export function occupancyTypeText(values: readonly string[]): string {
  for (const v of values) {
    const t = scrubText(v).replace(/\s+/g, ' ').trim();
    if (!t || t.length > 60 || !/^[A-Za-z0-9 ,.&/()'-]+$/.test(t) || !/[A-Za-z]/.test(t)) continue;
    return t;
  }
  return '';
}

/** "Certificate of occupancy in Los Angeles: Apartment" (or no type part when no type value is printable). */
export function occupancyTitle(city: string, typeText: string): string {
  return typeText ? `Certificate of occupancy in ${city}: ${typeText}` : `Certificate of occupancy in ${city}`;
}

/**
 * Review fix P2-1: the Texas external id is a KEYED hash (lib/signals/id-key.ts keyedId, HMAC with a server secret); the plain sha256 of
 * round 20 could be reversed. Kept under this name for the parsers; '' without a secret (the row then has no id and is never stored).
 */
export function hashedId(raw: string): string {
  return keyedId(raw);
}

export { isCompanyForm, isStorefrontNaics, isFoodNaics } from './next-filters';

// ---- Review fixes P2-3: certificates of occupancy at home addresses, and the DC quadrant --------------------------------------------

/** A home occupation or a child development home: a business run from a home. The certificate prints no address at all. */
export const HOME_OCCUPANCY_RE = /\bhome occupation|\bchild development home|\bfamily (?:day ?care|child care)|\bhome day ?care|\bin[- ]home\b/i;
/** Multi-family or commercial words that win over the residential test ("Apartment", "Multi-family dwelling", "5 units"). */
const MULTI_RE = /\bapartment|\bmulti[- ]?family|\b(?:[3-9]|\d{2,})\s*(?:\+\s*)?(?:units?|family)\b|\bcondominium building|\bmixed use/i;
/** One or two family homes and other dwellings. */
const RESIDENTIAL_CO_RE = /\b(?:1|one) (?:or|&|and) (?:2|two) family|\b1-2 family|\bsingle[- ]family|\btwo[- ]family|\bone[- ]family|\bduplex|\btownho(?:use|me)|\baccessory dwelling|\badu\b|\bdwelling|\bresidence\b|\bresidential\b|\bsfd\b|\bsfr\b/i;

export type OccupancyClass = 'home' | 'residential' | 'other';

/** home: no address; residential: block only; other (commercial, multi-family): the exact building address. unknownType: residential. */
export function occupancyClassOf(typeValues: readonly string[], unknownType = false): OccupancyClass {
  const t = typeValues.filter(Boolean).join(' | ');
  if (HOME_OCCUPANCY_RE.test(t)) return 'home';
  if (unknownType) return 'residential';
  if (MULTI_RE.test(t)) return 'other';
  return RESIDENTIAL_CO_RE.test(t) ? 'residential' : 'other';
}

/** The trailing quadrant (NW, NE, SW, SE) right after the street that cleanAddress keeps, or ''. */
export function quadrantAfter(raw: string): string {
  const t = raw.replace(/,/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
  const kept = (cleanAddress(t) ?? '').toUpperCase();
  if (!kept || !t.startsWith(kept)) return '';
  const next = t.slice(kept.length).trim().split(' ')[0] ?? '';
  return /^(?:NW|NE|SW|SE)\.?$/.test(next) ? next.replace(/\.$/, '') : '';
}

/**
 * The public address of a certificate-of-occupancy row and whether its private site contact must go: a home occupation prints nothing; a
 * residential certificate prints its BLOCK only (site-311.ts blockOfAddress: never a house number, nothing with a unit); anything else
 * prints `exact` (the address the shared rule kept). With keepQuadrant, a trailing NW/NE/SW/SE is kept on either form.
 */
export function occupancyAddress(rawAddress: string, exact: string, cls: OccupancyClass, keepQuadrant = false): { address: string; dropSite: boolean } {
  const q = keepQuadrant ? quadrantAfter(rawAddress) : '';
  const add = (a: string) => (a && q ? `${a} ${q}` : a);
  if (cls === 'home') return { address: '', dropSite: true };
  if (cls === 'residential') return { address: add(blockOfAddress(rawAddress)), dropSite: true };
  return { address: add(exact), dropSite: false };
}

/**
 * Review P3: a new-business summary with its premises address must fit in 280 characters WITH the whole address: when it does not, the
 * address is left out (never cut in the middle); without an address the summary is cut as before.
 */
export function businessSummary(parts: readonly string[], address: string): string | null {
  const t = (x: string) => x.replace(/\s+/g, ' ').trim();
  const full = t(parts.join(' | '));
  if (full.length <= 280) return full || null;
  const rest = t(parts.filter((p) => !address || p !== address).join(' | '));
  return (rest.length <= 280 ? rest : `${rest.slice(0, 277).trimEnd()}...`) || null;
}

