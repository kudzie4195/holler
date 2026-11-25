import type { CategoryId } from './categories';
import { isAlertLabel, ruleFor, type LabelInput, type OpportunityLabel } from './lead-rules';
import { isPermitRecord, routeFor } from './permit-routing';
import { siteAddressFromSummary } from './permit-value';
import { belowMinimum, type WorkProfile, type WorkRecord } from './work-profile';
import { businessTagFixEnabled } from './mapping/business-flag';

/**
 * Which matched cards go out as alerts (email and push) and which stay in the feed only (round 18 ROUTES). A held card is still matched,
 * stored and shown in the app feed, after the alerts, with its reason; it is never pushed, emailed or counted as an alert.
 *
 *   below_min   a permit whose stated job value is below the member's minimum (lib/signals/work-profile.ts). Feed shows "Below your minimum".
 *   held        a (trade, rule family) pair in PRECISION_HOLDS below: held out of alerts until its quality is proven. Feed shows "Background".
 *   background  a PERMIT card with no contact path (contactPathOf): it names nobody to call and no place to go. Feed shows "Background".
 *
 * The contact gate is for building permits only (round 33: and new-business licences while HOLLER_BUSINESS_TAG_FIX_ENABLED is on, held unless
 * the row names a business). Bids, storm reports, code violations, 311 requests and inspections are never held by it. A record whose contact state is not known (undefined: a row read back from the database without its contacts, as the
 * backfill and the rematch do) is never held by it either: only the scan, which holds the contacts it just stored, decides "no contact".
 *
 * A held card stays held: nothing ever clears alert_hold or re-arms the row, so a held card whose permit later gains a contact (or whose
 * member later lowers the minimum) is never sent. The feed then shows it without the hold chip (shownHold). Kept on purpose (round 18
 * review 2, decision 5): an old record is never released later as a fresh alert.
 *
 * Pure and client-safe.
 */
export type AlertHold = 'below_min' | 'held' | 'background';
export const ALERT_HOLDS: readonly AlertHold[] = ['below_min', 'held', 'background'];

export function isAlertHold(v: unknown): v is AlertHold {
  return v === 'below_min' || v === 'held' || v === 'background';
}

/**
 * How a member can act on a record: 'business' (an organisation is named: the contractor, the business, the buyer), 'site' (a street
 * address of the job site, from the site contact or from the permit's public summary), or null (neither).
 *
 * The owner's intent is "tells me who to call or where to go". A named business tells who to call. A street address with a house number
 * tells where to go: the address of permitted work is public record and is shown without any owner name. A bare street name with no
 * house number ("MAIN ST"), a ZIP or a county is NOT a place to go and does not count.
 */
export type ContactPath = 'business' | 'site';

export interface ContactLike {
  role: string;
  name?: string | null;
  address?: string | null;
}

/** A part that holds something other than a place: an amount, a bare number, "1 or 2 ...", an email, square footage. */
const NOT_PLACE_RE = /\bjob value\b|^\d+(?:\.\d+)?$|^\d+\s+or\s+(?:\d+|more)\b|\S@\S|\bsq\.?\s?ft\b/i;
/** "..., ATLANTA, GA 30309", "... MATTHEWS NC 28105", ", Cambridge, MA 02138": a printed city, state and ZIP after the street. */
const CITY_STATE_ZIP_TAIL_RE = /(?:,\s*[A-Za-z][A-Za-z .'-]{0,30}?,?|\s+[A-Za-z][A-Za-z'-]{1,24},?)\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?$/;
/** A house number: 1 to 6 digits (not all zeros), an optional letter ("123A"), a range or a letter after a hyphen ("123-125", "123-B") and "1/2". */
const HOUSE_RE = /^(\d{1,6}[A-Za-z]?(?:\s*-\s*(?:\d{1,6}[A-Za-z]?|[A-Za-z]))?(?:\s+1\/2)?)\s+(\S.*)$/;
const STREET_SUFFIX_RE =
  /^(?:st|street|ave?|avenue|blvd|bv|boulevard|rd|road|dr|drive|ln|lane|ct|court|pl|place|way|wy|pkwy|pky|parkway|hwy|highway|cir|circle|ter|terrace|trl|trail|sq|square|loop|run|row|aly|alley|xing|crossing|pass|path|walk|cv|cove|pt|point|ridge|bnd|bend|expy|fwy|plz|plaza|broadway)\.?$/i;
