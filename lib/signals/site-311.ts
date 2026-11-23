import { blockSiteAddress, cleanAddress } from '@/lib/contacts/sanitize';
import type { ContactInput } from '@/lib/contacts/types';
import { nycBlockAddress } from '@/lib/signals/adapters/nyc-address';

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
 * Round 21 integration: ONE rule for every 311 block. The New York whole-building heat path of r20-ship (socrata-datasets.ts
 * buildingAddress: "HEAT/HOT WATER / ENTIRE BUILDING" and "NON-RESIDENTIAL HEAT", exact values of two columns) is the one request type
 * NEVER_SITE_311_RE would refuse by its heat words; it keeps its own exact type test and comes here for everything else
 * (nycWholeBuildingContact): the same unit refusal (UNIT_IN_ADDRESS_RE: an address that names an apartment gives no block, as NEXT's
 * review fix P2-4 required; before round 21 the New York path dropped the unit and kept the block), the New York street reader
 * (nyc-address.ts nycBlockAddress) in place of cleanAddress, the same block check (sanitize.ts blockSiteAddress, which is also
 * isBlockForm), the same 5-digit ZIP rule and the same contact gate (extract.ts contactsAllowedFor / isBlockSiteContact).
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
  // Review fix P2-4: condo, duplex, mobile home, rental, renter, occupied, inside, interior and dwelling too (a home or unit from the inside).
  /\bcondo|\bduplex\b|\bmobile home|\brental\b|\brenter|\boccupied\b|\binside\b|\binterior\b|\bdwelling|\bapartment\b|\bapt\b|\bunit\b|\btenant|\blandlord\b|\bheat\b|\bhot water\b|\bnoise\b|\bloud\b|\bneighbou?r|\bdomestic\b|\bharass|\bpanhandl|\bhomeless|\bencampment|\bwelfare\b|\bwellness\b|\bsenior\b|\bchild\b|\bmedical\b|\bmissed (?:collection|pickup|pick-up)\b|\bgarbage cart\b|\brecycl/i;

/**
 * The shared default list of property-condition request types (rule 1), assumed from the published 311 type names of Dallas, Houston,
 * Chicago and New York (not read live this round). A source may use its own list.
 */
export const PROPERTY_CONDITION_311_RE =
  /\bhigh weeds?\b|\bweeds?\b|\bovergrown\b|\btall grass\b|\bjunk(?:ed)?\s+(?:motor\s+)?vehicle|\binoperable vehicle|\bopen (?:and|&) vacant\b|\bvacant (?:lot|structure|building|house)\b|\bsubstandard\b|\bdangerous (?:building|structure)\b|\bunsecured (?:building|structure)\b|\bill?egal dumping\b|\bdumping\b|\bjunk and debris\b|\bdebris on private\b|\blitter on private\b|\bgraffiti\b.*\b(?:private|building|property)\b|\brodent|\brats?\b|\bmosquito|\bstagnant (?:water|pool)\b|\bswimming pool\b|\bfence\b|\bminimum property standards?\b|\bproperty maintenance\b/i;

/** A unit, floor or pad word, or a "#", anywhere in an address. */
export const UNIT_IN_ADDRESS_RE = /#|\b(?:apt|apartment|unit|ste|suite|fl|flr|floor|rm|room|bldg|rear|bsmt|basement|lot|trlr|trailer|space|spc|ph|penthouse)\b/i;

/**
 * "2318 W 47TH ST" -> "2300 block of W 47TH ST"; an address with a unit ("12 MAIN ST APT 4") or anything unsure -> ''.
 * `reader` 'nyc' reads the street by the New York rule (numbered streets, Queens house numbers, named streets; nyc-address.ts) instead of
 * cleanAddress; every other check is the same.
 */
export function blockOfAddress(raw: string, reader: 'shared' | 'nyc' = 'shared'): string {
  // Review fix P2-4: an address that names a unit (APT, UNIT, #, floor, suite, rear, basement, lot, trailer) is a home or a part of a
  // building: no block at all, rather than the block of the unit.
  if (UNIT_IN_ADDRESS_RE.test(raw)) return '';
  if (reader === 'nyc') return blockSiteAddress(nycBlockAddress(raw)) ?? '';
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
  return { role: 'site', name: '', address, city: place.city, state: place.state, zip: zip5(place.zip) };
}

/** The ZIP a 311 site contact may carry: five digits only. */
function zip5(zip: string | null | undefined): string | null {
  return typeof zip === 'string' && /^\d{5}$/.test(zip) ? zip : null;
}

/** Round 21: the New York whole-building heat request's block (socrata-datasets.ts buildingAddress), through the one 311 rule. */
export interface WholeBuilding311Rule {
  /** Address columns, joined with spaces in order. Read only here, never printed on the public row. */
  fields: string[];
  /** The exact request types about a whole building (isWholeBuildingNyc311). */
  when: (get: (field: string) => string) => boolean;
}

/** The private block-level site of a New York whole-building 311 request, or null. Same unit, block, ZIP and gate rules as site311Contact. */
export function nycWholeBuildingContact(get: (field: string) => string, rule: WholeBuilding311Rule, place: { city: string; state: string; zip?: string | null }): ContactInput | null {
  if (!rule.when(get)) return null;
  const raw = rule.fields.map((f) => get(f)).filter(Boolean).join(' ');
  const address = raw ? blockOfAddress(raw, 'nyc') : '';
  if (!address) return null;
  return { role: 'site', name: '', address, city: place.city, state: place.state, zip: zip5(place.zip) };
}
