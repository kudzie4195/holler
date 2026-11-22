import { STREET_SUFFIX_WORDS, foldName, isListedGivenName, isVocabularyWord, registeredCompanyName } from './org';
import { gluedPersonWord, personWord, possessivePerson } from './trade-name';

/**
 * Round 18 (NAMES): the strict registered-company rule for OWNER, respondent and property-owner columns of code-violation records.
 *
 * A violation card may name the owner of the property only when the public record names a registered company, never a person. The
 * contractor trade-name rule (trade-name.ts) does NOT apply here: "Smith Roofing" in an owner column is refused, so is "John Smith".
 * ownerCompanyName(raw) returns the name with whitespace collapsed only when ALL hold (O0, institutional only, is described above
 * `institutional` below):
 *  O1. It ENDS with a legal form (LLC, L.L.C., INC, INCORPORATED, CORP, CORPORATION, CO, COMPANY, LP, L.P., LLP, LLLP, PLLC, LTD,
 *      LIMITED), or with "TRUST COMPANY" / "TRUST CO" (a bank acting as a corporate trustee), or with "HOUSING AUTHORITY" or
 *      "LAND BANK" / "LAND BANK AUTHORITY" (public landlords).
 *  O2. It passes registeredCompanyName (org.ts): plain ASCII, no phone, email or link, no role word (owner, tenant, trust, estate,
 *      c/o, agent, manager, same as, n/a ...), no DBA, no listed given name next to another word, no honorific, no initial, nothing
 *      that reads as a person ("JOHN SMITH LLC", "J SMITH LLC", "DR. PATEL HOLDINGS INC" fail). For the trust-company form the word
 *      "TRUST" is set aside for this check only; a personal trust ("SMITH FAMILY TRUST", "JOHN SMITH TR", "LAND TRUST #1234") never
 *      ends with a legal form and fails O1.
 *  O3. At most 70 characters (registeredCompanyName).
 */
const LEGAL_END_RE = /(?:^|\s)(?:l\.?l\.?c\.?|inc\.?|incorporated|corp\.?|corporation|co\.?|company|l\.?p\.?|l\.?l\.?p\.?|lllp|p\.?l\.?l\.?c\.?|ltd\.?|limited)$/i;
const TRUST_COMPANY_RE = /\strust\s+(?:co\.?|company)$/i;
const PUBLIC_LANDLORD_RE = /\s(?:housing authority|land bank(?: authority)?)$/i;

/**
 * Redo 1 (review P1-3, P2-4; commander rule 7): INSTITUTIONAL owners only. Words that describe the entity (legal forms, company and
 * landlord words below) are set aside; every other word must not be a person-name word: a listed given name, a listed surname, an
 * initial or a one- or two-letter word ("JS LLC"), a placeholder ("TAXPAYER LLC"), a given name glued to a surname ("JOHNSMITH LLC", "MARIAGARCIA LLC") or one or two letters glued to a surname ("JSMITH
 * PROPERTIES LLC", "MGARCIA LLC"), a possessive person form, or FAMILY. So "SMITH LLC", "MARIA LLC", "GARCIA PROPERTIES LLC", "PARK
 * MANAGEMENT INC" are refused (privacy first: a one-word personal LLC is how one person holds one building).
 */
const ENTITY_WORDS = new Set(
  (
    'llc l l c inc incorporated corp corporation co company lp llp lllp pllc ltd limited the of and ' +
    'management managment mgmt mgt realty properties property associates holdings holding group partners equities enterprises development ' +
    'housing apartments residential capital services investments ventures builders construction brokerage authority land bank trust ' +
    'national association fund reit homes'
  ).split(/\s+/),
);
const PLACEHOLDER_OWNER = new Set('taxpayer taxpayers unknown current occupant resident owner owners none same various'.split(' '));
/**
 * Redo 2 (review P2-4): English words that are also US surnames and are on neither name list ("GOLD LLC", "BRIGHT LLC", "HAWK PROPERTIES
 * LLC", "ROCK HAWK LLC"). Treated as person-name words in owner names only.
 */
const OWNER_SURNAME_WORDS = new Set('gold bright hawk bull rock grey gray leaf bear rain golden stone wood woods steel'.split(' '));
/**
 * Redo 2 (commander rule 8): an institution word makes a one-word owner institutional ("CHICAGO HOUSING AUTHORITY", "NORTHERN TRUST
 * COMPANY", "LAKEVIEW APARTMENTS LLC", "MIDWEST REALTY CORP"). PROPERTIES, MANAGEMENT and the like count only with a place word
 * ("LAKEVIEW PROPERTIES INC", "NORTHSIDE PROPERTIES LLC").
 */
const INSTITUTION_WORDS = new Set(
  (
    'authority apartments apartment realty bank bancorp trust university college school schools church churches ministries diocese county ' +
    'city hospital cooperative association housing redevelopment'
  ).split(' '),
);
const PLACE_OWNER_WORDS = new Set(
  (
    'north south east west northern southern eastern western central northside southside eastside westside midwest northwest northeast ' +
    'southwest southeast downtown uptown midtown metro metropolitan lakeview lakeside lakeshore lakefront riverside riverview parkside ' +
    'hillside bayside harborside harbor harbour valley heights highlands gateway chicago atlanta seattle boston miami orlando tampa ' +
    'nashville detroit oakland brooklyn queens bronx manhattan harlem buckhead decatur smyrna evanston skokie'
  ).split(/\s+/),
);
const FAMILY_RE = /\b(?:family|fam|families|heirs?|estates?|living|revocable|irrevocable|trustees?|kids|children|siblings|grandkids|grandchildren|grandpa|grandma)\b/i;

