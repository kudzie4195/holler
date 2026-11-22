import { BANNED_WORDS } from './fallback';

/**
 * Rules for the one-line "why this matters to a <trade>" note the AI step writes. Pure, no I/O.
 * A note that breaks any rule is dropped (the trades are kept). The model is told the same rules; this file is the part that is
 * enforced, so a prompt-injected record cannot get a link, a number, contact details or an over-long line onto a member's screen.
 */

export const NOTE_MAX_CHARS = 140;
export const NOTE_MIN_CHARS = 12;

/** House banned words (CONTEXT.md copy rules) plus the draft list in fallback.ts. Matched as whole words or phrases. */
export const NOTE_BANNED = [
  ...new Set([
    'delve', 'robust', 'seamless', 'elevate', 'unlock', 'empower', 'journey', 'landscape', 'leverage', 'not only', 'more than just',
    "it's worth noting", 'it is worth noting', "whether you're", 'whether you are',
    // Round 17 (item 2.5): a link says "public source", never "official record"; no hype promises.
    'official record', 'official records', 'official source', 'you will win', 'they need you',
    ...BANNED_WORDS.map((w) => w.toLowerCase()),
  ]),
];

/** Words that make a damage word a possibility instead of a claim, when one of them is within 3 words before it. */
const HEDGES = new Set(['may', 'might', 'can', 'could', 'possible', 'possibly', 'risk', 'check', 'inspect', 'inspecting']);
const DAMAGE = /^(damage|damages|damaged|damaging|destroyed|destroy|destroys|wrecked|ruined|collapsed|flooded|smashed|shattered|cracked|broken|leaking|leaks|leaked|torn|downed)$/;

export type NoteViolation =
  | 'empty'
  | 'too_short'
  | 'too_long'
  | 'multiline'
  | 'dash'
  | 'digits_not_in_input'
  | 'phone'
  | 'email'
  | 'url'
  | 'banned_word'
  | 'claims_damage'
  | 'claims_customer'
  | 'claims_request'
  | 'claims_certain'
  | 'claims_vendor'
  | 'claims_proof'
  | 'claims_cause'
  | 'unknown_name'
  | 'markup'
  | 'colon'
  | 'steering';

