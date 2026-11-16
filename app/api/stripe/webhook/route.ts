import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { billingNotConfigured, getStripe, mapStripeStatus } from '@/lib/stripe';


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
      const userId = session.client_reference_id;
      if (userId) {
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
      const status = event.type === 'customer.subscription.deleted' ? 'canceled' : mapStripeStatus(sub.status);
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