const ORDINAL_STREET_RE = /^\d+(?:st|nd|rd|th)$/i;
const QUADRANT_RE = /^(?:n|s|e|w|ne|nw|se|sw)\.?$/i;
/**
 * Words that make a numbered phrase a COUNT or a work description when the phrase ENDS in one and nothing else says it is a street (no
 * street suffix after a name word, no printed city, state and ZIP, no trailing quadrant): "30 day", "2 baths", "3 new units",
 * "4 SOUTH WINDOWS", "2 Way Radio Install", "10 stories", "200 AMP SERVICE". A street NAME that contains one of these words is still a
 * street: "3080 NEW HOPE SW, ATLANTA, GA 30331", "1800 BATH AVENUE", "25 Day St", "653 NEW LOTS AVENUE" (round 18 review 2, P2-2).
 */
const COUNT_WORDS = new Set(
  ('radio install installation installed repair repairs replace replacement remodel addition additions window windows roof reroof demolition demo ' +
    'inspection construction adjustment line lines permit permits day days week weeks month months year years hour hours amp amps gal gallon ' +
    'gallons ton tons kw kva family families dwelling dwellings story stories floor floors level levels unit units bed beds bedroom bedrooms ' +
    'bath baths room rooms building buildings acre acres lot lots sf sqft feet ft new existing service panel panels circuit circuits fixture ' +
    'fixtures heater heaters system systems car cars stall stalls space spaces seat seats sfd sfr townhome townhomes townhouses homes houses ' +
    'sign signs tree trees shingle shingles plex phase electric dumpster dumpsters fence').split(' '),
);
/** A word right before a number that makes the number a lot, block, unit or box, not a house number ("Lot 2 Sample Ct", "PO Box 12"). */
// Round 24 (cells report data bug): a highway, route or exit number is not a house number either ("blown down on Interstate 405 near
// Cherry Avenue" read as "405 near Cherry Avenue", a street address that does not exist).
const NOT_HOUSE_BEFORE = new Set(
  'lot lots tract unit ste suite apt bldg building fl floor rm room box no no. number phase section sec # interstate highway hwy route rte freeway expressway exit i us sr'.split(' '),
);
const STREET_WORD_RE = /^[#A-Za-z0-9'./-]+$/;

const words = (t: string) => t.split(' ').map((w) => w.replace(/[,;]+$/, '')).filter(Boolean);
const allZero = (house: string) => !/[1-9]/.test(house.replace(/\s+1\/2$/, ''));

/**
 * "123 Main St", "123-125 Main", "123A Main", "123-B Main St", "123 1/2 Main St", "1584 ABNER NW", "20 ARGYLE", "1200 block of Main St".
 * `addressish`: the text ended in a printed city, state and ZIP, which by itself says the part is an address.
 */
function startsWithNumberedStreet(t: string, addressish = false): boolean {
  const m = HOUSE_RE.exec(t);
  if (!m || allZero(m[1])) return false;
  const w = words(m[2]);
  if (w.length === 0 || w.length > 8 || !w.every((x) => STREET_WORD_RE.test(x))) return false;
  if (w[0].toLowerCase() === 'or') return false;
  if (addressish) return true;
  // A street suffix after a street-name word ("1800 BATH AVENUE", "25 Day St"); "2 Way Radio Install" has its "Way" first, so it is not one.
  if (w.some((x, i) => i > 0 && STREET_SUFFIX_RE.test(x))) return true;
  // A trailing quadrant after a street name ("1240 COUNTY LINE SW", "55 NEW JERSEY NW").
  if (w.length >= 2 && QUADRANT_RE.test(w[w.length - 1])) return true;
  // Otherwise a phrase that ENDS in a count or work word is a count ("30 day", "2 baths", "4 SOUTH WINDOWS").
  return !COUNT_WORDS.has(w[w.length - 1].toLowerCase());
}

/** A named building or place with a numbered street inside it: "One Atlantic Center 1201 W Peachtree St". The street must end in a suffix. */
function innerNumberedStreet(t: string): boolean {
  const w = words(t);
  for (let i = 1; i < w.length; i++) {
    if (!/^\d{1,6}[A-Za-z]?$/.test(w[i]) || allZero(w[i]) || NOT_HOUSE_BEFORE.has(w[i - 1].toLowerCase())) continue;
    const after = w.slice(i + 1, i + 6);
    const at = after.findIndex((x, j) => j > 0 && STREET_SUFFIX_RE.test(x));
    if (at > 0 && after.slice(0, at).every((x) => STREET_WORD_RE.test(x))) return true;
  }
  return false;
}

/** One side of an intersection: one to four words ending in a street suffix or an ordinal ("Main St", "3rd Ave", "10th"). */
function streetSide(side: string): boolean {
  const w = words(side.trim());
  if (w.length === 0 || w.length > 4) return false;
  if (!w.every((x) => /^[A-Za-z0-9'.-]+$/.test(x))) return false;
  const last = w[w.length - 1];
  return STREET_SUFFIX_RE.test(last) || (w.length === 1 && ORDINAL_STREET_RE.test(last)) || (w.length > 1 && QUADRANT_RE.test(last) && STREET_SUFFIX_RE.test(w[w.length - 2]));
}

/** An intersection: "Main St & 3rd Ave", "PEACHTREE ST / 10TH ST", "Main St @ 3rd Ave", "Peachtree St and 10th St". Both sides must be streets. */
function intersection(t: string): boolean {
  const sides = t.split(/\s*(?:&|@|\/)\s*|\s+(?:and|at)\s+/i);
  return sides.length === 2 && streetSide(sides[0]) && streetSide(sides[1]);
}

/**
 * Does this text name a place a member can go to? (a yes or no for the alert gate: nothing is cut, stored or shown). The text is always
 * one the member SEES on the card: a stored site contact or a part of the public summary. Wider than the display cutter
 * (permit-value.ts siteAddressFromSummary, sanitize.ts cleanAddress), which must also CUT the street safely.
 * Counts: a house number (not 0; a range, a letter or "1/2" allowed) and a street, whatever ordinary words the street name holds; a
 * hundred-block ("1200 block of Main St"); a named building with a numbered street; an intersection of two streets.
 * Does not count: "0 Peachtree", a lot or subdivision with no street, a PO Box, a street with no number and no cross street, and a number
 * that belongs to a count or a work phrase ("10 stories", "3 new units", "4 SOUTH WINDOWS", "2 Way Radio Install").
 */
export function textShowsPlace(text: string | null | undefined): boolean {
  if (typeof text !== 'string') return false;
  let t = text.replace(/\s+/g, ' ').trim();
  if (!t || /\bp\.?\s?o\.?\s*box\b/i.test(t) || NOT_PLACE_RE.test(t)) return false;
  const whole = t;
  t = t.replace(CITY_STATE_ZIP_TAIL_RE, '').trim();
  if (!t || NOT_PLACE_RE.test(t)) return false;
  const addressish = t !== whole;
  if (startsWithNumberedStreet(t, addressish)) return true;
  // "Peachtree Center, 225 Peachtree St": a later comma part that is itself a numbered street.
  const commaParts = t.split(/\s*,\s*/);
  if (commaParts.slice(1).some((p) => !NOT_PLACE_RE.test(p) && startsWithNumberedStreet(p, addressish))) return true;
  return innerNumberedStreet(t) || intersection(t);
}

/** The public summary prints a place to go in one of its parts (the gate's summary fallback). */
export function summaryNamesSite(summary: string | null | undefined): boolean {
  if (typeof summary !== 'string') return false;
  return summary.split(' | ').some((part) => textShowsPlace(part));
}

/**
 * The contact path, read only from what Holler stores and the card shows (round 18 review 2, decision 2), in this order:
 *  a. a stored business contact (an organisation with a name): the card's "Who to contact";
 *  b. a stored site contact whose address names a place: the job site the card already displays (lib/contacts extract.ts writes it for
 *     every source whose contact spec has a site, when the display cleaner keeps the street);
 *  c. a place printed in the card's own text (the public summary).
 * An alert never goes out on the strength of something the member cannot see, and the same permit gets the same answer on the scan, the
 * rematch, the backfill and the stage step (they all read the stored contacts and the summary).
 */
export function contactPathOf(contacts: readonly ContactLike[] | null | undefined, summary: string | null | undefined): ContactPath | null {
  const list = contacts ?? [];
  if (list.some((c) => c.role !== 'site' && typeof c.name === 'string' && c.name.trim().length > 0)) return 'business';
  if (list.some((c) => c.role === 'site' && textShowsPlace(c.address))) return 'site';
  if (summaryNamesSite(summary)) return 'site';
  // The display reader too (it cuts a street out of a longer part); house number 0 is never a place.
  const shown = siteAddressFromSummary(summary);
  if (shown && !/^0+[A-Za-z]?\s/.test(shown.address)) return 'site';
  return null;
}

/**
 * The rule family of a (record, trade) pair: the id of the label rule that decides it (lib/signals/lead-rules.ts RULES), with the permit
 * route kind added for the downstream rule ("soon-permit-downstream:new-build"), or "default:<subtype or kind>" when only the source default
 * applies. The replay (npm run replay:trades) counts cards per family, and PRECISION_HOLDS is keyed by it.
 */
export function ruleFamilyOf(sig: LabelInput, trade: string | null): string {
  const rule = ruleFor(sig, trade as CategoryId | null);
  if (rule) {
    if (rule.id === 'soon-permit-downstream') {
      const k = routeFor(sig.title, trade, { summary: sig.summary, source: sig.source });
      return k ? `${rule.id}:${k}` : rule.id;
    }
    return rule.id;
  }
  const sub = (sig.subtype ?? '').trim().toLowerCase() || (sig.kind ?? '').trim().toLowerCase() || 'record';
  return `default:${sub}`;
}

export interface PrecisionHold {
  trade: CategoryId;
  /** A rule family as ruleFamilyOf gives it. */
  family: string;
  /** Why it is held, with the evidence (fixture rows, test or grade). Shown in the replay report, never to members. */
  why: string;
}

/**
 * Trade + record-kind (rule family) pairs held out of alerts until their quality is proven. A held pair is still matched and shown in the
 * feed ("Background"); it is never pushed or emailed. A code table on purpose (reviewed in a pull request, no migration).
 *
 * EMPTY at round 18: the replay of the repo's real-row fixtures (npm run replay:trades, /home/claude/gates/r18/logs/ROUTES-replay-trades.md)
 * and the existing graded fixtures show no family that is clearly wrong for its trade (the round 15 failures, public 311 work and
 * own-trade permits, are already context or market insight). To hold a pair: add { trade, family, why } with the replay counts and the
 * sampled titles that prove it, and a test in tests/signals/routes-contact-gate.test.ts ("precision holds").
 */
export const PRECISION_HOLDS: readonly PrecisionHold[] = [];

export function isHeldPair(trade: string | null, family: string, holds: readonly PrecisionHold[] = PRECISION_HOLDS): boolean {
  if (!trade) return false;
  return holds.some((h) => h.trade === trade && h.family === family);
}

/** Round 33: a new-business licence while the switch is on. Its contact state is set by the scan (markContactPaths) and /check (check/delivery.ts). */
export function licenceGateApplies(sig: { kind?: string | null; subtype?: string | null }): boolean {
  return businessTagFixEnabled() && (sig.subtype ?? '').trim().toLowerCase() === 'business';
}

export interface GateInput extends WorkRecord {
  source: string;
  /** undefined = not known (never held by the contact gate); null = known to have no contact path. */
  contactPath?: ContactPath | null;
}

/**
 * The hold for one matched card, or null when it goes out as usual. Order: below_min (the member's own setting), then held, then
 * background. below_min marks any permit card (also a market insight); held and background apply only to cards that would be alerts.
 */
export function alertHoldFor(
  sig: GateInput,
  label: OpportunityLabel,
  trade: string | null,
  work: WorkProfile | null | undefined,
  holds: readonly PrecisionHold[] = PRECISION_HOLDS,
): AlertHold | null {
  if (belowMinimum(sig, work)) return 'below_min';
  if (!isAlertLabel(label)) return null;
  if (holds.length > 0 && isHeldPair(trade, ruleFamilyOf(sig, trade), holds)) return 'held';
  if (isPermitRecord(sig) && sig.contactPath === null) return 'background';
  // Round 33 (switch HOLLER_BUSINESS_TAG_FIX_ENABLED): a new-business licence card names no business and no address (a type word, a ZIP and a
  // rounded point; 38 of 1,632 stored rows have a contact). It is feed only unless the row has a named business to call.
  if (licenceGateApplies(sig) && sig.contactPath !== undefined && sig.contactPath !== 'business') return 'background';
  return null;
}

// ---- the holler_matches.alert_hold column (migration 0027) ------------------------------------------------------------------------

/** The match column that stores the hold. Absent before migration 0027: writers retry without it, readers without it. */
export const HOLD_COLUMN = 'alert_hold';

/**
 * Postgres 42703 (undefined column) or PostgREST PGRST204 (column not in the schema cache) about alert_hold: migration 0027 is not applied.
 * Also accepts the bare message form (readAllPages rethrows only the message).
 */
export function missingHoldColumn(e: { code?: string | null; message?: string | null } | string | null | undefined): boolean {
  if (!e) return false;
  const message = typeof e === 'string' ? e : (e.message ?? '');
  const code = typeof e === 'string' ? '' : (e.code ?? '');
  if (!/alert_hold/i.test(message)) return false;
  return code === '42703' || code === 'PGRST204' || /does not exist|could not find|schema cache/i.test(message);
}

/** The rows without the hold key (for a retry before migration 0027). Rows without a hold are returned as they are. */
export function withoutHold<T extends object>(rows: readonly T[]): T[] {
  return rows.map((r) => {
    if (!(HOLD_COLUMN in r)) return r;
    const copy = { ...r } as Record<string, unknown>;
    delete copy[HOLD_COLUMN];
    return copy as T;
  });
}

/**
 * The hold a card SHOWS. A 'background' card whose own text or contacts now name a place to go or a business (a card stored by an older
 * rule, or contacts read later) shows no hold: the feed never says "no business and no site address" next to an address it prints.
 */
export function shownHold(
  hold: AlertHold | null,
  contacts: readonly ContactLike[] | null | undefined,
  summary: string | null | undefined,
  /**
   * The member's CURRENT minimum (undefined: not known, the stored hold is shown) and the permit's stated value. A "Below your minimum"
   * card is shown without the chip once the member clears or lowers the minimum below that value (review P3-2).
   */
  now?: { minValue?: number | null; jobValue?: number | null },
): AlertHold | null {
  if (hold === 'background' && contactPathOf(contacts, summary) !== null) return null;
  if (hold === 'below_min' && now && now.minValue !== undefined) {
    if (now.minValue === null) return null;
    if (typeof now.jobValue === 'number' && now.jobValue >= now.minValue) return null;
  }
  return hold;
}

/** A match row's stored hold, or null (no column, no value, or an unknown value). */
export function holdOf(row: { alert_hold?: unknown } | null | undefined): AlertHold | null {
  const v = row?.alert_hold;
  return isAlertHold(v) ? v : null;
}
