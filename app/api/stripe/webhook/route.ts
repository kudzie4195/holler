import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { trackPaidInvoice } from '@/lib/analytics/stripe';
import {
  billingNotConfigured,
  getStripe,
  isHollerMetadata,
  mapStripeStatus,
  statusForSubscriptionEvent,
  stripeMayOverwrite,
  stripePlanSource,
  tierFromMetadata,
} from '@/lib/stripe';
import { isStorePlanLive } from '@/lib/storebilling/source';
import { refundSubscriptionPayments } from '@/lib/stripe/refund';

type Admin = ReturnType<typeof createAdminClient>;

/** Stripe statuses of a subscription that is still being paid for (or about to be). */
const LIVE_STRIPE = new Set(['active', 'trialing', 'past_due']);
/** PostgREST / Postgres codes for "this function or table is not there yet" (migration 0020 not applied). */
const NOT_THERE = new Set(['PGRST202', '42883', '42P01']);

const isPaid = (s: string | null) => s === 'active' || s === 'past_due';

/**
 * Tells holler_stripe_state (migration 0020) what Stripe now says about one subscription, for members who pay in two places (review
 * r2 F2). The function keeps it as shadow state while a store plan is the live source, keeps a store plan that a higher Stripe plan
 * takes over, and, when the member's live plan has ended, switches the plan to the other source if that one is still paid.
 * Called: when an event is blocked by a live store plan, right before Stripe takes over a live store plan, and right after a write
 * that leaves the row unpaid. Skipped for a row read before migration 0020 (no plan_source column). A missing function is logged
 * and skipped (fail soft); any other database error throws, so the handler answers 500 and Stripe delivers the event again.
 */
async function stripeState(admin: Admin, row: Record<string, unknown> | null, subId: string | null, status: string | null, tier: string | null) {
  if (!row || !('plan_source' in row) || typeof row.user_id !== 'string' || !subId || !status) return;
  const { data, error } = await admin.rpc('holler_stripe_state', { p_user_id: row.user_id, p_subscription_id: subId, p_status: status, p_plan: tier });
  if (error) {
    const code = (error as { code?: string }).code ?? 'unknown';
    if (NOT_THERE.has(code)) {
      console.error('[stripe] holler_stripe_state is missing (apply migration 0020); double-payer state not kept');
      return;
    }
    throw new Error(`holler_stripe_state failed: ${code}`);
  }
  if (data === 'apple' || data === 'google' || data === 'stripe') console.error(`[stripe] paid plan ended; switched to the other live source (${data})`);
}

/**
 * The stored row the event would write to, for the store-billing source guard (migration 0020). Null when there is no row. A failed
 * read throws, so the handler answers 500 and Stripe delivers the event again: a guard that could not look is never skipped.
 */
async function billingRow(admin: Admin, col: 'user_id' | 'stripe_customer_id', val: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin.from('holler_profiles').select('*').eq(col, val).maybeSingle();
  // More than one row for one Stripe customer cannot be guarded row by row: write as before this guard existed (the update filters
  // still apply) rather than answer 500 forever.
  if (error?.code === 'PGRST116') return null;
  if (error) throw new Error(`billing row read failed: ${error.code ?? 'unknown'}`);
  return (data as Record<string, unknown> | null) ?? null;
}

