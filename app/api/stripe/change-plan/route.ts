import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hit } from '@/lib/auth/ratelimit';
import { LIMITS } from '@/lib/auth/limits';
import {
  alreadySubscribed,
  billingNotConfigured,
  ensureProduct,
  getStripe,
  hollerMetadata,
  isHollerMetadata,
  isJsonRequest,
  isUpgrade,
  mapStripeStatus,
  parseChangeBody,
  planChangeKey,
  planFromInterval,
  prorationFor,
  subscriptionPriceData,
  tierFromMetadata,
  unsupportedMediaType,
} from '@/lib/stripe';
import { backfillWithLimit } from '@/lib/signals/backfill-run';
import { isStorePlanLive } from '@/lib/storebilling/source';

/** Stripe statuses that may move UP (Solo to Pro, or to a higher price). Not past_due: the member owes money already. */
const UPGRADE_FROM = new Set(['active', 'trialing']);
/** Stripe statuses that may move down. A past_due member may still cut their price. */
const DOWNGRADE_FROM = new Set(['active', 'trialing', 'past_due']);

function isPaymentFailure(e: unknown): boolean {
  const x = e as { type?: string; statusCode?: number; code?: string } | null;
  return x?.statusCode === 402 || x?.type === 'StripeCardError' || x?.code === 'card_declined';
}

/**
 * POST /api/stripe/change-plan {tier, plan?} (Content-Type: application/json): moves a paying member between Solo (id 'starter') and Pro
 * (and/or monthly and yearly) by changing the one item of their current Holler subscription.
 * - Upgrade (tier or price goes up): Stripe invoices the prorated difference now and charges the card on file
 *   (proration_behavior 'always_invoice', payment_behavior 'error_if_incomplete'). If that payment fails Stripe changes nothing and
 *   this route answers 402; the profile is not touched, so the member stays on the old plan in Stripe and here. Only an active
 *   (or Stripe-trialing) subscription may upgrade; past_due gets 409 payment_due.
 * - Downgrade: 'create_prorations', so the unused time becomes a credit on the next bill.
 * - The subscription metadata (tier, plan) that the webhook reads is updated in the same call, and holler_profiles.plan is written
 *   here so the new limits apply at once; the webhook that follows writes the same value.
 * - Price: the item moves to today's price of the plan and interval the member picked (PRICES_CENTS). Nothing else re-prices an
 *   item: with the same tier and interval this route makes no Stripe update at all, so a member on an older price keeps it.
 *   Upgrade or downgrade is judged on what the member pays now (the item's unit_amount), not on today's table.
 * - Double clicks: one Stripe idempotency key per member, subscription item, current price and target within a minute.
 *   Rate limit: LIMITS.planChangeUser. Repair: when Stripe already has the target plan (an earlier switch whose profile write failed),
 *   the profile is brought in line here instead of answering "no change" and leaving it stale.
 * - A live App Store or Google Play plan is managed in the store: 409 store_plan, nothing written (the web never writes the plan of a
 *   store-billed member; review r2 F6).
 * 415 not JSON, 400 bad input, 401 signed out, 402 payment failed, 409 no live Holler subscription / payment due / store plan,
 * 429 too many switches, 502 Stripe failed, 503 billing not configured or limiter down.
 */
