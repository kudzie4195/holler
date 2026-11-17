export type HollerStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

/**
 * Map a Stripe subscription status to holler_profiles.subscription_status.
 * Returns null when the event should not change the stored status (e.g. 'incomplete').
 * Our free trial is app-side (no card), so a Stripe 'trialing' subscription is treated as paid access.
 */
export function mapStripeStatus(s: string): HollerStatus | null {
  switch (s) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
    case 'paused':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    default:
      return null;
  }
}

/**
 * Status to store for a subscription webhook event.
 * Stripe does not guarantee event order, so for `customer.subscription.updated` the caller re-fetches the subscription
 * and passes its current status as `freshStatus`; that wins over the status carried in the (possibly stale) event.
 * A deleted subscription is always canceled. Returns null when nothing should change.
 */
export function statusForSubscriptionEvent(
  eventType: string,
  eventStatus: string,
  freshStatus?: string | null,
): HollerStatus | null {
  if (eventType === 'customer.subscription.deleted') return 'canceled';
  return mapStripeStatus(freshStatus ?? eventStatus);
}
