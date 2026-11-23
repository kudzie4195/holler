// Grandfathering: the round 7 price change (Solo 799 / 7999, Pro 1399 / 13999 cents) must never re-price an existing subscription.
// A member who signed up at the old prices (Solo 500 a month, Pro 999 a month) keeps that amount through every path this repo has:
// the webhook (every event type it handles), the plan switch when nothing changes (and its repair path), the billing portal and its
// return to Settings, checkout for someone already subscribed. Only a switch the member makes (another tier or another interval)
// moves the item, and then to today's price of the plan they move to.
// Stripe is a recording fake: every method call on it is logged by path, and the subscription item's amount is kept in memory, so a
// test can prove both "no write call was made" and "the amount did not change". Shapes are the ones our own routes read.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isUpgrade, PRICES_CENTS } from '@/lib/stripe/plans';

type Item = { id: string; price: { id: string; unit_amount: number; recurring: { interval: 'month' | 'year' } } };
type Sub = { id: string; status: string; customer: string; metadata: Record<string, string>; items: { data: Item[] } };

interface World {
  sub: Sub;
  row: Record<string, unknown>;
  calls: string[];
  profileWrites: Record<string, unknown>[];
  event: unknown;
}
let w: World;

const HOLLER = { app: 'holler', user_id: 'user-1' };
const OLD_SOLO_MONTHLY = 500; // what a member who subscribed before round 7 pays
const OLD_PRO_MONTHLY = 999;

function legacySub(tier: 'starter' | 'pro', interval: 'month' | 'year', cents: number, status = 'active'): Sub {
  return {
    id: 'sub_old',
    status,
    customer: 'cus_1',
    metadata: { ...HOLLER, tier, plan: interval === 'year' ? 'annual' : 'monthly' },
    items: { data: [{ id: 'si_old', price: { id: 'price_legacy', unit_amount: cents, recurring: { interval } } }] },
  };
}

/** Logs every call by its path ("subscriptions.update") and forwards to the handlers below. */
function recorder<T extends object>(target: T, prefix = ''): T {
  return new Proxy(target, {
    get(t, key: string) {
      const v = (t as Record<string, unknown>)[key];
      const name = prefix ? `${prefix}.${key}` : key;
      if (typeof v === 'function') {
        return (...args: unknown[]) => {
          w.calls.push(name);
          return (v as (...a: unknown[]) => unknown)(...args);
        };
      }
      if (v && typeof v === 'object') return recorder(v as object, name);
      return v;
    },
  });
}

function stripeFake() {
  const clone = () => JSON.parse(JSON.stringify(w.sub)) as Sub;
  return recorder({
    webhooks: { constructEventAsync: async () => w.event },
    customers: { create: async () => ({ id: 'cus_new' }) },
    checkout: { sessions: { create: async () => ({ url: 'https://checkout.stripe.test/s' }) } },
    billingPortal: { sessions: { create: async (p: { customer: string; return_url: string }) => ({ url: `https://portal.stripe.test/${p.customer}` }) } },
    products: {
      retrieve: async (id: string) => ({ id, active: true, name: id === 'holler_pro' ? 'Holler Pro' : 'Holler Solo', metadata: { app: 'holler' } }),
      create: async (p: { id: string }) => ({ id: p.id }),
      update: async (id: string) => ({ id }),
    },
    subscriptions: {
      retrieve: async (id: string) => {
        if (id !== w.sub.id) throw Object.assign(new Error('No such subscription'), { code: 'resource_missing' });
        return clone();
      },
      cancel: async () => clone(),
      update: async (id: string, params: { items: { id: string; price_data: { unit_amount: number; recurring: { interval: 'month' | 'year' } } }[]; metadata: Record<string, string> }) => {
        const pd = params.items[0].price_data;
        w.sub.items.data[0].price = { id: 'price_new', unit_amount: pd.unit_amount, recurring: pd.recurring };
        w.sub.metadata = params.metadata;
        return { ...clone(), id };
      },
    },
  });
}

