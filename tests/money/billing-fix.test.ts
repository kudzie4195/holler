// Billing fixes from review-billing.md (P1-1, P1-3, P2-1 to P2-4, P2-11), driven through the real route handlers against a
// stateful fake: one holler_profiles row that update() filters really apply to, and a fake Stripe that keeps subscriptions, honours
// idempotency keys and, like Stripe with payment_behavior 'error_if_incomplete', leaves the subscription unchanged when the card fails.
// The fakes model the Stripe behaviour described in stripe@23 types and Stripe's API reference; no call reaches Stripe.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeAccess } from '@/lib/auth/access';
import { effectiveTier } from '@/lib/plan';
import { isUpgrade, mapStripeStatus, PRICES_CENTS, prorationFor, planChangeKey, type Plan, type Tier } from '@/lib/stripe';

type Row = Record<string, unknown>;
interface FakeSub {
  id: string;
  status: string;
  metadata: Record<string, string>;
  items: { data: { id: string; price: { id: string; unit_amount: number; recurring: { interval: 'month' | 'year' } } }[] };
}

interface World {
  row: Row;
  failNextProfileWrite: boolean;
  subs: Map<string, FakeSub>;
  cardFails: boolean;
  retrieveFails: boolean;
  limiter: 'allowed' | 'limited' | 'error';
  keys: Map<string, unknown>;
  updateCalls: { id: string; params: Record<string, unknown>; opts?: { idempotencyKey?: string } }[];
  pricesCreated: number;
  cancelCalls: { id: string; params?: unknown }[];
  sessionCreate: ReturnType<typeof vi.fn>;
  construct: ReturnType<typeof vi.fn>;
  getUser: ReturnType<typeof vi.fn>;
}
let w: World;

const HOLLER = { app: 'holler', user_id: 'user-1' };

function sub(id: string, status: string, tier: Tier, plan: Plan): FakeSub {
  return {
    id,
    status,
    metadata: { ...HOLLER, tier, plan },
    items: { data: [{ id: `si_${id}`, price: { id: `price_${id}_0`, unit_amount: PRICES_CENTS[tier][plan], recurring: { interval: plan === 'annual' ? 'year' : 'month' } } }] },
  };
}

/** holler_profiles fake: update(patch).eq(...).or(...) applies to the one row only when every filter matches. */
function adminFake() {
  return {
    rpc: async () => ({ data: w.limiter === 'allowed', error: w.limiter === 'error' ? { code: 'x' } : null }),
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ...w.row }, error: null }) }) }),
      update: (patch: Row) => {
        const filters: ((r: Row) => boolean)[] = [];
        const chain = {
          eq: (col: string, val: unknown) => (filters.push((r) => r[col] === val), chain),
          or: (expr: string) => {
            const parts = expr.split(',').map((p) => p.split('.'));
            filters.push((r) => parts.some(([col, op, ...v]) => (op === 'is' ? r[col] === null : r[col] === v.join('.'))));
            return chain;
          },
          then: (resolve: (v: { error: { message: string } | null }) => void) => {
            if (w.failNextProfileWrite) {
              w.failNextProfileWrite = false;
              return resolve({ error: { message: 'write failed' } });
            }
            if (filters.every((f) => f(w.row))) Object.assign(w.row, patch);
            resolve({ error: null });
          },
        };
        return chain;
      },
    }),
  };
}

