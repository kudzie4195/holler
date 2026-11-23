// Round 18 integration: review 3 probe (logs/REV3-TRIAL-probe-tests) kept as a permanent regression test.
// REV3 probe 43: the SAME scenarios as probe 40, asserting the behaviour WITH R3-proposed-fix.patch applied. Fails at b99347a as committed.
// State for every test: the code is live and no trial migration is applied (a never-paid member still holds an old 14-day row).
// REAL: app/api/stripe/checkout/route.ts, app/api/m/{feed,alert,me}/route.ts, lib/lifecycle/run.ts, lib/auth/trial.ts, lib/lifecycle/store.ts.
// FAKE: Supabase (admin and member clients), the session, Stripe, the mobile feed readers. The fakes apply PostgREST filters at write time.
// Tests named FINDING assert the behaviour AS IT IS at b99347a; they fail once the defect is fixed.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-11-22T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

interface World {
  row: Record<string, any>;
  meta: Record<string, unknown>;
  ledger: { kind: string; sent_at: string }[];
  sessions: any[];
  calls: { getUser: number; select: number; update: number; updateHit: number; ledgerDelete: number; factory: number };
  /** Fails this many getUserById calls of the ADMIN client (one-off Auth admin error). */
  failGetUser: number;
  /** Fails this many profile UPDATEs (statement timeout). */
  failUpdate: number;
  /** Runs right after the n-th profile SELECT has taken its snapshot: a concurrent request that commits in between. */
  afterSelect?: (n: number, w: World) => void;
}

