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

/** A site contact counts only with an address that starts with a house number (the same shape the summary reader accepts). */
const HOUSE_NUMBER_RE = /^\s*\d{1,6}[A-Za-z]?(?:\s*-\s*\d{1,6}[A-Za-z]?)?\s+\S/;

export function contactPathOf(contacts: readonly ContactLike[] | null | undefined, summary: string | null | undefined): ContactPath | null {
  const list = contacts ?? [];
  if (list.some((c) => c.role !== 'site' && typeof c.name === 'string' && c.name.trim().length > 0)) return 'business';
  if (list.some((c) => c.role === 'site' && typeof c.address === 'string' && HOUSE_NUMBER_RE.test(c.address))) return 'site';
  if (siteAddressFromSummary(summary)) return 'site';
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

/** A match row's stored hold, or null (no column, no value, or an unknown value). */
export function holdOf(row: { alert_hold?: unknown } | null | undefined): AlertHold | null {
  const v = row?.alert_hold;
  return isAlertHold(v) ? v : null;
}
