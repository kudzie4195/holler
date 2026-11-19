import { isPaidNow } from '@/lib/storebilling/source';

/** The one paid test (review r2 F7). Re-exported so server code outside lib/storebilling can import it from here. */
export { isPaidNow };

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

export interface Access {
  status: SubscriptionStatus;
  /** Whole days left in the trial, never negative. Only meaningful while trialing. */
  daysLeft: number;
  trialEnded: boolean;
  /** True when the feed should be hidden behind the upgrade card. */
  locked: boolean;
}

/**
 * Trial and paywall rules.
 * ASSUMED policy: active and past_due keep access (past_due is Stripe's retry window);
 * trialing keeps access until trial_ends_at; canceled and expired trials are locked.
 */
export function computeAccess(
  profile: {
    subscription_status: string;
    trial_ends_at: string;
    /** Migration 0020. A store plan (apple, google) counts as paid like a Stripe one, until its expiry plus 3 days has passed. A missing or unreadable expiry is not paid. */
    plan_source?: string | null;
    store_expires_at?: string | null;
  },
  now: number = Date.now(),
): Access {
  const status = (['trialing', 'active', 'past_due', 'canceled'] as const).includes(
    profile.subscription_status as SubscriptionStatus,
  )
    ? (profile.subscription_status as SubscriptionStatus)
    : 'trialing';
  const end = new Date(profile.trial_ends_at).getTime();
  const msLeft = Number.isFinite(end) ? end - now : 0;
  const trialEnded = msLeft <= 0;
  const daysLeft = trialEnded ? 0 : Math.ceil(msLeft / 86_400_000);
  // A store plan whose period ran out with no EXPIRATION webhook (lost delivery) stops counting as paid after a short grace; a store
  // plan with no readable expiry never counts as paid (isPaidNow).
  const paid = (status === 'active' || status === 'past_due') && isPaidNow(profile, now);
  return { status, daysLeft, trialEnded, locked: !paid && trialEnded };
}
