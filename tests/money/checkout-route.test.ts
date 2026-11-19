// Route-level tests for POST /api/stripe/checkout and POST /api/stripe/webhook with Stripe, Supabase and the session mocked.
// The mocks return the shapes lib code reads (auth.getUser, from().select().eq().maybeSingle(), checkout.sessions.create, subscriptions.retrieve,
// webhooks.constructEventAsync); these are assumed from our own call sites, not recorded from Stripe.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The webhook route imports lib/analytics/stripe (invoice.paid -> paid), which is 'server-only'.
vi.mock('server-only', () => ({}));

interface Ctx {
  profile: Record<string, unknown> | null;
  updates: { table: string; patch: Record<string, unknown>; col?: string; val?: unknown }[];
  updateError: { message: string } | null;
  sessionCreate: ReturnType<typeof vi.fn>;
  customersCreate: ReturnType<typeof vi.fn>;
  retrieve: ReturnType<typeof vi.fn>;
  products: { retrieve: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  construct: ReturnType<typeof vi.fn>;
}
let ctx: Ctx;

function adminMock() {
  return {
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ctx.profile, error: null }) }) }),
      update: (patch: Record<string, unknown>) => {
        const rec: Ctx['updates'][number] = { table, patch };
        ctx.updates.push(rec);
        const chain: Record<string, unknown> = {};
        const done = () => Promise.resolve({ error: ctx.updateError });
        chain.eq = (col: string, val: unknown) => {
          rec.col = col;
          rec.val = val;
          return Object.assign(done(), chain);
        };
        chain.or = () => done();
        return Object.assign(done(), chain);
      },
    }),
  };
}

async function load() {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://holler.test');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
  vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: 'a@x.com' } } }) } }) }));
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminMock() }));
  vi.doMock('@/lib/stripe', async (orig) => {
    const actual = await orig<typeof import('../../lib/stripe')>();
    return {
      ...actual,
      getStripe: () => ({
        customers: { create: ctx.customersCreate },
        checkout: { sessions: { create: ctx.sessionCreate } },
        subscriptions: { retrieve: ctx.retrieve },
        products: ctx.products,
        webhooks: { constructEventAsync: ctx.construct },
      }),
    };
  });
  return { checkout: (await import('../../app/api/stripe/checkout/route')).POST, webhook: (await import('../../app/api/stripe/webhook/route')).POST };
}

