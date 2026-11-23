import { cleanAddress } from '@/lib/contacts/sanitize';
export { BLOCK_ADDRESS_RE } from '@/lib/contacts/sanitize';
import { STREET_SUFFIX_WORDS, holdsGivenName, looksLikeFullPersonName } from '@/lib/contacts/org';

/**
 * New York street addresses (round 20 VIOL review fixes P2-1, P2-2, P2-4). The shared rules (lib/contacts cleanAddress, socrata.ts
 * blockAddress) are written for cities that spell numbered streets with "TH" and use one house number. New York writes "EAST 130 STREET",
 * "41-20 BOWNE STREET" (Queens: cross street 41, house 20), "PARK AVENUE SOUTH" (a direction after the street type is part of the name) and
 * named streets with no type ("GRAND CONCOURSE", "CENTRAL PARK WEST"). These two functions read such an address for NEW YORK sources only;
 * every other source keeps the shared rules unchanged.
 *
 * nycBuildingAddress: the building's street address (house number and street, a trailing direction kept), NEVER a unit, or '' when unsure.
 * It is built only from: a house number; a street that the shared cleanAddress kept (its person-name and phone checks apply), or a fixed
 * numbered-street shape (an optional direction, 1 to 3 digits, a street type), or a street on the fixed named-street list below. So no free
 * text can reach it. It is an internal step: nothing stores or shows it (members and public rows get nycBlockAddress only).
 *
 * nycBlockAddress: the block of that address: "2300 block of WEST 52 STREET", "0-99 block of ...", Queens "41-00 block of BOWNE STREET".
 */

