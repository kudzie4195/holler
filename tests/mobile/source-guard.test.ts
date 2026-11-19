// Store billing source guards, both directions.
//  Stripe -> store: the Stripe webhook must not overwrite a live App Store / Google Play plan of the same or higher rank (route-level,
//                   through the real handler with a stateful profile row).
//  store -> Stripe: holler_apply_store_event refuses to overwrite a live Stripe plan ('other_store'). That half lives in SQL and is
//                   exercised in PGlite by /home/claude/gates/pg/migtest_0020.mjs; here the TypeScript twin (isStripePlanLive) is checked.
// Also: lib/auth/access.ts counts a store plan as paid until its expiry plus grace.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeAccess } from '@/lib/auth/access';
import { billingSourceOf, isStorePlanLive, isStripePlanLive, stripeMayOverwrite, STORE_EXPIRY_GRACE_MS } from '@/lib/storebilling/source';
import { storeManaged } from '@/lib/storebilling/web';
import { stripePlanSource } from '@/lib/stripe/status';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const future = new Date(NOW + 10 * 86_400_000).toISOString();
const past = new Date(NOW - 1 * 86_400_000).toISOString();
const apple = (plan: string, over: Record<string, unknown> = {}) => ({ plan, subscription_status: 'active', plan_source: 'apple', store_expires_at: future, ...over });

describe('stripeMayOverwrite (Stripe side)', () => {
  it('a live store plan of the same rank is never overwritten', () => {
    expect(stripeMayOverwrite(apple('pro'), { status: 'active', tier: 'pro' }, NOW)).toBe(false);
    expect(stripeMayOverwrite(apple('starter'), { status: 'active', tier: 'starter' }, NOW)).toBe(false);
  });
  it('nor by a lower rank', () => {
    expect(stripeMayOverwrite(apple('pro'), { status: 'active', tier: 'starter' }, NOW)).toBe(false);
  });
  it('a Stripe cancel or past-due never touches a live store plan; a higher paid rank takes over', () => {
    expect(stripeMayOverwrite(apple('starter'), { status: 'canceled', tier: 'pro' }, NOW)).toBe(false);
    expect(stripeMayOverwrite(apple('starter'), { status: 'canceled', tier: null }, NOW)).toBe(false);
    expect(stripeMayOverwrite(apple('starter'), { status: 'active', tier: 'pro' }, NOW)).toBe(true);
    expect(stripeMayOverwrite(apple('starter', { plan_source: 'google' }), { status: 'past_due', tier: 'pro' }, NOW)).toBe(true);
  });
  it('a store plan that is not live (expired, canceled) or no store plan at all does not block Stripe', () => {
    expect(stripeMayOverwrite(apple('pro', { store_expires_at: past }), { status: 'active', tier: 'starter' }, NOW)).toBe(true);
    expect(stripeMayOverwrite(apple('pro', { subscription_status: 'canceled' }), { status: 'active', tier: 'starter' }, NOW)).toBe(true);
    expect(stripeMayOverwrite({ plan: 'pro', subscription_status: 'active', plan_source: 'stripe' }, { status: 'canceled', tier: null }, NOW)).toBe(true);
    expect(stripeMayOverwrite(null, { status: 'active', tier: 'pro' }, NOW)).toBe(true);
    expect(stripeMayOverwrite({ plan: 'pro', subscription_status: 'active' }, { status: 'active', tier: 'starter' }, NOW)).toBe(true);
  });
  it('stripePlanSource: stripe only when paid and only when the column exists', () => {
    expect(stripePlanSource({ plan_source: 'none' }, 'active')).toBe('stripe');
    expect(stripePlanSource({ plan_source: 'apple' }, 'past_due')).toBe('stripe');
    expect(stripePlanSource({ plan_source: 'stripe' }, 'canceled')).toBeUndefined();
    expect(stripePlanSource({ plan: 'pro' } as { plan_source?: unknown }, 'active')).toBeUndefined(); // before migration 0020
    expect(stripePlanSource(null, 'active')).toBeUndefined();
  });
});