function stripeFake() {
  const clone = (s: FakeSub) => JSON.parse(JSON.stringify(s)) as FakeSub;
  return {
    customers: { create: vi.fn(async () => ({ id: 'cus_new' })) },
    checkout: { sessions: { create: w.sessionCreate } },
    products: { retrieve: async (id: string) => ({ id, active: true }), create: vi.fn(), update: vi.fn() },
    webhooks: { constructEventAsync: w.construct },
    subscriptions: {
      retrieve: async (id: string) => {
        if (w.retrieveFails) throw new Error('stripe api error');
        const s = w.subs.get(id);
        if (!s) throw Object.assign(new Error('No such subscription'), { code: 'resource_missing' });
        return clone(s);
      },
      cancel: async (id: string, params?: unknown) => {
        w.cancelCalls.push({ id, params });
        const s = w.subs.get(id)!;
        s.status = 'canceled';
        return clone(s);
      },
      update: async (id: string, params: Record<string, unknown>, opts?: { idempotencyKey?: string }) => {
        w.updateCalls.push({ id, params, opts });
        // Stripe replays the first answer for a repeated idempotency key and does nothing else.
        if (opts?.idempotencyKey && w.keys.has(opts.idempotencyKey)) {
          const prev = w.keys.get(opts.idempotencyKey);
          if (prev instanceof Error) throw prev;
          return prev;
        }
        const s = w.subs.get(id)!;
        const owes = params.proration_behavior === 'always_invoice';
        if (owes && params.payment_behavior === 'error_if_incomplete' && w.cardFails) {
          const err = Object.assign(new Error('Your card was declined.'), { type: 'StripeCardError', statusCode: 402, code: 'card_declined' });
          if (opts?.idempotencyKey) w.keys.set(opts.idempotencyKey, err);
          throw err; // subscription left exactly as it was
        }
        const item = (params.items as { id: string; price_data: { unit_amount: number; recurring: { interval: 'month' | 'year' } } }[])[0];
        w.pricesCreated++;
        s.items.data[0].price = { id: `price_${id}_${w.pricesCreated}`, unit_amount: item.price_data.unit_amount, recurring: item.price_data.recurring };
        s.metadata = params.metadata as Record<string, string>;
        const out = clone(s);
        if (opts?.idempotencyKey) w.keys.set(opts.idempotencyKey, out);
        return out;
      },
    },
  };
}

async function load() {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://holler.test');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
  vi.doMock('server-only', () => ({}));
  vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: w.getUser } }) }));
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminFake() }));
  const fake = stripeFake();
  vi.doMock('@/lib/stripe', async (orig) => ({ ...(await orig<typeof import('../../lib/stripe')>()), getStripe: () => fake }));
  return {
    change: (await import('../../app/api/stripe/change-plan/route')).POST,
    checkout: (await import('../../app/api/stripe/checkout/route')).POST,
    webhook: (await import('../../app/api/stripe/webhook/route')).POST,
  };
}

const CHANGE = 'http://x.test/api/stripe/change-plan';
const req = (url: string, body: unknown, contentType = 'application/json') =>
  new Request(url, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: contentType ? { 'content-type': contentType } : {} });