const DIR_RE = /^(?:N|S|E|W|NORTH|SOUTH|EAST|WEST)\.?$/i;
const NUMBERED_TYPE = '(?:STREET|ST|AVENUE|AVE|ROAD|RD|PLACE|PL|DRIVE|DR|TERRACE|TER|LANE|LN|COURT|CT)';
/** "[EAST] 148 STREET", "34 AVENUE", "BEACH 20 STREET": a number street in a fixed shape (digits and fixed words only). */
const NUMBERED_STREET_RE = new RegExp(`^((?:(?:NORTH|SOUTH|EAST|WEST|N|S|E|W|BEACH)\\s+)?\\d{1,3}\\s+${NUMBERED_TYPE})(?=\\s|$)`, 'i');
/** Unit words that must never survive in a street (checked again on the result). */
const UNIT_TOKEN_RE = /^(?:#.*|APT\.?|APARTMENT|UNIT|STE|SUITE|FL|FLR|FLOOR|RM|ROOM|BLDG|PH|PENTHOUSE|BSMT|BASEMENT|REAR|FRONT|LOWER|UPPER|UPPR|STORE|GARDEN|\d+(?:ST|ND|RD|TH)?FL|\d+[A-Z]{0,2}|[A-Z]?\d+[A-Z]?)$/i;

/** Words that mark a unit or a part of a building, never part of a street name. */
const UNIT_WORD_RE = /^(?:APT\.?|APARTMENT|UNIT|STE|SUITE|FL|FLR|FLOOR|RM|ROOM|BLDG|PH|PENTHOUSE|BSMT|BASEMENT|REAR|FRONT|LOWER|UPPER|UPPR|STORE|GARDEN|GARAGE|PVT|HOUSE)$/i;

/**
 * New York streets with no street type, or with more words than the shared rule keeps. A FIXED list (public street names, assumed from
 * the city's street grid, not read from a portal): a value matches only word for word, so nothing typed into a street column can pass as one.
 */
export const NYC_NAMED_STREETS: readonly string[] = [
  'ADAM CLAYTON POWELL JR BOULEVARD', 'FREDERICK DOUGLASS BOULEVARD', 'MALCOLM X BOULEVARD', 'MARTIN LUTHER KING JR BOULEVARD',
  'CENTRAL PARK WEST', 'CENTRAL PARK SOUTH', 'CENTRAL PARK NORTH', 'GRAND CONCOURSE', 'BRONX PARK EAST', 'BRONX PARK SOUTH',
  'RIVERSIDE DRIVE WEST', 'BROADWAY', 'BOWERY', 'FULTON STREET', 'SHORE FRONT PARKWAY', 'PROSPECT PARK WEST', 'PROSPECT PARK SOUTHWEST',
];

const norm = (raw: string) =>
  raw
    .toUpperCase()
    .replace(/,/g, ' ')
    .replace(/(\d)\s*-\s*(\d)/g, '$1-$2')
    .replace(/\s+/g, ' ')
    .trim()
    // A fractional house number ("123 1/2 EAST 10 STREET") is read as its whole number.
    .replace(/^(\S+) \d\/\d(?= )/, '$1');

/** The house number token: "2318", "41-20", "123A", "123-125". House number 0 is never a place. */
const HOUSE_RE = /^(\d{1,5}(?:-\d{1,5})?[A-Z]?)$/i;

function streetFromClean(rest: string[], kept: string[]): string[] | null {
  // kept: the street tokens the shared cleanAddress kept (after the house number); rest: the raw tokens after the house number.
  let end = -1;
  for (let i = 0; i < kept.length; i++) {
    const w = kept[i].replace(/\.$/, '').toLowerCase();
    if (!STREET_SUFFIX_WORDS.has(w)) continue;
    const next = kept[i + 1];
    if (i === 0 || (i === 1 && DIR_RE.test(kept[0]) && !/^\d/.test(kept[0]))) {
      // Type first: "AVENUE H", "AVENUE J" (Brooklyn), never "PLAZA 5A" or "ST MARKS".
      if ((w === 'avenue' || w === 'ave') && next && /^[A-Z]$/i.test(next)) {
        end = i + 1;
        break;
      }
      if (i === 0) continue;
    }
    end = i;
    break;
  }
  let street: string[];
  if (end >= 0) street = kept.slice(0, end + 1);
  else {
    // No street type: one street word (BROADWAY-like) after an optional direction, as the shared rule allows.
    const d = DIR_RE.test(kept[0] ?? '') && kept.length > 1 ? 1 : 0;
    if (!kept[d]) return null;
    street = kept.slice(0, d + 1);
  }
  // A direction right after the kept street is part of its name ("PARK AVENUE SOUTH", "PLAZA STREET EAST", "PELHAM PARKWAY NORTH").
  const after = rest[street.length];
  if (after && DIR_RE.test(after) && rest.slice(0, street.length).join(' ') === street.join(' ')) street = [...street, after.replace(/\.$/, '')];
  return street;
}

/**
 * Review P3-7: a kept address ("<house> <words...>") whose first street word is a person's given name, or whose first two street words read as
 * a person's name, while the words after them still make a street on their own ("451 ZELDA WEST 52 STREET", "8701 MARIA LOPEZ GEORGIA AVE"):
 * a name was typed into the house-number or street column. Such an address gives nothing. A street that IS a given name with only its
 * type after it ("12 FRANKLIN AVENUE") is not refused: the rest is not a street on its own.
 */
export function nameBeforeStreet(kept: string): boolean {
  const w = kept.replace(/\s+/g, ' ').trim().split(' ');
  const house = w[0];
  const rest = w.slice(1);
  if (rest.length < 3) return false;
  // A word that can be the start of a street name on its own: a direction, a street type ("ST MARKS"), a number or a unit word.
  const streetish = (x: string) => DIR_RE.test(x) || STREET_SUFFIX_WORDS.has(x.replace(/\.$/, '').toLowerCase()) || /\d/.test(x) || UNIT_WORD_RE.test(x) || /^SAINT$/i.test(x);
  const restIsStreet = (from: number) => {
    const tail = rest.slice(from);
    if (tail.length < 2 || STREET_SUFFIX_WORDS.has(tail[0].toLowerCase()) || UNIT_WORD_RE.test(tail[0])) return false;
    return NUMBERED_STREET_RE.test(tail.join(' ')) || Boolean(cleanAddress(`${house} ${tail.join(' ')}`));
  };
  if (!streetish(rest[0]) && /^[A-Z'-]+$/i.test(rest[0]) && holdsGivenName(rest[0]) && restIsStreet(1)) return true;
  if (!streetish(rest[0]) && !streetish(rest[1]) && looksLikeFullPersonName(`${rest[0]} ${rest[1]}`) && restIsStreet(2)) return true;
  return false;
}

/** The building's street address (no unit), or ''. See the file header. */
export function nycBuildingAddress(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const t = norm(raw);
  if (!t || /\bP\.?\s?O\.?\s*BOX\b/.test(t)) return '';
  const tokens = t.split(' ');
  const house = tokens[0];
  if (!HOUSE_RE.test(house) || /^0+(?:\D|$)/.test(house) || (house.match(/\d/g) ?? []).length > 6) return '';
  const rest = tokens.slice(1);
  const restText = rest.join(' ');
  let street: string[] | null = null;
  // 1. A named street, word for word, longest first.
  for (const name of [...NYC_NAMED_STREETS].sort((a, b) => b.length - a.length)) {
    if (restText === name || restText.startsWith(`${name} `)) {
      street = name.split(' ');
      const after = rest[street.length];
      if (after && DIR_RE.test(after) && !DIR_RE.test(street[street.length - 1])) street = [...street, after.replace(/\.$/, '')];
      break;
    }
  }
  // 2. A numbered street in the fixed shape ("EAST 130 STREET", "148 STREET", "BEACH 20 STREET").
  if (!street) {
    const m = NUMBERED_STREET_RE.exec(restText);
    if (m) {
      street = m[1].split(' ');
      const after = rest[street.length];
      if (after && DIR_RE.test(after)) street = [...street, after.replace(/\.$/, '')];
    }
  }
  // 3. Whatever the shared rule keeps (its name, phone and role checks apply).
  if (!street) {
    const kept = cleanAddress(t);
    if (!kept) return '';
    const keptTokens = kept.split(' ').slice(1);
    street = streetFromClean(rest, keptTokens);
  }
  if (!street || street.length === 0) return '';
  if (nameBeforeStreet(`${house} ${rest.join(' ')}`) && !NYC_NAMED_STREETS.some((n) => restText.startsWith(n))) return '';
  // Never a unit, in any spelling: a street ending in a unit-like token is not trusted (the type, a direction or a named word ends it).
  const last = street[street.length - 1];
  if (street.some((w) => w.startsWith('#') || UNIT_WORD_RE.test(w)) || (UNIT_TOKEN_RE.test(last) && !NUMBERED_STREET_RE.test(street.join(' ')) && !/^[A-Z]$/i.test(last))) return '';
  return `${house} ${street.join(' ')}`;
}

/** The block of a New York address: "2300 block of WEST 52 STREET", "0-99 block of ...", Queens "41-00 block of BOWNE STREET"; or ''. */
export function nycBlockAddress(raw: unknown): string {
  const exact = nycBuildingAddress(raw);
  if (!exact) return '';
  const at = exact.indexOf(' ');
  const house = exact.slice(0, at);
  const street = exact.slice(at + 1);
  const queens = /^(\d{1,3})-(\d{2})[A-Z]?$/i.exec(house);
  if (queens) return `${Number(queens[1])}-00 block of ${street}`;
  const n = Number(/^(\d{1,5})/.exec(house)?.[1] ?? NaN);
  if (!Number.isFinite(n) || n <= 0) return '';
  const hundred = Math.floor(n / 100) * 100;
  return hundred === 0 ? `0-99 block of ${street}` : `${hundred} block of ${street}`;
}
