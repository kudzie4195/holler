import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { billingNotConfigured, getStripe, isHollerMetadata, mapStripeStatus, statusForSubscriptionEvent, tierFromMetadata } from '@/lib/stripe';


/**
 * The subscription as Stripe has it now, or null when Stripe says it no longer exists (resource_missing). Any other failure throws,
 * so the handler answers 500 and Stripe delivers the event again (P1-3): a stale event body is never used in its place.
 */
async function freshSubscription(stripe: Stripe, id: string): Promise<Pick<Stripe.Subscription, 'status' | 'metadata'> | null> {
  try {
    return await stripe.subscriptions.retrieve(id);
  } catch (e) {
    if ((e as { code?: string } | null)?.code === 'resource_missing') return null;
    throw e;
  }
}

function idOf(x: string | { id: string } | null | undefined): string | null {
  if (!x) return null;
  return typeof x === 'string' ? x : x.id;
}

export async function POST(req: Request) {
  const stripe = getStripe();
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) return billingNotConfigured();

  const sig = req.headers.get('stripe-signature');
  if (!sig) return Response.json({ error: 'missing_signature' }, { status: 400 });
  const raw = await req.text(); // raw body required for signature verification

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return Response.json({ error: 'invalid_signature' }, { status: 400 });
  }

  const admin = createAdminClient();
  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      // Shared Stripe account: ignore other products' checkouts (200 so Stripe does not retry).
      if (!isHollerMetadata(session.metadata)) return Response.json({ received: true, ignored: 'not_holler' });
      const userId = session.client_reference_id ?? session.metadata?.user_id;
      if (userId && session.mode === 'subscription') {
        const subId = idOf(session.subscription);
        let status = mapStripeStatus('active')!;
        // The subscription's own metadata decides the plan; the session's metadata (same tier, set by our checkout) is the fallback.
        let tier = tierFromMetadata(session.metadata);
        if (subId) {
          // No fallback on a failed read (P1-3): it throws, the handler answers 500 and Stripe delivers the event again later.
          const sub = await freshSubscription(stripe, subId);
          if (!sub) status = 'canceled';
          else {
            status = mapStripeStatus(sub.status) ?? status;
            if (isHollerMetadata(sub.metadata)) tier = tierFromMetadata(sub.metadata);
          }
        }
        let q = admin
          .from('holler_profiles')
          .update({
            subscription_status: status,
            plan: tier,
            stripe_customer_id: idOf(session.customer),
            stripe_subscription_id: subId,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId);
        // A replayed (resent or late) checkout for a subscription that has since ended must not replace the member's current one
        // (P2-1). It may only write to a row that has no subscription yet or that already points at this one.
        if (status === 'canceled' && subId) q = q.or(`stripe_subscription_id.is.null,stripe_subscription_id.eq.${subId}`);
        const { error } = await q;
        if (error) throw new Error(error.message);
      }
    } else if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      const sub = event.data.object as Stripe.Subscription;
      if (!isHollerMetadata(sub.metadata)) return Response.json({ received: true, ignored: 'not_holler' });
      // Events can arrive out of order, so for created/updated read the subscription's current status and metadata instead of
      // trusting the event body (F-8). A plan switch changes metadata.tier, so the tier follows the same rule.
      let freshStatus: string | null = null;
      let tier = tierFromMetadata(sub.metadata);
      if (event.type !== 'customer.subscription.deleted') {
        // P1-3: never fall back to the (possibly stale) event body. If the read fails, the throw answers 500 and Stripe retries.
        const fresh = await freshSubscription(stripe, sub.id);
        freshStatus = fresh ? fresh.status : 'canceled';
        if (fresh && isHollerMetadata(fresh.metadata)) tier = tierFromMetadata(fresh.metadata);
      }
      const status = statusForSubscriptionEvent(event.type, sub.status, freshStatus);
      if (status) {
        // Cancel only changes the status. The stored plan stays, and lib/plan effectiveTier gives a canceled member Starter limits.
        const patch: Record<string, unknown> = {
          subscription_status: status,
          stripe_subscription_id: sub.id,
          updated_at: new Date().toISOString(),
        };
        if (event.type !== 'customer.subscription.deleted') patch.plan = tier;
        const userId = sub.metadata?.user_id;
        const customerId = idOf(sub.customer);
        let q = admin.from('holler_profiles').update(patch);
        if (userId) q = q.eq('user_id', userId);
        else if (customerId) q = q.eq('stripe_customer_id', customerId);
        else return Response.json({ received: true });
        // An old or duplicate subscription must not flip the status of the one the user is paying for.
        q = event.type === 'customer.subscription.deleted'
          ? q.eq('stripe_subscription_id', sub.id)
          : q.or(`stripe_subscription_id.is.null,stripe_subscription_id.eq.${sub.id}`);
        const { error } = await q;
        if (error) throw new Error(error.message);
      }
    }
  } catch (e) {
    console.error('[stripe] webhook handling failed', event.type, e instanceof Error ? e.message : e);
    return Response.json({ error: 'handler_failed' }, { status: 500 }); // Stripe retries
  }
  return Response.json({ received: true });
}
