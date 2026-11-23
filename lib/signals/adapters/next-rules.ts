import { createHash } from 'node:crypto';
import { extractContacts, type ContactSpec } from '@/lib/contacts/extract';
import type { CategoryId } from '@/lib/signals/categories';
import { scrubText } from './permit-privacy';

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
export function premisesAddressOf(read: (field: string) => string, spec: ContactSpec | undefined, place: { city: string; state: string }): string {
  if (!spec?.site?.onlyWithOrganisation) return '';
  const found = extractContacts(read, spec, place, 'business');
  if (!found.some((c) => c.role === 'business' && c.name)) return '';
  const site = found.find((c) => c.role === 'site' && typeof c.address === 'string' && c.address.trim());
  return site?.address?.trim() ?? '';
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

/** A stable external id that cannot be read back into the raw id (a taxpayer number): "h" + 24 hex of its sha256. '' stays ''. */
export function hashedId(raw: string): string {
  return raw ? `h${createHash('sha256').update(raw).digest('hex').slice(0, 24)}` : '';
}

export { isCompanyForm, isStorefrontNaics, isFoodNaics } from './next-filters';
