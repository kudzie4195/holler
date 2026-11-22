// Review r2 R1 + R4 (r18 TRIAL): code live, migration 0028 NOT applied. A member on day 11 of an old 14-day row clicks the trial email's
// button (/app/settings#billing-h) and subscribes WITHOUT ever opening /app. POST /api/stripe/checkout must give Stripe a trial that ends
// on day 60 (start + TRIAL_DAYS, as stored in the row by the repair), not day 14. The route runs for real; Supabase, the session and
// Stripe are in-memory fakes that apply the PostgREST filters at write time (assumed shapes, from our own call sites).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-22T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

interface World {
  row: Record<string, any>;
  meta: Record<string, unknown>;
  ledger: string[];
  sessions: any[];
  writes: number;
}

function adminOf(w: World): any {
  return {
    auth: { admin: {
      getUserById: async () => ({ data: { user: { id: 'u1', app_metadata: { ...w.meta } } }, error: null }),
      updateUserById: async (_id: string, p: any) => (Object.assign(w.meta, p.app_metadata), { error: null }),
    } },
    from: (table: string) => {
      if (table === 'holler_lifecycle_sends') {
        const d: any = { delete: () => d, eq: () => d, in: async (_k: string, kinds: string[]) => ((w.ledger = w.ledger.filter((k) => !kinds.includes(k))), { error: null }) };
        return d;
      }
      const q: any = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: { ...w.row }, error: null }),
        update: (patch: Record<string, unknown>) => {
          const tests: ((r: any) => boolean)[] = [];
          const u: any = {
            eq: (k: string, v: unknown) => (k !== 'user_id' && tests.push((r) => r[k] === v), u),
            is: (k: string, v: unknown) => (tests.push((r) => (r[k] ?? null) === v), u),
            lt: (k: string, v: string) => (tests.push((r) => Date.parse(r[k]) < Date.parse(v)), u),
            or: () => (tests.push((r) => r.plan_source == null || r.plan_source === 'none'), u),
            select: () => u,
            then: (res: (v: any) => void) => {
              const hit = tests.every((t) => t(w.row));
              if (hit) { Object.assign(w.row, patch); w.writes++; }
              res({ error: null, data: hit ? [{ user_id: 'u1', trial_ends_at: w.row.trial_ends_at }] : [] });
            },
          };
          return u;
        },
      };
      return q;
    },
  };
}

async function checkoutFor(w: World) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://holler.test');
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'a@x.com', app_metadata: { ...w.meta } } } }) } }) }));
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminOf(w) }));
  vi.doMock('@/lib/auth/ratelimit', () => ({ hit: async () => 'allowed' }));
  vi.doMock('@/lib/stripe', async (orig) => {
    const actual = await orig<typeof import('../../lib/stripe')>();
    return {
      ...actual,
      getStripe: () => ({
        customers: { create: async () => ({ id: 'cus_1' }) },
        checkout: { sessions: { create: async (p: any) => (w.sessions.push(p), { url: 'https://checkout.stripe.test/s' }) } },
        subscriptions: { retrieve: async () => null },
        products: { retrieve: async (id: string) => ({ id, active: true, name: 'Holler Solo', metadata: { app: 'holler' } }), create: vi.fn(), update: vi.fn() },
      }),
    };
  });
  const { POST } = await import('../../app/api/stripe/checkout/route');
  return POST(new Request('http://x.test/api/stripe/checkout', { method: 'POST', body: '', headers: { 'content-type': 'application/json' } }));
}

const member = (startBackD: number, lenD: number, extra: Record<string, unknown> = {}): World => ({
  row: { user_id: 'u1', business_name: 'Ace', stripe_customer_id: 'cus_1', stripe_subscription_id: null, plan: 'starter', plan_source: 'none', subscription_status: 'trialing', created_at: iso(NOW - startBackD * DAY), trial_ends_at: iso(NOW - startBackD * DAY + lenD * DAY), ...extra },
  meta: { holler_trial_started_at: iso(NOW - startBackD * DAY) },
  ledger: ['welcome', 'trial_ending'],
  sessions: [],
  writes: 0,
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const m of ['@/lib/supabase/server', '@/lib/supabase/admin', '@/lib/auth/ratelimit', '@/lib/stripe']) vi.doUnmock(m);
});

