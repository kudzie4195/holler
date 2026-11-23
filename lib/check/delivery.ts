import { matchArea, matchOne, type MatchProfile, type MatchSignal } from '@/lib/signals/match';
import { matchScope } from '@/lib/plan';
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

/** A one-trade member placed so the area test passes: at the record's own point, or in its state for a record with no point. */
function memberAt(s: CheckSignal, trade: string): MatchProfile {
  return { user_id: 'check', categories: [trade], lat: s.lat, lon: s.lon, state: s.state, radius_mi: CHECK_RADIUS_MI };
}

/**
 * The delivery of one record for a member with this one trade, without the area test (the cached read is per grid cell, not per ZIP;
 * checkInMemberArea below adds the area test for the ZIP). matchOne = area test AND everything else, and the area test passes by
 * construction here, so `deliveryFor(s) !== null && checkInMemberArea(s, zip)` is exactly matchOne for a member at the ZIP.
 */
export function deliveryFor(s: CheckSignal, trade: string, nowMs: number): CheckDelivery | null {
  const sig = asMatchSignal(s);
  const profile = memberAt(s, trade);
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
export function checkInMemberArea(s: CheckSignal, zip: { lat: number; lon: number; state: string }, trade: string): boolean {
  const profile: MatchProfile = { user_id: 'check', categories: [trade], lat: zip.lat, lon: zip.lon, state: zip.state, radius_mi: CHECK_RADIUS_MI };
  return matchArea(asMatchSignal(s), profile) !== null;
}

/**
 * The check items a member at this ZIP with this one trade and the default area would have in their feed: the cached items (already only
 * the records the trade would be shown, with their delivery) minus those outside the member's area. The record fields are dropped here,
 * so nothing but the fields the page showed before leaves this function.
 */
export function memberItems<T extends { signal?: CheckSignal }>(items: readonly T[], zip: { lat: number; lon: number; state: string }, trade: string): Omit<T, 'signal'>[] {
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
