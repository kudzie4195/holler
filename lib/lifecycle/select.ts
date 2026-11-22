/**
 * Who gets which trial email. Pure: no database, no clock of its own.
 *
 *   welcome  20 to 44 hours after signup (profile created_at), not subscribed.
 *   trial_ending  36 to 84 hours before trial_ends_at, still trialing, no subscription. It normally goes at the first hourly run inside
 *                 the window, about 3 days (84 h) before the end, the same 3 days Stripe uses for trial_will_end. Round 18: was 36 to 60
 *                 hours for the 14-day trial. The lower edge stays at 36 h so nobody falls between the old and the new window during the
 *                 deploy (review r2 R2b), and missed runs still reach everyone; the email states the days actually left (2 or 3).
 *   trial_ended  18 to 48 hours after trial_ends_at, still unsubscribed, never canceled.
 * Every kind needs a verified email (email_verified_at set): no lifecycle email ever goes to an unverified address, which may be a
 * stranger's mistyped one.
 * A returning member (deleted the profile, then came back) is due a welcome here by row age, but lib/lifecycle/run.ts drops it after
 * reading the member's trial stamp (isReturningMember), so they never get a second one.
 *
 * "Subscribed" means a paid status (active, past_due), a canceled status, or a stripe_subscription_id on the row. A checkout started
 * during the trial stores the subscription id while the status is still 'trialing', so the id counts. Canceled members are left
 * alone: they either chose to leave or their payment failed for good.
 * Windows are closed on both ends and measured in milliseconds, so the edges are exact. They are wide enough (24 to 48 hours: welcome 24,
 * trial_ending 48, trial_ended 30) that
 * an hourly cron that misses a few runs still reaches everyone, and the sends ledger keeps each kind to one email per member.
 */
export type LifecycleKind = 'welcome' | 'trial_ending' | 'trial_ended';
export const LIFECYCLE_KINDS: readonly LifecycleKind[] = ['welcome', 'trial_ending', 'trial_ended'] as const;

const HOUR = 3_600_000;
/** A trial stamp this much older than the profile row means the person had an earlier profile (see isReturningMember). */
export const RETURNING_SLACK_MS = HOUR;

/** [from, to] in hours; the meaning of each is in the header above. */
export const WINDOWS = {
  /** Hours since signup. */
  welcome: { from: 20, to: 44 },
  /** Hours until the trial ends: sent at about 84 h (3 days) normally, as late as 36 h when runs were missed (round 18; was 36 to 60). */
  trial_ending: { from: 36, to: 84 },
  /** Hours since the trial ended. */
  trial_ended: { from: 18, to: 48 },
} as const;

export interface LifecycleProfile {
  user_id: string;
  created_at: string | null;
  email_verified_at: string | null;
  subscription_status: string;
  trial_ends_at: string | null;
  stripe_subscription_id?: string | null;
}

export interface Candidate {
  userId: string;
  kind: LifecycleKind;
}

const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN);

/** True when this member has, or had, a subscription of any kind. */
export function hasSubscription(p: Pick<LifecycleProfile, 'subscription_status' | 'stripe_subscription_id'>): boolean {
  return p.subscription_status !== 'trialing' || !!p.stripe_subscription_id;
}

/** Which kind (if any) this profile is due right now. Does not look at what was already sent or opted out. */
export function dueKind(p: LifecycleProfile, now: Date): LifecycleKind | null {
  if (hasSubscription(p)) return null;
  if (!p.email_verified_at) return null;
  const t = now.getTime();
  const end = ms(p.trial_ends_at);
  if (Number.isFinite(end)) {
    const untilEnd = end - t;
    if (untilEnd >= WINDOWS.trial_ending.from * HOUR && untilEnd <= WINDOWS.trial_ending.to * HOUR) return 'trial_ending';
    const sinceEnd = t - end;
    if (sinceEnd >= WINDOWS.trial_ended.from * HOUR && sinceEnd <= WINDOWS.trial_ended.to * HOUR) return 'trial_ended';
  }
  const created = ms(p.created_at);
  if (Number.isFinite(created)) {
    const age = t - created;
    if (age >= WINDOWS.welcome.from * HOUR && age <= WINDOWS.welcome.to * HOUR) return 'welcome';
  }
  return null;
}