export async function POST(req: Request) {
  const stripe = getStripe();
  if (!stripe) return billingNotConfigured();
  if (!isJsonRequest(req)) return unsupportedMediaType();

  let body: unknown;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 });
  }
  const input = parseChangeBody(body);
  if (!input) return Response.json({ error: 'invalid_body' }, { status: 400 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const limited = await hit([LIMITS.planChangeUser(user.id)], admin);
  if (limited === 'limited') return Response.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': '3600' } });
  if (limited === 'error') return Response.json({ error: 'unavailable' }, { status: 503 });

  const { data: profile, error } = await admin
    .from('holler_profiles')
    // '*' so the store columns (migration 0020) come along when they exist; a database without them still answers.
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) return Response.json({ error: 'profile_lookup_failed' }, { status: 500 });
  if (isStorePlanLive(profile as Parameters<typeof isStorePlanLive>[0])) return Response.json({ error: 'store_plan' }, { status: 409 });
  const subId = (profile?.stripe_subscription_id as string | null | undefined) ?? null;
  if (!profile || !subId || !alreadySubscribed(profile.subscription_status as string | null)) {
    return Response.json({ error: 'no_subscription' }, { status: 409 });
  }

  try {
    let sub;
    try {
      sub = await stripe.subscriptions.retrieve(subId);
    } catch (e) {
      if ((e as { code?: string }).code === 'resource_missing') return Response.json({ error: 'no_subscription' }, { status: 409 });
      throw e;
    }
    // Shared Stripe account: only ever touch a Holler subscription that is still live.
    if (!isHollerMetadata(sub.metadata) || !DOWNGRADE_FROM.has(sub.status)) return Response.json({ error: 'no_subscription' }, { status: 409 });
    const item = sub.items?.data?.[0];
    if (!item) return Response.json({ error: 'no_subscription' }, { status: 409 });

    const currentTier = tierFromMetadata(sub.metadata);
    const currentPlan = planFromInterval(item.price?.recurring?.interval);
    const tier = input.tier;
    const plan = input.plan ?? currentPlan;
    const status = mapStripeStatus(sub.status);

    if (tier === currentTier && plan === currentPlan) {
      // Repair: Stripe already has this plan. If an earlier switch reached Stripe but the profile write failed, fix the row now.
      let repaired = false;
      if (profile.plan !== currentTier || (status && profile.subscription_status !== status)) {
        const patch: Record<string, unknown> = { plan: currentTier, updated_at: new Date().toISOString() };
        if (status) patch.subscription_status = status;
        const { error: fixErr } = await admin.from('holler_profiles').update(patch).eq('user_id', user.id).eq('stripe_subscription_id', sub.id);
        if (fixErr) console.error('[stripe] change-plan repair write failed', fixErr.message);
        else repaired = true;
      }
      return Response.json({ tier, plan, status, changed: false, repaired });
    }

    const upgrade = isUpgrade({ tier: currentTier, plan: currentPlan, cents: item.price?.unit_amount ?? null }, { tier, plan });
    if (upgrade && !UPGRADE_FROM.has(sub.status)) return Response.json({ error: 'payment_due' }, { status: 409 });

    const product = await ensureProduct(stripe, tier);
    let updated;
    try {
      updated = await stripe.subscriptions.update(
        sub.id,
        {
          items: [{ id: item.id, price_data: subscriptionPriceData(tier, plan, product) }],
          ...prorationFor(upgrade),
          metadata: { ...sub.metadata, ...hollerMetadata(user.id), plan, tier },
        },
        { idempotencyKey: planChangeKey({ userId: user.id, subscriptionId: sub.id, itemId: item.id, priceId: item.price?.id, tier, plan }) },
      );
    } catch (e) {
      if (upgrade && isPaymentFailure(e)) {
        // error_if_incomplete: Stripe left the subscription as it was. Leave the profile as it was too.
        return Response.json({ error: 'payment_failed' }, { status: 402 });
      }
      throw e;
    }

    const newTier = tierFromMetadata(updated.metadata);
    const newStatus = mapStripeStatus(updated.status);
    const patch: Record<string, unknown> = { plan: newTier, updated_at: new Date().toISOString() };
    if (newStatus) patch.subscription_status = newStatus;
    const { error: saveErr } = await admin.from('holler_profiles').update(patch).eq('user_id', user.id);
    // Stripe already changed. The webhook (customer.subscription.updated) writes the same plan, and a second click repairs it.
    if (saveErr) console.error('[stripe] change-plan saved in Stripe but not in the profile', saveErr.message);
    // Moving to Pro turns on saved extra areas, trades past 5 and keywords: fill the feed for them after the response (idempotent,
    // rate limited, never throws). after() throws outside a request scope; the plan change itself has already succeeded then.
    if (!saveErr && newTier === 'pro') {
      try {
        after(() => backfillWithLimit(user.id).then(() => undefined));
      } catch {
        // no request scope: skip the backfill, the next settings save or scan fills the feed
      }
    }
    return Response.json({ tier: newTier, plan, status: newStatus, changed: true, charged_now: upgrade });
  } catch (e) {
    console.error('[stripe] change-plan failed', e instanceof Error ? e.message : e);
    return Response.json({ error: 'change_failed' }, { status: 502 });
  }
}