describe('R1: subscribing from Settings before 0028, without opening /app', () => {
  it('day 11 of an old 14-day row: Stripe gets trial_end = day 60 (start + 60), the value the row now holds, not day 14', async () => {
    const w = member(11, 14);
    const res = await checkoutFor(w);
    expect(res.status).toBe(200);
    const start = NOW - 11 * DAY;
    expect(w.row.trial_ends_at).toBe(iso(start + 60 * DAY)); // the repair moved the stored row first
    expect(w.sessions).toHaveLength(1);
    const trialEnd = w.sessions[0].subscription_data.trial_end;
    expect(trialEnd * 1000).toBe(start + 60 * DAY); // day 60
    expect(trialEnd * 1000).not.toBe(start + 14 * DAY); // not day 14
    expect(trialEnd * 1000).toBe(Date.parse(w.row.trial_ends_at)); // R4: only a stored value reaches Stripe
    expect(w.ledger).toEqual(['welcome']); // the reminder can go again for the new end
  });

  it('a 14-day trial that ended 6 days ago (start 20 days back): Stripe gets a trial to day 60, not a charge today', async () => {
    const w = member(20, 14);
    const res = await checkoutFor(w);
    expect(res.status).toBe(200);
    expect(w.sessions[0].subscription_data.trial_end * 1000).toBe(NOW - 20 * DAY + 60 * DAY);
  });

  it('never more than the stored row: a member already at start + 60 is passed through unchanged, with no write', async () => {
    const w = member(5, 60);
    await checkoutFor(w);
    expect(w.writes).toBe(0);
    expect(w.sessions[0].subscription_data.trial_end * 1000).toBe(NOW + 55 * DAY);
  });

  it('a start 58 days back whose 14-day trial ended (2 days would be left): not revived, charged now, as before', async () => {
    const w = member(58, 14);
    await checkoutFor(w);
    expect(w.writes).toBe(0);
    expect(w.sessions[0].subscription_data.trial_end).toBeUndefined();
    expect(w.sessions[0].subscription_data.trial_period_days).toBeUndefined();
  });

  it('R4: if the member subscribed elsewhere between the read and the write, nothing moved and Stripe gets the stored end (here: the row is paid, checkout refuses)', async () => {
    const w = member(11, 14, { subscription_status: 'active', stripe_subscription_id: 'sub_1' });
    const res = await checkoutFor(w);
    expect(res.status).toBe(409);
    expect(w.writes).toBe(0);
    expect(w.row.trial_ends_at).toBe(iso(NOW - 11 * DAY + 14 * DAY));
  });
});

describe('R1: every reader of the trial end that shows billing or charges runs the repair first', () => {
  const src = (f: string) => readFileSync(f, 'utf8');
  it('Settings, Checkout, /app, GET /api/m/me, PATCH /api/m/profile and the lifecycle cron', () => {
    const settings = src('app/app/settings/page.tsx');
    expect(settings.indexOf('repairShortTrial(user, loaded')).toBeGreaterThan(0);
    expect(settings.indexOf('repairShortTrial(user, loaded')).toBeLessThan(settings.indexOf('computeAccess(profile)'));
    const checkout = src('app/api/stripe/checkout/route.ts');
    expect(checkout.indexOf('repairShortTrialChecked(user')).toBeGreaterThan(0);
    expect(checkout.indexOf('repairShortTrialChecked(user')).toBeLessThan(checkout.indexOf('trialParams(trialEnd)'));
    expect(checkout).not.toContain('trialParams(profile.trial_ends_at');
    const app = src('app/app/page.tsx');
    expect(app.indexOf('repairShortTrial(user')).toBeLessThan(app.indexOf('computeAccess(profile, now)'));
    expect(src('app/api/m/me/route.ts')).toContain('repairShortTrial(m.ctx.user');
    expect(src('app/api/m/profile/route.ts')).toContain('repairShortTrial(user');
    expect(src('app/api/cron/lifecycle/route.ts')).toContain('repairTrial: (userId, now) => repairTrialForCron(admin, userId, now)');
    // the trial emails' button still goes to Settings, which now repairs first
    expect(src('lib/lifecycle/run.ts')).toContain('plansUrl: `${base}/app/settings#billing-h`');
  });
});
