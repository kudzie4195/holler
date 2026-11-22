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
 * Round 18 (NAMES): the trade-name rule for CONTRACTOR company columns.
 *
 * The owner's decision: a trade name in a contractor column is a business and may be shown, even when it carries a person's name
 * ("Smith Roofing", "Mary Jones Plumbing LLC", "Carter Electric"). The strict rule in org.ts (cleanOrgName) is unchanged and still
 * decides every other column (business licences, inspections, awards); this file only widens what a contractor column may name.
 *
 * cleanContractorName(raw) returns cleanOrgName(raw) when the strict rule passes. Otherwise it returns the trade name only when ALL hold:
 *  T1. The whole value passes the same guards as the strict rule: a string of at most 400 characters, no invisible or direction
 *      character, every letter ASCII after accent folding, no phone, email or link anywhere, no role word anywhere (owner, tenant,
 *      c/o, attn, trust, estate ... hasRoleWord), no street-address shape.
 *  T2. Shape. "PERSON (COMPANY)" keeps the bracket only; "X DBA Y" (also d/b/a, t/a, trading as, doing business as, operating as, o/a)
 *      keeps the part after the last DBA marker only. A legal form after a comma joins the name ("Smith Roofing, Inc."). Any other
 *      comma or separator (; | / \ : brackets quotes " - " and so on) gives null: "SMITH, JOHN A", "Glass, Mary", "Carter, Electra",
 *      "John Smith, Qualifier" are refused. The one exception is "A/C" (air conditioning), read as one trade word.
 *  T3. No word is an honorific (MR, DR ...), a suffix (JR, SR, III), a credential (MD, CPA ...), a job-title or licence-holder word
 *      (QUALIFIER, LICENSEE, OWNER, PRESIDENT, ELECTRICIAN, PLUMBER, ROOFER ...), or a connector (AT, FOR, BY, WITH, VIA, FROM, OR,
 *      OBO, ON BEHALF OF, LICENSE HOLDER, WORKS FOR ...). Digits only as a short token: "#1", "1ST", "A1", "247" (at most 3 digits).
 *  T4. A business marker: a final legal form (LLC, INC, CORP, CORPORATION, CO, COMPANY, LP, LLP, LLLP, PLLC, LTD, LIMITED,
 *      INCORPORATED, PC, PA, also dotted), a family or partnership phrase at the end ("& Sons", "and Son", "Bros", "Brothers",
 *      "& Associates", "& Daughters", "& Co"), or a TRADE word (TRADE_WORDS below) as the last word, or followed only by safe tail words
 *      (TAIL_WORDS, short number tokens, and non-name vocabulary words: "Roofing Depot", "Service 1st", "Plumbing Pros").
 *      Agent nouns that are also surnames or person roles are NOT trade words: Painter, Carpenter, Mason, Roofer, Plumber, Builder,
 *      Contractor (singular), Handyman, Locksmith. So "Bill Painter" and "Mason Carpenter" stay refused.
 *  T5. A trade word that is also a listed surname or given name, or a common surname vocabulary word (org.ts SURNAME_VOCAB: Homes,
 *      Lawn, Tree, Steel ...), or on AMBIGUOUS_TRADE (Glass, Stone, Wood, Iron, Solar ...) counts as the marker only when the name has
 *      another marker (a legal form, a family phrase, a second trade word) or no listed given name or initial before it: "Smith Glass"
 *      passes, "Mary Glass" and "Ann Stone" do not.
 *  T6. At least one distinctive word besides markers and trade words ("Roofing Inc" and "Roofing & Construction" name nobody), at most
 *      ten words, 3 to 120 characters.
 * A bare personal name never passes (no marker). The result is stable: cleanContractorName(cleanContractorName(x)) equals
 * cleanContractorName(x), and isContractorName(x) is true only when cleanContractorName(x) equals x after whitespace normalization.
 *
 * Owner, applicant, tenant and resident columns never reach this function: extract.ts uses it for role 'contractor' only.
 */

const list = (s: string): string[] => s.split(/\s+/).filter(Boolean);

/**
 * Trade and business words that make a contractor-column value a trade name (T4). Grouped by trade; plural agent nouns ("Roofers",
 * "Builders") are firms, singular ones are a person's role and are left out.
 */
