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