function adminFake() {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ...w.row }, error: null }) }) }),
      update: (patch: Record<string, unknown>) => {
        w.profileWrites.push(patch);
        const done = () => {
          Object.assign(w.row, patch);
          return Promise.resolve({ error: null });
        };
        const chain: Record<string, unknown> = {};
        chain.eq = () => Object.assign(done(), chain);
        chain.or = () => Object.assign(done(), chain);
        return Object.assign(done(), chain);
      },
    }),
  };
}

async function load() {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://holler.test');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
  vi.doMock('server-only', () => ({}));
  vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: 'a@x.com' } } }) } }) }));
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminFake() }));
  vi.doMock('@/lib/auth/ratelimit', () => ({ hit: async () => 'allowed' }));
  const fake = stripeFake();
  vi.doMock('@/lib/stripe', async (orig) => ({ ...(await orig<typeof import('../../lib/stripe')>()), getStripe: () => fake }));
  return {
    webhook: (await import('../../app/api/stripe/webhook/route')).POST,
    change: (await import('../../app/api/stripe/change-plan/route')).POST,
    portal: (await import('../../app/api/stripe/portal/route')).POST,
    checkout: (await import('../../app/api/stripe/checkout/route')).POST,
  };
}

const json = (url: string, body: unknown) => new Request(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const hook = () => new Request('http://x.test/api/stripe/webhook', { method: 'POST', body: '{}', headers: { 'stripe-signature': 't=1,v1=x' } });
const CHANGE = 'http://x.test/api/stripe/change-plan';
/** Stripe calls that can change what a member pays. None of them may appear unless the member switched plan or interval. */
const PRICE_WRITES = /^(subscriptions\.(update|create)|subscriptionItems\.|prices\.|invoiceItems\.|subscriptionSchedules\.)/;
const amount = () => w.sub.items.data[0].price.unit_amount;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  w = {
    sub: legacySub('starter', 'month', OLD_SOLO_MONTHLY),
    row: { user_id: 'user-1', plan: 'starter', subscription_status: 'active', stripe_subscription_id: 'sub_old', stripe_customer_id: 'cus_1', trial_ends_at: '2026-01-01T00:00:00Z' },
    calls: [],
    profileWrites: [],
    event: null,
  };
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the new table really is different from what legacy members pay', () => {
  it('Solo monthly 799 and Pro monthly 1399 now; the legacy fixtures pay 500 and 999', () => {
    expect(PRICES_CENTS.starter.monthly).toBe(799);
    expect(PRICES_CENTS.pro.monthly).toBe(1399);
    expect(OLD_SOLO_MONTHLY).not.toBe(PRICES_CENTS.starter.monthly);
    expect(OLD_PRO_MONTHLY).not.toBe(PRICES_CENTS.pro.monthly);
  });
});

describe('webhook: reads Stripe, writes only holler_profiles, never re-prices', () => {
  const events: [string, () => unknown][] = [
    ['checkout.session.completed', () => ({ mode: 'subscription', client_reference_id: 'user-1', subscription: 'sub_old', customer: 'cus_1', metadata: { ...HOLLER, tier: 'starter' } })],
    ['customer.subscription.created', () => JSON.parse(JSON.stringify(w.sub))],
    ['customer.subscription.updated', () => JSON.parse(JSON.stringify(w.sub))],
    ['customer.subscription.deleted', () => ({ ...JSON.parse(JSON.stringify(w.sub)), status: 'canceled' })],
    ['invoice.paid', () => ({ id: 'in_1', subscription: 'sub_old', customer: 'cus_1' })],
    ['invoice.upcoming', () => ({ subscription: 'sub_old', customer: 'cus_1' })],
  ];
  for (const [type, object] of events) {
    it(`${type}: no price write, the item keeps 500 cents`, async () => {
      w.event = { type, data: { object: object() } };
      const { webhook } = await load();
      expect((await webhook(hook())).status).toBe(200);
      expect(w.calls.filter((c) => PRICE_WRITES.test(c))).toEqual([]);
      expect(w.calls.every((c) => c === 'webhooks.constructEventAsync' || c === 'subscriptions.retrieve')).toBe(true);
      expect(amount()).toBe(OLD_SOLO_MONTHLY);
      for (const p of w.profileWrites) for (const k of Object.keys(p)) expect(['subscription_status', 'plan', 'stripe_customer_id', 'stripe_subscription_id', 'updated_at']).toContain(k);
    });
  }
});