/** A live App Store or Google Play plan of the same or higher rank stays as it is (200, so Stripe does not retry). */
function storePlanKept(eventType: string) {
  console.error('[stripe] live store plan kept; Stripe event not applied', eventType);
  return Response.json({ received: true, ignored: 'store_plan' });
}


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
        const row = await billingRow(admin, 'user_id', userId);
        // A second completed checkout while the member already has a different live Holler subscription (two sessions opened before
        // either was paid): keep the subscription that is on the profile row and live in Stripe, refund what the other one was
        // charged and cancel it, so the member never pays twice (review r2 F10, review v2 P2, commander decision 6). The same
        // subscription delivered twice is not a duplicate (current === subId), and a plan switch through /api/stripe/change-plan
        // updates the same subscription, so it never comes here. Refund BEFORE cancel: a failed refund throws (500), Stripe delivers
        // the event again, and the duplicate is still live so this branch runs again (the refund idempotency key stops a second one).
        const current = typeof row?.stripe_subscription_id === 'string' ? row.stripe_subscription_id : null;
        if (subId && current && current !== subId && isPaid(status)) {
          const first = await freshSubscription(stripe, current);
          if (first && isHollerMetadata(first.metadata) && LIVE_STRIPE.has(first.status)) {
            const refund = await refundSubscriptionPayments(stripe, subId);
            await stripe.subscriptions.cancel(subId);
            console.error(
              `[stripe] second Holler subscription ${subId} canceled; ${current} kept; refunds [${refund.refunded.join(',')}]` +
                (refund.manual.length ? `. NEEDS A LOOK: refund by hand the payments [${refund.manual.join(',')}]` : ''),
            );
            // The row is out of step (it says unpaid while the kept subscription is live in Stripe): write the kept one's state.
            const keptStatus = mapStripeStatus(first.status);
            const keptTier = tierFromMetadata(first.metadata);
            if (row && keptStatus && keptStatus !== row.subscription_status) {
              if (stripeMayOverwrite(row, { status: keptStatus, tier: keptTier })) {
                if (isStorePlanLive(row)) await stripeState(admin, row, current, keptStatus, keptTier);
                const patch: Record<string, unknown> = { subscription_status: keptStatus, plan: keptTier, updated_at: new Date().toISOString() };
                const source = stripePlanSource(row, keptStatus);
                if (source) patch.plan_source = source;
                const { error } = await admin.from('holler_profiles').update(patch).eq('user_id', userId).eq('stripe_subscription_id', current);
                if (error) throw new Error(error.message);
              } else {
                await stripeState(admin, row, current, keptStatus, keptTier);
              }
            }
            return Response.json({ received: true, ignored: 'duplicate_subscription' });
          }
        }
        // Source guard: never over a live App Store or Google Play plan of the same or higher rank. The Stripe state is still kept.
        if (!stripeMayOverwrite(row, { status, tier })) {
          await stripeState(admin, row, subId, status, tier);
          return storePlanKept(event.type);
        }
        // A higher plan on the web takes over a live store plan: keep the store plan so it can come back when Stripe ends.
        if (isStorePlanLive(row)) await stripeState(admin, row, subId, status, tier);
        const patch: Record<string, unknown> = {
          subscription_status: status,
          plan: tier,
          stripe_customer_id: idOf(session.customer),
          stripe_subscription_id: subId,
          updated_at: new Date().toISOString(),
        };
        const source = stripePlanSource(row, status);
        if (source) patch.plan_source = source;
        let q = admin.from('holler_profiles').update(patch).eq('user_id', userId);
        // A replayed (resent or late) checkout for a subscription that has since ended must not replace the member's current one
        // (P2-1). It may only write to a row that has no subscription yet or that already points at this one.
        if (status === 'canceled' && subId) q = q.or(`stripe_subscription_id.is.null,stripe_subscription_id.eq.${subId}`);
        const { error } = await q;
        if (error) throw new Error(error.message);
        if (!isPaid(status)) await stripeState(admin, row, subId, status, null);
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
        // Cancel only changes the status. The stored plan stays, and lib/plan effectiveTier gives a canceled member Solo limits.
        const patch: Record<string, unknown> = {
          subscription_status: status,
          stripe_subscription_id: sub.id,
          updated_at: new Date().toISOString(),
        };
        if (event.type !== 'customer.subscription.deleted') patch.plan = tier;
        const userId = sub.metadata?.user_id;
        const customerId = idOf(sub.customer);
        if (!userId && !customerId) return Response.json({ received: true });
        // Source guard: never over a live App Store or Google Play plan of the same or higher rank (a Stripe cancel never touches one).
        const row = userId ? await billingRow(admin, 'user_id', userId) : await billingRow(admin, 'stripe_customer_id', customerId!);
        const stateTier = event.type === 'customer.subscription.deleted' ? null : tier;
        if (!stripeMayOverwrite(row, { status, tier: stateTier })) {
          await stripeState(admin, row, sub.id, status, stateTier);
          return storePlanKept(event.type);
        }
        if (isStorePlanLive(row)) await stripeState(admin, row, sub.id, status, stateTier);
        const source = stripePlanSource(row, status);
        if (source) patch.plan_source = source;
        let q = admin.from('holler_profiles').update(patch);
        if (userId) q = q.eq('user_id', userId);
        else q = q.eq('stripe_customer_id', customerId!);
        // An old or duplicate subscription must not flip the status of the one the user is paying for.
        q = event.type === 'customer.subscription.deleted'
          ? q.eq('stripe_subscription_id', sub.id)
          : q.or(`stripe_subscription_id.is.null,stripe_subscription_id.eq.${sub.id}`);
        const { error } = await q;
        if (error) throw new Error(error.message);
        // The paid source ended: record it, and let the database switch to the other source if that one is still paid (r2 F2).
        if (!isPaid(status)) await stripeState(admin, row, sub.id, status, stateTier);
      }
    } else if (event.type === 'invoice.paid') {
      await trackPaidInvoice(admin, event.data.object);
    }
  } catch (e) {
    console.error('[stripe] webhook handling failed', event.type, e instanceof Error ? e.message : e);
    return Response.json({ error: 'handler_failed' }, { status: 500 }); // Stripe retries
  }
  return Response.json({ received: true });
}
