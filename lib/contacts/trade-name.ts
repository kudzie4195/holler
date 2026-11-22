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
 *      - a final legal form (LLC, INC, CORP, CORPORATION, CO, COMPANY, LP, LLP, LLLP, PLLC, LTD, LIMITED, INCORPORATED, PC, PA);
 *      - a family or partnership phrase at the end ("& Sons", "and Son", "Bros", "Brothers", "& Associates", "& Co");
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
      'tailor cafe coffee tea liquor',
  ),
);

/** Licence names (cleanBusinessName): business words beyond the contractor lists (each is also on AMBIGUOUS_WORDS). */
const LICENCE_WORDS: ReadonlySet<string> = new Set(
  list('pizza grill bar tavern diner kitchen deli locksmith locksmiths salon spa barber nails tailor cafe coffee tea market liquor'),
);

/** Words allowed after the last marker (C4): they describe the firm, never a person. */
const TAIL_WORDS: ReadonlySet<string> = new Set(
  list('pros pro experts masters guys team crew unlimited plus usa america express depot direct now today'),
);

/** A family or partnership phrase at the end (C4). */
const FAMILY_TAIL = new Set(list('sons son daughters associates assoc co company partners'));
const BROTHERS = new Set(list('bros brothers'));

/** Final legal forms (C4), dots removed. */
const LEGAL = new Set(list('llc inc incorporated corp corporation co company lp llp lllp pllc ltd limited pc pa plc'));
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
      'same test null pending private personal individual unlicensed relative dad mom husband wife friend friends volunteer volunteers',
  ),
);
/** C1: placeholder words anywhere in a name ("John Smith Self Services", "Owner Builder Roofing"). */
const PLACEHOLDER_ANYWHERE = new Set(list('self myself personal private homeowner homeowners homeownr own unlicensed notary'));
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
const FAMILY_WORDS = new Set(list('family fam families estate estates heirs heir trustee trustees ttee living revocable irrevocable legacy'));

/** Licence names (rule 6): a home-based activity in the name or the licence category gives no contact unless a legal form is named. */
export const HOME_BASED_RE =
  /\b(?:day ?care|daycares|child ?care|childcare|family day|family child|home occupation|home[- ]based|in[- ]home|home daycare|babysit\w*|nanny|nannies|group home|foster|bed and breakfast|short[- ]term rental|home office|home business|residential care|adult family home)\b/i;

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

interface Tok {
  raw: string;
  k: string;
}

