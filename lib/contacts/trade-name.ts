import {
  SURNAME_VOCAB,
  classifyWord,
  cleanOrgName,
  foldName,
  hasContactShape,
  hasRoleWord,
  hasStreetAddressShape,
  isListedGivenName,
  isListedSurname,
  isVocabularyWord,
  type WordClass,
} from './org';
import { knownCompanyName, knownFormHasLegalEnd } from './known-companies';

/**
 * Round 18 (NAMES, redo 1 after the privacy review): the names a CONTRACTOR column and a BUSINESS-LICENCE column may show.
 *
 * The owner's decision: a trade name in a contractor column is a business and may be shown, even when it carries a person's name
 * ("Smith Roofing", "Mary Jones Plumbing LLC", "Carter Electric"). The commander's redo decisions are privacy first: when in doubt, show
 * nothing. A person-shaped string is never a business just because its last word is a trade word.
 *
 * cleanContractorName(raw) returns a name only when ALL of these hold (the strict org.ts rule is one way to produce the candidate; it
 * goes through the same checks C1 to C8 afterwards, so nothing it accepts skips them):
 *  C1. Placeholders and owner-builder styles are refused: "Self", "Self Contractor", "No Contractor", "Owner Builder", "Homeowner",
 *      "None", "N/A", "TBD", "Various", "Unknown", "Same as owner" and the like (PLACEHOLDER_FIRST, PLACEHOLDER_RE), and SELF,
 *      PERSONAL, PRIVATE, HOMEOWNER, OWN anywhere ("John Smith Self Services"; PLACEHOLDER_ANYWHERE). A name with no
 *      distinctive word ("Roofing LLC", "The Roofing Company", "General Contractor", "Roof Repair") names nobody and is refused.
 *  C2. The value passes the same guards as the strict rule: at most 400 characters, no invisible or direction character, every letter
 *      ASCII after accent folding, no phone, email or link, no role word (owner, tenant, c/o, attn, trust, estate ...), no street
 *      address. "PERSON (COMPANY)" keeps the bracket only; "X DBA Y" keeps Y only; "PERSON of FIRM" and "PERSON c/o FIRM" keep the
 *      firm only, and only when the firm passes on its own (otherwise nothing). Any other comma or separator refuses the value
 *      ("SMITH, JOHN A", "Glass, Mary", "John Smith, Qualifier"); a legal form after a comma joins the name ("Smith Roofing, Inc.").
 *  C3. No honorific, suffix (JR, SR), credential, job-title or licence-holder word, connector (at, for, by, with, from ...). Digits only
 *      as a short token ("#1", "1ST", "A1").
 *  C4. A business marker, one of:
 *      - a final unambiguous legal form (STRONG_LEGAL: LLC, L.L.C., INC, INCORPORATED, CORP, CORPORATION, LTD, LIMITED, LLP, LLLP,
 *        PLLC, PLC, "LIMITED PARTNERSHIP"; "Company" spelled out only with no person-name word or with a second marker). Redo 2: the
 *        short forms CO, PA, PC, SA, AG, LP (NAME_LIKE_LEGAL) count only next to an unambiguous marker or in a name of three or more words
 *        with no person-name word ("Maria Co", "VANG PA", "Smith Co." are refused; "Smith Roofing Co" passes);
 *      - a family or partnership phrase at the end ("& Sons", "and Son", "& Daughters", "& Associates", "& Partners"), never after a
 *        first name alone ("John & Sons"). Redo 2: "Bros" and "Brothers" need a second marker ("Smith Brothers Roofing");
 *      - redo 2: a generic firm word (GENERIC_FORMS: Services, Group, Enterprises, Company, Associates, Solutions ...) qualifies alone only
 *        with no person-name word ("Acme Services"); next to one it needs a trade word or a strong legal form ("Smith Lawn Services",
 *        "Smith Services LLC"; "John Smith Services" is refused);
 *      - an UNAMBIGUOUS trade or business form (FIRM_WORDS below) in the final run of trade words, followed only by safe tail words
 *        ("Roofing Depot", "Plumbing Pros"). Ambiguous words that are also surnames or common nouns (AMBIGUOUS_WORDS below: Glass,
 *        Pool, Power, Cable, Service, Drain, Mold, Boring, Mason, Carpenter, Painter, Gardner, Stone, Wood, Steel, Tile, Homes, Tree,
 *        Lawn, Fence, Roof, Plumb, Barber, Kitchen, Market ...) NEVER qualify alone: they need a legal form, a family phrase or an
 *        unambiguous form in the same final run ("Smith Glass & Glazing"). "John Drain", "T Boring", "Mary Mold", "Deontay Glass",
 *        "Truong Pool", "Sherlock Homes" are refused; "Smith Homes LLC" passes.
 *      Without one of these, a value the strict rule accepted passes only when it is not person-shaped (C5) and does not end in an
 *      ambiguous word ("OPTIONS REAL ESTATE" passes; "Saoirse Tile" does not).
 *  C5. Without a legal form, an unambiguous marker that is itself a listed surname ("Cooling") does not lift the name alone: "Carter
 *      Electric" passes; "Mary Cooling" and "Jim Bob Cooling" do not ("Smith Heating & Cooling" passes on Heating). A person-shaped
 *      value (two words, or first + initial + last, no legal form) with no marker never passes.
 *  C6. Family and personal holding shapes are refused: FAMILY, ESTATE, HEIRS, TRUSTEE, LIVING, REVOCABLE anywhere, or a person-name word
 *      (a listed given name, a listed surname or an initial) followed by Properties, Holdings, Investments and the like, unless the name
 *      also carries a real trade (TRADE_FIRM_WORDS: Roofing, Plumbing ...). "SMITH FAMILY LLC", "John & Mary Smith Properties", "Smith
 *      Family Services" are refused; "Smith Family Roofing" passes.
 *  C7. A person beside a firm is refused: a listed given name after a trade word ("Roofing Mary Glass", "Services John Smith Services"),
 *      the same listed surname twice ("John Smith Smith Roofing"), "the" inside the name ("John Smith The Roofing").
 *  C8. At least one distinctive word, at most ten words, 3 to 120 characters, stable (cleanContractorName(x) gives itself back).
 *
 * Owner, applicant, tenant and resident columns never reach this function: names.ts uses it for role 'contractor' only.
 */

const list = (s: string): string[] => s.split(/\s+/).filter(Boolean);

/**
 * Real trades (C4, C6): gerund or plural trade forms that are not a common first name in US records. Each one can turn "X Roofing" into
 * a business. A word here that is also a listed surname ("Cooling") does not lift a person-shaped value (C5).
 */
export const TRADE_FIRM_WORDS: ReadonlySet<string> = new Set(
  list(
    'roofing roofers plumbing plumbers electric electrical electricians heating cooling hvac mechanical refrigeration ventilation ' +
      'conditioning air-conditioning construction constructors contracting contractors builders homebuilders remodeling remodelers ' +
      'renovations restoration restorations painting painters landscaping landscapers paving pavers fencing flooring siding gutters ' +
      'insulation drywall masonry concrete asphalt sealcoating excavating excavation demolition welding fabrication fabricators ' +
      'irrigation sprinklers waterproofing foundations carpentry cabinetry millwork plastering stucco hauling movers towing trucking ' +
      'cleaning janitorial exterminating engineering engineers architects surveying surveyors abatement hardscaping energy utilities ' +
      'telecommunications communications signage glazing',
  ),
);