const hook = () => new Request('http://x.test/api/stripe/webhook', { method: 'POST', body: '{}', headers: { 'stripe-signature': 't=1,v1=x' } });
const subEvent = (type: string, id: string, status: string, tier: Tier) => ({ type, data: { object: { id, status, customer: 'cus_1', metadata: { ...HOLLER, tier } } } });
const stripeTier = (id: string) => w.subs.get(id)!.metadata.tier;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  w = {
    row: { user_id: 'user-1', plan: 'starter', subscription_status: 'active', stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', trial_ends_at: '2026-01-01T00:00:00Z', business_name: 'Ace' },
    failNextProfileWrite: false,
    subs: new Map([['sub_1', sub('sub_1', 'active', 'starter', 'annual')]]),
    cardFails: false,
    retrieveFails: false,
    limiter: 'allowed',
    keys: new Map(),
    updateCalls: [],
    pricesCreated: 0,
    cancelCalls: [],
    sessionCreate: vi.fn(async () => ({ url: 'https://checkout.stripe.test/s' })),
    construct: vi.fn(),
    getUser: vi.fn(async () => ({ data: { user: { id: 'user-1', email: 'a@x.com' } } })),
  };
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('P1-1: an upgrade is charged at once, or does not happen', () => {
  it('reviewer reproduction: Starter yearly to Pro charges now (always_invoice + error_if_incomplete); the profile moves to Pro', async () => {
    const { change } = await load();
    const res = await change(req(CHANGE, { tier: 'pro' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ tier: 'pro', plan: 'annual', changed: true, charged_now: true });
    expect(w.updateCalls[0].params).toMatchObject({ proration_behavior: 'always_invoice', payment_behavior: 'error_if_incomplete' });
    expect(stripeTier('sub_1')).toBe('pro');
    expect(w.row.plan).toBe('pro');
  });

  it('card declined: 402, Stripe and the profile both stay on Starter', async () => {
    w.cardFails = true;
    const { change } = await load();
    const res = await change(req(CHANGE, { tier: 'pro' }));
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: 'payment_failed' });
    expect(stripeTier('sub_1')).toBe('starter');
    expect(w.subs.get('sub_1')!.items.data[0].price.unit_amount).toBe(4800);
    expect(w.row.plan).toBe('starter');
    expect(effectiveTier(w.row as { plan: string; subscription_status: string })).toBe('starter');
  });

  it('monthly to yearly at a higher amount is an upgrade too (charged now)', async () => {
    w.subs.set('sub_1', sub('sub_1', 'active', 'starter', 'monthly'));
    const { change } = await load();
    expect((await change(req(CHANGE, { tier: 'starter', plan: 'annual' }))).status).toBe(200);
    expect(w.updateCalls[0].params).toMatchObject({ proration_behavior: 'always_invoice', payment_behavior: 'error_if_incomplete' });
  });

  it('a downgrade keeps create_prorations (a credit on the next bill) and needs no payment', async () => {
    w.subs.set('sub_1', sub('sub_1', 'active', 'pro', 'monthly'));
    w.row.plan = 'pro';
    w.cardFails = true;
    const { change } = await load();
    const res = await change(req(CHANGE, { tier: 'starter' }));
    expect(res.status).toBe(200);
    expect(w.updateCalls[0].params.proration_behavior).toBe('create_prorations');
    expect(w.updateCalls[0].params).not.toHaveProperty('payment_behavior');
    expect(w.row.plan).toBe('starter');
  });

  it('past_due cannot upgrade (409 payment_due, nothing sent to Stripe) but can still downgrade', async () => {
    w.subs.set('sub_1', sub('sub_1', 'past_due', 'starter', 'monthly'));
    w.row.subscription_status = 'past_due';
    const { change } = await load();
    const up = await change(req(CHANGE, { tier: 'pro' }));
    expect(up.status).toBe(409);
    expect(await up.json()).toEqual({ error: 'payment_due' });
    expect(w.updateCalls).toHaveLength(0);
    expect(w.row.plan).toBe('starter');
    w.subs.set('sub_1', sub('sub_1', 'past_due', 'pro', 'annual'));
    w.row.plan = 'pro';
    expect((await change(req(CHANGE, { tier: 'starter' }))).status).toBe(200);
    expect(w.updateCalls[0].params.proration_behavior).toBe('create_prorations');
  });

  it('every possible switch: upgrades (tier or price up) always invoice now, everything else only creates credits', () => {
    const all: { tier: Tier; plan: Plan }[] = [
      { tier: 'starter', plan: 'monthly' },
      { tier: 'starter', plan: 'annual' },
      { tier: 'pro', plan: 'monthly' },
      { tier: 'pro', plan: 'annual' },
    ];
    for (const from of all) {
      for (const to of all) {
        if (from.tier === to.tier && from.plan === to.plan) continue;
        const up = isUpgrade(from, to);
        const higher = to.tier === 'pro' && from.tier === 'starter' ? true : PRICES_CENTS[to.tier][to.plan] > PRICES_CENTS[from.tier][from.plan];
        expect(up, `${from.tier}/${from.plan} -> ${to.tier}/${to.plan}`).toBe(higher);
        expect(prorationFor(up)).toEqual(up ? { proration_behavior: 'always_invoice', payment_behavior: 'error_if_incomplete' } : { proration_behavior: 'create_prorations' });
      }
    }
    // Delete account cancels with Stripe's defaults (invoice_now false, prorate false), which drop pending prorations. Because no
    // upgrade leaves an amount pending any more, the only thing that can be dropped is a downgrade credit, never money owed to Holler.
    expect(isUpgrade({ tier: 'pro', plan: 'monthly' }, { tier: 'starter', plan: 'annual' })).toBe(true); // $9.99 -> $48
    expect(isUpgrade({ tier: 'starter', plan: 'annual' }, { tier: 'pro', plan: 'monthly' })).toBe(true); // tier up
  });
});