// Checkout requires Content-Type: application/json (billing-fix P2-4); an empty JSON-typed body still means Solo (id starter) monthly.
const post = (body?: string) => new Request('http://x.test/api/stripe/checkout', { method: 'POST', body, headers: { 'content-type': 'application/json' } });
const TRIAL_END = new Date(Date.now() + 5 * 86_400_000).toISOString();

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  ctx = {
    profile: { stripe_customer_id: 'cus_1', business_name: 'Ace', subscription_status: 'trialing', trial_ends_at: TRIAL_END },
    updates: [],
    updateError: null,
    sessionCreate: vi.fn(async () => ({ url: 'https://checkout.stripe.test/s' })),
    customersCreate: vi.fn(async () => ({ id: 'cus_new' })),
    retrieve: vi.fn(),
    products: { retrieve: vi.fn(async (id: string) => ({ id, active: true, name: id === 'holler_pro' ? 'Holler Pro' : 'Holler Solo', metadata: { app: 'holler' } })), create: vi.fn(), update: vi.fn() },
    construct: vi.fn(),
  };
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/stripe/checkout', () => {
  it('no body means Solo monthly: 799 cents, interval month, fixed product, trial_end kept, holler metadata', async () => {
    const { checkout } = await load();
    const res = await checkout(post());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://checkout.stripe.test/s' });
    const arg = ctx.sessionCreate.mock.calls[0][0];
    expect(arg.line_items[0].price_data).toEqual({ unit_amount: 799, recurring: { interval: 'month' }, currency: 'usd', product: 'holler_starter' });
    expect(arg.subscription_data.trial_end).toBe(Math.ceil(Date.parse(TRIAL_END) / 1000));
    expect(arg.metadata).toMatchObject({ app: 'holler', user_id: 'user-1' });
    expect(arg.subscription_data.metadata).toMatchObject({ app: 'holler', user_id: 'user-1' });
    expect(arg.client_reference_id).toBe('user-1');
  });

  it('annual: 7999 cents, interval year, same trial_end, same metadata', async () => {
    const { checkout } = await load();
    const res = await checkout(post(JSON.stringify({ plan: 'annual' })));
    expect(res.status).toBe(200);
    const arg = ctx.sessionCreate.mock.calls[0][0];
    expect(arg.line_items[0].price_data).toMatchObject({ unit_amount: 7999, recurring: { interval: 'year' }, currency: 'usd', product: 'holler_starter' });
    expect(arg.subscription_data.trial_end).toBe(Math.ceil(Date.parse(TRIAL_END) / 1000));
    expect(arg.metadata).toMatchObject({ app: 'holler', user_id: 'user-1', plan: 'annual' });
    expect(arg.subscription_data.metadata).toMatchObject({ app: 'holler' });
    expect(arg.mode).toBe('subscription');
  });

  it('annual with the trial already over charges now (no trial params), never a stale trial_end', async () => {
    ctx.profile = { ...ctx.profile!, trial_ends_at: '2026-01-01T00:00:00Z' };
    const { checkout } = await load();
    await checkout(post(JSON.stringify({ plan: 'annual' })));
    const sub = ctx.sessionCreate.mock.calls[0][0].subscription_data;
    expect(sub).not.toHaveProperty('trial_end');
    expect(sub).not.toHaveProperty('trial_period_days');
  });

  it('repeated checkouts reuse one product per tier: no product_data, no product created, no rename when the name is current', async () => {
    const { checkout } = await load();
    for (let i = 0; i < 3; i++) expect((await checkout(post(JSON.stringify({ plan: i % 2 ? 'annual' : 'monthly' })))).status).toBe(200);
    expect(ctx.sessionCreate).toHaveBeenCalledTimes(3);
    for (const [arg] of ctx.sessionCreate.mock.calls) {
      expect(arg.line_items[0].price_data).not.toHaveProperty('product_data');
      expect(arg.line_items[0].price_data.product).toBe('holler_starter');
    }
    expect(ctx.products.create).not.toHaveBeenCalled();
    expect(ctx.products.update).not.toHaveBeenCalled();
  });

  it('a product lookup failure is a 502 and no session is created', async () => {
    ctx.products.retrieve.mockRejectedValue(Object.assign(new Error('api down'), { code: 'api_error' }));
    const { checkout } = await load();
    expect((await checkout(post())).status).toBe(502);
    expect(ctx.sessionCreate).not.toHaveBeenCalled();
  });

  it('rejects an unknown plan and invalid JSON with 400 before touching Stripe', async () => {
    const { checkout } = await load();
    expect((await checkout(post(JSON.stringify({ plan: 'lifetime' })))).status).toBe(400);
    expect((await checkout(post('{nope'))).status).toBe(400);
    expect(ctx.sessionCreate).not.toHaveBeenCalled();
  });

  it('already_subscribed guard applies to annual too (409)', async () => {
    ctx.profile = { ...ctx.profile!, subscription_status: 'active' };
    const { checkout } = await load();
    const res = await checkout(post(JSON.stringify({ plan: 'annual' })));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'already_subscribed' });
    expect(ctx.sessionCreate).not.toHaveBeenCalled();
  });

  it('creates the customer with an idempotency key and fails loudly if saving the id fails (F-10)', async () => {
    ctx.profile = { ...ctx.profile!, stripe_customer_id: null };
    ctx.updateError = { message: 'write failed' };
    const { checkout } = await load();
    const res = await checkout(post());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'customer_save_failed' });
    expect(ctx.customersCreate.mock.calls[0][1]).toEqual({ idempotencyKey: expect.stringMatching(/^holler-customer-user-1-[0-9a-f]{24}$/) });
    expect(ctx.sessionCreate).not.toHaveBeenCalled();
  });

  it('saves the new customer id and goes on when the write works', async () => {
    ctx.profile = { ...ctx.profile!, stripe_customer_id: null };
    const { checkout } = await load();
    expect((await checkout(post())).status).toBe(200);
    expect(ctx.updates[0].patch).toEqual({ stripe_customer_id: 'cus_new' });
    expect(ctx.sessionCreate.mock.calls[0][0].customer).toBe('cus_new');
  });
});

