import { createHash } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { siteUrl } from '@/lib/env';
import { alreadySubscribed, billingNotConfigured, getStripe, hollerMetadata, parsePlan, priceDataFor, trialParams } from '@/lib/stripe';

export async function POST(req: Request) {
  const stripe = getStripe();
  if (!stripe) return billingNotConfigured();

  // Body is optional: no body means monthly. Anything that is not monthly or annual is a 400, never a guess.
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

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { data: profile, error } = await admin
    .from('holler_profiles')
    .select('stripe_customer_id, business_name, subscription_status, trial_ends_at')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) return Response.json({ error: 'profile_lookup_failed' }, { status: 500 });
  if (!profile) return Response.json({ error: 'no_profile' }, { status: 400 });
  // Already paying (or in Stripe's retry window): a second checkout would create a second subscription.
  if (alreadySubscribed(profile.subscription_status as string | null)) {
    return Response.json({ error: 'already_subscribed' }, { status: 409 });
  }

  try {
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

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      metadata: { ...hollerMetadata(user.id), plan },
      line_items: [
        {
          quantity: 1,
          price_data: priceDataFor(plan),
        },
      ],
      // No charge during the free trial that started in the app. Same trial rule for monthly and annual.
      subscription_data: { metadata: { ...hollerMetadata(user.id), plan }, ...trialParams(profile.trial_ends_at as string | null) },
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
