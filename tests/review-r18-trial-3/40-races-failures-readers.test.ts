// REV3 probe 40 (r18 TRIAL, commit b99347a): the repair under failure and under concurrency, and the readers that have no repair.
// State for every test: the code is live and migration 0028 is NOT applied (a never-paid member still holds an old 14-day row).
// REAL: app/api/stripe/checkout/route.ts, app/api/m/{feed,alert,me}/route.ts, lib/lifecycle/run.ts, lib/auth/trial.ts, lib/lifecycle/store.ts.
// FAKE: Supabase (admin and member clients), the session, Stripe, the mobile feed readers. The fakes apply PostgREST filters at write time.
// Tests named FINDING assert the behaviour AS IT IS at b99347a; they fail once the defect is fixed.
// Round 18 integration: kept as a permanent test WITHOUT its FINDING tests (D1a, D1b, D2a, D2b, D3 and the parallel D3 case), which
// asserted the defects and fail once R3-proposed-fix.patch is applied; 43-after-fix.test.ts runs the same scenarios asserting the fix.
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

describe('REV3 checkout: what Stripe is given when the repair does not move the row itself', () => {
  it('control: day 11 of an old 14-day row, repair works: Stripe gets day 60', async () => {
    const w = member(11, 14);
    expect((await checkoutFor(w)).status).toBe(200);
    expect(w.sessions[0].subscription_data.trial_end * 1000).toBe(NOW + 49 * DAY);
  });



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

describe('REV3 lifecycle cron: the repair does not move the row itself', () => {
  it('control: day 11 (72 h left), repair works: no email, row at day 60', async () => {
    const w = member(11, 14);
    const c = await cronWorld(w);
    const s = await c.run(NOW);
    expect(c.sent).toEqual([]);
    expect(s).toMatchObject({ skipped_trial_extended: 1 });
    expect(w.row.trial_ends_at).toBe(iso(NOW + 49 * DAY));
  });



});

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


describe('REV3 cost when nothing needs repair', () => {
  it('a row already at start + 60 days: no admin client is built by GET /api/m/me, and the pure check makes no call', async () => {
    const w = member(20, 60);
    const m = await mobile(w);
    await m.me();
    expect(w.calls).toMatchObject({ factory: 0, getUser: 0, select: 0, update: 0, ledgerDelete: 0 });
  });

  it('checkout with a row already at start + 60 days: the repair adds no call (1 profile read by the route itself, no Auth admin call, no UPDATE)', async () => {
    const w = member(20, 60);
    await checkoutFor(w);
    expect(w.calls).toMatchObject({ getUser: 0, select: 1, update: 0, updateHit: 0, ledgerDelete: 0 });
  });

  it('the cron: the stamp read for the repair check shares the one Auth read the email address needs (1 getUserById per candidate, not 2)', async () => {
    const { createStore } = await import('../../lib/lifecycle/store');
    let n = 0;
    const s = createStore({ from: () => ({}) as any, auth: { admin: { getUserById: async () => (n++, { data: { user: { email: 'a@x.com', app_metadata: { holler_trial_started_at: iso(NOW) } } }, error: null }) } } } as any);
    expect(await s.trialStartedAt!('u1')).toBe(iso(NOW));
    expect(await s.emailOf('u1')).toBe('a@x.com');
    expect(n).toBe(1);
  });

  it('the cron with a member already at start + 60: the repair hook is not called at all', async () => {
    const w = member(57, 60); // 72 h left of the 60 days
    const c = await cronWorld(w);
    await c.run(NOW);
    expect(c.sent.map((m) => m.subject)).toEqual(['Your trial ends in 3 days']);
    expect(w.calls).toMatchObject({ getUser: 0, select: 0, update: 0 });
  });
});