describe('plan switch: no change means no Stripe write', () => {
  it('same tier, interval omitted: changed false, no update, amount stays 500', async () => {
    const { change } = await load();
    const res = await change(json(CHANGE, { tier: 'starter' }));
    expect(await res.json()).toMatchObject({ changed: false });
    expect(w.calls.filter((c) => PRICE_WRITES.test(c))).toEqual([]);
    expect(amount()).toBe(OLD_SOLO_MONTHLY);
  });
  it('same tier, same interval named explicitly: same answer', async () => {
    const { change } = await load();
    await change(json(CHANGE, { tier: 'starter', plan: 'monthly' }));
    expect(w.calls.filter((c) => PRICE_WRITES.test(c))).toEqual([]);
    expect(amount()).toBe(OLD_SOLO_MONTHLY);
  });
  it('the repair path (profile out of line with Stripe) fixes the row only, never the price', async () => {
    w.row.plan = 'pro'; // stale row: Stripe says starter
    const { change } = await load();
    expect(await (await change(json(CHANGE, { tier: 'starter' }))).json()).toMatchObject({ changed: false, repaired: true });
    expect(w.row.plan).toBe('starter');
    expect(w.calls.filter((c) => PRICE_WRITES.test(c))).toEqual([]);
    expect(amount()).toBe(OLD_SOLO_MONTHLY);
  });
  it('a legacy Pro member (999) who asks for Pro again keeps 999', async () => {
    w.sub = legacySub('pro', 'month', OLD_PRO_MONTHLY);
    w.row.plan = 'pro';
    const { change } = await load();
    await change(json(CHANGE, { tier: 'pro' }));
    expect(w.calls.filter((c) => PRICE_WRITES.test(c))).toEqual([]);
    expect(amount()).toBe(OLD_PRO_MONTHLY);
  });
});

describe('plan switch the member asks for: today\'s price of the plan they move to', () => {
  it('legacy Solo 500 monthly to Pro: 1399 (current Pro monthly), charged now', async () => {
    const { change } = await load();
    expect(await (await change(json(CHANGE, { tier: 'pro' }))).json()).toMatchObject({ tier: 'pro', plan: 'monthly', changed: true, charged_now: true });
    expect(w.calls.filter((c) => c === 'subscriptions.update')).toHaveLength(1);
    expect(amount()).toBe(PRICES_CENTS.pro.monthly);
  });
  it('legacy Solo 500 monthly to Solo yearly: 7999 (current Solo yearly)', async () => {
    const { change } = await load();
    await change(json(CHANGE, { tier: 'starter', plan: 'annual' }));
    expect(amount()).toBe(PRICES_CENTS.starter.annual);
    expect(w.sub.items.data[0].price.recurring.interval).toBe('year');
  });
  it('legacy Pro 999 monthly down to Solo monthly: 799 (current Solo), a downgrade by what they pay now', async () => {
    w.sub = legacySub('pro', 'month', OLD_PRO_MONTHLY);
    w.row.plan = 'pro';
    const { change } = await load();
    expect(await (await change(json(CHANGE, { tier: 'starter' }))).json()).toMatchObject({ tier: 'starter', changed: true, charged_now: false });
    expect(amount()).toBe(PRICES_CENTS.starter.monthly);
  });
});

