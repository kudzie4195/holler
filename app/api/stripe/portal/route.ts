import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { siteUrl } from '@/lib/env';
import { billingNotConfigured, getStripe } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

export async function POST() {
  const stripe = getStripe();
  if (!stripe) return billingNotConfigured();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await createAdminClient()
    .from('holler_profiles')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile?.stripe_customer_id) return Response.json({ error: 'no_customer' }, { status: 400 });

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${siteUrl}/app/settings`,
    });
    return Response.json({ url: session.url });
  } catch (e) {
    console.error('[stripe] portal failed', e instanceof Error ? e.message : e);
    return Response.json({ error: 'portal_failed' }, { status: 502 });
  }
}