describe('P1-3: a failed re-fetch never lets a stale event win', () => {
  it('reviewer scenario: deleted(sub_1), then a stale updated(sub_1, active/pro) while retrieve fails: 500, row stays canceled', async () => {
    w.row = { ...w.row, plan: 'pro', subscription_status: 'active' };
    w.subs.set('sub_1', sub('sub_1', 'canceled', 'pro', 'monthly'));
    w.construct.mockResolvedValueOnce(subEvent('customer.subscription.deleted', 'sub_1', 'canceled', 'pro'));
    const { webhook } = await load();
    expect((await webhook(hook())).status).toBe(200);
    expect(w.row.subscription_status).toBe('canceled');

    w.retrieveFails = true;
    w.construct.mockResolvedValueOnce(subEvent('customer.subscription.updated', 'sub_1', 'active', 'pro'));
    const res = await webhook(hook());
    expect(res.status).toBe(500); // Stripe redelivers
    expect(w.row.subscription_status).toBe('canceled');
    expect(effectiveTier(w.row as { plan: string; subscription_status: string })).toBe('starter');

    // Stripe's redelivery once the API answers again converges on the truth.
    w.retrieveFails = false;
    w.construct.mockResolvedValueOnce(subEvent('customer.subscription.updated', 'sub_1', 'active', 'pro'));
    expect((await webhook(hook())).status).toBe(200);
    expect(w.row.subscription_status).toBe('canceled');
  });

  it('checkout.session.completed with a failed re-fetch is a 500 too, never an assumed active', async () => {
    w.row = { ...w.row, subscription_status: 'trialing', stripe_subscription_id: null };
    w.retrieveFails = true;
    w.construct.mockResolvedValueOnce({ type: 'checkout.session.completed', data: { object: { mode: 'subscription', client_reference_id: 'user-1', subscription: 'sub_1', customer: 'cus_1', metadata: { ...HOLLER, tier: 'pro' } } } });
    const { webhook } = await load();
    expect((await webhook(hook())).status).toBe(500);
    expect(w.row.subscription_status).toBe('trialing');
  });
});

