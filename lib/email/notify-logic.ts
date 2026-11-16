export interface NotifyProfile {
  alert_email: boolean;
  subscription_status: string;
  trial_ends_at: string | null;
  last_notified_at: string | null;
  /** Set only by the server after the user opens the signed verification link. */
  email_verified_at: string | null;
}

export const MIN_GAP_MINUTES = 60;

export type NotifyDecision = { ok: true } | { ok: false; reason: 'alerts_off' | 'unverified' | 'not_entitled' | 'throttled' };

/** Pure gating for the digest: alerts on, email verified, (trialing and inside trial) or active, and at most one email per 60 min. */
export function decideNotify(p: NotifyProfile, now: Date, minGapMinutes = MIN_GAP_MINUTES): NotifyDecision {
  if (!p.alert_email) return { ok: false, reason: 'alerts_off' };
  if (!p.email_verified_at) return { ok: false, reason: 'unverified' };
  const trialEnd = p.trial_ends_at ? new Date(p.trial_ends_at).getTime() : NaN;
  const inTrial = p.subscription_status === 'trialing' && !Number.isNaN(trialEnd) && trialEnd > now.getTime();
  if (!(inTrial || p.subscription_status === 'active')) return { ok: false, reason: 'not_entitled' };
  if (p.last_notified_at) {
    const last = new Date(p.last_notified_at).getTime();
    if (!Number.isNaN(last) && now.getTime() - last < minGapMinutes * 60000) {
      return { ok: false, reason: 'throttled' };
    }
  }
  return { ok: true };
}

/** Unverified accounts older than this stop getting their matches held for them. */
export const UNVERIFIED_GRACE_DAYS = 7;
/** Max ids per `.in()` list: keeps the PostgREST URL well under gateway limits. */
export const IN_CHUNK = 200;

export interface PlanProfile extends NotifyProfile {
  user_id: string;
  created_at: string | null;
}

/**
 *  send: email them now.
 *  wait: leave their matches un-notified (throttled, past_due, or unverified inside the grace window).
 *  skip: they will not be emailed for these matches, so mark the matches notified to stop them crowding out others.
 */
export type NotifyAction = 'send' | 'wait' | 'skip';

export function classifyForNotify(
  p: PlanProfile | undefined,
  now: Date,
  minGapMinutes = MIN_GAP_MINUTES,
): { action: NotifyAction; reason: 'ok' | 'missing' | 'alerts_off' | 'unverified' | 'unverified_grace' | 'not_entitled' | 'past_due' | 'throttled' } {
  if (!p) return { action: 'skip', reason: 'missing' };
  if (!p.alert_email) return { action: 'skip', reason: 'alerts_off' };
  if (!p.email_verified_at) {
    const created = p.created_at ? new Date(p.created_at).getTime() : NaN;
    const old = !Number.isNaN(created) && now.getTime() - created > UNVERIFIED_GRACE_DAYS * 86_400_000;
    return old ? { action: 'skip', reason: 'unverified' } : { action: 'wait', reason: 'unverified_grace' };
  }
  const d = decideNotify(p, now, minGapMinutes);
  if (d.ok) return { action: 'send', reason: 'ok' };
  if (d.reason === 'throttled') return { action: 'wait', reason: 'throttled' };
  // past_due can recover, so hold its matches. Canceled, expired trial and unknown states are skipped.
  if (p.subscription_status === 'past_due') return { action: 'wait', reason: 'past_due' };
  return { action: 'skip', reason: 'not_entitled' };
}

export interface NotifyPlan {
  send: string[];
  wait: string[];
  skip: string[];
  counts: Record<string, number>;
}

/** Pure planning over every user id that has un-notified matches. Ids with no profile row are skipped. */
export function planNotify(userIds: string[], profiles: PlanProfile[], now: Date, minGapMinutes = MIN_GAP_MINUTES): NotifyPlan {
  const byId = new Map(profiles.map((p) => [p.user_id, p]));
  const plan: NotifyPlan = { send: [], wait: [], skip: [], counts: {} };
  for (const id of userIds) {
    const { action, reason } = classifyForNotify(byId.get(id), now, minGapMinutes);
    plan[action].push(id);
    plan.counts[reason] = (plan.counts[reason] ?? 0) + 1;
  }
  return plan;
}

export function chunk<T>(items: readonly T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
