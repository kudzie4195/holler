// Review r3 P2 (plan-limited trades): the notify digest and the lifecycle "best 3" ask notesFor / scoresFor for the trades the plan
// lets matching use (matchScope(profile).categories), not every saved trade. Harness copied from round7-notify-merge.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchScope } from '@/lib/plan/scope';

const NOW = Date.parse('2026-11-19T12:00:00.000Z');
const H = 3_600_000;
const UID = '11111111-1111-4111-8111-111111111111';

type Op = { op: string; args: unknown[] };
interface World {
  profile?: Record<string, unknown>;
  migrated: boolean;
  lastNotified: string | null;
  ai: { signal_id: number; trades: Record<string, number>; notes: Record<string, string> }[];
  calls: { table: string; ops: Op[] }[];
  /** A database without migration 0020: a select naming plan_source fails like PostgREST does. */
  no0020?: boolean;
  matches?: unknown[];
}

// Titles name damage, hail or a tornado so all three are Act Now (a bare "wind report" is Coming soon): this test is about the AI ranking, not the label order.
const sig = (id: number, title: string, hoursAgo: number, severity = 1) => ({
  id,
  source: 'spc',
  external_id: `x${id}`,
  expires_at: null,
  kind: 'report',
  title,
  url: null,
  city: 'Smyrna',
  state: 'GA',
  occurred_at: new Date(NOW - hoursAgo * H).toISOString(),
  severity,
  subtype: null,
});
// Newest match first, as the route reads them.
const MATCHES = [
  { id: 101, user_id: UID, created_at: new Date(NOW - 1 * H).toISOString(), signal: sig(1, 'Wind damage reported near Smyrna', 2) },
  { id: 102, user_id: UID, created_at: new Date(NOW - 2 * H).toISOString(), signal: sig(2, 'Tornado warning for Cobb County', 30, 3) },
  { id: 103, user_id: UID, created_at: new Date(NOW - 3 * H).toISOString(), signal: sig(3, 'Hail report near Marietta', 40) },
];

const missing = (t: string) => ({ data: null, error: { code: '42P01', message: `relation "public.${t}" does not exist` } });

function fakeAdmin(w: World) {
  return {
    from(table: string) {
      const ops: Op[] = [];
      w.calls.push({ table, ops });
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'range', 'in', 'is', 'update', 'insert', 'limit']) {
        q[m] = (...args: unknown[]) => (ops.push({ op: m, args }), q);
      }
      const result = () => {
        const has = (o: string) => ops.some((x) => x.op === o);
        if (table === 'holler_matches') return has('update') ? { error: null } : { data: w.matches ?? MATCHES, error: null };
        if (table === 'holler_profiles') {
          if (has('update')) return { error: null };
          const cols = String(ops.find((x) => x.op === 'select')?.args[0] ?? '');
          if (w.no0020 && /plan_source/.test(cols)) return { data: null, error: { code: '42703', message: 'column holler_profiles.plan_source does not exist' } };
          return {
            data: [
              {
                user_id: UID,
                business_name: 'Peachtree Roofing',
                categories: ['roofing'],
                alert_email: true,
                subscription_status: 'active',
                trial_ends_at: null,
                last_notified_at: w.lastNotified,
                email_verified_at: '2026-11-01T00:00:00Z',
                created_at: '2026-11-01T00:00:00Z',
                ...w.profile,
              },
            ],
            error: null,
          };
        }
        if (table === 'holler_signal_ai') {
          if (!w.migrated) return missing(table);
          const ids = (ops.find((x) => x.op === 'in')?.args[1] ?? []) as number[];
          return { data: w.ai.filter((r) => ids.includes(r.signal_id)), error: null };
        }
        if (table === 'holler_alert_log' || table === 'holler_events') return w.migrated ? { data: [], error: null } : missing(table);
        return { data: [], error: null };
      };
      q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
      return q;
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'owner@peachtree.test' } }, error: null }) } },
  };
}

async function runNotify(w: World) {
  vi.resetModules();
  vi.stubEnv('CRON_SECRET', 's3cret');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const sent: { subject: string; html: string; text: string }[] = [];
  vi.doMock('server-only', () => ({}));
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => fakeAdmin(w) }));
  vi.doMock('@/lib/outreach/loader', async (orig) => ({
    ...(await orig<typeof import('@/lib/outreach/loader')>()),
    loadMemberContacts: async () => new Map(),
  }));
  vi.doMock('@/lib/email', async (orig) => ({
    ...(await orig<typeof import('@/lib/email')>()),
    sendEmail: async (m: { subject: string; html: string; text: string }) => (sent.push(m), { ok: true as const, id: 'e1' }),
  }));
  const { GET } = await import('@/app/api/cron/notify/route');
  const res = await GET(new Request('https://holler.test/api/cron/notify', { headers: { authorization: 'Bearer s3cret' } }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, sent };
}

const order = (text: string) =>
  ['Wind damage reported near Smyrna', 'Tornado warning for Cobb County', 'Hail report near Marietta'].map((t) => [t, text.indexOf(t)] as const).sort((a, b) => a[1] - b[1]).map((x) => x[0]);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  for (const m of ['@/lib/supabase/admin', '@/lib/outreach/loader', '@/lib/email', 'server-only', '@/lib/lifecycle', '@/lib/ai', '@/lib/env']) vi.doUnmock(m);
});

// Six saved trades; Solo uses the first 5, so roofing (the 6th) is saved but not matched.
const SIX = ['plumbing', 'hvac', 'electrical', 'painting', 'pest-control', 'roofing'];
const AI = [{ signal_id: 3, trades: { roofing: 0.95 }, notes: { roofing: 'A roof inspection may follow this hail report.' } }];