function adminOf(w: World): any {
  return {
    auth: { admin: {
      getUserById: async () => {
        w.calls.getUser++;
        if (w.failGetUser > 0) { w.failGetUser--; return { data: null, error: { message: 'upstream connect error (503)' } }; }
        return { data: { user: { id: 'u1', email: 'a@x.com', app_metadata: { ...w.meta } } }, error: null };
      },
      updateUserById: async (_id: string, p: any) => (Object.assign(w.meta, p.app_metadata), { error: null }),
    } },
    from: (table: string) => {
      if (table === 'holler_lifecycle_sends') {
        const d: any = { delete: () => d, eq: () => d, in: async (_k: string, kinds: string[]) => { w.calls.ledgerDelete++; w.ledger = w.ledger.filter((r) => !kinds.includes(r.kind)); return { error: null }; } };
        return d;
      }
      const q: any = {
        select: () => q, eq: () => q,
        maybeSingle: async () => { w.calls.select++; const snap = { ...w.row }; w.afterSelect?.(w.calls.select, w); return { data: snap, error: null }; },
        update: (patch: Record<string, unknown>) => {
          const tests: ((r: any) => boolean)[] = [];
          const u: any = {
            eq: (k: string, v: unknown) => (k !== 'user_id' && tests.push((r) => r[k] === v), u),
            is: (k: string, v: unknown) => (tests.push((r) => (r[k] ?? null) === v), u),
            lt: (k: string, v: string) => (tests.push((r) => Date.parse(r[k]) < Date.parse(v)), u),
            or: () => (tests.push((r) => r.plan_source == null || r.plan_source === 'none'), u),
            select: () => u,
            then: (res: (v: any) => void) => {
              w.calls.update++;
              if (w.failUpdate > 0) { w.failUpdate--; return res({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }); }
              const hit = tests.every((t) => t(w.row));
              if (hit) { Object.assign(w.row, patch); w.calls.updateHit++; }
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

const member = (startBackD: number, lenD: number, extra: Record<string, unknown> = {}): World => ({
  row: { user_id: 'u1', business_name: 'Ace', stripe_customer_id: 'cus_1', stripe_subscription_id: null, plan: 'starter', plan_source: 'none', subscription_status: 'trialing', email_verified_at: iso(NOW - startBackD * DAY), created_at: iso(NOW - startBackD * DAY), trial_ends_at: iso(NOW - startBackD * DAY + lenD * DAY), categories: ['roofing'], lat: 33.9, lon: -84.5, state: 'GA', radius_mi: 25, ...extra },
  meta: { holler_trial_started_at: iso(NOW - startBackD * DAY) },
  ledger: [{ kind: 'welcome', sent_at: iso(NOW - startBackD * DAY + 21 * HOUR) }],
  sessions: [],
  calls: { getUser: 0, select: 0, update: 0, updateHit: 0, ledgerDelete: 0, factory: 0 },
  failGetUser: 0,
  failUpdate: 0,
});

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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const m of ['@/lib/supabase/server', '@/lib/supabase/admin', '@/lib/auth/ratelimit', '@/lib/stripe', '@/lib/mobile/auth', '@/lib/mobile/feed', '@/lib/mobile/admin']) vi.doUnmock(m);
});

// ---- the lifecycle cron ------------------------------------------------------------------------------------------------------------
async function cronWorld(w: World) {
  const { runLifecycle } = await import('../../lib/lifecycle/run');
  const { repairTrialForCron, repairShortTrial } = await import('../../lib/auth/trial');
  const sent: { at: number; subject: string }[] = [];
  let clock = NOW;
  let onLoaded: (() => Promise<void>) | undefined;
  const store: any = {
    loadProfiles: async () => [{ ...w.row }],
    loadSends: async () => { const rows = w.ledger.map((r) => ({ user_id: 'u1', ...r })); await onLoaded?.(); return rows; },
    claim: async (_u: string, k: string) => (w.ledger.some((r) => r.kind === k) ? 'exists' : (w.ledger.push({ kind: k, sent_at: iso(clock) }), 'claimed')),
    release: async (_u: string, k: string) => { w.ledger = w.ledger.filter((r) => r.kind !== k); },
    isOptedOut: async () => false,
    emailOf: async () => 'a@x.com',
    trialStartedAt: async () => (w.meta.holler_trial_started_at as string) ?? null,
    matchesOf: async () => ({ items: [], total: 0, capped: false }),
    quietPreview: async () => null,
    missedSince: async () => ({ count: 0, capped: false }),
  };
  const admin = adminOf(w);
  const run = (at: number) => { clock = at; return runLifecycle({ store, send: async (i: any) => (sent.push({ at, subject: i.subject }), { ok: true, id: 'e' } as any), siteUrl: 'https://holler.test', secret: 's', now: new Date(at), clock: () => 0, repairTrial: (u, n) => repairTrialForCron(admin, u, n) }); };
  return { run, sent, admin, repairShortTrial, setOnLoaded: (f?: () => Promise<void>) => { onLoaded = f; } };
}

// ---- mobile readers -----------------------------------------------------------------------------------------------------------------
async function mobile(w: World) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://holler.test');
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  const ctx = () => ({ ok: true, ctx: { user: { id: 'u1', email: 'a@x.com', app_metadata: { ...w.meta } }, token: 't', db: {}, profile: { ...w.row } } });
  vi.doMock('@/lib/mobile/auth', () => ({ requireMember: async () => ctx() }));
  vi.doMock('@/lib/mobile/admin', () => ({ adminOrNull: () => null }));
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => (w.calls.factory++, adminOf(w)) }));
  vi.doMock('@/lib/mobile/feed', () => ({
    decodeCursor: () => null, encodeCursor: () => '',
    readFeedPage: async () => ({ rows: [], nextCursor: null, error: false }),
    readOneMatch: async () => ({ row: { id: 1 }, error: false }),
    buildAlerts: async (rows: any[], deps: any) => rows.map(() => ({ signalId: 7, masked: deps.locked })),
  }));
  const feed = (await import('../../app/api/m/feed/route')).GET;
  const alert = (await import('../../app/api/m/alert/[signalId]/route')).GET;
  const me = (await import('../../app/api/m/me/route')).GET;
  const req = (p: string) => new Request(`http://x.test${p}`, { headers: { authorization: 'Bearer a.b.c' } });
  return {
    feed: async () => (await feed(req('/api/m/feed'))).json(),
    alert: async () => (await alert(req('/api/m/alert/7'), { params: Promise.resolve({ signalId: '7' }) })).json(),
    me: async () => (await me(req('/api/m/me'))).json(),
  };
}


