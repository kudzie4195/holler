/**
 * The one rule for the house number of a job-site address (round 18 integration). The contact gate (lib/signals/alert-gate.ts
 * textShowsPlace), the address lists (lib/lists/core.ts buildingAddress) and the business phone lookup at a site (lib/enrich/business-lookup.ts
 * parseStreet) all read a site address as a house number that is not 0 followed by a street, with any unit cut off. A hundred-block
 * ("1200 block of Main St") names a block, not a building: the gate still counts it as a place to go (round 18 ROUTES review 2, decision 3),
 * but it is never a building on a list and never an address a listing is matched against. Pure and client-safe.
 */

/** "0", "00", "0A", "0 1/2": a house number of zeros is never a site (placeholder rows in several permit feeds). */
export function isZeroHouseNumber(house: string): boolean {
  return /^\d/.test(house) && !/[1-9]/.test(house.replace(/\s+1\/2$/, '').replace(/[A-Za-z]+$/, ''));
}

/** "1200 block of Main St", "1200 BLK MAIN ST", "1200 block Main St": a hundred-block, not a building. */
export function isHundredBlock(text: string): boolean {
  return /^\s*\d+[A-Za-z]?\s+(?:block|blk)\b/i.test(text);
}

const SUFFIX = new Set(
  'st street ave avenue av blvd bv boulevard rd road dr drive ln lane ct court pl place way wy pkwy pky parkway hwy highway cir circle ter terrace trl trail sq square loop run row aly alley xing crossing pass path walk cv cove pt point ridge bnd bend expy fwy plz plaza'.split(' '),
);
const QUADRANT = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']);
/** Plural count words: "30 DAYS ST", "2 UNITS DR" are counts, not streets. ("14 Story St" is a street: singular words are kept.) */
const COUNT_PLURALS = new Set('days months years hours units stories floors levels lots acres beds bedrooms baths rooms buildings permits stalls spaces seats'.split(' '));
/** ", ATLANTA, GA 30309", " MATTHEWS NC 28105": a printed city, state and ZIP after the street. */
const CITY_STATE_ZIP_TAIL = /(?:,\s*[A-Za-z][A-Za-z .'-]{0,30}?,?|\s+[A-Za-z][A-Za-z'-]{1,24},?)\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?$/;

/**
 * The building street of one summary part that the contact gate already reads as a place, for a part the display cutter
 * (permit-value.ts siteAddressFromSummary) does not cut: "6344 TILLEY WY MATTHEWS NC 28105" -> "6344 TILLEY WY", "346 HENRY AARON SW,
 * ATLANTA, GA 30310" -> "346 HENRY AARON SW", "10416 E INDEPENDENCE BV 650" -> "10416 E INDEPENDENCE BV", "14 Story St, Cambridge, MA
 * 02138" -> "14 Story St". Strict: the street must END in a street type or a quadrant after a name word (a bare number after it is a unit and
 * is dropped), so a word typed after the street (a name, a borough, a city with no ZIP) is never printed: such a part gives null. Null too for
 * house number 0, a hundred-block, more than five street words and a count ("30 DAYS ST"). Round 18 integration (Part B item 5).
 */
export function buildingStreetFromPart(part: string | null | undefined): string | null {
  if (typeof part !== 'string') return null;
  const t = part.replace(/\s+/g, ' ').trim().replace(CITY_STATE_ZIP_TAIL, '').replace(/[,.;]+$/, '').trim();
  const m = /^(\d{1,6}[A-Za-z]?(?:-\d{1,6}[A-Za-z]?)?)\s+(.+)$/.exec(t);
  if (!m || isZeroHouseNumber(m[1]) || isHundredBlock(t)) return null;
  let w = m[2].split(' ');
  if (w.length > 2 && /^\d{1,5}[A-Za-z]?$/.test(w[w.length - 1])) w = w.slice(0, -1);
  if (w.length < 2 || w.length > 5 || !w.every((x) => /^[A-Za-z0-9'.-]+$/.test(x))) return null;
  const k = w.map((x) => x.toLowerCase().replace(/\.$/, ''));
  if (k.some((x) => COUNT_PLURALS.has(x))) return null;
  const last = k[k.length - 1];
  const nameBefore = (i: number) => k.slice(0, i).some((x) => !QUADRANT.has(x) && !SUFFIX.has(x));
  const ok = (SUFFIX.has(last) && nameBefore(k.length - 1)) || (QUADRANT.has(last) && nameBefore(k.length - 1));
  return ok ? `${m[1]} ${w.join(' ')}` : null;
}