/** Generic firm forms (C4): unambiguous, but not a trade, so they never lift the family and holding refusal of C6. */
export const FORM_FIRM_WORDS: ReadonlySet<string> = new Set(
  list('services enterprises group solutions systems industries technologies associates consulting consultants development developers'),
);

/** Holding words (C6): a marker for a firm, refused after a person-name word unless a real trade is also named. */
const HOLDING_WORDS: ReadonlySet<string> = new Set(
  list('properties property holdings holding investments investment realty ventures foundation management partners capital'),
);

/** Every unambiguous marker of C4. */
export const FIRM_WORDS: ReadonlySet<string> = new Set([...TRADE_FIRM_WORDS, ...FORM_FIRM_WORDS, ...HOLDING_WORDS]);

/**
 * Ambiguous words (C4): trade or business words that are also surnames, first names or common nouns. They never qualify alone. A
 * FIRM_WORDS word that is a listed given name or is on org.ts SURNAME_VOCAB is treated the same way.
 */
export const AMBIGUOUS_WORDS: ReadonlySet<string> = new Set(
  list(
    'glass pool pools power cable cables service drain drains mold boring mason carpenter painter gardner gardener stone stones wood woods ' +
      'steel tile tiles homes home tree trees lawn lawns fence fences roof roofs plumb barber barbers kitchen kitchens market markets ' +
      'solar air ac a/c comfort garage floor floors iron locks lock signs sign furnace furnaces junk spas spa fiber gutter rooter chimney ' +
      'chimneys shutters doors windows decks drilling repair repairs design designs pest lumber supply supplies equipment rentals ' +
      'storage moving transport security alarm alarms automation controls locksmith pizza grill bar tavern diner deli salon nails ' +
      'tailor cafe coffee tea liquor holding property investment',
  ),
);

/** Licence names (cleanBusinessName): business words beyond the contractor lists (each is also on AMBIGUOUS_WORDS). */
const LICENCE_WORDS: ReadonlySet<string> = new Set(
  list('pizza grill bar tavern diner kitchen deli locksmith locksmiths salon spa barber nails tailor cafe coffee tea market liquor'),
);

/** Words allowed after the last marker (C4): they describe the firm, never a person. */
const TAIL_WORDS: ReadonlySet<string> = new Set(
  list('pros pro experts expert masters guys team crew unlimited plus usa america express depot direct now today works'),
);

/**
 * A family or partnership phrase at the end (C4): "& Sons", "and Son", "& Daughters", "& Associates", "& Partners". Redo 2: accepted only
 * when the part before the "&" is not a first name alone ("Smith & Sons" passes; "John & Sons", "Mary & Daughters" do not). "Bros" and
 * "Brothers" are no family phrase any more ("Brothers" is a listed surname: "John Brothers", "Smith Brothers"); they need a second
 * marker ("Smith Brothers Roofing", "Smith Bros Inc").
 */
const FAMILY_TAIL = new Set(list('sons son daughters associates assoc partners'));
const BROTHERS = new Set(list('bros brothers'));

/**
 * Unambiguous legal forms (C4, redo 2): each makes a business on its own, subject to C1 (placeholders) and C6 (family and holdings).
 * "Company" spelled out is a legal form too, but next to a person-name word it is a generic word (GENERIC_FORMS) and needs a second
 * marker ("Acme Company" passes, "Maria Lopez Company" does not).
 */
const STRONG_LEGAL = new Set(list('llc inc incorporated corp corporation ltd limited llp lllp pllc plc company'));
/**
 * Redo 2 (review P1-A): short legal forms that are also surnames, given names or other words: Co ("Maria Co", "TRAN CO"), PA ("VANG PA",
 * "Lee Pa"), PC, SA, AG, LP ("Kim Lp"). They never make a two-word name a company. They count only next to an unambiguous marker (a
 * trade or business form, or a strong legal form before them: "Smith Roofing Co", "ACM PLUMBING CO.", "ARRINGTON ROOFING CO INC."), or in a
 * name of three or more words with no person-name word ("INVITATION HOMES LP"). A period does not change that ("Smith Co." is refused).
 */
const NAME_LIKE_LEGAL = new Set(list('co pa pc sa ag lp'));
/** Final legal forms (C4), dots removed. */
const LEGAL = new Set([...STRONG_LEGAL, ...NAME_LIKE_LEGAL]);
/**
 * Redo 2 (commander rule 3): generic firm words. Next to a person-name word they never qualify on their own ("John Smith Services",
 * "John Smith Group" are refused); they need a second marker, a trade form or an unambiguous legal form ("Smith Lawn Services", "Smith
 * Services LLC" pass). With no person-name word they qualify ("Acme Services", "SUMMIT CONSULTING GROUP").
 */
const GENERIC_FORMS = new Set(list('services group enterprises enterprise company associates solutions systems industries technologies consulting consultants development developers properties holdings investments realty ventures foundation management partners capital'));
/** Words that never belong in a contractor's trade name (C3): connectors that join a person to a company. */
const CONNECTORS = new Set(list('at for by with via from or vs versus nee obo attn of'));
const DBA_RE = /(?:^|\s)(?:d\/b\/a|d\.b\.a\.?|d b a|dba:?|t\/a|trading as|doing business as|operating as|o\/a)(?=\s|$)/gi;
const BLOCKED_PHRASES_RE = /\b(?:on behalf of|license holder|licence holder|lic holder|works for|employed by|working for|formerly|f\/k\/a|fka|n\/k\/a|nka|a\/k\/a|aka|and\/or|successor to)\b/i;
/** "PERSON of FIRM", "PERSON c/o FIRM" (C2): only the firm may be kept. */
const PERSON_FIRM_SPLIT_RE = /\s+(?:of|c\/o|c\.o\.|in care of|care of)\s+/i;

/** C1: placeholder and owner-builder values (whole value) and their first words. */
const PLACEHOLDER_RE =
  /^(?:the\s+)?(?:self|none|n\/?a|tbd|t\.b\.d\.?|various|unknown|unk|homeowner|home owner|homeowners|owner|owners|owner builder|owner\/builder|owner-builder|owner as (?:general )?contractor|same|same as owner|same as above|see above|no contractor|not applicable|not provided|pending|to be determined|null|none listed|private|individual)\.?$/i;