export const TRADE_WORDS: ReadonlySet<string> = new Set(
  list(
    // roofing and exterior
    'roofing roofers roofs siding gutters gutter exteriors exterior windows doors awning awnings shutters decks decking ' +
      // plumbing, mechanical, electrical, energy
      'plumbing plumbers drain drains sewer septic rooter piping plumbing-heating ' +
      'electric electrical electricians electrics wiring lighting ' +
      'heating cooling air a/c ac hvac conditioning air-conditioning refrigeration ventilation mechanical mechanicals furnace furnaces ' +
      'boilers boiler duct ducts ductwork comfort ' +
      'solar energy power generators insulation ' +
      // general building
      'construction constructors contracting contractors builders building buildings homes homebuilders development developers ' +
      'remodeling remodelers remodel renovation renovations restoration restorations rebuilders improvement improvements ' +
      'carpentry framing millwork woodworks cabinetry cabinets countertops drywall plastering stucco masonry concrete paving pavers ' +
      'asphalt sealcoating excavating excavation excavators grading sitework demolition wrecking foundations foundation ' +
      'waterproofing basements steelworks ironworks welding fabrication fabricators erectors ' +
      // finishes
      'painting painters coatings flooring floors floor carpet carpets tile tiles glass glazing mirrors interiors design designs ' +
      // outdoor
      'landscaping landscape landscapes landscapers lawn lawncare lawns tree trees arborists irrigation sprinkler sprinklers fence ' +
      'fencing fences pools pool spas outdoor nursery hardscapes hardscaping gardens ' +
      // other trades and services
      'cleaning cleaners janitorial maintenance repair repairs pest exterminating termite hauling junk moving movers storage towing ' +
      'trucking transport inspections engineering engineers architects architecture surveying surveyors abatement environmental ' +
      'restoration mold radon chimney chimneys fireplaces garage overhead locks security alarm alarms automation controls signs ' +
      'signage communications telecom cable fiber wireless networks elevator elevators appliance appliances supply supplies equipment ' +
      'rentals lumber materials utilities drilling boring ' +
      // forms of business
      'services service solutions systems group enterprises enterprise company industries contracting holdings partners ' +
      'associates consulting consultants technologies management realty properties property investments ventures',
  ),
);

/** Trade words that are also common surnames or could close a person's name (T5): a marker only with other evidence. */
const AMBIGUOUS_TRADE: ReadonlySet<string> = new Set(
  list('glass stone stones wood woods iron solar homes lawn tree trees power comfort cable gardens floor pool garage fence air ac'),
);

/** Words allowed after the last trade word (T4): they describe the firm, never a person. */
const TAIL_WORDS: ReadonlySet<string> = new Set(
  list('pros pro experts masters guys team crew unlimited plus usa america express depot direct now today inc'),
);

/** A family or partnership phrase at the end (T4). */
const FAMILY_TAIL = new Set(list('sons son daughters associates assoc co company partners'));
const BROTHERS = new Set(list('bros brothers'));

/** Final legal forms (T4), dots removed. */
const LEGAL = new Set(list('llc inc incorporated corp corporation co company lp llp lllp pllc ltd limited pc pa plc'));
/** Words that never belong in a contractor's trade name (T3): connectors that join a person to a company. */
const CONNECTORS = new Set(list('at for by with via from or vs versus nee obo attn'));
const DBA_RE = /(?:^|\s)(?:d\/b\/a|d\.b\.a\.?|d b a|dba:?|t\/a|trading as|doing business as|operating as|o\/a)(?=\s|$)/gi;
const BLOCKED_PHRASES_RE = /\b(?:on behalf of|license holder|licence holder|lic holder|works for|employed by|working for|formerly|f\/k\/a|fka|n\/k\/a|nka|a\/k\/a|aka|and\/or|in care of|successor to)\b/i;

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** A token of the name: its raw text and the folded word used for lookups (dots removed). */
interface Tok {
  raw: string;
  k: string;
}

