export type HollerStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

/**
 * Map a Stripe subscription status to holler_profiles.subscription_status.
 * Returns null when the event should not change the stored status (e.g. 'incomplete').
 * Our free trial is app-side (no card), so a Stripe 'trialing' subscription is treated as paid access (owner decision: a trial
 * member who subscribes to Pro with a card gets Pro limits at once).
 * 'past_due' (Stripe is still retrying the card) keeps access. 'unpaid' (retries ran out) and 'paused' (a trial ended with no way to
 * pay) are not paid: they are stored as 'canceled', which removes paid access and Pro limits but deletes nothing. If the member
 * pays later, Stripe sends the subscription as 'active' again and the webhook stores that.
 */
export function mapStripeStatus(s: string): HollerStatus | null {
  switch (s) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
      return 'past_due';
    case 'unpaid':
    case 'paused':
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