describe('P2-1: a replayed checkout for an old subscription does not replace the live one', () => {
  const completed = (subId: string) => ({ type: 'checkout.session.completed', data: { object: { mode: 'subscription', client_reference_id: 'user-1', subscription: subId, customer: 'cus_1', metadata: { ...HOLLER, tier: 'pro' } } } });

  it('reviewer scenario: row active/starter/sub_NEW, replay of sub_OLD (canceled) leaves it alone; later events for sub_NEW still apply', async () => {
    w.row = { ...w.row, plan: 'starter', subscription_status: 'active', stripe_subscription_id: 'sub_NEW' };
    w.subs = new Map([
      ['sub_OLD', sub('sub_OLD', 'canceled', 'pro', 'monthly')],
      ['sub_NEW', sub('sub_NEW', 'active', 'starter', 'monthly')],
    ]);
    w.construct.mockResolvedValueOnce(completed('sub_OLD'));
    const { webhook } = await load();
    expect((await webhook(hook())).status).toBe(200);
    expect(w.row).toMatchObject({ subscription_status: 'active', plan: 'starter', stripe_subscription_id: 'sub_NEW' });

    w.subs.get('sub_NEW')!.metadata.tier = 'pro';
    w.construct.mockResolvedValueOnce(subEvent('customer.subscription.updated', 'sub_NEW', 'active', 'pro'));
    expect((await webhook(hook())).status).toBe(200);
    expect(w.row).toMatchObject({ subscription_status: 'active', plan: 'pro', stripe_subscription_id: 'sub_NEW' });
  });

  it('a new live checkout still replaces an old canceled one, and a first checkout still lands', async () => {
    w.row = { ...w.row, subscription_status: 'canceled', stripe_subscription_id: 'sub_OLD' };
    w.subs = new Map([['sub_NEW', sub('sub_NEW', 'active', 'pro', 'monthly')]]);
    w.construct.mockResolvedValueOnce(completed('sub_NEW'));
    const { webhook } = await load();
    await webhook(hook());
    expect(w.row).toMatchObject({ subscription_status: 'active', plan: 'pro', stripe_subscription_id: 'sub_NEW' });
  });
});

