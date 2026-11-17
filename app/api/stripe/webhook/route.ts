import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { billingNotConfigured, getStripe, isHollerMetadata, mapStripeStatus, statusForSubscriptionEvent } from '@/lib/stripe';


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
        if (subId) {
          try {
            const sub = await stripe.subscriptions.retrieve(subId);
            status = mapStripeStatus(sub.status) ?? status;
          } catch {
            // fall back to active: checkout completed means payment method accepted
          }
        }
        const { error } = await admin
          .from('holler_profiles')
          .update({
            subscription_status: status,
            stripe_customer_id: idOf(session.customer),
            stripe_subscription_id: subId,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId);
        if (error) throw new Error(error.message);
      }
    } else if (
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      const sub = event.data.object as Stripe.Subscription;
      if (!isHollerMetadata(sub.metadata)) return Response.json({ received: true, ignored: 'not_holler' });
      // Events can arrive out of order, so for updates read the subscription's current status instead of trusting the event body (F-8).
      let freshStatus: string | null = null;
      if (event.type === 'customer.subscription.updated') {
        try {
          freshStatus = (await stripe.subscriptions.retrieve(sub.id)).status;
        } catch {
          // fall back to the event's own status; Stripe retries the webhook if we return 500 below
        }
      }
      const status = statusForSubscriptionEvent(event.type, sub.status, freshStatus);
      if (status) {
        const patch = {
          subscription_status: status,
          stripe_subscription_id: sub.id,
          updated_at: new Date().toISOString(),
        };
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
