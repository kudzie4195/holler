import { createHash } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { siteUrl } from '@/lib/env';
import { isPaidNow } from '@/lib/auth/access';
import { hit } from '@/lib/auth/ratelimit';
import { LIMITS } from '@/lib/auth/limits';
import {
  billingNotConfigured,
  ensureProduct,
  getStripe,
  hollerMetadata,
  isHollerMetadata,
  isJsonRequest,
  parsePlan,
  parseTier,
  priceDataFor,
  trialParams,
  unsupportedMediaType,
} from '@/lib/stripe';

/**
 * Stripe statuses that Holler stores as 'canceled' (no paid access) although the subscription is still open in Stripe. Before a new
 * checkout, such a leftover subscription is canceled so the member never ends up with two.
 */
const LEFTOVER = new Set(['unpaid', 'paused']);

export async function POST(req: Request) {
  const stripe = getStripe();
  if (!stripe) return billingNotConfigured();
  // Content-Type: application/json is required (an empty body is fine), so a cross-site HTML form cannot start a checkout.
  if (!isJsonRequest(req)) return unsupportedMediaType();

  // Body is optional: no body means Solo (id 'starter') monthly. A plan that is not monthly or annual, or a tier that is not starter or pro,
  // is a 400, never a guess.
  let body: unknown;
  const rawBody = await req.text();
  if (rawBody.trim()) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return Response.json({ error: 'invalid_plan' }, { status: 400 });
    }
  }
  const plan = parsePlan(body);
  if (!plan) return Response.json({ error: 'invalid_plan' }, { status: 400 });
  const tier = parseTier(body);
  if (!tier) return Response.json({ error: 'invalid_tier' }, { status: 400 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  // Review P2-4d: 10 checkout starts an hour per member (each creates a Stripe session). Fails closed like change-plan: no limiter, no
  // new Stripe session.
  const limited = await hit([LIMITS.checkoutUser(user.id)], admin);
  if (limited === 'limited') return Response.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': '3600' } });
  if (limited === 'error') return Response.json({ error: 'unavailable' }, { status: 503 });

  const { data: profile, error } = await admin
    .from('holler_profiles')
    // '*' so the store columns (migration 0020) come along when they exist; a database without them still answers.
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) return Response.json({ error: 'profile_lookup_failed' }, { status: 500 });
  if (!profile) return Response.json({ error: 'no_profile' }, { status: 400 });
  // Already paying (or in Stripe's retry window): a second checkout would create a second subscription.
  // Moving between Solo and Pro goes through POST /api/stripe/change-plan instead.
  // Same paid test as the feed lock (isPaidNow): a store plan whose period ran out with no EXPIRATION webhook, or with no readable
  // expiry, is not paid, so that member may subscribe here (review r2 F7).
  if (isPaidNow(profile as Parameters<typeof isPaidNow>[0])) {
    return Response.json({ error: 'already_subscribed' }, { status: 409 });
  }

  try {
    // Owner decision: unpaid and paused count as canceled here. If that subscription is still open in Stripe, close it first
    // (Stripe also stops collecting its old invoices on cancel), so a fresh checkout cannot leave two Holler subscriptions behind.
    const oldSubId = profile.stripe_subscription_id as string | null;
    if (oldSubId) {
      const old = await stripe.subscriptions.retrieve(oldSubId).catch((e: { code?: string }) => {
        if (e?.code === 'resource_missing') return null;
        throw e;
      });
      if (old && isHollerMetadata(old.metadata) && LEFTOVER.has(old.status)) await stripe.subscriptions.cancel(old.id);
    }

    let customerId = profile.stripe_customer_id as string | null;
    if (!customerId) {
      // The idempotency key makes a retry (for example after the save below fails) return the same customer, not a second one.
      // Stripe rejects a reused key whose parameters changed, so the key hashes the parameters too.
      const params = {
        email: user.email ?? undefined,
        name: profile.business_name ?? undefined,
        metadata: hollerMetadata(user.id),
      };
      const keyHash = createHash('sha256').update(JSON.stringify(params)).digest('hex').slice(0, 24);
      const customer = await stripe.customers.create(params, { idempotencyKey: `holler-customer-${user.id}-${keyHash}` });
      customerId = customer.id;
      const { error: saveErr } = await admin.from('holler_profiles').update({ stripe_customer_id: customerId }).eq('user_id', user.id);
      if (saveErr) {
        console.error('[stripe] could not save stripe_customer_id', saveErr.message);
        return Response.json({ error: 'customer_save_failed' }, { status: 500 });
      }
    }

    // One fixed product per tier (lib/stripe/products.ts), so a checkout never makes a new Stripe product (product_data would).
    const product = await ensureProduct(stripe, tier);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      metadata: { ...hollerMetadata(user.id), plan, tier },
      line_items: [
        {
          quantity: 1,
          price_data: priceDataFor(plan, tier, product),
        },
      ],
      // No charge during the free trial that started in the app. Same trial rule for every plan and interval.
      // The webhook reads tier from the subscription's metadata to set holler_profiles.plan.
      subscription_data: { metadata: { ...hollerMetadata(user.id), plan, tier }, ...trialParams(profile.trial_ends_at as string | null) },
      success_url: `${siteUrl}/app?upgraded=1`,
      cancel_url: `${siteUrl}/app/settings`,
    });
    if (!session.url) return Response.json({ error: 'no_checkout_url' }, { status: 502 });
    return Response.json({ url: session.url });
  } catch (e) {
    console.error('[stripe] checkout failed', e instanceof Error ? e.message : e);
    return Response.json({ error: 'checkout_failed' }, { status: 502 });
  }
}