describe('notify digest: notes and ranking use the plan-limited trades', () => {
  it('Solo with a 6th saved trade: no note and no ranking for that trade', async () => {
    expect(matchScope({ categories: SIX, lat: null, lon: null, state: null, plan: 'starter', subscription_status: 'active' }).categories).not.toContain('roofing');
    const w: World = { migrated: true, lastNotified: null, ai: AI, calls: [], profile: { categories: SIX, plan: 'starter' } };
    const r = await runNotify(w);
    expect(r.body).toMatchObject({ emailed: 1 });
    expect(r.sent[0].text).not.toContain('A roof inspection may follow');
    // the hail record was classified with none of the plan's trades: it scores 0 and goes last
    expect(order(r.sent[0].text)[2]).toBe('Hail report near Marietta');
  });

  it('Pro with the same trades: the note shows and ranks first', async () => {
    const w: World = { migrated: true, lastNotified: null, ai: AI, calls: [], profile: { categories: SIX, plan: 'pro' } };
    const r = await runNotify(w);
    expect(r.sent[0].text).toContain('Why it may matter: A roof inspection may follow this hail report.');
    expect(order(r.sent[0].text)[0]).toBe('Hail report near Marietta');
  });
});

// Integrate3: the cross-file patches from fix-a (Cobb line), fix-b (store columns, fail soft) and fix-c (plan in the select).
describe('notify digest: integrate3 patches', () => {
  const profileSelects = (w: World) =>
    w.calls.filter((c) => c.table === 'holler_profiles' && !c.ops.some((o) => o.op === 'update')).map((c) => String(c.ops.find((o) => o.op === 'select')?.args[0]));
  it('reads plan and the 0020 store columns in one select', async () => {
    const w: World = { migrated: true, lastNotified: null, ai: [], calls: [] };
    await runNotify(w);
    const [cols] = profileSelects(w);
    for (const c of ['plan', 'plan_source', 'store_expires_at', 'categories']) expect(cols.split(', ')).toContain(c);
  });
  it('before 0020 the read retries without the store columns and still emails', async () => {
    const w: World = { migrated: true, lastNotified: null, ai: [], calls: [], no0020: true };
    const r = await runNotify(w);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ emailed: 1 });
    const sel = profileSelects(w);
    expect(sel).toHaveLength(2);
    expect(sel[1]).not.toContain('plan_source');
    expect(sel[1].split(', ')).toContain('plan');
  });
  it('an App Store plan with no readable expiry after the trial is not emailed (isPaidNow)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const w: World = { migrated: true, lastNotified: null, ai: [], calls: [], profile: { plan_source: 'apple', store_expires_at: null, trial_ends_at: '2026-11-01T00:00:00Z' } };
    const r = await runNotify(w);
    expect(r.body).toMatchObject({ emailed: 0, skipped_not_entitled: 1 });
    vi.restoreAllMocks();
  });
  it('a Cobb County row says the feed has a street address but no map point, instead of a town', async () => {
    const cobb = { ...sig(9, 'Residential permit: re-roof', 3), source: 'arcgis-cobb-residential-permits', kind: 'permit', city: 'Cobb County' };
    const w: World = { migrated: true, lastNotified: null, ai: [], calls: [], matches: [{ id: 109, user_id: UID, created_at: new Date(NOW - H).toISOString(), signal: cobb }] };
    const r = await runNotify(w);
    expect(r.sent[0].text).toContain("In Cobb County. The county's feed has a street address but no map point, so no distance is shown.");
    expect(r.sent[0].text).not.toContain('Cobb County, GA');
  });
});

describe('lifecycle best 3: scores use the plan-limited trades', () => {
  it('passes matchScope(profile).categories to scoresFor', async () => {
    vi.resetModules();
    const seen: string[][] = [];
    let rankFor: ((p: unknown, items: unknown[]) => Promise<unknown>) | undefined;
    vi.doMock('server-only', () => ({}));
    vi.doMock('@/lib/env', () => ({ env: { CRON_SECRET: 's3cret' }, siteUrl: 'https://x.test' }));
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
    vi.doMock('@/lib/email', () => ({ sendEmail: vi.fn() }));
    vi.doMock('@/lib/ai', () => ({
      rankSignals: (x: unknown[]) => x,
      scoresFor: async (_db: unknown, _ids: number[], trades: string[]) => (seen.push(trades), new Map()),
    }));
    vi.doMock('@/lib/lifecycle', () => ({
      createStore: () => ({}),
      runLifecycle: async (o: { rankFor: typeof rankFor }) => ((rankFor = o.rankFor), { ok: true }),
    }));
    const { GET } = await import('@/app/api/cron/lifecycle/route');
    await GET(new Request('https://x.test/api/cron/lifecycle', { headers: { authorization: 'Bearer s3cret' } }));
    const base = { user_id: UID, business_name: 'B', lat: 1, lon: 2, state: 'GA', radius_mi: 10, extra_areas: [], keywords: [] };
    await rankFor!({ ...base, categories: SIX, plan: 'starter', subscription_status: 'active' }, [{ id: 1 }]);
    await rankFor!({ ...base, categories: SIX, plan: 'pro', subscription_status: 'active' }, [{ id: 1 }]);
    await rankFor!({ ...base, categories: SIX, plan: 'pro', subscription_status: 'canceled' }, [{ id: 1 }]);
    expect(seen).toEqual([SIX.slice(0, 5), SIX, SIX.slice(0, 5)]);
  });
});
