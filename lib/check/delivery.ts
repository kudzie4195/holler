import { matchArea, matchOne, type MatchProfile, type MatchSignal } from '@/lib/signals/match';
import { matchScope } from '@/lib/plan';
import { expandTradeIds } from '@/lib/plan/composite-trades';
import { contactPathOf } from '@/lib/signals/alert-gate';
import { isPermitRecord } from '@/lib/signals/permit-routing';
import { deadlineOf, demoteExpired, isAlertLabel, labelForMember, recordLabelInput } from '@/lib/signals/lead-rules';
import { CHECK_RADIUS_MI } from './scope';

/**
 * Round 24 FIX2 (review D1). What a member with ONE trade would get from a record on /check:
 *   'email'  an alert: matched, not held, and labelled act_now or coming_soon by the notify route's own expression;
 *   'feed'   matched and shown on the matches page only (market insight, or a held card);
 *   null     never in that member's feed (context, a follower record, a probation source, a hidden bid, a trade that does not see it).
 *
 * Nothing here re-implements a rule. Matching is matchOne (lib/signals/match.ts), the scan's own function. The email test is the exact
 * expression of app/api/cron/notify/route.ts (labelOf): demoteExpired(labelForMember({ ...recordLabelInput(s), categories }, trades),
 * deadlineOf(s), now), with `trades` from matchScope, plus the hold (alert_hold) matchOne returns.
 *
 * The one input the public read cannot see is the contact table (holler_signal_contacts is not readable with the public key). The scan
 * decides the permit contact gate from the adapter's contacts AND the public summary; here only the summary is known. A permit whose summary
 * names no job-site address is therefore treated as held ('feed'). That can only under-promise: a card marked 'email' always has a
 * contact path the gate accepts, so no record is marked as emailed that the gate would hold.
 */
export type CheckDelivery = 'email' | 'feed';

/** The record fields matching and labelling read. Kept on each check item (server side only) so the page can run the area test for its ZIP. */
export interface CheckSignal {
  id: number;
  source: string;
  kind: string;
  title: string;
  summary: string | null;
  categories: string[];
  lat: number | null;
  lon: number | null;
  state: string | null;
  severity: number;
  occurred_at: string;
  expires_at?: string | null;
  data: Record<string, unknown> | null;
}

function asMatchSignal(s: CheckSignal): MatchSignal {
  const data = (s.data ?? {}) as MatchSignal['data'] & Record<string, unknown>;
  const sub = typeof data?.subtype === 'string' ? (data.subtype as string) : null;
  const base: MatchSignal = {
    id: s.id,
    categories: Array.isArray(s.categories) ? s.categories : [],
    lat: s.lat,
    lon: s.lon,
    state: s.state,
    severity: s.severity,
    occurred_at: s.occurred_at,
    subtype: sub,
    data,
    source: s.source,
    title: s.title,
    summary: s.summary,
    kind: s.kind,
  };
  // The contact gate input, as the scan sets it (lib/signals/run.ts contactPathOf(contacts, summary)), with the contacts unknown (see above).
  return isPermitRecord({ source: s.source, kind: s.kind, subtype: sub }) ? { ...base, contactPath: contactPathOf([], s.summary) } : base;
}

/**
 * Round 25: the trades of the member /check stands for. One trade id is itself; the "Pressure washing" chip is the two trades sign-up saves
 * for it (lib/plan/composite-trades.ts expandTradeIds), so a /check for pressure washing is a member with exactly those two trades.
 */
export function memberTrades(trade: string | readonly string[]): string[] {
  return expandTradeIds(typeof trade === 'string' ? [trade] : trade);
}

/** A member with these trades placed so the area test passes: at the record's own point, or in its state for a record with no point. */
function memberAt(s: CheckSignal, trades: readonly string[]): MatchProfile {
  return { user_id: 'check', categories: [...trades], lat: s.lat, lon: s.lon, state: s.state, radius_mi: CHECK_RADIUS_MI };
}

/**
 * The delivery of one record for a member with this one trade, without the area test (the cached read is per grid cell, not per ZIP;
 * checkInMemberArea below adds the area test for the ZIP). matchOne = area test AND everything else, and the area test passes by
 * construction here, so `deliveryFor(s) !== null && checkInMemberArea(s, zip)` is exactly matchOne for a member at the ZIP.
 */