const PLACEHOLDER_FIRST = new Set(
  list(
    'self myself me my our own ownr owner owners homeowner homeowners homeownr hmownr no none not na n/a tbd unknown unk various multiple ' +
      'same test null pending private personal individual unlicensed relative dad mom husband wife friend friends volunteer volunteers ' +
      'diy exempt undecided undetermined ourselves yourself himself herself mine bldr awaiting ho cash uncle aunt cousin nephew niece ' +
      'weekend sweat zzz xyz sample example demo',
  ),
);
/** C1 (review 2, P3-1): placeholder phrases anywhere ("To Be Hired Roofing", "Bid Pending Construction", "Do It Yourself Construction"). */
const PLACEHOLDER_PHRASE_RE = /^h\.?\s?o\.?\s|\b(?:to be (?:hired|selected|determined|named|announced)|out to bid|bid pending|see (?:plans|permit|attached)|do it yourself|ownr\/bldr|owner\/bldr|not yet (?:hired|selected))\b/i;
/** C1: placeholder words anywhere in a name ("John Smith Self Services", "Owner Builder Roofing"). */
const PLACEHOLDER_ANYWHERE = new Set(list('self myself personal private homeowner homeowners homeownr own unlicensed notary volunteer volunteers'));
/** Words that are never distinctive (C1, C8). */
const GENERIC_WORDS = new Set(
  list(
    'the a an and & my our your general new local residential commercial contractor contractors subcontractor subcontractors sub ' +
      'builder home homes house houses repair repairs roof roofs work works job jobs project projects licensed certified insured bonded ' +
      'family bathroom bathrooms kitchen kitchens deck decks interior exterior emergency fire water flood storm replacement replacements ' +
      'installation installations install installer installers selected selection be to volunteers volunteer habitat any various other ' +
      'xx xxx xxxx independent public',
  ),
);
/** C6: family and personal holding words. */
const FAMILY_WORDS = new Set(
  list('family fam families estate estates heirs heir trustee trustees ttee living revocable irrevocable legacy kids children siblings grandkids grandchildren grandpa grandma'),
);

/** Licence names (rule 6): a home-based activity in the name or the licence category gives no contact unless a legal form is named. */
export const HOME_BASED_RE =
  /\b(?:day ?care|daycares|child ?care|childcare|pre-?schools?|preschool|nursery school|family day|family child|home occupation|home[- ]based|in[- ]home|home daycare|babysit\w*|nanny|nannies|group home|foster|bed and breakfast|short[- ]term rental|home office|home business|residential care|adult family home)\b/i;

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

interface Tok {
  raw: string;
  k: string;
}

