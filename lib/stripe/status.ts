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