/**
 * True when the person's one-trial stamp (auth app_metadata holler_trial_started_at, written from the FIRST profile's created_at by
 * lib/auth/trial.ts) is clearly older than this profile row: they deleted an earlier profile and came back. No stamp, or one that
 * cannot be read, means a first profile.
 */
export function isReturningMember(createdAt: string | null, trialStartedAt: string | null | undefined): boolean {
  const created = ms(createdAt);
  const stamp = ms(trialStartedAt ?? null);
  return Number.isFinite(created) && Number.isFinite(stamp) && stamp < created - RETURNING_SLACK_MS;
}

export interface SendRow {
  user_id: string;
  kind: string;
  /** When the row was written (holler_lifecycle_sends.sent_at). Lets a trial_ending / trial_ended row sent for an EARLIER end be told apart. */
  sent_at?: string | null;
}

/**
 * trial_ending / trial_ended rows that were sent for an EARLIER trial end than the row now holds (the end was moved later by the round 18
 * extension, and the ledger reset that goes with it was lost, review r2 R3). Keyed by time, so no new column is needed:
 *   trial_ending is sent at most 84 hours before its end, so one written more than 85 hours before the current end was for an older end;
 *   trial_ended is sent after its end, so one written before the current end was for an older end.
 * These rows do not count as sent, and the cron clears them before it claims (lib/lifecycle/run.ts). A row with no sent_at is never stale.
 */
export function staleTrialSends(profiles: readonly Pick<LifecycleProfile, 'user_id' | 'trial_ends_at'>[], sends: readonly SendRow[]): SendRow[] {
  const endOf = new Map(profiles.map((p) => [p.user_id, ms(p.trial_ends_at)]));
  return sends.filter((s) => {
    const end = endOf.get(s.user_id);
    const at = ms(s.sent_at ?? null);
    if (end === undefined || !Number.isFinite(end) || !Number.isFinite(at)) return false;
    if (s.kind === 'trial_ending') return at < end - (WINDOWS.trial_ending.to + 1) * HOUR;
    if (s.kind === 'trial_ended') return at < end;
    return false;
  });
}

/**
 * Pure selection. Drops anyone who opted out of lifecycle emails and anyone who already has a row for the kind they are due.
 * Output order is stable: trial_ending, welcome, trial_ended, then user id.
 */
export function selectLifecycle(profiles: readonly LifecycleProfile[], sends: readonly SendRow[], now: Date): Candidate[] {
  const optedOut = new Set(sends.filter((s) => s.kind === 'optout').map((s) => s.user_id));
  const stale = new Set(staleTrialSends(profiles, sends));
  const sent = new Set(sends.filter((s) => !stale.has(s)).map((s) => `${s.user_id}:${s.kind}`));
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const p of profiles) {
    if (seen.has(p.user_id) || optedOut.has(p.user_id)) continue;
    seen.add(p.user_id);
    const kind = dueKind(p, now);
    if (!kind || sent.has(`${p.user_id}:${kind}`)) continue;
    out.push({ userId: p.user_id, kind });
  }
  const order: Record<LifecycleKind, number> = { trial_ending: 0, welcome: 1, trial_ended: 2 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
}

/** The widest range of timestamps any window can touch, for the profile query: [createdFrom, createdTo], [endFrom, endTo] pairs. */
export function queryRanges(now: Date): {
  created: { gte: string; lte: string };
  endsSoon: { gte: string; lte: string };
  endedRecently: { gte: string; lte: string };
} {
  const t = now.getTime();
  const iso = (n: number) => new Date(n).toISOString();
  return {
    created: { gte: iso(t - WINDOWS.welcome.to * HOUR), lte: iso(t - WINDOWS.welcome.from * HOUR) },
    endsSoon: { gte: iso(t + WINDOWS.trial_ending.from * HOUR), lte: iso(t + WINDOWS.trial_ending.to * HOUR) },
    endedRecently: { gte: iso(t - WINDOWS.trial_ended.to * HOUR), lte: iso(t - WINDOWS.trial_ended.from * HOUR) },
  };
}
