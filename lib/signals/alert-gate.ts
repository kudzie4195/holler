import type { CategoryId } from './categories';
import { isAlertLabel, ruleFor, type LabelInput, type OpportunityLabel } from './lead-rules';
import { isPermitRecord, routeFor } from './permit-routing';
import { siteAddressFromSummary } from './permit-value';
import { belowMinimum, type WorkProfile, type WorkRecord } from './work-profile';

/**
 * Which matched cards go out as alerts (email and push) and which stay in the feed only (round 18 ROUTES). A held card is still matched,
 * stored and shown in the app feed, after the alerts, with its reason; it is never pushed, emailed or counted as an alert.
 *
 *   below_min   a permit whose stated job value is below the member's minimum (lib/signals/work-profile.ts). Feed shows "Below your minimum".
 *   held        a (trade, rule family) pair in PRECISION_HOLDS below: held out of alerts until its quality is proven. Feed shows "Background".
 *   background  a PERMIT card with no contact path (contactPathOf): it names nobody to call and no place to go. Feed shows "Background".
 *
 * The contact gate is for building permits only. Bids, storm reports, code violations, 311 requests, inspections and business licences are
 * never held by it. A record whose contact state is not known (undefined: a row read back from the database without its contacts, as the
 * backfill and the rematch do) is never held by it either: only the scan, which holds the contacts it just stored, decides "no contact".
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
 * house number ("MAIN ST"), a block, a ZIP or a county is NOT a place to go and does not count.
 */
export type ContactPath = 'business' | 'site';

export interface ContactLike {
  role: string;
  name?: string | null;
  address?: string | null;
}

/** A part that holds something other than a place: an amount, a block, a use class, an email, or a count at its end ("10 stories"). */
const NOT_PLACE_RE =
  /\bjob value\b|\bblock of\b|^\d+(?:\.\d+)?$|^\d+\s+or\s+(?:\d+|more)\b|@|\bsq\.?\s?ft\b|\b(?:stories|story|floors?|levels?|units?|bed(?:room)?s?|baths?|rooms?|buildings?|acres?|lots?|sf|sqft|feet|ft|years?|months?|weeks?|days?|hours?|permits?|stalls?|spaces?|seats?|dwellings?)\b\s*$/i;
/** "..., ATLANTA, GA 30309", "... MATTHEWS NC 28105", ", Cambridge, MA 02138": a printed city, state and ZIP after the street. */
const CITY_STATE_ZIP_TAIL_RE = /(?:,\s*[A-Za-z][A-Za-z .'-]{0,30}?,?|\s+[A-Za-z][A-Za-z'-]{1,24},?)\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?$/;
/** A house number: 1 to 6 digits (not all zeros), an optional letter ("123A"), an optional range ("123-125") and an optional "1/2". */
const HOUSE_RE = /^(\d{1,6}[A-Za-z]?(?:\s*-\s*\d{1,6}[A-Za-z]?)?(?:\s+1\/2)?)\s+(\S.*)$/;
const STREET_SUFFIX_RE =
  /^(?:st|street|ave?|avenue|blvd|bv|boulevard|rd|road|dr|drive|ln|lane|ct|court|pl|place|way|wy|pkwy|pky|parkway|hwy|highway|cir|circle|ter|terrace|trl|trail|sq|square|loop|run|row|aly|alley|xing|crossing|pass|path|walk|cv|cove|pt|point|ridge|bnd|bend|expy|fwy|plz|plaza|broadway)\.?$/i;