describe('live-plan tests shared with the store side', () => {
  it('isStripePlanLive: plan_source stripe or a legacy row with a Stripe subscription, while paid', () => {
    expect(isStripePlanLive({ subscription_status: 'active', plan_source: 'stripe' })).toBe(true);
    expect(isStripePlanLive({ subscription_status: 'past_due', plan_source: 'none', stripe_subscription_id: 'sub_1' })).toBe(true);
    expect(isStripePlanLive({ subscription_status: 'canceled', plan_source: 'stripe' })).toBe(false);
    expect(isStripePlanLive({ subscription_status: 'active', plan_source: 'apple', stripe_subscription_id: 'sub_old' })).toBe(false);
    expect(billingSourceOf({ plan_source: 'none', stripe_subscription_id: 'sub_1' })).toBe('stripe');
    expect(billingSourceOf({})).toBe('none');
  });
  it('isStorePlanLive', () => {
    expect(isStorePlanLive(apple('pro'), NOW)).toBe(true);
    // review r2 F1: a store row with no expiry is never live (this line used to pin the defect: toBe(true)).
    expect(isStorePlanLive(apple('pro', { store_expires_at: null }), NOW)).toBe(false);
    expect(isStorePlanLive(apple('pro', { store_expires_at: past }), NOW)).toBe(false);
    expect(isStorePlanLive(apple('pro', { plan_source: 'stripe' }), NOW)).toBe(false);
  });
  it('web billing card: managed in the store while live', () => {
    expect(storeManaged(apple('pro'), NOW)).toMatchObject({ store: 'apple', storeName: 'the App Store', manageUrl: 'https://apps.apple.com/account/subscriptions' });
    expect(storeManaged(apple('pro', { plan_source: 'google' }), NOW)?.line).toBe(
      'You pay for Holler through Google Play. To change or cancel your plan, use Google Play on your phone.',
    );
    expect(storeManaged(apple('pro', { subscription_status: 'canceled' }), NOW)).toBeNull();
    expect(storeManaged({ plan: 'pro', subscription_status: 'active', plan_source: 'stripe' }, NOW)).toBeNull();
  });
});

describe('computeAccess with store plans (lib/auth/access.ts)', () => {
  const trialOver = '2026-01-01T00:00:00Z';
  it('a live store plan is paid', () => {
    expect(computeAccess({ subscription_status: 'active', trial_ends_at: trialOver, plan_source: 'apple', store_expires_at: future }, NOW).locked).toBe(false);
  });
  it('a store plan stays paid through the grace window after expiry, then locks', () => {
    const justPast = new Date(NOW - STORE_EXPIRY_GRACE_MS + 60_000).toISOString();
    const longPast = new Date(NOW - STORE_EXPIRY_GRACE_MS - 60_000).toISOString();
    expect(computeAccess({ subscription_status: 'active', trial_ends_at: trialOver, plan_source: 'google', store_expires_at: justPast }, NOW).locked).toBe(false);
    expect(computeAccess({ subscription_status: 'active', trial_ends_at: trialOver, plan_source: 'google', store_expires_at: longPast }, NOW).locked).toBe(true);
  });
  it('Stripe and pre-0020 rows behave exactly as before', () => {
    expect(computeAccess({ subscription_status: 'active', trial_ends_at: trialOver }, NOW).locked).toBe(false);
    expect(computeAccess({ subscription_status: 'active', trial_ends_at: trialOver, plan_source: 'stripe', store_expires_at: longAgo() }, NOW).locked).toBe(false);
    expect(computeAccess({ subscription_status: 'canceled', trial_ends_at: trialOver }, NOW).locked).toBe(true);
  });
});
function longAgo() {
  return '2020-01-01T00:00:00Z';
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Stripe webhook route with a stateful row
// ---------------------------------------------------------------------------------------------------------------------------------
type Row = Record<string, unknown>;
let row: Row | null;
let event: unknown;
let freshSub: { status: string; metadata: Record<string, string> } | null;
let writes: Row[];
let readError: { code: string } | null = null;
let rpcs: { name: string; args: Record<string, unknown> }[] = [];

function admin() {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => (rpcs.push({ name, args }), { data: 'kept', error: null }),
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => (readError ? { data: null, error: readError } : { data: row ? { ...row } : null, error: null }) }) }),
      update: (patch: Row) => {
        const filters: ((r: Row) => boolean)[] = [];
        const chain = {
          eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), chain),
          or: (expr: string) => {
            const parts = expr.split(',').map((p) => p.split('.'));
            filters.push((r) => parts.some(([c, op, ...v]) => (op === 'is' ? r[c] == null : r[c] === v.join('.'))));
            return chain;
          },
          then: (resolve: (v: { error: null }) => void) => {
            if (row && filters.every((f) => f(row!))) {
              Object.assign(row, patch);
              writes.push(patch);
            }
            resolve({ error: null });
          },
        };
        return chain;
      },
    }),
  };
}

async function hook() {
  vi.resetModules();
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
  vi.doMock('server-only', () => ({}));
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => admin() }));
  vi.doMock('@/lib/stripe', async (orig) => ({
    ...(await orig<typeof import('../../lib/stripe')>()),
    getStripe: () => ({
      webhooks: { constructEventAsync: async () => event },
      subscriptions: { retrieve: async () => freshSub },
    }),
  }));
  const { POST } = await import('../../app/api/stripe/webhook/route');
  return POST(new Request('https://x.test/api/stripe/webhook', { method: 'POST', body: '{}', headers: { 'stripe-signature': 't=1,v1=x' } }));
}

const META = (tier: string) => ({ app: 'holler', user_id: 'u1', tier, plan: 'monthly' });
const subEvent = (type: string, tier: string, status = 'active') => ({ type, data: { object: { id: 'sub_w', status, customer: 'cus_1', metadata: META(tier) } } });
const checkout = (tier: string) => ({
  type: 'checkout.session.completed',
  data: { object: { mode: 'subscription', client_reference_id: 'u1', subscription: 'sub_w', customer: 'cus_1', metadata: META(tier) } },
});

