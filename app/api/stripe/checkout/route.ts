import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { siteUrl } from '@/lib/env';
import { alreadySubscribed, billingNotConfigured, getStripe, hollerMetadata, PRICE_CENTS, trialParams } from '@/lib/stripe';


export async function POST() {
  const stripe = getStripe();
  if (!stripe) return billingNotConfigured();

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
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        name: profile.business_name ?? undefined,
        metadata: hollerMetadata(user.id),
      });
      customerId = customer.id;
      await admin.from('holler_profiles').update({ stripe_customer_id: customerId }).eq('user_id', user.id);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      metadata: hollerMetadata(user.id),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: PRICE_CENTS,
            recurring: { interval: 'month' },
            product_data: { name: 'Holler' },
          },
        },
      ],
      // No charge during the free trial that started in the app.
      subscription_data: { metadata: hollerMetadata(user.id), ...trialParams(profile.trial_ends_at as string | null) },
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
