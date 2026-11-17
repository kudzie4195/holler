// Starter / Pro billing: checkout tier, webhook plan, POST /api/stripe/change-plan, ensureProduct. Stripe, Supabase and the session are
// mocked with the shapes our own code reads (assumed, not recorded from Stripe). The subscriptions.update parameter shape is checked by
// tsc against node_modules/stripe (stripe@23 SubscriptionUpdateParams.Item.PriceData: currency, product, recurring, unit_amount).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureProduct, parseChangeBody, parseTier, PRODUCT_IDS, subscriptionPriceData, tierFromMetadata, type ProductsApi } from '@/lib/stripe';

interface Ctx {
  user: { id: string; email: string } | null;
  profile: Record<string, unknown> | null;
  updates: { table: string; patch: Record<string, unknown>; col?: string; val?: unknown; filters: [string, unknown][]; or?: string }[];
  sessionCreate: ReturnType<typeof vi.fn>;
  retrieve: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  construct: ReturnType<typeof vi.fn>;
  products: { retrieve: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  hit: (...a: unknown[]) => Promise<string>;
  updateError: { message: string } | null;
}
let ctx: Ctx;

function adminMock() {
  return {
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ctx.profile, error: null }) }) }),
      update: (patch: Record<string, unknown>) => {
        const rec: Ctx['updates'][number] = { table, patch, filters: [] };
        ctx.updates.push(rec);
        const chain: Record<string, unknown> = {};
        const done = () => Promise.resolve({ error: ctx.updateError });
        chain.eq = (col: string, val: unknown) => {
          if (rec.col === undefined) [rec.col, rec.val] = [col, val];
          rec.filters.push([col, val]);
          return Object.assign(done(), chain);
        };
        chain.or = (f: string) => ((rec.or = f), Object.assign(done(), chain));
        return Object.assign(done(), chain);
      },
    }),
  };
}

async function load() {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://holler.test');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
  vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: ctx.user } }) } }) }));
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminMock() }));
  vi.doMock('@/lib/auth/ratelimit', () => ({ hit: (...a: unknown[]) => ctx.hit(...a) }));
  vi.doMock('@/lib/stripe', async (orig) => {
    const actual = await orig<typeof import('../../lib/stripe')>();
    return {
      ...actual,
      getStripe: () => ({
        customers: { create: vi.fn() },
        checkout: { sessions: { create: ctx.sessionCreate } },
        subscriptions: { retrieve: ctx.retrieve, update: ctx.update },
        products: ctx.products,
        webhooks: { constructEventAsync: ctx.construct },
      }),
    };
  });
  return {
    checkout: (await import('../../app/api/stripe/checkout/route')).POST,
    webhook: (await import('../../app/api/stripe/webhook/route')).POST,
    change: (await import('../../app/api/stripe/change-plan/route')).POST,
  };
}