describe('AFTER FIX checkout', () => {
  it('a failed repair (Auth admin read, or the UPDATE): 503 and no Stripe session; the retry gets day 30', async () => {
    for (const how of ['auth', 'update'] as const) {
      const w = member(11, 14);
      if (how === 'auth') w.failGetUser = 1; else w.failUpdate = 1;
      const res = await checkoutFor(w);
      expect(res.status).toBe(503);
      expect(res.headers.get('retry-after')).toBe('5');
      expect(w.sessions).toHaveLength(0);
      const again = await checkoutFor(w);
      expect(again.status).toBe(200);
      expect(w.sessions[0].subscription_data.trial_end * 1000).toBe(NOW + 19 * DAY);
    }
  });
  it('an ended 14-day trial with a failed repair is not charged today', async () => {
    const e = member(20, 14); e.failGetUser = 1;
    expect((await checkoutFor(e)).status).toBe(503);
    expect(e.sessions).toHaveLength(0);
  });
  it('a concurrent repair wins (both shapes): Stripe gets the end the row holds, day 30', async () => {
    for (const n of [1, 2]) {
      const w = member(11, 14);
      w.afterSelect = (k, ww) => { if (k === n) ww.row.trial_ends_at = iso(NOW + 19 * DAY); };
      expect((await checkoutFor(w)).status).toBe(200);
      expect(w.sessions[0].subscription_data.trial_end * 1000).toBe(NOW + 19 * DAY);
      expect(w.sessions[0].subscription_data.trial_end * 1000).toBe(Date.parse(w.row.trial_ends_at));
    }
  });
  it('unchanged: a healthy row costs no extra call; a refused revival (start 58 days back) is charged now as before; a paying row is refused', async () => {
    const h = member(20, 30); await checkoutFor(h);
    expect(h.calls).toMatchObject({ getUser: 0, select: 1, update: 0 });
    const o = member(58, 14); expect((await checkoutFor(o)).status).toBe(200);
    expect(o.sessions[0].subscription_data.trial_end).toBeUndefined();
    const p = member(11, 14, { subscription_status: 'active', stripe_subscription_id: 'sub_1' });
    expect((await checkoutFor(p)).status).toBe(409);
  });
});

describe('AFTER FIX lifecycle cron', () => {
  it('the member signs in during the run: no email for the old end', async () => {
    const w = member(11, 14); const c = await cronWorld(w);
    c.setOnLoaded(async () => { await c.repairShortTrial({ id: 'u1', app_metadata: w.meta }, { ...w.row } as any, () => c.admin, new Date(NOW)); });
    const s = await c.run(NOW);
    expect(c.sent).toEqual([]);
    expect(s).toMatchObject({ skipped_trial_extended: 1 });
  });
  it('two overlapping runs: no email', async () => {
    const w = member(11, 14); const c = await cronWorld(w);
    await Promise.all([c.run(NOW), c.run(NOW)]);
    expect(c.sent).toEqual([]);
    expect(w.row.trial_ends_at).toBe(iso(NOW + 19 * DAY));
  });
  it('one failed repair: nothing is sent and no ledger row is taken; the next hourly run extends; the reminder comes once, 84 h before the new end', async () => {
    const w = member(11, 14); const c = await cronWorld(w);
    w.failGetUser = 3; // all three in-run tries
    const s1 = await c.run(NOW);
    expect(c.sent).toEqual([]);
    expect(w.ledger.map((r) => r.kind)).toEqual(['welcome']);
    expect(s1).toMatchObject({ failed: 3, skipped_trial_extended: 0 });
    const s2 = await c.run(NOW + HOUR);
    expect(s2).toMatchObject({ skipped_trial_extended: 1 });
    expect(w.row.trial_ends_at).toBe(iso(NOW + 19 * DAY));
    const newEnd = NOW + 19 * DAY;
    for (let h = 90; h >= 30; h--) await c.run(newEnd - h * HOUR);
    for (let h = 1; h <= 50; h++) await c.run(newEnd + h * HOUR);
    expect(c.sent.map((m) => m.subject)).toEqual(['Your trial ends in 3 days', 'Your alerts are paused']);
  });
  it('unchanged: a refused repair (the member subscribed, or a returning member) still sends as before; a healthy row never calls the hook', async () => {
    const w = member(27, 30); const c = await cronWorld(w);
    await c.run(NOW);
    expect(c.sent.map((m) => m.subject)).toEqual(['Your trial ends in 3 days']);
    expect(w.calls).toMatchObject({ getUser: 0, select: 0, update: 0 });
  });
});

describe('AFTER FIX mobile', () => {
  it('feed and alert first, or beside /me: never locked for a member with 40 days left; a healthy row builds no admin client', async () => {
    const w = member(20, 14); const m = await mobile(w);
    expect((await m.feed()).locked).toBe(false);
    const w2 = member(20, 14); const m2 = await mobile(w2);
    expect((await m2.alert()).locked).toBe(false);
    const w3 = member(20, 14); const m3 = await mobile(w3);
    const [f, a, who] = await Promise.all([m3.feed(), m3.alert(), m3.me()]);
    expect([f.locked, a.locked, who.access.state]).toEqual([false, false, 'trial']);
    const w4 = member(20, 30); const m4 = await mobile(w4);
    await m4.feed(); await m4.alert();
    expect(w4.calls.factory).toBe(0);
    const w5 = member(28, 14); const m5 = await mobile(w5); // 2 days of the trial left: not revived, still locked
    expect((await m5.feed()).locked).toBe(true);
  });
});
