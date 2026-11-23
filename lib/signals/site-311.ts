import { blockSiteAddress, cleanAddress } from '@/lib/contacts/sanitize';
import type { ContactInput } from '@/lib/contacts/types';

/**
 * Round 20 (NEXT): the ONE rule for a 311 request's address, in every city. Owner decision (2026-11-22): a block-level address counts as a
 * place to go, and a 311 row gets AT MOST a block-level site, never an exact house number. A 311 request is made by a resident, often about
 * their own street or home, so:
 *
 *   1. Only request types about the condition of a PROPERTY or PREMISES someone else is responsible for (high weeds, a junk vehicle on a lot,
 *      an open or substandard structure, illegal dumping, rodents at a building, graffiti on a building) can give a site at all
 *      (`propertyTypes`, per source, read from the request type column only).
 *   2. A request type that is about a home or a unit from the inside (apartment, unit, tenant, heat or hot water in an apartment, noise,
 *      a neighbour) never gives one, whatever the source's list says (NEVER_SITE_311_RE). NYC "HEAT/HOT WATER / APARTMENT ONLY" stays
 *      without any address.
 *   3. The address column is read through lib/contacts cleanAddress (house number, street words, street suffix; person-name, phone and role
 *      checks) and turned into its BLOCK ("2318 W 47TH ST" -> "2300 block of W 47TH ST"). Anything the rule is unsure of gives nothing.
 *   4. The block is a PRIVATE site contact (holler_signal_contacts, service role only; shown to a member with access on the card). The
 *      public row (title, summary, data) never carries it: 311 summaries keep leaving the street out (socrata.ts, arcgis.ts).
 *   5. lib/contacts/extract.ts contactsAllowedFor lets a 311 row keep this block-level site and nothing else, at extraction and before
 *      any write; sanitize.ts keeps the block form as written (blockSiteAddress).
 *
 * INTEGRATION NOTE: branch r20-viol writes its own NYC whole-building heat block (nyc-address.ts nycBlockAddress, socrata-datasets.ts
 * buildingAddress) and its own block test (sanitize.ts isBlockForm, extract.ts isBlockSite). At integration keep ONE gate: the New York
 * reader may produce the block, but the type test (NEVER_SITE_311_RE plus a source's propertyTypes) and the contact gate should be these.
 *
 * Pure: no I/O.
 */

export interface Site311Rule {
  /** Address columns, joined with spaces in order. Read only here, never printed on the public row. */
  addressFields: string[];
  /** The request type column(s): the only text the type test reads (never a free-text description). */
  typeFields: string[];
  /** Request types about the condition of a property or premises (rule 1). */
  propertyTypes: RegExp;
}

/**
 * Request types that are about a home or a unit from the inside, or about people rather than a property (rule 2). Applied to every source.
 * "APARTMENT ONLY" is the NYC heat descriptor for one flat.
 */
export const NEVER_SITE_311_RE =
  /\bapartment\b|\bapt\b|\bunit\b|\btenant|\blandlord\b|\bheat\b|\bhot water\b|\bnoise\b|\bloud\b|\bneighbou?r|\bdomestic\b|\bharass|\bpanhandl|\bhomeless|\bencampment|\bwelfare\b|\bwellness\b|\bsenior\b|\bchild\b|\bmedical\b|\bmissed (?:collection|pickup|pick-up)\b|\bgarbage cart\b|\brecycl/i;

/**
 * The shared default list of property-condition request types (rule 1), assumed from the published 311 type names of Dallas, Houston,
 * Chicago and New York (not read live this round). A source may use its own list.
 */
export const PROPERTY_CONDITION_311_RE =
  /\bhigh weeds?\b|\bweeds?\b|\bovergrown\b|\btall grass\b|\bjunk(?:ed)?\s+(?:motor\s+)?vehicle|\binoperable vehicle|\bopen (?:and|&) vacant\b|\bvacant (?:lot|structure|building|house)\b|\bsubstandard\b|\bdangerous (?:building|structure)\b|\bunsecured (?:building|structure)\b|\bill?egal dumping\b|\bdumping\b|\bjunk and debris\b|\bdebris on private\b|\blitter on private\b|\bgraffiti\b.*\b(?:private|building|property)\b|\brodent|\brats?\b|\bmosquito|\bstagnant (?:water|pool)\b|\bswimming pool\b|\bfence\b|\bminimum property standards?\b|\bproperty maintenance\b/i;

/** "2318 W 47TH ST" -> "2300 block of W 47TH ST"; "12 MAIN ST APT 4" -> "0-99 block of MAIN ST"; anything unsure -> ''. */
export function blockOfAddress(raw: string): string {
  const exact = cleanAddress(raw);
  if (!exact || /^PO BOX\b/i.test(exact)) return '';
  const m = /^(\d{1,6})(?:-\d{1,6})?[A-Za-z]?\s+(.+)$/.exec(exact);
  if (!m) return '';
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return '';
  // The unit a cleaned address may still carry ("APT 4", "#5B", "STE 100") is never part of a block.
  const street = m[2].replace(/\s*(?:#.*|\b(?:apt|apartment|unit|ste|suite|fl|floor|rm|room|bldg)\b.*)$/i, '').trim();
  if (!street) return '';
  const block = n < 100 ? `0-99 block of ${street}` : `${Math.floor(n / 100) * 100} block of ${street}`;
  return blockSiteAddress(block) ?? '';
}

/** Rules 1 and 2: may a request of this type give a site at all? Reads the type column(s) only. */
export function site311TypeAllowed(get: (field: string) => string, rule: Pick<Site311Rule, 'typeFields' | 'propertyTypes'>): boolean {
  const type = rule.typeFields.map((f) => get(f)).filter(Boolean).join(' / ');
  if (!type) return false;
  if (NEVER_SITE_311_RE.test(type)) return false;
  return rule.propertyTypes.test(type);
}

/** The block-level site of one 311 row ('' when the type or the address does not allow one). */
export function site311Block(get: (field: string) => string, rule: Site311Rule): string {
  if (!site311TypeAllowed(get, rule)) return '';
  const raw = rule.addressFields.map((f) => get(f)).filter(Boolean).join(' ');
  return raw ? blockOfAddress(raw) : '';
}

/** The private site contact of one 311 row, or null (rule 4). City and state are the dataset's own; the ZIP only when it is 5 digits. */
export function site311Contact(get: (field: string) => string, rule: Site311Rule, place: { city: string; state: string; zip?: string | null }): ContactInput | null {
  const address = site311Block(get, rule);
  if (!address) return null;
  const zip = typeof place.zip === 'string' && /^\d{5}$/.test(place.zip) ? place.zip : null;
  return { role: 'site', name: '', address, city: place.city, state: place.state, zip };
}