export function deliveryFor(s: CheckSignal, trade: string | readonly string[], nowMs: number): CheckDelivery | null {
  const sig = asMatchSignal(s);
  const profile = memberAt(s, memberTrades(trade));
  const m = matchOne(sig, profile, undefined, nowMs);
  if (!m) return null;
  if (m.hold) return 'feed';
  // app/api/cron/notify/route.ts labelOf, for this member's plan-limited trades.
  const trades = matchScope({ ...profile, plan: null, subscription_status: 'trialing' }).categories;
  const row = { ...s, subtype: sig.subtype ?? null, permitStage: (s.data ?? {})['permitStage'] };
  const label = demoteExpired(labelForMember({ ...recordLabelInput(row), categories: s.categories }, trades), deadlineOf(row), nowMs);
  return isAlertLabel(label) ? 'email' : 'feed';
}

/** The area test of a member at this ZIP with the default radius (CHECK_RADIUS_MI, what onboarding sets): matchArea, the scan's own test. */
export function checkInMemberArea(s: CheckSignal, zip: { lat: number; lon: number; state: string }, trade: string | readonly string[]): boolean {
  const profile: MatchProfile = { user_id: 'check', categories: memberTrades(trade), lat: zip.lat, lon: zip.lon, state: zip.state, radius_mi: CHECK_RADIUS_MI };
  return matchArea(asMatchSignal(s), profile) !== null;
}

/**
 * The check items a member at this ZIP with this one trade and the default area would have in their feed: the cached items (already only
 * the records the trade would be shown, with their delivery) minus those outside the member's area. The record fields are dropped here,
 * so nothing but the fields the page showed before leaves this function.
 */
export function memberItems<T extends { signal?: CheckSignal }>(items: readonly T[], zip: { lat: number; lon: number; state: string }, trade: string | readonly string[]): Omit<T, 'signal'>[] {
  const out: Omit<T, 'signal'>[] = [];
  for (const it of items) {
    if (it.signal && !checkInMemberArea(it.signal, zip, trade)) continue;
    const copy = { ...it };
    delete copy.signal;
    out.push(copy);
  }
  return out;
}

/** How many of the listed records are emailed as alerts. Counted from the rows themselves, never estimated. */
export function emailedCount(items: readonly { delivery?: CheckDelivery }[]): number {
  return items.filter((i) => i.delivery === 'email').length;
}

/**
 * Round 25: the counted answer above the /check results. Computed over EVERY member item (memberItems: all records a member with this trade
 * at this ZIP would have in the feed, not the 20 listed), with the same mark each row carries: only rows marked 'email' are counted, so a
 * matches-page row is never in the number.
 *   count    rows a member would have been emailed;
 *   places   distinct points among them (a record with no point counts by its place line);
 *   oldest   occurred_at of the oldest counted row (the page says "since <date>", never a window length: feeds cover different spans);
 *   atLeast  true when a read behind the items stopped at its row limit (lib/check/load.ts), so the page says "at least".
 */
export interface AlertTotals {
  count: number;
  places: number;
  oldest: string | null;
  atLeast: boolean;
}

export function alertTotals(
  items: readonly { id: number; delivery?: CheckDelivery; occurredAt: string; lat?: number | null; lon?: number | null; place?: string | null }[],
  clipped: boolean,
): AlertTotals {
  const emailed = items.filter((i) => i.delivery === 'email');
  const places = new Set<string>();
  let oldest: string | null = null;
  let oldestMs = Infinity;
  for (const i of emailed) {
    places.add(typeof i.lat === 'number' && typeof i.lon === 'number' ? `${i.lat.toFixed(4)},${i.lon.toFixed(4)}` : `place:${i.place ?? i.id}`);
    const ms = Date.parse(i.occurredAt);
    if (Number.isFinite(ms) && ms < oldestMs) {
      oldestMs = ms;
      oldest = i.occurredAt;
    }
  }
  return { count: emailed.length, places: places.size, oldest, atLeast: clipped };
}