const DIGIT_TOKEN_RE = /^(?:#?\d{1,3}|\d{1,3}(?:st|nd|rd|th)|[a-z]\d{1,2})$/i;

function toks(s: string): Tok[] {
  return s.split(' ').filter(Boolean).map((raw) => ({ raw, k: foldName(raw).replace(/\./g, '').replace(/[\u2018\u2019]/g, "'") }));
}

/** An unambiguous marker word (C4). A word that is a listed given name or on SURNAME_VOCAB never is. */
function isFirm(k: string): boolean {
  return FIRM_WORDS.has(k) && !AMBIGUOUS_WORDS.has(k) && !isListedGivenName(k) && !SURNAME_VOCAB.has(k);
}

/** An ambiguous marker word (C4): on AMBIGUOUS_WORDS, or a FIRM_WORDS word that is also a first name or a common surname. */
function isAmbiguous(k: string): boolean {
  return AMBIGUOUS_WORDS.has(k) || (FIRM_WORDS.has(k) && !isFirm(k));
}

/** A listed given name glued to a listed surname (either order, each 3+ letters) or one or two letters before a listed surname (4+). */
export function gluedPersonWord(k: string): boolean {
  if (k.length < 5) return false;
  for (let i = 3; i <= k.length - 3; i++) {
    const a = k.slice(0, i);
    const b = k.slice(i);
    if ((isListedGivenName(a) && isListedSurname(b)) || (isListedSurname(a) && isListedGivenName(b))) return true;
  }
  for (const i of [1, 2]) if (k.length - i >= 4 && isListedSurname(k.slice(i))) return true;
  return false;
}

/** A person-name word: a listed given name, a listed surname, an initial, or a glued listed name. Exported for owner-company.ts. */
export function personWord(k: string): boolean {
  const w = k.replace(/'s$/, '');
  return /^[a-z]$/.test(w) || isListedGivenName(w) || isListedSurname(w) || gluedPersonWord(w);
}

/** A possessive person form: "John's", "MARIAS", "JOES" (a listed given name plus s, with or without the apostrophe). */
export function possessivePerson(k: string): boolean {
  const m = k.match(/^(.+?)'?s$/);
  return Boolean(m && m[1].length >= 2 && isListedGivenName(m[1]));
}

/** C1: a placeholder or owner-builder value. */
export function isPlaceholderName(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const t = collapse(foldName(raw).replace(/[^a-z0-9/&' .-]/g, ' '));
  if (!t) return true;
  if (PLACEHOLDER_RE.test(t) || PLACEHOLDER_PHRASE_RE.test(t)) return true;
  const words = t.replace(/^the\s+/, '').split(/[\s-]+/).map((w) => w.replace(/[.']/g, ''));
  return PLACEHOLDER_FIRST.has(words[0]) || words.some((w) => PLACEHOLDER_ANYWHERE.has(w));
}

/**
 * Is the token at `i` a legal form here? A strong form always ("LIMITED PARTNERSHIP" too); a short name-like form (NAME_LIKE_LEGAL) only
 * next to an unambiguous marker before it, or in a name of three or more words with no person-name word (redo 2, review P1-A).
 */
function isLegalAt(ts: Tok[], i: number): boolean {
  const t = ts[i];
  if (!t) return false;
  if (t.k === 'partnership' && ts[i - 1]?.k === 'limited') return true;
  if (!LEGAL.has(t.k)) return false;
  if (STRONG_LEGAL.has(t.k)) return true;
  const before = ts.slice(0, i);
  if (before.some((o) => isFirm(o.k) || STRONG_LEGAL.has(o.k))) return true;
  const words = ts.filter((o) => o.k !== '&' && o.k !== 'and' && o.k !== 'the');
  return words.length >= 3 && !before.some((o) => o.k !== '&' && o.k !== 'and' && o.k !== 'the' && (personWord(o.k) || possessivePerson(o.k)));
}

/** A strong (unambiguous) legal form at the end, not counting "Company" (redo 2: a generic word next to a person). */
function strongLegalEnd(ts: Tok[]): boolean {
  const last = ts[ts.length - 1];
  return ts.length >= 2 && Boolean(last) && (STRONG_LEGAL.has(last.k) || (last.k === 'partnership' && ts[ts.length - 2]?.k === 'limited')) && last.k !== 'company';
}

/** Does this name end with a legal form (C4; also rule 5: a contractor's own address is kept only then)? */
export function hasLegalSuffix(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  const ts = toks(collapse(name.replace(/,/g, ' ')));
  return ts.length >= 2 && isLegalAt(ts, ts.length - 1);
}

/** C2: the candidate text after the bracket and DBA rules, or null. */
function candidateOf(s: string): string | null {
  let t = s;
  const br = t.match(/^([^()[\]{}]*)\(([^()[\]{}]+)\)\s*$/);
  if (br) t = br[2];
  if (/[()[\]{}]/.test(t)) return null;
  const parts = t.split(DBA_RE);
  if (parts.length > 1) t = parts[parts.length - 1];
  // A legal form after a comma joins the name ("Smith Roofing, Inc." -> "Smith Roofing Inc."), up to two ("Co., Inc.").
  t = t.replace(/\s*,\s*((?:l\.?l\.?c|inc|incorporated|corp|corporation|co|company|l\.?p|l\.?l\.?p|lllp|p\.?l\.?l\.?c|ltd|limited|p\.?c|p\.?a)\.?)(?=\s*(?:,|$))/gi, ' $1');
  t = t.replace(/\s*,\s*((?:l\.?l\.?c|inc|incorporated|corp|corporation|co|company|l\.?p|l\.?l\.?p|lllp|p\.?l\.?l\.?c|ltd|limited|p\.?c|p\.?a)\.?)\s*$/gi, ' $1');
  t = collapse(t.replace(/^[\s"'`.,;:\-*_|]+|[\s"'`,;:\-*_|]+$/g, ''));
  if (!t) return null;
  // "A/C" is one trade word (air conditioning); every other separator refuses the value.
  const probe = t.replace(/\ba\/c\b/gi, 'AC');
  if (/[,;|\\/:"@%*~=<>+^?!_$]/.test(probe) || /\s-+\s|\s-+|-+\s|--/.test(probe)) return null;
  return t;
}

/** C2 and C3 on the whole value: the cleaned candidate as written, or null. */
function shapeOk(raw: string): string | null {
  if (raw.length > 400) return null;
  if (/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u00AD]/.test(raw)) return null;
  if (/\p{L}/u.test(foldName(raw).replace(/[a-z]/g, ''))) return null; // look-alike scripts
  const s = collapse(raw.normalize('NFKC').replace(/[\u2018\u2019\u201B\u00B4]/g, "'").replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' '));
  if (!s || /[\u2010-\u2015\u2212]/.test(s)) return null;
  if (hasContactShape(s) || hasRoleWord(s) || hasStreetAddressShape(s) || BLOCKED_PHRASES_RE.test(s)) return null;
  const cand = candidateOf(s);
  if (!cand) return null;
  if (hasRoleWord(cand) || hasStreetAddressShape(cand)) return null;
  const ts = toks(cand);
  if (!ts.length || ts.length > 10) return null;
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (t.k === '&' || t.k === 'and' || t.k === 'the') continue;
    if (/\d/.test(t.k)) {
      if (!DIGIT_TOKEN_RE.test(t.k)) return null;
      continue;
    }
    if (/^a\/c$/i.test(t.raw)) continue;
    // Redo 2 (review P3-2): glued initials joined by "&" are a firm token ("J&J Roofing", "A&B Electric"); never an honorific pair.
    const amp = t.k.match(/^([a-z]{1,2})&([a-z]{1,2})$/);
    if (amp) {
      if (classifyWord(amp[1]) === 'honor' || classifyWord(amp[2]) === 'honor') return null;
      continue;
    }
    if (CONNECTORS.has(t.k)) return null;
    // A period only at the end of a legal form, a single initial, "Bros." or "Assoc." ("J. Smith Roofing", "Smith Bros.").
    if (t.raw.includes('.') && !(LEGAL.has(t.k) || BROTHERS.has(t.k) || t.k === 'assoc' || /^[a-z]$/i.test(t.k) || /^(?:[a-z]\.)+$/i.test(t.raw))) return null;
    if (/^(?:[a-z]\.)+$/i.test(t.raw) && !LEGAL.has(t.k) && t.k.length > 1) return null;
    const cls: WordClass = classifyWord(t.k, i === ts.length - 1);
    if (cls === 'bad' && !/^[a-z]$/.test(t.k)) return null;
    if ((cls === 'honor' || cls === 'suffix' || cls === 'cred' || cls === 'title') && !(LEGAL.has(t.k) && i >= ts.length - 2)) return null;
  }
  const ends = [ts[0].k, ts[ts.length - 1].k];
  if (ends.includes('&') || ends.includes('and')) return null;
  if (ts.filter((t) => t.k === '&' || t.k === 'and').length > 2) return null;
  return collapse(ts.map((t) => t.raw).join(' '));
}

/** The structure of a candidate: legal forms stripped, the family phrase, the final run of marker words. */
function analyse(name: string, extraMarker: (k: string) => boolean = () => false) {
  const ts = toks(name);
  let end = ts.length;
  let legal = 0;
  while (end > 1 && legal < 2 && isLegalAt(ts, end - 1)) {
    end--;
    legal++;
  }
  const core = ts.slice(0, end);
  const last = core[core.length - 1]?.k ?? '';
  const prev = core[core.length - 2]?.k;
  // Review 2 (P1-B): "Brothers" is itself a listed surname ("John Brothers", "Joyce Brothers"), so written out it never qualifies after
  // one word alone; "Smith Bros", "Smith & Jones Brothers" and "Smith Brothers Roofing" (the trade form) still do.
  // Redo 2: "& Sons" after a first name alone ("John & Sons") is a person; "Bros" / "Brothers" are no family phrase at all.
  const firstAlone = core.length === 3 && isListedGivenName(core[0].k) && !isListedSurname(core[0].k);
  const family = FAMILY_TAIL.has(last) && (prev === '&' || prev === 'and') && core.length >= 3 && !firstAlone;
  const isMarker = (t: Tok) => isFirm(t.k) || isAmbiguous(t.k) || extraMarker(t.k) || /^a\/c$/i.test(t.raw);
  // Skip safe tail words, then take the run of marker words (and "&" / "and" between them) at the end.
  let i = core.length - 1;
  while (i >= 0 && !isMarker(core[i]) && (DIGIT_TOKEN_RE.test(core[i].k) || TAIL_WORDS.has(core[i].k))) i--;
  const run: Tok[] = [];
  while (i >= 0 && (isMarker(core[i]) || ((core[i].k === '&' || core[i].k === 'and') && i > 0 && isMarker(core[i - 1])))) {
    run.unshift(core[i]);
    i--;
  }
  const runWords = run.filter((t) => t.k !== '&' && t.k !== 'and');
  // Person-shaped (C5): two words, or first + initial + last, with no legal form.
  const words = ts.filter((t) => t.k !== '&' && t.k !== 'and');
  const personShaped = legal === 0 && (words.length === 2 || (words.length === 3 && /^[a-z]$/.test(words[1].k)));
  // Person-name words outside the marker run (redo 2: a generic firm word next to one needs a second marker).
  const runSet = new Set(run);
  const personTokens = core.filter(
    (t, j) =>
      !runSet.has(t) && t.k !== '&' && t.k !== 'and' && t.k !== 'the' && !isMarker(t) && !(t.k === 'real' && core[j + 1]?.k === 'estate') && !(t.k === 'estate' && core[j - 1]?.k === 'real') && (personWord(t.k) || possessivePerson(t.k)),
  );
  return { ts, legal, family, run: runWords, personShaped, personTokens, strongLegal: legal > 0 && strongLegalEnd(ts) };
}

/** C1 (a distinctive word), C6 and C7 on a candidate: shared by the contractor and the licence rules. */
function personGuardsOk(name: string, extraMarker: (k: string) => boolean = () => false): boolean {
  const ts = toks(name);
  const ks = ts.map((t) => t.k);
  const markerWord = (k: string) => isFirm(k) || isAmbiguous(k) || extraMarker(k);
  // C1 / C8: a distinctive word. Redo 2 (review P3-2): not needed when a strong legal form ends a name of two or more words with a word
  // that is not generic ("Home Depot USA Inc", "Power Home Remodeling Group LLC"), or when the name is two or more marker words with a real
  // trade among them and nothing else, at least three ("Power Home Remodeling"). "Roofing LLC", "General Contractor LLC", "Home
  // Remodeling" and "Plumbing Repair" stay refused.
  const distinctive = ks.filter(
    (k) => !GENERIC_WORDS.has(k) && !markerWord(k) && !LEGAL.has(k) && !TAIL_WORDS.has(k) && !FAMILY_TAIL.has(k) && !BROTHERS.has(k) && !DIGIT_TOKEN_RE.test(k),
  );
  const coreKs = ks.filter((k) => !LEGAL.has(k) && k !== '&' && k !== 'and' && k !== 'the');
  const legalCore = strongLegalEnd(ts) && coreKs.length >= 2 && coreKs.some((k) => !GENERIC_WORDS.has(k));
  const allMarkers = coreKs.length >= 3 && coreKs.every((k) => markerWord(k) || TAIL_WORDS.has(k)) && coreKs.some((k) => TRADE_FIRM_WORDS.has(k));
  if (!distinctive.length && !legalCore && !allMarkers) return false;
  // C6: family and personal holding shapes.
  const realTrade = ks.some((k) => TRADE_FIRM_WORDS.has(k));
  // "REAL ESTATE" is a trade, not an estate.
  if (!realTrade && ks.some((k, i) => FAMILY_WORDS.has(k) && !(k === 'estate' && ks[i - 1] === 'real'))) return false;
  if (!realTrade) {
    for (let i = 0; i < ks.length; i++) if (HOLDING_WORDS.has(ks[i]) && ks.slice(0, i).some((k) => !markerWord(k) && personWord(k))) return false;
  }
  // C7: a person beside a firm.
  if (ks.indexOf('the') > 0) return false;
  const firstMarker = ks.findIndex(markerWord);
  if (firstMarker >= 0 && ks.slice(firstMarker + 1).some((k) => !markerWord(k) && isListedGivenName(k.replace(/'s$/, '')))) return false;
  const surnames = ks.filter((k) => isListedSurname(k) && !markerWord(k));
  if (new Set(surnames).size !== surnames.length) return false;
  return true;
}

/** C4 and C5 for the contractor rule, on a candidate that passed C2 and C3. `strictPassed`: the strict rule accepted it. */
function contractorMarkerOk(name: string, strictPassed: boolean): boolean {
  const a = analyse(name);
  if (a.strongLegal || a.family) return true;
  const hasPerson = a.personTokens.length > 0;
  // A real trade form in the final run lifts the name, unless its only trade word is a listed surname (C5: "Mary Cooling").
  const trade = a.run.filter((t) => isFirm(t.k) && !GENERIC_FORMS.has(t.k));
  if (trade.length > 0 && !trade.every((t) => isListedSurname(t.k))) return true;
  const generic = a.run.filter((t) => GENERIC_FORMS.has(t.k));
  const ambiguous = a.run.filter((t) => isAmbiguous(t.k) && !GENERIC_FORMS.has(t.k));
  const weakOrCompany = a.legal > 0; // "Company" spelled out, or a short form that isLegalAt accepted
  if (generic.length > 0 || weakOrCompany) {
    // Redo 2 (rule 3): a generic word (or "Company") next to a person-name word needs a second marker: a trade word in the run.
    if (!hasPerson) return true;
    return ambiguous.length > 0 || trade.length > 0;
  }
  if (a.run.length > 0) return false; // ambiguous words only: never alone
  // No marker at all: only a value the strict rule accepted, not person-shaped, with no person-name word.
  return strictPassed && !a.personShaped && !hasPerson;
}

/** Redo 2 (review P3-1): filler first words that name a real firm only with a strong legal form ("ABC Construction" no, "ABC Roofing Inc" yes). */
const FILLER_FIRST = new Set(list('abc xyz aaa'));

function contractorOne(raw: string): string | null {
  if (!raw.trim() || isPlaceholderName(raw)) return null;
  const first = foldName(raw.trim()).split(/\s+/)[0];
  if (FILLER_FIRST.has(first) && !strongLegalEnd(toks(collapse(raw.replace(/,/g, ' '))))) return null;
  const strict = cleanOrgName(raw);
  const cand = strict ?? shapeOk(raw);
  if (!cand || isPlaceholderName(cand)) return null;
  // The strict rule's output must pass the same shape checks (C2, C3).
  if (strict && shapeOk(strict) !== strict) return null;
  if (!personGuardsOk(cand)) return null;
  if (!contractorMarkerOk(cand, strict !== null)) return null;
  const out = cand.normalize('NFD').replace(/[\u0300-\u036F]/g, '');
  if (out.length < 3 || out.length > 120) return null;
  return out;
}

/** The name a CONTRACTOR column may show, or null (C1 to C8). Never used for owner, applicant, tenant or resident columns. Stable. */
export function cleanContractorName(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  // Round 20 (LIC): a listed large builder or contractor, named exactly (known-companies.ts; never a string that only shares a word).
  const known = knownCompanyName(raw);
  if (known) return known;
  // Final review P3-4: a name that is only a listed place and a legal form ("TEXAS LLC", "CALIFORNIA LLC") is the tail of "X HOMES OF TEXAS
  // LLC" as rows stored before the round 20 fix kept it. Never a firm's name on its own: not shown (display reads this rule too).
  if (placeWithLegal(raw)) return null;
  if (isPlaceholderName(raw)) return null;
  // C2: "PERSON of FIRM" / "PERSON c/o FIRM": the firm alone, or nothing. "FIRM of PLACE" keeps the firm.
  const parts = raw.normalize('NFKC').split(PERSON_FIRM_SPLIT_RE);
  if (parts.length > 2) return null;
  if (parts.length === 2) {
    // Round 20 (review LIC P3, a live bug): "FIRM of PLACE LEGAL" ("LENNAR HOMES OF CALIFORNIA LLC") used to show "CALIFORNIA LLC", the
    // place alone. A right part that is only a place plus a legal form is never shown on its own; the whole name is kept when the left
    // part ends in a firm word and "<left part> <legal form>" passes this rule by itself, else the left part alone, else nothing.
    const place = placeWithLegal(parts[1]);
    if (place) return firmOfPlace(raw, parts[0], place);
    return contractorOne(parts[0]) ?? contractorOne(parts[1]);
  }
  return contractorOne(raw);
}

/** US states and the metro labels builders use in subsidiary names ("OF DFW", "OF NORTH TEXAS"), lower case. */
const PLACE_NAMES = new Set(
  [
    'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida', 'georgia', 'hawaii', 'idaho',
    'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota',
    'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina',
    'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas',
    'utah', 'vermont', 'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming', 'the carolinas', 'carolinas', 'dfw', 'dallas',
    'houston', 'austin', 'san antonio', 'phoenix', 'atlanta', 'chicago', 'miami', 'tampa', 'orlando', 'jacksonville', 'philadelphia',
    'los angeles', 'southern california', 'northern california', 'central california', 'inland empire', 'las vegas', 'denver', 'charlotte',
    'raleigh', 'nashville', 'dc', 'washington dc', 'south florida', 'north florida', 'central florida', 'southwest florida', 'north texas',
    'central texas', 'south texas', 'east texas', 'west texas', 'north georgia', 'arizona central',
  ],
);
const PLACE_LEGAL_RE = /^(.+?)[\s,]+(l\.?\s?l\.?\s?c\.?|inc\.?|incorporated|corp\.?|corporation|ltd\.?|limited|l\.?\s?p\.?|l\.?\s?l\.?\s?p\.?)\s*$/i;
/** Left-part endings that make "<left> of <place>" a firm's subsidiary name. */
const FIRM_OF_PLACE_END = new Set(list('homes home homebuilders communities builders building construction contractors residential companies company bros brothers group development developers'));

/** "CALIFORNIA LLC", "North Texas, Inc." -> the legal form when the text is only a listed place plus a legal form, else null. */
function placeWithLegal(text: string): string | null {
  const m = collapse(text).match(PLACE_LEGAL_RE);
  if (!m) return null;
  const place = collapse(foldName(m[1]).replace(/[.,]/g, ' '));
  return PLACE_NAMES.has(place) ? m[2] : null;
}

function firmOfPlace(raw: string, left: string, legal: string): string | null {
  const ws = collapse(left).split(' ');
  const last = foldName(ws[ws.length - 1] ?? '').replace(/[^a-z]/g, '');
  if (FIRM_OF_PLACE_END.has(last) && contractorOne(`${collapse(left)} ${legal}`)) {
    // The left part with the legal form passed every check of this rule; the rest is " of ", a listed place and that legal form.
    const whole = collapse(raw.normalize('NFKC'));
    if (/^[A-Za-z0-9 &.,'/-]+$/.test(whole) && whole.length <= 120 && !hasRoleWord(whole) && !hasContactShape(whole)) return whole;
  }
  return contractorOne(left);
}

/** True only when cleanContractorName returns the same string (after whitespace normalization). */
export function isContractorName(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  const c = cleanContractorName(name);
  return c !== null && c === collapse(name);
}

/**
 * Review 2 (licence recall): what the licence ROW says about its name, beyond the name itself. Built in extract.ts from the dataset's own
 * columns; nothing in it is ever stored, shown or logged.
 */
export interface LicenceContext {
  /**
   * The row's OTHER name columns: the legal entity or the owner (Chicago legal_name, Los Angeles and NYC business_name, San Francisco
   * ownership_name, Orlando business_owner_name). Comparison only.
   */
  ownerNames?: readonly (string | null | undefined)[];
  /** The record kind is an establishment by definition (a food-establishment inspection): the site is never a home office. */
  storefront?: boolean;
  /** Re-check of a name the extraction already accepted (storage, display): the row is gone, so only the shape is checked. */
  shapeOnly?: boolean;
}

/** Licence trade names (rule L3): plain shop words the vocabularies lack. None is a name. */
const LICENCE_EXTRA_WORDS: ReadonlySet<string> = new Set(list('print prints ship shipping copy copies'));
/**
 * Rule L3: words on the given-name list that are ordinary English adjectives or nouns in shop names ("WINDY CITY CAFE", "GOLDEN DRAGON
 * RESTAURANT", "LUCKY NAILS"). Allowed only inside rule L3, where no word of the name may be a listed surname and the owner check holds.
 */
const PLAIN_ENGLISH_GIVEN: ReadonlySet<string> = new Set(list('windy golden blue star bay king queen lucky happy sunny royal grand silver magic'));
/**
 * REVIEW PROPOSAL (round 20, rule L1b): only with a STRONG legal form at the end (LLC, INC, CORP, LTD ...), and only as a second try after
 * the rule above refused the name. ESTABLISHMENT_NOUNS: shop and restaurant nouns the name lists also carry as surnames or glued forms
 * ("Kit Chen" in "kitchen"). DUAL_ADJECTIVES: dictionary adjectives and nouns that are also rare given names. SHOP_NOUNS: plain shop
 * words the vocabularies lack (used only when they are on no name list).
 */
const ESTABLISHMENT_NOUNS: ReadonlySet<string> = new Set(list('kitchen bar spa studio salon coffee house market shack hardware burgers grill cafe tavern diner deli pizza').filter((w) => !isListedGivenName(w)));
const DUAL_ADJECTIVES: ReadonlySet<string> = new Set(list('red green urban river magnolia velvet bliss serenity beauty lantern capitol'));
const SHOP_NOUNS: ReadonlySet<string> = new Set(list('agave grind bayou goods pixel phone paw cactus gifts wine sneakers polished nail lash braids massage brow room taste tacos'));

/** Rule L3: activities that are mostly run from a home, a car or a phone. With one of these the trade-name rule gives nothing. */
export const HOME_PRONE_RE =
  /\b(?:tutor\w*|lessons?|sitting|sitters?|walking|walkers?|housekeep\w*|house ?clean\w*|maids?|home ?(?:health|care|made|maker|makers)|homecare|freelanc\w*|ride ?share|notary|doulas?|midwi\w*|caregiv\w*|personal (?:train\w*|chef|care|assistant|shopper)|life coach\w*|coaching|etsy|ebay|online|vacation rentals?|airbnb|room rentals?|mobile|handmade|crafts?|sewing|cottage|apartment|spare room|basement|living room|kitchen table|residential|home|homes|home-?based|homebased)\b/i;

function nameTokens(s: string): string[] {
  return foldName(s).split(/[^a-z]+/).filter((w) => w.length >= 2);
}

/**
 * Rule L3, the owner check: the row names its owner or legal entity in another column, and no word of the trade name comes from a
 * person named there. An owner value that ends with a legal form is a company and is not compared ("SUMMIT CITY CAFE" owned by "SUMMIT
 * CITY CAFE LLC"). False when the row has no such column value at all: no evidence, no name.
 */
function distinctFromOwner(nameWords: string[], ctx: LicenceContext): boolean {
  const owners = (ctx.ownerNames ?? []).filter((o): o is string => typeof o === 'string' && o.trim().length > 0);
  if (!owners.length) return false;
  return !sharesWithOwner(nameWords, ctx);
}

/**
 * Redo 2: does a word of the name come from a PERSON named in the row's owner or legal-entity column (exact word, a shared stem of four
 * letters, or the owner's initials)? An owner value that ends with a legal form is a company and is not compared. Comparison only.
 */
function sharesWithOwner(nameWords: string[], ctx: LicenceContext): boolean {
  const owners = (ctx.ownerNames ?? []).filter((o): o is string => typeof o === 'string' && o.trim().length > 0);
  for (const o of owners) {
    if (hasLegalSuffix(o)) continue;
    const ot = nameTokens(o);
    const initials = ot.map((w) => w[0]).join('');
    for (const w of nameWords) {
      if (ot.some((x) => x === w || (x.length >= 4 && w.length >= 4 && (x.startsWith(w) || w.startsWith(x))))) return true;
      // The owner's initials in any order ("BQ TUTORING" for Bashir Qasim).
      if (w.length <= 3 && ot.length >= 2 && [...w].every((ch) => initials.includes(ch))) return true;
    }
  }
  return false;
}

/**
 * Round 19 integration (review COVERAGE finding 5, review UNIFY defect 5): US state names that the given-name list holds but that are not
 * used as given names. In a licence name WITH a legal form they read as the place they are ("TEXAS ROOFING LLC"). Every other listed
 * place word that is also a real given name (Georgia, Virginia, Carolina, Dakota, Montana, Indiana, Nevada, Tennessee, Dallas, Phoenix, Austin,
 * Houston, Denver, Orlando, Memphis, Arlington, Washington, York) is left as it was. Exactly these two words; nothing else changed.
 */
export const PLACE_NOT_PERSON: ReadonlySet<string> = new Set(['texas', 'florida']);

/**
 * The name a BUSINESS-LICENCE or inspection column may show (role 'business'), or null. A licence site can be a home, so the business is
 * shown (with its address) only when the name is clearly not a person and not a home-based activity. Every name passes C1 to C3, C6
 * and C7, and holds no initial, no possessive or glued person form and no listed given name. Then one of:
 *  L1. the name ends with a legal form;
 *  L2. it has a business marker and EVERY other word is plain vocabulary that is not a name, whatever the length ("SUNSET PIZZA",
 *      "SUMMIT CONSULTING GROUP"; review 2: "Bashir Qasim Tutoring" and "Ifeoma Chukwudi Catering" used to pass with three words);
 *  L3. (review 2, needs the ROW) a trade name: a business marker, at most ONE word on no vocabulary, no listed surname, no home-prone
 *      activity in the name or the category columns (HOME_PRONE_RE), not "UNKNOWN + SURNAME-WORD" in two words ("Gareth Barber"), and
 *      the row backs it: its owner or legal-entity column is filled and shares no word with the name (distinctFromOwner), or the record
 *      kind is an establishment (ctx.storefront). "FLATBUSH LOCKSMITH" owned by "SAMPLE PERSON" passes; "QASIM LOCKSMITH" owned by
 *      "QASIM BASHIR" does not; with no owner column value nothing passes by L3.
 * In L2 and L3 a home-based activity in the name (HOME_BASED_RE) gives nothing; extract.ts checks the category columns.
 */
export function cleanBusinessName(raw: unknown, ctx: LicenceContext = {}): string | null {
  return cleanBusinessNameBase(raw, ctx) ?? legalPlusBusinessWord(raw, ctx);
}

/**
 * Rule L1b (review proposal): "a legal form plus a non-person word". A name the base rule refused passes only when ALL hold:
 *  - the base shape guards (placeholder, shapeOk, personGuardsOk, the owner comparison, no home-based or home-prone activity word);
 *  - a strong legal form ends it, and 2 to 6 words stand before it;
 *  - EVERY word is one of: E an establishment noun (closed list), D a dictionary adjective (closed list), P a plain vocabulary or
 *    business word that is on no name list, is not glued from names, is no initial and no possessive. Anything else refuses the name:
 *    one listed given name or surname outside the two closed lists, or one unknown word, is enough;
 *  - at least one business word (an E, or a P that is a trade or business word);
 *  - at most one D, never last, in a name of three words or more, with a P right after it ("GOLDEN DRAGON RESTAURANT LLC" passes;
 *    "ROSE KITCHEN LLC", "GOLDEN KITCHEN LLC", "GREEN SMITH BAKERY LLC" do not).
 */
function legalPlusBusinessWord(raw: unknown, ctx: LicenceContext): string | null {
  if (typeof raw !== 'string' || !raw.trim() || isPlaceholderName(raw)) return null;
  const cand = shapeOk(raw);
  if (!cand || isPlaceholderName(cand)) return null;
  const ts = toks(cand);
  if (!strongLegalEnd(ts) || /[a-z][A-Z]/.test(cand)) return null;
  if (HOME_BASED_RE.test(cand) || HOME_PRONE_RE.test(cand)) return null;
  const listed = (k: string) => isListedGivenName(k) || isListedSurname(k);
  const shop = (k: string) => SHOP_NOUNS.has(k) && !listed(k);
  const marker = (k: string) => LICENCE_WORDS.has(k) || LICENCE_EXTRA_WORDS.has(k) || classifyWord(k) === 'business' || shop(k) || ESTABLISHMENT_NOUNS.has(k);
  if (!personGuardsOk(cand, marker)) return null;
  const words = ts.filter((t) => t.k !== '&' && t.k !== 'and' && t.k !== 'the' && !LEGAL.has(t.k));
  if (words.length < 2 || words.length > 6) return null;
  const estab = (k: string) => ESTABLISHMENT_NOUNS.has(k);
  const dual = (k: string) => !estab(k) && (PLAIN_ENGLISH_GIVEN.has(k) || DUAL_ADJECTIVES.has(k));
  const business = (k: string) => (isFirm(k) || LICENCE_WORDS.has(k) || LICENCE_EXTRA_WORDS.has(k) || classifyWord(k) === 'business' || shop(k)) && !listed(k);
  const plain = (k: string) => /^[a-z][a-z-]*$/.test(k) && k.length >= 2 && !k.includes("'") && !listed(k) && !gluedPersonWord(k) && (isVocabularyWord(k) || business(k)) && (!possessivePerson(k) || isVocabularyWord(k) || shop(k));
  const cls = words.map((o) => (estab(o.k) ? 'E' : dual(o.k) ? 'D' : plain(o.k) ? 'P' : 'X'));
  if (cls.includes('X')) return null;
  const d = cls.indexOf('D');
  if (cls.filter((c) => c === 'D').length > 1) return null;
  if (d >= 0 && (words.length < 3 || cls[d + 1] !== 'P')) return null;
  if (!words.some((o, i) => cls[i] === 'E' || (cls[i] === 'P' && business(o.k)))) return null;
  const all = words.map((o) => o.k.replace(/[^a-z]/g, '')).filter((w) => w.length >= 2);
  if (!ctx.shapeOnly && sharesWithOwner(all, ctx)) return null;
  const out = cand.normalize('NFD').replace(/[\u0300-\u036F]/g, '');
  return out.length >= 3 && out.length <= 120 ? out : null;
}

function cleanBusinessNameBase(raw: unknown, ctx: LicenceContext = {}): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  // Round 20 (LIC): a listed large builder or contractor, named exactly (known-companies.ts). The owner check still applies: a row whose
  // owner column names a PERSON who shares a word with the name gives nothing ("Toll Brothers" owned by "Mary Toll").
  // Review LIC P2-6: only a listed name that ENDS with a legal form (LLC, Inc, Corp, Co, LP, LLP, PLLC, Ltd); any other listed name goes
  // through the normal licence rule below, as before round 20.
  const known = knownFormHasLegalEnd(raw) ? knownCompanyName(raw) : null;
  if (known) return !ctx.shapeOnly && sharesWithOwner(nameTokens(known), ctx) ? null : known;
  if (isPlaceholderName(raw)) return null;
  const strict = cleanOrgName(raw);
  const cand = strict ?? shapeOk(raw);
  if (!cand || isPlaceholderName(cand)) return null;
  if (strict && shapeOk(strict) !== strict) return null;
  const marker = (k: string) => LICENCE_WORDS.has(k) || LICENCE_EXTRA_WORDS.has(k) || classifyWord(k) === 'business';
  if (!personGuardsOk(cand, marker)) return null;
  const a = analyse(cand, marker);
  const out = cand.normalize('NFD').replace(/[\u0300-\u036F]/g, '');
  if (out.length < 3 || out.length > 120) return null;
  const plainGiven = (k: string) => PLAIN_ENGLISH_GIVEN.has(k);
  let usedPlainGiven = false;
  // The state-name exemption (PLACE_NOT_PERSON) holds only with a legal form and when EVERY other word is a trade or business word or
  // plain vocabulary that is no person-name word: "SOUTH FLORIDA ROOFING INC" passes, "Florida Garcia Inc" and "TEXAS SMITH LLC" do not.
  const plainWord = (k: string) =>
    k === '&' || k === 'and' || k === 'the' || /\d/.test(k) || LEGAL.has(k) ||
    ((isFirm(k) || marker(k) || isVocabularyWord(k)) && !personWord(k) && !isListedSurname(k) && !isListedGivenName(k));
  const placeWord = (k: string) => a.legal > 0 && PLACE_NOT_PERSON.has(k) && a.ts.some((o) => o.k !== k && !LEGAL.has(o.k)) && a.ts.every((o) => o.k === k || plainWord(o.k));
  // Every licence name, legal form or not: no listed given name, no glued or possessive person form, no initial ("REGINALD JACKSON HOME
  // IMPROVEMENT LLC", "Danny Smith LLC", "JT Smith LLC" give nothing: the site of a licence can be the person's home).
  for (const t of a.ts) {
    if (t.k === '&' || t.k === 'and' || t.k === 'the' || /\d/.test(t.k) || LEGAL.has(t.k)) continue;
    if (/^[a-z]$/.test(t.k) || possessivePerson(t.k) || gluedPersonWord(t.k) || /[a-z][A-Z]/.test(t.raw)) return null;
    // Review 2 (P1-D): a hyphenated word is checked part by part ("Mary-Ann Smith-Jones Catering", "Maria-Elena Tutoring Services").
    const parts = t.k.includes('-') ? t.k.split('-').filter(Boolean) : [];
    if (parts.some((p) => possessivePerson(p) || (isListedGivenName(p) && !isFirm(p) && !plainGiven(p)))) return null;
    if (a.legal === 0 && parts.some((p) => isListedSurname(p) && !isFirm(p) && !plainGiven(p))) return null;
    // Round 19 integration: a US state name that is not used as a given name (PLACE_NOT_PERSON) is a place in a registered name
    // ("NORTH TEXAS ROOFING LLC", "SOUTH FLORIDA ROOFING INC"), only with a legal form; without one it is still refused.
    if (placeWord(t.k)) continue;
    if (isListedGivenName(t.k.replace(/'s$/, '')) && !isFirm(t.k)) {
      if (!plainGiven(t.k) || a.legal > 0) return null;
      usedPlainGiven = true; // only rule L3 may accept it
    }
  }
  const words = a.ts.filter((t) => t.k !== '&' && t.k !== 'and' && t.k !== 'the' && !LEGAL.has(t.k));
  const markerWord = (k: string) => isFirm(k) || isAmbiguous(k) || marker(k);
  // Redo 2 (commander rule 4): on every path, a name that shares a word with a PERSON named in the row's owner or legal-entity column is
  // that person's ("QASIM LOCKSMITH" owned by "QASIM BASHIR"). The owner value is compared here and nowhere stored, shown or logged.
  const allWords = words.filter((o) => !/\d/.test(o.k)).map((o) => o.k.replace(/[^a-z]/g, '')).filter((w) => w.length >= 2);
  if (!ctx.shapeOnly && sharesWithOwner(allWords, ctx)) return null;
  if (a.legal > 0) {
    // L1. Review 2 (P2): two or more words on no vocabulary before the legal form read as FIRST LAST with names missing from the lists
    // ("Deontay Kamara LLC", "KAMARA DEONTAY PA"); one such word is a company name ("Verdantas LLC", "Kowalczyk Inc").
    const unknown = words.filter((o) => !markerWord(o.k) && !/\d/.test(o.k) && !isVocabularyWord(o.k) && !isListedSurname(o.k));
    if (unknown.length > 1) return null;
    // Redo 2: a storefront record (no owner column to compare) needs a legal name with no person-name word at all, surnames included.
    if (ctx.storefront && words.some((o) => !markerWord(o.k) && !/\d/.test(o.k) && personWord(o.k))) return null;
    return out;
  }
  if (HOME_BASED_RE.test(cand)) return null;
  if (!words.some((t) => markerWord(t.k))) return null;
  const plain = (o: Tok) => /\d/.test(o.k) || (isVocabularyWord(o.k) && !personWord(o.k));
  const others = words.filter((o) => !markerWord(o.k));
  // L2: every word beside the markers is plain vocabulary that is not a name.
  const l2 = !usedPlainGiven && others.every(plain) && words.every((t) => !(markerWord(t.k) && (isAmbiguous(t.k) || isListedSurname(t.k) || isListedGivenName(t.k))) || words.filter((o) => o !== t && !isFirm(o.k)).every(plain));
  // Review 2: a home-prone activity in the name gives nothing by L2 or L3 ("Mobile Detailing Services", "Cottage Food Bakery").
  if (HOME_PRONE_RE.test(cand)) return null;
  if (l2) return out;
  // L3: a trade name the row backs. A possessive of any word ("Deontay's Barbershop") is a person's shop: nothing.
  if (others.some((o) => /'s$/.test(o.k))) return null;
  const odd = others.filter((o) => !plain(o));
  if (odd.length > 1) return null;
  // Redo 2: an unknown word ending in "s" may be a possessive written without the apostrophe ("Saoirses Bakery").
  if (odd.some((o) => /s$/.test(o.k))) return null;
  for (const o of others) {
    if (/\d/.test(o.k) || plainGiven(o.k)) continue;
    if (isListedSurname(o.k) || isListedGivenName(o.k) || personWord(o.k)) return null;
  }
  // "UNKNOWN + SURNAME-WORD" in two words reads as FIRST LAST ("Gareth Barber", "Bashir Market", "Golden Barber").
  const surnameMarker = (k: string) => isListedSurname(k) || isListedGivenName(k);
  if (words.length === 2 && odd.length + others.filter((o) => plainGiven(o.k)).length > 0 && words.some((t) => markerWord(t.k) && surnameMarker(t.k))) return null;
  if (ctx.shapeOnly || ctx.storefront) return out;
  return distinctFromOwner(others.filter((o) => !/\d/.test(o.k)).map((o) => o.k.replace(/[^a-z]/g, '')).filter((w) => w.length >= 2), ctx) ? out : null;
}

/** True only when cleanBusinessName returns the same string (after whitespace normalization). */
export function isBusinessName(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  // A stored name: the row that backed it (rule L3) is gone, so the shape is what can be re-checked.
  const c = cleanBusinessName(name, { shapeOnly: true });
  return c !== null && c === collapse(name);
}