describe('P2-2 / P2-3: double clicks, rate limit, repair', () => {
  it('a double click sends the same idempotency key, so Stripe applies one switch and creates one price', async () => {
    const { change } = await load();
    const [a, b] = await Promise.all([change(req(CHANGE, { tier: 'pro' })), change(req(CHANGE, { tier: 'pro' }))]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(w.updateCalls).toHaveLength(2);
    expect(w.updateCalls[0].opts?.idempotencyKey).toBeTruthy();
    expect(w.updateCalls[1].opts?.idempotencyKey).toBe(w.updateCalls[0].opts?.idempotencyKey);
    expect(w.pricesCreated).toBe(1);
  });

  it('the key is stable inside the window and changes with the target, the current price or the next window', () => {
    const base = { userId: 'u', subscriptionId: 'sub_1', itemId: 'si_1', priceId: 'price_a', tier: 'pro' as Tier, plan: 'monthly' as Plan };
    const t = 1_800_000_000_000;
    expect(planChangeKey(base, t)).toBe(planChangeKey(base, t + 30_000));
    expect(planChangeKey(base, t)).not.toBe(planChangeKey({ ...base, tier: 'starter' }, t));
    expect(planChangeKey(base, t)).not.toBe(planChangeKey({ ...base, plan: 'annual' }, t));
    expect(planChangeKey(base, t)).not.toBe(planChangeKey({ ...base, priceId: 'price_b' }, t));
    expect(planChangeKey(base, t)).not.toBe(planChangeKey(base, t + 60_000));
    expect(planChangeKey(base, t).length).toBeLessThanOrEqual(255);
  });

  it('rate limited: 429 before Stripe is called; limiter down: 503', async () => {
    w.limiter = 'limited';
    const { change } = await load();
    expect((await change(req(CHANGE, { tier: 'pro' }))).status).toBe(429);
    w.limiter = 'error';
    expect((await change(req(CHANGE, { tier: 'pro' }))).status).toBe(503);
    expect(w.updateCalls).toHaveLength(0);
  });

  it('reviewer scenario: Stripe switched but the profile write failed; the second click repairs the row', async () => {
    w.failNextProfileWrite = true;
    const { change } = await load();
    const first = await change(req(CHANGE, { tier: 'pro' }));
    expect(first.status).toBe(200);
    expect(stripeTier('sub_1')).toBe('pro');
    expect(w.row.plan).toBe('starter'); // the write failed
    const second = await change(req(CHANGE, { tier: 'pro' }));
    expect(await second.json()).toMatchObject({ changed: false, repaired: true });
    expect(w.row.plan).toBe('pro');
    expect(w.updateCalls).toHaveLength(1); // the repair did not touch Stripe
  });

  it('the webhook also brings the row in line after a failed profile write', async () => {
    w.failNextProfileWrite = true;
    const { change, webhook } = await load();
    await change(req(CHANGE, { tier: 'pro' }));
    expect(w.row.plan).toBe('starter');
    w.construct.mockResolvedValueOnce(subEvent('customer.subscription.updated', 'sub_1', 'active', 'pro'));
    await webhook(hook());
    expect(w.row.plan).toBe('pro');
  });
});

describe('P2-4: state-changing billing routes need Content-Type: application/json (415 otherwise)', () => {
  const bad = ['text/plain', 'text/plain; application/json', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', ''];
  it('change-plan', async () => {
    const { change } = await load();
    for (const ct of bad) expect((await change(req(CHANGE, '{"tier":"pro"}', ct))).status, ct || '(none)').toBe(415);
    expect((await change(req(CHANGE, '{"tier":"pro"}', 'application/json; charset=utf-8'))).status).toBe(200);
    expect(w.updateCalls).toHaveLength(1);
  });
  it('checkout', async () => {
    w.row = { ...w.row, subscription_status: 'trialing', stripe_subscription_id: null };
    const { checkout } = await load();
    const url = 'http://x.test/api/stripe/checkout';
    for (const ct of bad) expect((await checkout(req(url, '{"tier":"pro"}', ct))).status, ct || '(none)').toBe(415);
    expect(w.sessionCreate).not.toHaveBeenCalled();
    expect((await checkout(req(url, '', 'application/json'))).status).toBe(200);
  });
});

describe('Owner decision: unpaid and paused are not paid', () => {
  it('maps unpaid and paused to canceled: no paid access, Starter limits, nothing deleted; past_due keeps access', async () => {
    for (const s of ['unpaid', 'paused']) {
      w.row = { ...w.row, plan: 'pro', subscription_status: 'active', extra_areas: [{ zip: '30601' }], keywords: ['tree removal'] };
      w.subs.set('sub_1', sub('sub_1', s, 'pro', 'monthly'));
      w.construct.mockResolvedValueOnce(subEvent('customer.subscription.updated', 'sub_1', s, 'pro'));
      const { webhook } = await load();
      expect((await webhook(hook())).status).toBe(200);
      expect(w.row.subscription_status).toBe('canceled');
      expect(w.row.plan).toBe('pro'); // saved, unused
      expect(w.row.keywords).toEqual(['tree removal']);
      expect(effectiveTier(w.row as { plan: string; subscription_status: string })).toBe('starter');
      expect(computeAccess({ subscription_status: w.row.subscription_status as string, trial_ends_at: '2026-01-01T00:00:00Z' }).locked).toBe(true);
    }
    expect(mapStripeStatus('past_due')).toBe('past_due');
    expect(computeAccess({ subscription_status: 'past_due', trial_ends_at: '2026-01-01T00:00:00Z' }).locked).toBe(false);
    expect(effectiveTier({ plan: 'pro', subscription_status: 'past_due' })).toBe('pro');
  });

  it('re-subscribing after unpaid closes the leftover Stripe subscription first, so there are never two', async () => {
    w.row = { ...w.row, subscription_status: 'canceled' };
    w.subs.set('sub_1', sub('sub_1', 'unpaid', 'starter', 'monthly'));
    const { checkout } = await load();
    expect((await checkout(req('http://x.test/api/stripe/checkout', { tier: 'pro' }))).status).toBe(200);
    expect(w.cancelCalls.map((c) => c.id)).toEqual(['sub_1']);
    expect(w.subs.get('sub_1')!.status).toBe('canceled');
    expect(w.sessionCreate).toHaveBeenCalledTimes(1);
  });

  it('a trial member who subscribes to Pro with a card gets Pro at once (kept)', () => {
    expect(mapStripeStatus('trialing')).toBe('active');
    expect(effectiveTier({ plan: 'pro', subscription_status: mapStripeStatus('trialing') })).toBe('pro');
  });
});