const DIGIT_TOKEN_RE = /^(?:#?\d{1,3}|\d{1,3}(?:st|nd|rd|th)|[a-z]\d{1,2})$/i;

function isLegalTok(t: Tok): boolean {
  return LEGAL.has(t.k);
}

function isTrade(k: string): boolean {
  return TRADE_WORDS.has(k);
}

function isAmbiguousTrade(k: string): boolean {
  return AMBIGUOUS_TRADE.has(k) || SURNAME_VOCAB.has(k) || isListedSurname(k) || isListedGivenName(k);
}

/** T2: the candidate text after the bracket and DBA rules, or null. */
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

/** The trade-name rule alone (T1 to T6), or null. */
function tradeName(raw: string, isMarker: (k: string) => boolean = isTrade): string | null {
  if (raw.length > 400) return null;
  if (/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u00AD]/.test(raw)) return null;
  if (/\p{L}/u.test(foldName(raw).replace(/[a-z]/g, ''))) return null; // T1: look-alike scripts
  const s = collapse(raw.normalize('NFKC').replace(/[\u2018\u2019\u201B\u00B4]/g, "'").replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' '));
  if (!s || /[\u2010-\u2015\u2212]/.test(s)) return null;
  if (hasContactShape(s) || hasRoleWord(s) || hasStreetAddressShape(s) || BLOCKED_PHRASES_RE.test(s)) return null;
  const cand = candidateOf(s);
  if (!cand) return null;
  if (hasRoleWord(cand) || hasStreetAddressShape(cand)) return null;

  // Each word as written, and its folded lookup form without dots ("Inc." -> "inc", "L.L.C." -> "llc").
  const toks: Tok[] = cand.split(' ').map((raw0) => ({ raw: raw0, k: foldName(raw0).replace(/\./g, '').replace(/[\u2018\u2019]/g, "'") }));
  if (toks.length > 10) return null;
  // T3: each word
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.k === '&' || t.k === 'and' || t.k === 'the') continue;
    if (/\d/.test(t.k)) {
      if (!DIGIT_TOKEN_RE.test(t.k)) return null;
      continue;
    }
    if (/^a\/c$/i.test(t.raw)) continue;
    if (CONNECTORS.has(t.k)) return null;
    // A period is allowed only at the end of a legal form, an initial, "Bros." or "Assoc." ("J. Smith Roofing", "Smith Bros.").
    if (t.raw.includes('.') && !(LEGAL.has(t.k) || BROTHERS.has(t.k) || t.k === 'assoc' || /^[a-z]$/i.test(t.k) || /^(?:[a-z]\.)+$/i.test(t.raw))) return null;
    if (/^(?:[a-z]\.)+$/i.test(t.raw) && !LEGAL.has(t.k) && t.k.length > 1) return null; // "J.R." style initials are fine only as one letter
    const cls: WordClass = classifyWord(t.k, i === toks.length - 1);
    if (cls === 'bad' && !/^[a-z]$/.test(t.k)) return null;
    if (cls === 'honor' || cls === 'suffix' || cls === 'cred' || cls === 'title') {
      // "pa", "pc" are legal forms only at the end; anywhere else a credential or title word refuses the value.
      if (!(LEGAL.has(t.k) && i >= toks.length - 2)) return null;
    }
  }
  if (toks[0].k === '&' || toks[0].k === 'and' || toks[toks.length - 1].k === '&' || toks[toks.length - 1].k === 'and') return null;
  if (toks.filter((t) => t.k === '&' || t.k === 'and').length > 2) return null;

  // T4: strip final legal forms (at most two: "Co. Inc.").
  let end = toks.length;
  let legal = 0;
  while (end > 1 && legal < 2 && isLegalTok(toks[end - 1])) {
    end--;
    legal++;
  }
  const core = toks.slice(0, end);
  if (!core.length) return null;
  const last = core[core.length - 1].k;
  const prev = core[core.length - 2]?.k;
  const family = (FAMILY_TAIL.has(last) && (prev === '&' || prev === 'and') && core.length >= 3) || (BROTHERS.has(last) && core.length >= 2);

  // The last trade word, with only safe tail words after it.
  let tradeAt = -1;
  for (let i = core.length - 1; i >= 0; i--) {
    const k = core[i].k;
    if (isMarker(k) || /^a\/c$/i.test(core[i].raw)) {
      tradeAt = i;
      break;
    }
    const safeTail = DIGIT_TOKEN_RE.test(k) || TAIL_WORDS.has(k) || ((isVocabularyWord(k) && !isListedGivenName(k) && !isListedSurname(k)) && k !== '&' && k !== 'and');
    if (!safeTail) break;
  }
  const tradeIdx = core.map((t, i) => (isMarker(t.k) || /^a\/c$/i.test(t.raw) ? i : -1)).filter((i) => i >= 0);
  const firmTrade = tradeIdx.filter((i) => !isAmbiguousTrade(core[i].k));
  let trade = tradeAt >= 0;
  if (trade && isAmbiguousTrade(core[tradeAt].k) && !(legal > 0 || family || firmTrade.length > 0)) {
    // T5: an ambiguous trade word alone needs no listed given name or initial before it.
    const before = core.slice(0, tradeAt);
    if (before.some((t) => isListedGivenName(t.k) || /^[a-z]$/.test(t.k))) trade = false;
  }
  if (!(legal > 0 || family || trade)) return null;

  // T6: a distinctive word.
  const distinctive = core.filter((t, i) => {
    if (t.k === '&' || t.k === 'and' || t.k === 'the') return false;
    if (tradeIdx.includes(i) || TAIL_WORDS.has(t.k)) return false;
    if (family && i >= core.length - 2 && (FAMILY_TAIL.has(t.k) || BROTHERS.has(t.k))) return false;
    return true;
  });
  if (!distinctive.length) return null;

  const out = collapse(toks.map((t) => t.raw).join(' '));
  if (out.length < 3 || out.length > 120) return null;
  return out.normalize('NFD').replace(/[\u0300-\u036F]/g, '');
}