const ORDINAL_STREET_RE = /^\d+(?:st|nd|rd|th)$/i;
/** Words that make a numbered phrase a count or a work description, not a street ("2 Way Radio Install", "4 SOUTH WINDOWS", "1 or 2 Family"). */
const NOT_STREET_WORDS = new Set(
  ('radio install installation installed repair repairs replace replacement remodel addition additions window windows roof reroof demolition demo ' +
    'inspection construction adjustment line lines permit permits day days week weeks month months year years hour hours amp amps gal gallon ' +
    'gallons ton tons kw kva or family families dwelling dwellings stories bedroom bedrooms bath baths sqft sf feet ft acre acres new existing ' +
    'service panel circuit circuits fixture fixtures heater heaters system systems car cars stall stalls spaces seats rooms').split(' '),
);
/** A word right before a number that makes the number a lot, block, unit or box, not a house number ("Lot 2 Sample Ct", "PO Box 12"). */
const NOT_HOUSE_BEFORE = new Set('lot lots block blk tract unit ste suite apt bldg building fl floor rm room box no no. number phase section sec #'.split(' '));
const STREET_WORD_RE = /^[#A-Za-z0-9'./-]+$/;

const words = (t: string) => t.split(' ').map((w) => w.replace(/[,;]+$/, '')).filter(Boolean);
const allZero = (house: string) => !/[1-9]/.test(house.replace(/\s+1\/2$/, ''));

/** "123 Main St", "123-125 Main", "123A Main", "123 1/2 Main St", "1584 ABNER NW", "20 ARGYLE", "1790 BROADWAY Manhattan". */
function startsWithNumberedStreet(t: string): boolean {
  const m = HOUSE_RE.exec(t);
  if (!m || allZero(m[1])) return false;
  const w = words(m[2]);
  if (w.length === 0 || w.length > 8) return false;
  return w.every((x) => STREET_WORD_RE.test(x) && !NOT_STREET_WORDS.has(x.toLowerCase()));
}

/** A named building or place with a numbered street inside it: "One Atlantic Center 1201 W Peachtree St". The street must end in a suffix. */
function innerNumberedStreet(t: string): boolean {
  const w = words(t);
  for (let i = 1; i < w.length; i++) {
    if (!/^\d{1,6}[A-Za-z]?$/.test(w[i]) || allZero(w[i]) || NOT_HOUSE_BEFORE.has(w[i - 1].toLowerCase())) continue;
    const after = w.slice(i + 1, i + 6);
    const at = after.findIndex((x, j) => j > 0 && STREET_SUFFIX_RE.test(x));
    if (at > 0 && after.slice(0, at).every((x) => STREET_WORD_RE.test(x) && !NOT_STREET_WORDS.has(x.toLowerCase()))) return true;
  }
  return false;
}

/** One side of an intersection: one to four words ending in a street suffix or an ordinal ("Main St", "3rd Ave", "10th"). */
function streetSide(side: string): boolean {
  const w = words(side.trim());
  if (w.length === 0 || w.length > 4) return false;
  if (!w.every((x) => /^[A-Za-z0-9'.-]+$/.test(x) && !NOT_STREET_WORDS.has(x.toLowerCase()))) return false;
  const last = w[w.length - 1];
  return STREET_SUFFIX_RE.test(last) || (w.length === 1 && ORDINAL_STREET_RE.test(last)) || (w.length > 1 && /^(?:n|s|e|w|ne|nw|se|sw)$/i.test(last) && STREET_SUFFIX_RE.test(w[w.length - 2]));
}

/** An intersection: "Main St & 3rd Ave", "Peachtree St and 10th St", "Main St at Oak Ave". Both sides must read as streets. */
function intersection(t: string): boolean {
  const sides = t.split(/\s+(?:&|and|at)\s+/i);
  return sides.length === 2 && streetSide(sides[0]) && streetSide(sides[1]);
}

/**
 * For the alert gate ONLY (a yes or no: nothing is cut, stored or shown): does this text name a place a member can go to? Wider than the
 * display cutter (permit-value.ts siteAddressFromSummary, sanitize.ts cleanAddress), which must also CUT the street safely and so refuses
 * many real addresses ("196 MONTGOMERY FERRY NE, ATLANTA, GA 30309", "6344 TILLEY WY MATTHEWS NC 28105", "20 ARGYLE").
 * Counts: a house number (not 0; a range, a letter or "1/2" allowed) and a street; a named building with a numbered street; an
 * intersection of two streets. Does not count: "0 Peachtree", a lot or subdivision with no street, a PO Box, a street with no number and
 * no cross street, a block ("1200 block of Main St"), a count or a work phrase ("10 stories", "4 SOUTH WINDOWS", "2 Way Radio Install").
 */
export function textShowsPlace(text: string | null | undefined): boolean {
  if (typeof text !== 'string') return false;
  let t = text.replace(/\s+/g, ' ').trim();
  if (!t || /\bp\.?\s?o\.?\s*box\b/i.test(t) || NOT_PLACE_RE.test(t)) return false;
  t = t.replace(CITY_STATE_ZIP_TAIL_RE, '').trim();
  if (!t || NOT_PLACE_RE.test(t)) return false;
  if (startsWithNumberedStreet(t)) return true;
  // "Peachtree Center, 225 Peachtree St": a later comma part that is itself a numbered street.
  const commaParts = t.split(/\s*,\s*/);
  if (commaParts.slice(1).some((p) => !NOT_PLACE_RE.test(p) && startsWithNumberedStreet(p))) return true;
  return innerNumberedStreet(t) || intersection(t);
}

/** The public summary prints a place to go in one of its parts (the gate's summary fallback). */
export function summaryNamesSite(summary: string | null | undefined): boolean {
  if (typeof summary !== 'string') return false;
  return summary.split(' | ').some((part) => textShowsPlace(part));
}

/**
 * The contact path, in the order the owner set (round 18 review, decision 1):
 *  a. a stored business contact (an organisation with a name);
 *  b. a site: a stored site contact's address, or the raw site-address field of the source spec (`siteSeen`, read by the adapter before the
 *     display cutter, never stored);
 *  c. only as a fallback, a place printed in the public summary.
 * The card's own text is part of (c): a card that prints a street address is never held.
 */
export function contactPathOf(
  contacts: readonly ContactLike[] | null | undefined,
  summary: string | null | undefined,
  siteSeen?: boolean,
): ContactPath | null {
  const list = contacts ?? [];
  if (list.some((c) => c.role !== 'site' && typeof c.name === 'string' && c.name.trim().length > 0)) return 'business';
  if (siteSeen === true || list.some((c) => c.role === 'site' && textShowsPlace(c.address))) return 'site';
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