describe('POST /api/stripe/webhook customer.subscription.updated (F-8)', () => {
  const event = (status: string) => ({
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_1', status, customer: 'cus_1', metadata: { app: 'holler', user_id: 'user-1' } } },
  });
  const hook = () => new Request('http://x.test/api/stripe/webhook', { method: 'POST', body: '{}', headers: { 'stripe-signature': 't=1,v1=x' } });

  it('maps the freshly fetched status, not the stale one in the event', async () => {
    ctx.construct.mockResolvedValue(event('past_due'));
    ctx.retrieve.mockResolvedValue({ id: 'sub_1', status: 'active' });
    const { webhook } = await load();
    expect((await webhook(hook())).status).toBe(200);
    expect(ctx.retrieve).toHaveBeenCalledWith('sub_1');
    expect(ctx.updates[0].patch).toMatchObject({ subscription_status: 'active', stripe_subscription_id: 'sub_1' });
  });

  it('P1-3: a failed fresh read answers 500 so Stripe retries, and the stale event status is not written', async () => {
    ctx.construct.mockResolvedValue(event('past_due'));
    ctx.retrieve.mockRejectedValue(new Error('network'));
    const { webhook } = await load();
    expect((await webhook(hook())).status).toBe(500);
    expect(ctx.updates).toHaveLength(0);
  });

  it('does not fetch for a deleted event and stores canceled', async () => {
    ctx.construct.mockResolvedValue({ ...event('active'), type: 'customer.subscription.deleted' });
    const { webhook } = await load();
    await webhook(hook());
    expect(ctx.retrieve).not.toHaveBeenCalled();
    expect(ctx.updates[0].patch).toMatchObject({ subscription_status: 'canceled' });
  });

  it('ignores another product subscription without any API call', async () => {
    const e = event('active');
    e.data.object.metadata = { app: 'clovermap', user_id: 'x' };
    ctx.construct.mockResolvedValue(e);
    const { webhook } = await load();
    const res = await webhook(hook());
    expect(await res.json()).toMatchObject({ ignored: 'not_holler' });
    expect(ctx.retrieve).not.toHaveBeenCalled();
    expect(ctx.updates).toHaveLength(0);
  });
});

describe('POST /api/stripe/webhook invoice.paid (funnel "paid", analytics)', () => {
  const hook = () => new Request('http://x.test/api/stripe/webhook', { method: 'POST', body: '{}', headers: { 'stripe-signature': 't=1,v1=x' } });

  it('passes the invoice to trackPaidInvoice, writes no profile row and answers 200', async () => {
    const trackPaidInvoice = vi.fn(async () => undefined);
    const invoice = { id: 'in_1', amount_paid: 799, customer: 'cus_1', subscription_details: { metadata: { app: 'holler', user_id: 'user-1' } } };
    ctx.construct.mockResolvedValue({ type: 'invoice.paid', data: { object: invoice } });
    vi.doMock('@/lib/analytics/stripe', () => ({ trackPaidInvoice }));
    const { webhook } = await load();
    const res = await webhook(hook());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(trackPaidInvoice).toHaveBeenCalledTimes(1);
    expect((trackPaidInvoice.mock.calls[0] as unknown[])[1]).toEqual(invoice);
    expect(ctx.updates).toHaveLength(0);
    expect(ctx.retrieve).not.toHaveBeenCalled();
    vi.doUnmock('@/lib/analytics/stripe');
  });

  it('a trial invoice (amount_paid 0) goes through the real helper and records nothing, still 200', async () => {
    ctx.construct.mockResolvedValue({ type: 'invoice.paid', data: { object: { id: 'in_0', amount_paid: 0, customer: 'cus_1' } } });
    const { webhook } = await load();
    expect((await webhook(hook())).status).toBe(200);
    expect(ctx.updates).toHaveLength(0);
  });
});