/**
 * The name a CONTRACTOR column may show: the strict organisation name when it passes, else the trade name (T1 to T6 above), else null.
 * Never used for owner, applicant, tenant or resident columns. Stable.
 */
export function cleanContractorName(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const strict = cleanOrgName(raw);
  if (strict) return strict;
  const t = tradeName(raw);
  if (!t) return null;
  // Stability: the returned name must give itself back (a strict rule that would cut it differently means "unsure": null).
  const again = cleanOrgName(t);
  if (again !== null && again !== t) return null;
  if (again === null && tradeName(t) !== t) return null;
  return t;
}

/**
 * Business-licence and inspection names (role 'business', round 18). The business named on a new licence is the prospect, but a licence
 * can belong to a home business whose site is a home, so the widening is narrower than for contractors: the strict organisation name
 * when it passes, else the trade-name rule (T1 to T6, with the business vocabulary of org.ts and LICENCE_WORDS as markers as well as
 * TRADE_WORDS) ONLY when no word is a listed given name, a listed surname, an initial or a glued name. "SUNSET PIZZA", "FLATBUSH
 * LOCKSMITH" and "Bayview Bookkeeping" pass; "Maria Lopez Home Daycare", "Lopez Daycare", "Kelly Lewis" and "J R Pizza" do not.
 */
const LICENCE_WORDS: ReadonlySet<string> = new Set(
  list('pizza grill bar tavern diner kitchen deli locksmith locksmiths salon spa barber nails tailor cafe coffee tea market liquor'),
);

const LEGAL_WORDS = new Set(list('llc inc incorporated corp corporation co company lp llp lllp pllc ltd limited'));

/** A listed given name glued to a listed surname ("MARIALOPEZ", "JOHNSMITH"), each part 3+ letters. */
function gluedPersonWord(k: string): boolean {
  if (k.length < 6) return false;
  for (let i = 3; i <= k.length - 3; i++) if (isListedGivenName(k.slice(0, i)) && isListedSurname(k.slice(i))) return true;
  return false;
}

function businessMarker(k: string): boolean {
  return isTrade(k) || LICENCE_WORDS.has(k) || classifyWord(k) === 'business';
}

export function cleanBusinessName(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const strict = cleanOrgName(raw);
  if (strict) return strict;
  const t = tradeName(raw, businessMarker);
  if (!t) return null;
  // No person in the name: every word that is not the business marker is checked (the marker itself may be a surname: "Pizza").
  for (const w of t.split(' ')) {
    const k = foldName(w).replace(/\./g, '').replace(/'s$/, '');
    if (!/^[a-z][a-z'-]*$/.test(k) || k === 'and') continue;
    if (k.length === 1) return null; // an initial
    if (/[a-z][A-Z]/.test(w)) return null; // a glued name in mixed case ("MariaLopez")
    if (businessMarker(k) || LEGAL_WORDS.has(k)) continue;
    for (const piece of k.split('-')) {
      if (isListedGivenName(piece) || isListedSurname(piece) || gluedPersonWord(piece)) return null;
    }
  }
  const again = cleanOrgName(t);
  if (again !== null && again !== t) return null;
  if (again === null && tradeName(t, businessMarker) !== t) return null;
  return t;
}

/** True only when cleanBusinessName returns the same string (after whitespace normalization). */
export function isBusinessName(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  const c = cleanBusinessName(name);
  return c !== null && c === collapse(name);
}

/** True only when cleanContractorName returns the same string (after whitespace normalization). */
export function isContractorName(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  const c = cleanContractorName(name);
  return c !== null && c === collapse(name);
}