describe('Stripe webhook route: source guard', () => {
  beforeEach(() => {
    writes = [];
    rpcs = [];
    freshSub = null;
    readError = null;
  });
  it('a failed guard read is a 500 (Stripe retries); several rows for one customer fall back to the old behaviour', async () => {
    row = { user_id: 'u1', plan: 'starter', subscription_status: 'trialing', plan_source: 'none', stripe_subscription_id: null, stripe_customer_id: 'cus_1' };
    event = subEvent('customer.subscription.updated', 'pro');
    freshSub = { status: 'active', metadata: META('pro') };
    readError = { code: '57014' };
    expect((await hook()).status).toBe(500);
    expect(writes).toEqual([]);
    readError = { code: 'PGRST116' };
    expect((await hook()).status).toBe(200);
    expect(row).toMatchObject({ plan: 'pro', subscription_status: 'active' });
  });
  afterEach(() => vi.unstubAllEnvs());
  const liveApple = (plan: string): Row => ({
    user_id: 'u1',
    plan,
    subscription_status: 'active',
    plan_source: 'apple',
    store_expires_at: new Date(Date.now() + 20 * 86_400_000).toISOString(),
    stripe_customer_id: null,
    stripe_subscription_id: null,
  });

  it('checkout for the same plan over a live App Store plan: 200 ignored store_plan, row untouched', async () => {
    row = liveApple('starter');
    event = checkout('starter');
    freshSub = { status: 'active', metadata: META('starter') };
    const res = await hook();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, ignored: 'store_plan' });
    expect(writes).toEqual([]);
    expect(row).toMatchObject({ plan_source: 'apple', plan: 'starter' });
  });
  it('subscription.updated for a lower plan over a live Google Pro: untouched', async () => {
    row = liveApple('pro');
    row.plan_source = 'google';
    event = subEvent('customer.subscription.updated', 'starter');
    freshSub = { status: 'active', metadata: META('starter') };
    expect((await hook()).status).toBe(200);
    expect(writes).toEqual([]);
  });
  it('subscription.deleted never cancels a live store plan', async () => {
    row = { ...liveApple('pro'), stripe_subscription_id: 'sub_w' };
    event = subEvent('customer.subscription.deleted', 'pro', 'canceled');
    expect((await hook()).status).toBe(200);
    expect(writes).toEqual([]);
    expect(row.subscription_status).toBe('active');
    // review r2 F2: the blocked Stripe state is still handed to the database (shadow state for a double payer).
    expect(rpcs).toEqual([{ name: 'holler_stripe_state', args: { p_user_id: 'u1', p_subscription_id: 'sub_w', p_status: 'canceled', p_plan: null } }]);
  });
  it('a higher plan on the web takes over: Pro written, plan_source stripe', async () => {
    row = liveApple('starter');
    event = checkout('pro');
    freshSub = { status: 'active', metadata: META('pro') };
    expect((await hook()).status).toBe(200);
    expect(row).toMatchObject({ plan: 'pro', subscription_status: 'active', plan_source: 'stripe', stripe_subscription_id: 'sub_w' });
  });
  it('an expired store plan does not block Stripe; plan_source becomes stripe', async () => {
    row = { ...liveApple('pro'), store_expires_at: '2026-01-01T00:00:00Z', subscription_status: 'canceled' };
    event = checkout('starter');
    freshSub = { status: 'active', metadata: META('starter') };
    await hook();
    expect(row).toMatchObject({ plan: 'starter', subscription_status: 'active', plan_source: 'stripe' });
  });
  it('a trial row (plan_source none): Stripe writes as before and records plan_source stripe', async () => {
    row = { user_id: 'u1', plan: 'starter', subscription_status: 'trialing', plan_source: 'none', stripe_subscription_id: null };
    event = subEvent('customer.subscription.updated', 'pro');
    freshSub = { status: 'active', metadata: META('pro') };
    await hook();
    expect(row).toMatchObject({ plan: 'pro', subscription_status: 'active', plan_source: 'stripe' });
  });
  it('before migration 0020 (no plan_source column) the patch never names it', async () => {
    row = { user_id: 'u1', plan: 'starter', subscription_status: 'trialing', stripe_subscription_id: null };
    event = subEvent('customer.subscription.updated', 'pro');
    freshSub = { status: 'active', metadata: META('pro') };
    await hook();
    expect(writes).toHaveLength(1);
    expect(writes[0]).not.toHaveProperty('plan_source');
  });
  it('a Stripe cancel of a Stripe plan keeps plan_source stripe (the column is not rewritten)', async () => {
    row = { user_id: 'u1', plan: 'pro', subscription_status: 'active', plan_source: 'stripe', stripe_subscription_id: 'sub_w' };
    event = subEvent('customer.subscription.deleted', 'pro', 'canceled');
    await hook();
    expect(row).toMatchObject({ subscription_status: 'canceled', plan_source: 'stripe' });
    expect(writes[0]).not.toHaveProperty('plan_source');
  });
});
