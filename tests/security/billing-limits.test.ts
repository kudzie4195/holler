// Review P2-4d: POST /api/stripe/checkout and POST /api/stripe/portal go through the shared limiter (holler_rate_hit) per member, so a
// member (or a stolen session) cannot spin up Stripe sessions without bound. Checkout fails closed (503) when the limiter is down, like
// change-plan; the portal fails open, because it is where a member cancels.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '../../lib/auth/limits';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({ env: {}, siteUrl: 'https://localholler.com' }));

const USER = '33333333-3333-4333-8333-333333333333';
const w = {
  limiter: 'allowed' as 'allowed' | 'limited' | 'error' | 'throw',
  rpcKeys: [] as string[],
  stripeCalls: [] as string[],
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: USER, email: 'm@x.test' } } }) } }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: { p_key: string }) => {
      if (name !== 'holler_rate_hit') throw new Error('unexpected rpc');
      w.rpcKeys.push(args.p_key);
      if (w.limiter === 'throw') throw new Error('limiter down');
      if (w.limiter === 'error') return { data: null, error: { code: 'PGRST202' } };
      return { data: w.limiter === 'allowed', error: null };
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { user_id: USER, stripe_customer_id: 'cus_1', subscription_status: null, trial_ends_at: null }, error: null }) }) }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}));
vi.mock('@/lib/stripe', async (orig) => {
  const real = await orig<typeof import('../../lib/stripe')>();
  return {
    ...real,
    getStripe: () => ({
      billingPortal: { sessions: { create: async () => (w.stripeCalls.push('portal'), { url: 'https://billing.stripe.test/p' }) } },
      checkout: { sessions: { create: async () => (w.stripeCalls.push('checkout'), { url: 'https://checkout.stripe.test/c' }) } },
      subscriptions: { retrieve: async () => ({}) },
    }),
    ensureProduct: async () => ({ id: 'prod_1' }),
  };
});

const post = (path: string, body?: string) =>
  new Request(`https://localholler.com${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://localholler.com', host: 'localholler.com' },
    body,
  });

beforeEach(() => {
  w.limiter = 'allowed';
  w.rpcKeys = [];
  w.stripeCalls = [];
});

describe('POST /api/stripe/checkout limiter (P2-4d)', () => {
  it('counts against the per-member checkout key and goes on when allowed', async () => {
    const { POST } = await import('../../app/api/stripe/checkout/route');
    const res = await POST(post('/api/stripe/checkout', '{}'));
    expect(res.status).toBe(200);
    expect(w.rpcKeys).toEqual([LIMITS.checkoutUser(USER).key]);
    expect(w.stripeCalls).toEqual(['checkout']);
  });
  it('over the limit: 429 with Retry-After, no Stripe session', async () => {
    w.limiter = 'limited';
    const { POST } = await import('../../app/api/stripe/checkout/route');
    const res = await POST(post('/api/stripe/checkout', '{}'));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('3600');
    expect(w.stripeCalls).toEqual([]);
  });
  it('limiter down: 503 (fails closed), no Stripe session', async () => {
    w.limiter = 'error';
    const { POST } = await import('../../app/api/stripe/checkout/route');
    expect((await POST(post('/api/stripe/checkout', '{}'))).status).toBe(503);
    expect(w.stripeCalls).toEqual([]);
  });
});

describe('POST /api/stripe/portal limiter (P2-4d)', () => {
  it('counts against the per-member portal key and opens the portal when allowed', async () => {
    const { POST } = await import('../../app/api/stripe/portal/route');
    const res = await POST(post('/api/stripe/portal'));
    expect(res.status).toBe(200);
    expect(w.rpcKeys).toEqual([LIMITS.portalUser(USER).key]);
    expect(w.stripeCalls).toEqual(['portal']);
  });
  it('over the limit: 429 with Retry-After, no portal session', async () => {
    w.limiter = 'limited';
    const { POST } = await import('../../app/api/stripe/portal/route');
    const res = await POST(post('/api/stripe/portal'));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('3600');
    expect(w.stripeCalls).toEqual([]);
  });
  it('limiter down (error or throw): still opens the portal (fails open, so a member can always cancel)', async () => {
    const { POST } = await import('../../app/api/stripe/portal/route');
    for (const mode of ['error', 'throw'] as const) {
      w.limiter = mode;
      expect((await POST(post('/api/stripe/portal'))).status).toBe(200);
    }
    expect(w.stripeCalls).toEqual(['portal', 'portal']);
  });
  it('the limits are per member and bounded', () => {
    expect(LIMITS.checkoutUser(USER)).toMatchObject({ max: 10, windowSeconds: 3600 });
    expect(LIMITS.portalUser(USER)).toMatchObject({ max: 20, windowSeconds: 3600 });
    expect(LIMITS.checkoutUser(USER).key).not.toContain(USER);
  });
});