/** Number tokens ("75", "1.75", "2,500" -> "2500") in a text. */
export function numberTokens(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((t) => t.replace(/,/g, ''));
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .split(/[^a-z0-9']+/)
    .filter(Boolean);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const NEED_OBJ = new Set(['a', 'an', 'you', 'your', 'help', 'someone', 'service', 'services']);
/**
 * A claim that someone is a customer or a lead. "lead" counts only as a noun ("new leads", "a lead"): the verb in an honest hedge
 * ("could lead to", "may lead to", "often leads to") and the metal ("lead paint", "lead pipes") do not (verify-v1 decision 5).
 */
const CUSTOMER =
  /\b(customers?|clients?|prospects?|buyers?)\b|\bleads\b(?!\s+(?:to|into)\b)|\b(?:a|an|the|new|more|hot|warm|fresh|sales|good|great|your|real|solid|likely|possible|potential)\s+lead\b(?!\s+(?:to|into|paint|pipes?|lines?|service|abatement|based|free|safe|testing)\b)/i;
/** Certainty about work or customers: notes speak of possibilities only ("may", "could"). */
const CERTAIN = /\b(will|won't|wont|guarantee[sd]?|guaranteeing|definitely|certainly|for sure|sure to|bound to)\b/i;
const REQUEST =
  /\b(ask(s|ed|ing)?|request(s|ed|ing)?|looking for|seeking|hiring|hired?|wants?|wanted|waiting for|booked|called for|reached out|quote request|job for you|work for you)\b/i;
/**
 * A permit never proves that a vendor was chosen, and a 311 or violation record never proves who is doing the work: a note must not
 * say a contractor, roofer or crew already has, was given or pulled the job. "Hired", "booked", "awarded" and similar are also in
 * REQUEST/this list. Matching is deliberately broad: a false hit only drops the note, the trades stay.
 */
const VENDOR = new RegExp(
  [
    '\\b(already|has|have|had|got|gets|using|uses)\\s+(a|an|the|their|its|one|some)?\\s*(contractors?|roofers?|vendors?|installers?|crews?|plumbers?|electricians?|builders?|painters?|handymen|company|companies|providers?|firms?)\\b',
    '\\b(selected|chosen|awarded|awarding|retained|contracted|signed|secured|lined up|locked in|spoken for|taken care of|already handled|in good hands|picked|named)\\b',
    '\\balready\\s+(has|have|had|got|handled|hired|booked|taken)\\b',
    '\\b(contractors?|vendors?|roofers?|installers?|crews?|builders?|plumbers?|electricians?)\\s+(already|has|have|had|got)\\b',
    '\\bwinning\\s+(bid|bidder|contractor|vendor)\\b',
    '\\b(contractors?|vendors?|roofers?|builders?)\\b.{0,30}\\b(pulled|filed|applied|obtained|submitted|took out|is doing|are doing|will do)\\b',
    '\\b(pulled|filed|applied for|obtained|submitted|taken out)\\s+(by|the permit)\\b',
    '\\b(permit\\s+holder|permit\\s+applicant|applicant|licensed\\s+contractor\\s+on)\\b',
  ].join('|'),
  'i',
);
/** Proof words: nothing in a public record confirms, proves or verifies damage, a condition or demand. */
const PROOF = /\b(confirm(s|ed|ing)?|proof|prov(es|ed|en|ing)|verif(y|ies|ied|ying)|evidence of|shows? that|certified)\b/i;
/** Weather and storm records: a cause-and-effect verb next to a damage word turns a possibility into a claim. */
const CAUSAL = /\b(caused|causes|causing|resulted|resulting|result of|led to|leads to|left behind|brought down|knocked)\b/i;
const WEATHER_KINDS = new Set(['alert', 'report', 'disaster', 'quake']);

const PHONE = /(\+?\d[\s.()-]*){7,}/;
const EMAIL = /@|\bat\s+\w+\s+dot\s+\w+/i;
const URL_SCHEME = /https?:|ftp:|mailto:|www\.|:\/\//i;
/** "evil.example", "x.co/abc". Dotted abbreviations ("U.S.", "a.m.") have single-letter labels and do not match. */
const DOMAIN_LIKE = /\b[a-z0-9-]{2,}\.[a-z]{2,24}\b/i;
/** A web address spelled out: "hailfixpros dot com". */
const SPELLED_DOMAIN =
  /\bdot\s+(com|net|org|io|co|us|biz|info|app|dev|me|ly|ai|tv|xyz|site|online|store|shop|pro|club|live|tech|gov|edu|ca|uk)\b/i;
/** A web address with the dot left out: "hailfixpros com". */
const BARE_TLD = /\b[a-z0-9-]{3,}\s+(?:com|net|org|io)\b/i;
/** Short phone shapes ("555 0199", "555-0199") on top of PHONE's 7+ digit runs. */
const PHONE_SHORT = /\b\d{3}[\s.)-]+\d{4}\b/;
/**
 * Words that tell the reader to do something outside Holler (search, visit, text, call, message, click, download, go to, look up, DM,
 * contact, follow, sign up) or point at a place to do it (Google, Instagram, a website, online, free estimates), in any form. A note says
 * why a record matters; it never sends anyone anywhere, and a lower-case brand name with any of these is dropped (verify-v1 decision 5).
 * "may call for" (needs) is not steering. A few harmless lines are still dropped, which only costs the note: the trades stay.
 */
const STEERING = new RegExp(
  [
    '\\b(search(es|ed|ing)?|visit(s|ed|ing)?|text(s|ed|ing)?|messag(e|es|ed|ing)|click(s|ed|ing)?|download(s|ed|ing)?)\\b',
    '\\bcall(s|ed|ing)?\\b(?!\\s+for\\b)',
    '\\b(go(es|ing)?|head(s|ed|ing)?)\\s+(to|over)\\b',
    '\\blook(s|ed|ing)?\\s+up\\b',
    '\\b(dm|dms|inbox)\\b',
    '\\b(contact(s|ed|ing)?|follow(s|ed|ing)?\\s+(us|them)|sign(s|ed|ing)?\\s+up|check(s|ed|ing)?\\s+out|reach(es|ed|ing)?\\s+out|book(s|ed|ing)?\\s+now)\\b',
    '\\b(google|googl(e|ed|ing)|instagram|insta|facebook|fb|tiktok|yelp|nextdoor|website|web\\s+site|online|app\\s+store)\\b',
    '\\bfree\\s+(estimates?|quotes?|inspections?|consultations?|bids?)\\b',
  ].join('|'),
  'i',
);

/**
 * Every rule the note breaks. `input` is the exact public text the model was shown for this signal (title, summary, kind, subtype,
 * source, categories, city, state), used for the digit rule: a number may appear in the note only if it appears in the input.
 */
export function noteViolations(note: string, input: string, ctx: { kind?: string | null } = {}): NoteViolation[] {
  const out: NoteViolation[] = [];
  if (typeof note !== 'string' || note.trim() === '') return ['empty'];
  if (/[\r\n\u2028\u2029]/.test(note)) out.push('multiline');
  const t = note.trim();
  if (t.length > NOTE_MAX_CHARS) out.push('too_long');
  if (t.length < NOTE_MIN_CHARS) out.push('too_short');
  if (/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/.test(t)) out.push('dash');
  if (/[<>`*_#[\]{}|\\]/.test(t)) out.push('markup');

  const allowed = new Set(numberTokens(input));
  if (numberTokens(t).some((n) => !allowed.has(n))) out.push('digits_not_in_input');
  if (PHONE.test(t) || PHONE_SHORT.test(t)) out.push('phone');
  if (EMAIL.test(t)) out.push('email');
  if (URL_SCHEME.test(t) || DOMAIN_LIKE.test(t) || SPELLED_DOMAIN.test(t) || BARE_TLD.test(t)) out.push('url');
  // One plain sentence needs no colon; any token with one ("javascript:", "tel:", "here: ...") is refused.
  if (/:/.test(t)) out.push('colon');
  if (STEERING.test(t)) out.push('steering');

  const lower = t.toLowerCase().replace(/[’]/g, "'");
  if (NOTE_BANNED.some((w) => new RegExp(`(^|[^a-z])${escapeRe(w)}($|[^a-z])`).test(lower))) out.push('banned_word');

  const ws = words(t);
  for (let i = 0; i < ws.length; i++) {
    if (!DAMAGE.test(ws[i])) continue;
    const before = ws.slice(Math.max(0, i - 3), i);
    if (!before.some((w) => HEDGES.has(w))) {
      out.push('claims_damage');
      break;
    }
  }
  if (CUSTOMER.test(t)) out.push('claims_customer');
  if (CERTAIN.test(t)) out.push('claims_certain');
  if (VENDOR.test(t)) out.push('claims_vendor');
  if (PROOF.test(t)) out.push('claims_proof');
  // Weather never proves damage: for weather records a causal verb is refused even when a hedge is nearby.
  if (WEATHER_KINDS.has((ctx.kind ?? '').toLowerCase()) && CAUSAL.test(t)) out.push('claims_cause');
  if (REQUEST.test(t)) out.push('claims_request');
  else {
    // "needs a roofer" is a claim; "may need a look" is not. "need" counts only without a hedge in the 2 words before it.
    for (let i = 0; i < ws.length - 1; i++) {
      if (!/^needs?$/.test(ws[i]) || !NEED_OBJ.has(ws[i + 1])) continue;
      if (!ws.slice(Math.max(0, i - 2), i).some((w) => HEDGES.has(w))) {
        out.push('claims_request');
        break;
      }
    }
  }
  if (unknownNames(t, input).length > 0) out.push('unknown_name');
  return out;
}

/** Capitalized words a note may use even when the input does not contain them. */
const NAME_OK = new Set(['ac', 'hvac', 'ev', 'us', 'u.s', 'diy', 'ok']);

/**
 * Capitalized words after the first word that do not appear in the input: a place, person or business the record never named.
 * This matters most for cached notes, which were written for another record (another city) with the same normalized text.
 */
function unknownNames(note: string, input: string): string[] {
  const known = new Set(words(input));
  const toks = note.match(/[A-Za-z][A-Za-z.'’]*/g) ?? [];
  return toks
    .slice(1)
    .filter((w) => /^[A-Z]/.test(w))
    .map((w) => w.toLowerCase().replace(/[.'’]+$/, ''))
    .filter((w) => !known.has(w) && !NAME_OK.has(w));
}

/** The note, trimmed and with runs of spaces collapsed, or null when it breaks any rule. */
export function cleanNote(note: unknown, input: string, ctx: { kind?: string | null } = {}): string | null {
  if (typeof note !== 'string') return null;
  const t = note.replace(/[ \t]+/g, ' ').trim();
  return noteViolations(t, input, ctx).length === 0 ? t : null;
}