/**
 * Redo 2: a building entity named for its address ("342 WEST 71 STREET LLC", "2078 MORRIS LLC", "595 E 170TH LLC"): a house number at the
 * start, then a street. The street words may be surnames or direction letters ("MORRIS", "E"), never a listed first name, a glued name,
 * a possessive person form or FAMILY.
 */
function addressEntity(t: string): boolean {
  const raw = t.split(/[\s,/()&.#]+/).filter(Boolean);
  if (!raw.length || !/^\d{1,6}(?:-\d{1,6})?[a-z]?$/i.test(raw[0])) return false;
  const words = raw.slice(1).filter((w) => !/\d/.test(w)).map((w) => foldName(w).replace(/[^a-z']/g, '')).filter(Boolean);
  const street = words.filter((w) => !ENTITY_WORDS.has(w));
  if (!street.length) return false;
  // A listed first name counts as a street name only next to a street suffix ("2078 MORRIS AVE LLC"); a direction is always a direction.
  const hasSuffix = words.some((w) => STREET_SUFFIX_WORDS.has(w));
  const direction = (w: string) => /^(?:[nsew]|north|south|east|west)$/.test(w);
  return street.every((w) => direction(w) || STREET_SUFFIX_WORDS.has(w) || (w.length > 1 && (hasSuffix || !isListedGivenName(w)) && !gluedPersonWord(w) && !possessivePerson(w) && !PLACEHOLDER_OWNER.has(w)));
}

function institutional(t: string): boolean {
  if (FAMILY_RE.test(t)) return false;
  if (addressEntity(t)) return true;
  const words = t.split(/[\s,/()&.#-]+/).filter((w) => !/\d/.test(w)).map((w) => foldName(w).replace(/[^a-z']/g, '')).filter(Boolean);
  const rest = words.filter((w) => !ENTITY_WORDS.has(w));
  // Initials ("JS LLC", "MG PROPERTIES LLC") and placeholder owners ("TAXPAYER LLC", "UNKNOWN OWNER LLC") are refused too.
  if (!rest.every((w) => w.length > 2 && !PLACEHOLDER_OWNER.has(w) && !OWNER_SURNAME_WORDS.has(w) && !personWord(w) && !possessivePerson(w))) return false;
  // Every other word must be a plain vocabulary word (a place, a descriptive word, a street word) or a number: a word on no list cannot
  // be told apart from a first name missing from the lists ("Deontay Homes LLC"), so it is refused (privacy first; this also refuses
  // "STONEHENGE MANAGEMENT LLC" and "DEUTSCHE BANK NATIONAL TRUST COMPANY").
  if (!rest.every((w) => isVocabularyWord(w) || STREET_SUFFIX_WORDS.has(w))) return false;
  // Redo 2 (commander rule 8): a single word plus a legal form is never institutional ("GOLD LLC", "1864 CORP"). Two or more such words
  // ("123 MAIN STREET LLC", "NORTHERN TRUST COMPANY"), an institution word, or a place word with PROPERTIES / MANAGEMENT / HOMES.
  if (rest.length >= 2) return true;
  if (words.some((w) => INSTITUTION_WORDS.has(w))) return true;
  return rest.length === 1 && PLACE_OWNER_WORDS.has(rest[0]) && words.some((w) => ENTITY_WORDS.has(w) && !/^(?:llc|l|c|inc|incorporated|corp|corporation|co|company|lp|llp|lllp|pllc|ltd|limited|the|of|and)$/.test(w));
}

export function ownerCompanyName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (!institutional(t)) return null;
  if (TRUST_COMPANY_RE.test(t)) {
    // "CHICAGO TITLE LAND TRUST COMPANY": checked as "CHICAGO TITLE LAND COMPANY", stored as written. Nothing may follow the legal form.
    if (/\btrust\b.*\btrust\b/i.test(t)) return null;
    return registeredCompanyName(t.replace(TRUST_COMPANY_RE, ' COMPANY')) ? t : null;
  }
  if (PUBLIC_LANDLORD_RE.test(t)) {
    // "HOUSING AUTHORITY OF THE CITY OF X" is not this shape; "ATLANTA HOUSING AUTHORITY" is. HOUSING is a company marker in org.ts.
    return registeredCompanyName(t.replace(/\s(?:authority)$/i, '').replace(/\sland bank$/i, ' HOUSING')) ? t : null;
  }
  if (!LEGAL_END_RE.test(t)) return null;
  return registeredCompanyName(t);
}

/** True only when ownerCompanyName returns the same string (after whitespace normalization). */
export function isOwnerCompanyName(name: unknown): boolean {
  return typeof name === 'string' && ownerCompanyName(name) === name.replace(/\s+/g, ' ').trim() && ownerCompanyName(name) !== null;
}