describe('isUpgrade judges a legacy member on what they pay now', () => {
  it('a member paying less than the new target is charged the difference now, even on a lower tier move', () => {
    // Hypothetical legacy Pro at 500 a month moving to Solo monthly (799): the price goes up for them, so it is an upgrade.
    expect(isUpgrade({ tier: 'pro', plan: 'monthly', cents: 500 }, { tier: 'starter', plan: 'monthly' })).toBe(true);
    // Without the paid amount the table decides (1399 to 799: down).
    expect(isUpgrade({ tier: 'pro', plan: 'monthly' }, { tier: 'starter', plan: 'monthly' })).toBe(false);
    expect(isUpgrade({ tier: 'pro', plan: 'monthly', cents: null }, { tier: 'starter', plan: 'monthly' })).toBe(false);
  });
  it('with the real old prices every switch classifies the same as on the new table', () => {
    const OLD = { starter: { monthly: 500, annual: 4800 }, pro: { monthly: 999, annual: 9600 } } as const;
    const all = [['starter', 'monthly'], ['starter', 'annual'], ['pro', 'monthly'], ['pro', 'annual']] as const;
    for (const [ft, fp] of all) {
      for (const [tt, tp] of all) {
        if (ft === tt && fp === tp) continue;
        expect(isUpgrade({ tier: ft, plan: fp, cents: OLD[ft][fp] }, { tier: tt, plan: tp }), `${ft}/${fp} -> ${tt}/${tp}`).toBe(isUpgrade({ tier: ft, plan: fp }, { tier: tt, plan: tp }));
      }
    }
  });
});

describe('billing portal and checkout', () => {
  it('portal: one session create, return to Settings, nothing else', async () => {
    const { portal } = await load();
    const res = await portal(new Request('https://localholler.com/api/stripe/portal', { method: 'POST' }));
    expect(res.status).toBe(200);
    expect(w.calls).toEqual(['billingPortal.sessions.create']);
    expect(amount()).toBe(OLD_SOLO_MONTHLY);
  });
  it('checkout for a member who already pays: 409, no session, no price write', async () => {
    const { checkout } = await load();
    expect((await checkout(json('http://x.test/api/stripe/checkout', { tier: 'pro' }))).status).toBe(409);
    expect(w.calls).toEqual([]);
    expect(amount()).toBe(OLD_SOLO_MONTHLY);
  });
});

describe('no other code path can push a price onto a subscription', () => {
  const root = path.resolve(__dirname, '../..');
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n);
      if (n === 'node_modules' || n.startsWith('.')) return [];
      return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|mjs|js)$/.test(n) ? [p] : [];
    });
  }
  const src = ['app', 'lib', 'components', 'scripts', 'supabase'].flatMap((d) => {
    try {
      return files(path.join(root, d));
    } catch {
      return [];
    }
  });

  /** Source with comments removed, so a doc comment that names a call is not counted as the call. */
  const code = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

  it('subscriptions.update is called in exactly one file: the member plan switch', () => {
    const hits = src.filter((f) => /subscriptions\s*\.\s*update\s*\(/.test(code(f))).map((f) => path.relative(root, f));
    expect(hits).toEqual([path.join('app', 'api', 'stripe', 'change-plan', 'route.ts')]);
  });
  it('nothing creates or edits prices, subscription items, schedules or invoice items', () => {
    const bad = /(subscriptionItems|subscriptionSchedules|invoiceItems)\s*\.|prices\s*\.\s*(create|update)\s*\(/;
    const hits = src.filter((f) => bad.test(code(f))).map((f) => path.relative(root, f));
    expect(hits).toEqual([]);
  });
  it('the Settings page the portal returns to has no Stripe write and no sync', () => {
    const dir = path.join(root, 'app', 'app', 'settings');
    for (const f of files(dir)) {
      const s = code(f);
      expect(s, f).not.toMatch(/subscriptions\s*\.\s*update|prices\s*\.|subscriptionItems/);
    }
  });
});