const json = (url: string, body?: unknown) =>
  new Request(url, { method: 'POST', body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const hook = () => new Request('http://x.test/api/stripe/webhook', { method: 'POST', body: '{}', headers: { 'stripe-signature': 't=1,v1=x' } });
const HOLLER = { app: 'holler', user_id: 'user-1' };
const liveSub = (over: Record<string, unknown> = {}) => ({
  id: 'sub_1',
  status: 'active',
  metadata: { ...HOLLER, plan: 'monthly', tier: 'starter' },
  items: { data: [{ id: 'si_1', price: { recurring: { interval: 'month' } } }] },
  ...over,
});

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  ctx = {
    user: { id: 'user-1', email: 'a@x.com' },
    profile: { stripe_customer_id: 'cus_1', business_name: 'Ace', subscription_status: 'trialing', trial_ends_at: '2026-01-01T00:00:00Z', stripe_subscription_id: null },
    updates: [],
    sessionCreate: vi.fn(async () => ({ url: 'https://checkout.stripe.test/s' })),
    retrieve: vi.fn(),
    update: vi.fn(async (id: string, p: { metadata: Record<string, string> }) => ({ id, status: 'active', metadata: p.metadata })),
    construct: vi.fn(),
    products: { retrieve: vi.fn(async (id: string) => ({ id, active: true })), create: vi.fn(), update: vi.fn() },
    hit: async () => 'allowed',
    updateError: null,
  };
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('parsers', () => {
  it('parseTier: missing means starter, anything else is null', () => {
    expect(parseTier(undefined)).toBe('starter');
    expect(parseTier({})).toBe('starter');
    expect(parseTier({ tier: null })).toBe('starter');
    expect(parseTier({ tier: 'pro' })).toBe('pro');
    for (const bad of [{ tier: 'Pro' }, { tier: 'gold' }, { tier: '' }, { tier: 2 }, 'pro', ['pro']]) expect(parseTier(bad)).toBeNull();
  });
  it('tierFromMetadata: absent or unknown means starter', () => {
    expect(tierFromMetadata({ app: 'holler', tier: 'pro' })).toBe('pro');
    expect(tierFromMetadata({ app: 'holler' })).toBe('starter');
    expect(tierFromMetadata({ app: 'holler', tier: 'gold' })).toBe('starter');
    expect(tierFromMetadata(null)).toBe('starter');
  });
  it('parseChangeBody: tier required, plan optional', () => {
    expect(parseChangeBody({ tier: 'pro' })).toEqual({ tier: 'pro', plan: null });
    expect(parseChangeBody({ tier: 'starter', plan: 'annual' })).toEqual({ tier: 'starter', plan: 'annual' });
    for (const bad of [null, {}, { tier: 'gold' }, { tier: 'pro', plan: 'yearly' }, [], 'pro']) expect(parseChangeBody(bad)).toBeNull();
  });
  it('subscriptionPriceData uses a product id and the cents table', () => {
    expect(subscriptionPriceData('pro', 'monthly', 'holler_pro')).toEqual({ currency: 'usd', product: 'holler_pro', unit_amount: 999, recurring: { interval: 'month' } });
    expect(subscriptionPriceData('pro', 'annual', 'holler_pro')).toEqual({ currency: 'usd', product: 'holler_pro', unit_amount: 9600, recurring: { interval: 'year' } });
    expect(subscriptionPriceData('starter', 'annual', 'holler_starter').unit_amount).toBe(4800);
  });
});

describe('POST /api/stripe/checkout with tier', () => {
  const url = 'http://x.test/api/stripe/checkout';
  it('pro monthly: 999 cents, tier in session and subscription metadata', async () => {
    const { checkout } = await load();
    expect((await checkout(json(url, { plan: 'monthly', tier: 'pro' }))).status).toBe(200);
    const arg = ctx.sessionCreate.mock.calls[0][0];
    expect(arg.line_items[0].price_data).toMatchObject({ unit_amount: 999, recurring: { interval: 'month' } });
    expect(arg.metadata).toEqual({ ...HOLLER, plan: 'monthly', tier: 'pro' });
    expect(arg.subscription_data.metadata).toEqual({ ...HOLLER, plan: 'monthly', tier: 'pro' });
  });
  it('pro annual: 9600 cents', async () => {
    const { checkout } = await load();
    await checkout(json(url, { plan: 'annual', tier: 'pro' }));
    expect(ctx.sessionCreate.mock.calls[0][0].line_items[0].price_data).toMatchObject({ unit_amount: 9600, recurring: { interval: 'year' } });
  });
  it('missing tier means starter (500), with tier starter in metadata', async () => {
    const { checkout } = await load();
    await checkout(json(url, { plan: 'monthly' }));
    const arg = ctx.sessionCreate.mock.calls[0][0];
    expect(arg.line_items[0].price_data.unit_amount).toBe(500);
    expect(arg.subscription_data.metadata.tier).toBe('starter');
  });
  it('an unknown tier is a 400 before Stripe is called', async () => {
    const { checkout } = await load();
    for (const tier of ['gold', 'PRO', '', 3]) {
      const res = await checkout(json(url, { plan: 'monthly', tier }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_tier' });
    }
    expect(ctx.sessionCreate).not.toHaveBeenCalled();
  });
  it('subscribers still get 409 already_subscribed, for pro too', async () => {
    ctx.profile = { ...ctx.profile!, subscription_status: 'active' };
    const { checkout } = await load();
    const res = await checkout(json(url, { tier: 'pro' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'already_subscribed' });
  });
});

describe('webhook sets holler_profiles.plan from the subscription tier', () => {
  const subEvent = (type: string, metadata: Record<string, string>, status = 'active') => ({ type, data: { object: { id: 'sub_1', status, customer: 'cus_1', metadata } } });

  it('checkout.session.completed: plan from the re-fetched subscription metadata', async () => {
    ctx.construct.mockResolvedValue({ type: 'checkout.session.completed', data: { object: { mode: 'subscription', client_reference_id: 'user-1', subscription: 'sub_1', customer: 'cus_1', metadata: { ...HOLLER, tier: 'pro' } } } });
    ctx.retrieve.mockResolvedValue({ id: 'sub_1', status: 'trialing', metadata: { ...HOLLER, tier: 'pro' } });
    const { webhook } = await load();
    expect((await webhook(hook())).status).toBe(200);
    expect(ctx.updates[0].patch).toMatchObject({ subscription_status: 'active', plan: 'pro', stripe_subscription_id: 'sub_1' });
  });

  it('checkout.session.completed without tier metadata (subscriptions made before Pro) stores starter', async () => {
    ctx.construct.mockResolvedValue({ type: 'checkout.session.completed', data: { object: { mode: 'subscription', client_reference_id: 'user-1', subscription: 'sub_1', customer: 'cus_1', metadata: HOLLER } } });
    ctx.retrieve.mockResolvedValue({ id: 'sub_1', status: 'active', metadata: HOLLER });
    const { webhook } = await load();
    await webhook(hook());
    expect(ctx.updates[0].patch).toMatchObject({ plan: 'starter' });
  });

  it('customer.subscription.created and .updated read the fresh subscription (event order safe)', async () => {
    for (const type of ['customer.subscription.created', 'customer.subscription.updated']) {
      ctx.updates = [];
      ctx.retrieve.mockReset();
      ctx.construct.mockResolvedValue(subEvent(type, { ...HOLLER, tier: 'starter' }, 'past_due')); // stale event body
      ctx.retrieve.mockResolvedValue({ id: 'sub_1', status: 'active', metadata: { ...HOLLER, tier: 'pro' } });
      const { webhook } = await load();
      expect((await webhook(hook())).status).toBe(200);
      expect(ctx.retrieve).toHaveBeenCalledWith('sub_1');
      expect(ctx.updates[0].patch).toMatchObject({ subscription_status: 'active', plan: 'pro' });
    }
  });

  it('P1-3: a failed re-fetch is a 500 (Stripe retries) and writes nothing; the event body is never trusted', async () => {
    for (const type of ['customer.subscription.created', 'customer.subscription.updated']) {
      ctx.updates = [];
      ctx.construct.mockResolvedValue(subEvent(type, { ...HOLLER, tier: 'pro' }));
      ctx.retrieve.mockRejectedValue(new Error('network'));
      const { webhook } = await load();
      const res = await webhook(hook());
      expect(res.status).toBe(500);
      expect(ctx.updates).toHaveLength(0);
    }
  });

  it('deleted: status canceled as before, plan untouched', async () => {
    ctx.construct.mockResolvedValue(subEvent('customer.subscription.deleted', { ...HOLLER, tier: 'pro' }));
    const { webhook } = await load();
    await webhook(hook());
    expect(ctx.retrieve).not.toHaveBeenCalled();
    expect(ctx.updates[0].patch).toMatchObject({ subscription_status: 'canceled' });
    expect(ctx.updates[0].patch).not.toHaveProperty('plan');
  });

  it('other products on the shared account are still ignored, including the new created event', async () => {
    for (const type of ['customer.subscription.created', 'customer.subscription.updated', 'checkout.session.completed']) {
      ctx.updates = [];
      const object = type === 'checkout.session.completed' ? { mode: 'subscription', subscription: 'sub_x', metadata: { app: 'clovermap', tier: 'pro' } } : { id: 'sub_x', status: 'active', metadata: { app: 'clovermap', tier: 'pro' } };
      ctx.construct.mockResolvedValue({ type, data: { object } });
      const { webhook } = await load();
      expect(await (await webhook(hook())).json()).toMatchObject({ ignored: 'not_holler' });
      expect(ctx.updates).toHaveLength(0);
    }
    expect(ctx.retrieve).not.toHaveBeenCalled();
  });
});

describe('POST /api/stripe/change-plan', () => {
  const url = 'http://x.test/api/stripe/change-plan';
  const subscribed = () => (ctx.profile = { ...ctx.profile!, subscription_status: 'active', stripe_subscription_id: 'sub_1' });

  it('400 on bad input', async () => {
    subscribed();
    const { change } = await load();
    for (const b of ['{nope', '', { tier: 'gold' }, { tier: 'pro', plan: 'weekly' }, {}]) expect((await change(json(url, b))).status).toBe(400);
    expect(ctx.update).not.toHaveBeenCalled();
  });

  it('401 without a session', async () => {
    ctx.user = null;
    const { change } = await load();
    expect((await change(json(url, { tier: 'pro' }))).status).toBe(401);
  });

  it('409 when there is no active subscription (trial, canceled, missing id, other product, ended in Stripe)', async () => {
    const { change } = await load();
    expect((await change(json(url, { tier: 'pro' }))).status).toBe(409); // trialing
    ctx.profile = { ...ctx.profile!, subscription_status: 'canceled', stripe_subscription_id: 'sub_1' };
    expect((await change(json(url, { tier: 'pro' }))).status).toBe(409);
    ctx.profile = { ...ctx.profile!, subscription_status: 'active', stripe_subscription_id: null };
    expect((await change(json(url, { tier: 'pro' }))).status).toBe(409);
    subscribed();
    ctx.retrieve.mockResolvedValue(liveSub({ metadata: { app: 'clovermap' } }));
    expect((await change(json(url, { tier: 'pro' }))).status).toBe(409);
    ctx.retrieve.mockResolvedValue(liveSub({ status: 'canceled' }));
    const res = await change(json(url, { tier: 'pro' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'no_subscription' });
    expect(ctx.update).not.toHaveBeenCalled();
  });

  it('starter monthly to pro: updates the item price, charges the difference now, keeps the interval, updates metadata and the profile', async () => {
    subscribed();
    ctx.retrieve.mockResolvedValue(liveSub());
    const { change } = await load();
    const res = await change(json(url, { tier: 'pro' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tier: 'pro', plan: 'monthly', status: 'active', changed: true, charged_now: true });
    const [id, params, opts] = ctx.update.mock.calls[0];
    expect(id).toBe('sub_1');
    expect(params).toEqual({
      items: [{ id: 'si_1', price_data: { currency: 'usd', product: PRODUCT_IDS.pro, unit_amount: 999, recurring: { interval: 'month' } } }],
      proration_behavior: 'always_invoice',
      payment_behavior: 'error_if_incomplete',
      metadata: { ...HOLLER, plan: 'monthly', tier: 'pro' },
    });
    expect(opts).toEqual({ idempotencyKey: expect.stringMatching(/^holler-change-user-1-sub_1-si_1-none-pro-monthly-\d+$/) });
    expect(ctx.updates[0]).toMatchObject({ table: 'holler_profiles', patch: { plan: 'pro', subscription_status: 'active' }, col: 'user_id', val: 'user-1' });
  });

  it('pro yearly to starter keeps yearly (4800); an explicit plan switches the interval', async () => {
    subscribed();
    ctx.retrieve.mockResolvedValue(liveSub({ metadata: { ...HOLLER, tier: 'pro', plan: 'annual' }, items: { data: [{ id: 'si_9', price: { recurring: { interval: 'year' } } }] } }));
    const { change } = await load();
    expect(await (await change(json(url, { tier: 'starter' }))).json()).toMatchObject({ tier: 'starter', plan: 'annual' });
    expect(ctx.update.mock.calls[0][1].items[0]).toEqual({ id: 'si_9', price_data: { currency: 'usd', product: PRODUCT_IDS.starter, unit_amount: 4800, recurring: { interval: 'year' } } });
    await change(json(url, { tier: 'pro', plan: 'monthly' }));
    expect(ctx.update.mock.calls[1][1].items[0].price_data).toMatchObject({ unit_amount: 999, recurring: { interval: 'month' } });
  });

  it('same tier and interval: no Stripe update, changed false', async () => {
    subscribed();
    ctx.retrieve.mockResolvedValue(liveSub());
    const { change } = await load();
    expect(await (await change(json(url, { tier: 'starter' }))).json()).toMatchObject({ tier: 'starter', plan: 'monthly', changed: false });
    expect(ctx.update).not.toHaveBeenCalled();
  });

  it('502 when Stripe fails, profile untouched', async () => {
    subscribed();
    ctx.retrieve.mockResolvedValue(liveSub());
    ctx.update.mockRejectedValue(new Error('card_declined'));
    const { change } = await load();
    expect((await change(json(url, { tier: 'pro' }))).status).toBe(502);
    expect(ctx.updates).toHaveLength(0);
  });
});

describe('ensureProduct', () => {
  const api = (o: Partial<Record<'retrieve' | 'create' | 'update', ReturnType<typeof vi.fn>>>) =>
    ({ products: { retrieve: o.retrieve ?? vi.fn(), create: o.create ?? vi.fn(async () => ({ id: 'x' })), update: o.update ?? vi.fn(async () => ({ id: 'x' })) } }) as unknown as ProductsApi & { products: Record<string, ReturnType<typeof vi.fn>> };
  const err = (code: string) => Object.assign(new Error(code), { code });

  it('reuses an existing product', async () => {
    const a = api({ retrieve: vi.fn(async () => ({ id: 'holler_pro', active: true })) });
    expect(await ensureProduct(a, 'pro')).toBe('holler_pro');
    expect(a.products.create).not.toHaveBeenCalled();
  });
  it('creates it once with holler metadata when missing', async () => {
    const a = api({ retrieve: vi.fn(async () => { throw err('resource_missing'); }) });
    expect(await ensureProduct(a, 'pro')).toBe('holler_pro');
    expect(a.products.create).toHaveBeenCalledWith({ id: 'holler_pro', name: 'Holler Pro', metadata: { app: 'holler', tier: 'pro' } });
  });
  it('a lost creation race uses the same id; an archived product is turned back on; other errors throw', async () => {
    const race = api({ retrieve: vi.fn(async () => { throw err('resource_missing'); }), create: vi.fn(async () => { throw err('resource_already_exists'); }) });
    expect(await ensureProduct(race, 'starter')).toBe('holler_starter');
    const archived = api({ retrieve: vi.fn(async () => ({ id: 'holler_pro', active: false })) });
    await ensureProduct(archived, 'pro');
    expect(archived.products.update).toHaveBeenCalledWith('holler_pro', { active: true });
    await expect(ensureProduct(api({ retrieve: vi.fn(async () => { throw err('api_key_expired'); }) }), 'pro')).rejects.toThrow();
  });
});