const DIGIT_TOKEN_RE = /^(?:#?\d{1,3}|\d{1,3}(?:st|nd|rd|th)|[a-z]\d{1,2})$/i;

function toks(s: string): Tok[] {
  return s.split(' ').filter(Boolean).map((raw) => ({ raw, k: foldName(raw).replace(/\./g, '').replace(/[‘’]/g, "'") }));
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
function gluedPersonWord(k: string): boolean {
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
  if (PLACEHOLDER_RE.test(t)) return true;
  const words = t.replace(/^the\s+/, '').split(/[\s-]+/).map((w) => w.replace(/[.']/g, ''));
  return PLACEHOLDER_FIRST.has(words[0]) || words.some((w) => PLACEHOLDER_ANYWHERE.has(w));
}

/** Does this name end with a legal form (C4; also rule 5: a contractor's own address is kept only then)? */
export function hasLegalSuffix(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  const ts = toks(collapse(name.replace(/,/g, ' ')));
  return ts.length >= 2 && LEGAL.has(ts[ts.length - 1].k);
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
  if (/[​-‏‪-‮⁠-⁤⁦-⁩﻿­]/.test(raw)) return null;
  if (/\p{L}/u.test(foldName(raw).replace(/[a-z]/g, ''))) return null; // look-alike scripts
  const s = collapse(raw.normalize('NFKC').replace(/[‘’‛´]/g, "'").replace(/[  -   　]/g, ' '));
  if (!s || /[‐-―−]/.test(s)) return null;
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
  while (end > 1 && legal < 2 && LEGAL.has(ts[end - 1].k)) {
    end--;
    legal++;
  }
  const core = ts.slice(0, end);
  const last = core[core.length - 1]?.k ?? '';
  const prev = core[core.length - 2]?.k;
  const family = (FAMILY_TAIL.has(last) && (prev === '&' || prev === 'and') && core.length >= 3) || (BROTHERS.has(last) && core.length >= 2);
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
  return { ts, legal, family, run: runWords, personShaped };
}

/** C1 (a distinctive word), C6 and C7 on a candidate: shared by the contractor and the licence rules. */
function personGuardsOk(name: string, extraMarker: (k: string) => boolean = () => false): boolean {
  const ts = toks(name);
  const ks = ts.map((t) => t.k);
  const markerWord = (k: string) => isFirm(k) || isAmbiguous(k) || extraMarker(k);
  // C1 / C8: a distinctive word.
  const distinctive = ks.filter(
    (k) => !GENERIC_WORDS.has(k) && !markerWord(k) && !LEGAL.has(k) && !TAIL_WORDS.has(k) && !FAMILY_TAIL.has(k) && !BROTHERS.has(k) && !DIGIT_TOKEN_RE.test(k),
  );
  if (!distinctive.length) return false;
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
  if (a.legal > 0 || a.family) return true;
  const firm = a.run.filter((t) => isFirm(t.k));
  if (firm.length > 0) {
    // C5: the only marker is itself a listed surname ("Mary Cooling", "Jim Bob Cooling"): a person, whatever the length.
    return !firm.every((t) => isListedSurname(t.k));
  }
  if (a.run.length > 0) return false; // ambiguous words only: never alone
  // No marker at all: only a value the strict rule accepted, and not person-shaped.
  return strictPassed && !a.personShaped;
}

function contractorOne(raw: string): string | null {
  if (!raw.trim() || isPlaceholderName(raw)) return null;
  const strict = cleanOrgName(raw);
  const cand = strict ?? shapeOk(raw);
  if (!cand || isPlaceholderName(cand)) return null;
  // The strict rule's output must pass the same shape checks (C2, C3).
  if (strict && shapeOk(strict) !== strict) return null;
  if (!personGuardsOk(cand)) return null;
  if (!contractorMarkerOk(cand, strict !== null)) return null;
  const out = cand.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (out.length < 3 || out.length > 120) return null;
  return out;
}

/** The name a CONTRACTOR column may show, or null (C1 to C8). Never used for owner, applicant, tenant or resident columns. Stable. */
export function cleanContractorName(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  if (isPlaceholderName(raw)) return null;
  // C2: "PERSON of FIRM" / "PERSON c/o FIRM": the firm alone, or nothing. "FIRM of PLACE" keeps the firm.
  const parts = raw.normalize('NFKC').split(PERSON_FIRM_SPLIT_RE);
  if (parts.length > 2) return null;
  if (parts.length === 2) return contractorOne(parts[0]) ?? contractorOne(parts[1]);
  return contractorOne(raw);
}

/** True only when cleanContractorName returns the same string (after whitespace normalization). */
export function isContractorName(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  const c = cleanContractorName(name);
  return c !== null && c === collapse(name);
}

/**
 * The name a BUSINESS-LICENCE or inspection column may show (role 'business', redo rule 6), or null. A licence site can be a home, so
 * the business is shown (with its address) only when no word is a listed given name, an initial, a glued or a possessive person form
 * (even with a legal form: "REGINALD JACKSON HOME IMPROVEMENT LLC" gives nothing), and:
 *  - the name ends with a legal form (and passes C1 to C3, C6, C7); or
 *  - no word is a person-name word (a listed given name, a listed surname, an initial, a glued name), no word is a possessive person
 *    form ("John's", "MARIAS", "JOES"), the name does not read as a home-based activity (HOME_BASED_RE: daycare, child care, home
 *    occupation, home-based ...), it has a business marker (a trade or business word, LICENCE_WORDS or org.ts business vocabulary),
 *    and an ambiguous marker (Barber, Kitchen, Market, Pizza ...) stands only beside plain vocabulary words that are not names ("SUNSET
 *    PIZZA" passes; "Gareth Barber", "Saoirse Kitchen", "Bashir Market" do not).
 * The licence CATEGORY is checked for a home-based activity in extract.ts (OrgSpec.homeFields). "Lopez Daycare", "MARIAS DAYCARE" and
 * "Maria Lopez Home Daycare" give nothing.
 */
export function cleanBusinessName(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  if (isPlaceholderName(raw)) return null;
  const strict = cleanOrgName(raw);
  const cand = strict ?? shapeOk(raw);
  if (!cand || isPlaceholderName(cand)) return null;
  if (strict && shapeOk(strict) !== strict) return null;
  const marker = (k: string) => LICENCE_WORDS.has(k) || classifyWord(k) === 'business';
  if (!personGuardsOk(cand, marker)) return null;
  const a = analyse(cand, marker);
  // Every licence name, legal form or not: no listed given name, no glued or possessive person form, no initial ("REGINALD JACKSON HOME
  // IMPROVEMENT LLC", "Danny Smith LLC", "JT Smith LLC" give nothing: the site of a licence can be the person's home).
  for (const t of a.ts) {
    if (t.k === '&' || t.k === 'and' || t.k === 'the' || /\d/.test(t.k) || LEGAL.has(t.k)) continue;
    if (/^[a-z]$/.test(t.k) || possessivePerson(t.k) || gluedPersonWord(t.k) || /[a-z][A-Z]/.test(t.raw)) return null;
    if (isListedGivenName(t.k.replace(/'s$/, '')) && !isFirm(t.k)) return null;
  }
  if (a.legal === 0) {
    if (HOME_BASED_RE.test(cand)) return null;
    const words = a.ts.filter((t) => t.k !== '&' && t.k !== 'and' && t.k !== 'the');
    const markerWord = (k: string) => isFirm(k) || isAmbiguous(k) || marker(k);
    if (!words.some((t) => markerWord(t.k))) return null;
    const plain = (o: Tok) => /\d/.test(o.k) || (isVocabularyWord(o.k) && !personWord(o.k));
    // Two words (or first + initial + last): the word beside the marker must be plain vocabulary ("SUNSET PIZZA", not "Gareth Barber",
    // "Ifeoma Salon" or "Bayview Bookkeeping": an unknown word there cannot be told apart from a first name missing from the lists).
    if (a.personShaped && words.filter((o) => !markerWord(o.k)).some((o) => !plain(o))) return null;
    for (const t of words) {
      if (/[a-z][A-Z]/.test(t.raw)) return null; // a glued name in mixed case ("MariaLopez")
      if (possessivePerson(t.k)) return null;
      if (/^[a-z]$/.test(t.k)) return null; // an initial
      if (/\d/.test(t.k)) continue;
      const isMarkerWord = markerWord(t.k);
      if (!isMarkerWord && personWord(t.k)) return null;
      if (isMarkerWord && (isAmbiguous(t.k) || isListedSurname(t.k) || isListedGivenName(t.k))) {
        // An ambiguous marker (also a surname or a common noun) beside an unknown word reads as "FIRST LAST": every other word must be
        // plain vocabulary that is not a name, or an unambiguous trade form.
        const others = words.filter((o) => o !== t && !isFirm(o.k));
        if (others.some((o) => !plain(o))) return null;
      }
    }
  }
  const out = cand.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (out.length < 3 || out.length > 120) return null;
  return out;
}

/** True only when cleanBusinessName returns the same string (after whitespace normalization). */
export function isBusinessName(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  const c = cleanBusinessName(name);
  return c !== null && c === collapse(name);
}
