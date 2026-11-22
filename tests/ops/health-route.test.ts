// GET /api/cron/health with the database (in-memory fake), registry and mail send mocked. Inputs are hand-written (assumed).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeDb } from './fakedb';

const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const sendEmail = vi.fn();

async function load(opts: { env?: Record<string, string>; db?: FakeDb; adapters?: unknown[]; send?: unknown } = {}) {
  vi.resetModules();
  sendEmail.mockReset();
  sendEmail.mockResolvedValue(opts.send ?? { ok: true, id: 'em_1' });
  vi.stubEnv('CRON_SECRET', 's3cret');
  for (const k of ['ADMIN_EMAIL', 'SUPPORT_EMAIL']) vi.stubEnv(k, opts.env?.[k] ?? '');
  const db = opts.db ?? new FakeDb();
  // Round 18: the route also reads the trial length the database enforces (migration 0028, holler_trial_db_check). A healthy database
  // has 0028 applied; FakeDb has no rpc of its own.
  const withRpc = db as FakeDb & { rpc?: (fn: string) => Promise<{ data: unknown; error: { code: string } | null }> };
  withRpc.rpc ??= async (fn: string) =>
    fn === 'holler_trial_db_check' ? { data: { default_days: 60, stamp_cap_days: 60, guard_cap_days: 60 }, error: null } : { data: null, error: { code: 'PGRST202' } };
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }));
  vi.doMock('@/lib/signals/registry', () => ({
    ALL_ADAPTERS: opts.adapters ?? [
      { id: 'nws', label: 'NWS alerts', kind: 'alert', cadenceMinutes: 15, sourceUrl: 'x', fetch: async () => [] },
      { id: 'sam-gov', label: 'SAM', kind: 'contract', cadenceMinutes: 720, requiresEnv: ['SAM_API_KEY_NOT_SET_IN_TESTS'], sourceUrl: 'x', fetch: async () => [] },
    ],
  }));
  vi.doMock('@/lib/email', async (orig) => ({ ...(await orig<typeof import('../../lib/email')>()), sendEmail }));
  return { GET: (await import('../../app/api/cron/health/route')).GET, db };
}

const req = (qs = '', auth: string | null = 'Bearer s3cret') => new Request(`http://x.test/api/cron/health${qs}`, { headers: auth ? { authorization: auth } : {} });
afterEach(() => vi.unstubAllEnvs());

const healthyRuns = () => Array.from({ length: 200 }, (_, i): { id: number; source: string; started_at: string; fetched: number; inserted: number; error: string | null } => ({ id: i + 1, source: 'nws', started_at: ago((i + 1) * 15 * 60_000), fetched: 12, inserted: 1, error: null }));

describe('GET /api/cron/health', () => {
  it('401 without the secret, with a wrong one, and via ?key= wrong', async () => {
    const { GET } = await load();
    expect((await GET(req('', null))).status).toBe(401);
    expect((await GET(req('', 'Bearer nope'))).status).toBe(401);
    expect((await GET(req('?key=nope', null))).status).toBe(401);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('503 when the admin client cannot be built', async () => {
    vi.resetModules();
    vi.stubEnv('CRON_SECRET', 's3cret');
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => { throw new Error('missing env'); } }));
    const { GET } = await import('../../app/api/cron/health/route');
    expect((await GET(req())).status).toBe(503);
  });

  it('returns the report as JSON and emails ADMIN_EMAIL when healthy', async () => {
    const db = new FakeDb({
      holler_scan_runs: healthyRuns(),
      holler_profiles: [
        { user_id: 'a', created_at: ago(3600_000), subscription_status: 'trialing', trial_ends_at: ago(-86400_000), last_notified_at: ago(1800_000) },
        { user_id: 'b', created_at: ago(30 * 86400_000), subscription_status: 'active', trial_ends_at: ago(20 * 86400_000), last_notified_at: ago(5 * 86400_000) },
      ],
    });
    const { GET } = await load({ db, env: { ADMIN_EMAIL: 'me@x.com', SUPPORT_EMAIL: 'help@x.com' } });
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.subject).toBe('Holler health: all sources OK');
    expect(body.counts).toEqual({ newSignups24h: 1, activeSubscribers: 1, trialing: 1, usersEmailed24h: 1 });
    expect(body.notConfigured).toEqual(['sam-gov: needs SAM_API_KEY_NOT_SET_IN_TESTS']);
    expect(body.email).toEqual({ status: 'sent', to: 'me@x.com' });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ to: 'me@x.com', subject: 'Holler health: all sources OK' });
  });

  it('falls back to SUPPORT_EMAIL, and reports no_recipient when neither is set', async () => {
    const db = () => new FakeDb({ holler_scan_runs: healthyRuns() });
    let r = await load({ db: db(), env: { SUPPORT_EMAIL: 'help@x.com' } });
    expect((await (await r.GET(req())).json()).email).toEqual({ status: 'sent', to: 'help@x.com' });
    r = await load({ db: db() });
    const body = await (await r.GET(req())).json();
    expect(body.email.status).toBe('no_recipient');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('subject and body lead with problems when a source is broken', async () => {
    const runs = healthyRuns();
    runs[0] = { ...runs[0], error: 'HTTP 503' };
    const { GET } = await load({ db: new FakeDb({ holler_scan_runs: runs }), env: { ADMIN_EMAIL: 'me@x.com' } });
    const body = await (await GET(req())).json();
    expect(body.subject).toBe('Holler health: 1 source needs attention');
    expect(body.problems[0]).toContain('nws: errored on its latest run: HTTP 503');
    expect(sendEmail.mock.calls[0][0].text).toContain('Needs attention');
  });

  it('?dry=1 builds the report and sends nothing', async () => {
    const { GET } = await load({ db: new FakeDb({ holler_scan_runs: healthyRuns() }), env: { ADMIN_EMAIL: 'me@x.com' } });
    const body = await (await GET(req('?dry=1'))).json();
    expect(body.email).toEqual({ status: 'not_sent_dry' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('surfaces a skipped or failed send in the JSON instead of hiding it', async () => {
    let r = await load({ db: new FakeDb({ holler_scan_runs: healthyRuns() }), env: { ADMIN_EMAIL: 'me@x.com' }, send: { skipped: true, reason: 'no_from' } });
    expect((await (await r.GET(req())).json()).email).toEqual({ status: 'skipped', to: 'me@x.com', detail: 'no_from' });
    r = await load({ db: new FakeDb({ holler_scan_runs: healthyRuns() }), env: { ADMIN_EMAIL: 'me@x.com' }, send: { ok: false, error: 'domain not verified' } });
    expect((await (await r.GET(req())).json()).email).toEqual({ status: 'failed', to: 'me@x.com', detail: 'domain not verified' });
  });

  it('reads more than 1000 run rows (pages)', async () => {
    const many = Array.from({ length: 2400 }, (_, i) => ({ id: i + 1, source: 'nws', started_at: ago((i + 1) * 60_000), fetched: 3, inserted: 0, error: null }));
    const { GET } = await load({ db: new FakeDb({ holler_scan_runs: many }) });
    const body = await (await GET(req('?dry=1'))).json();
    // 2400 one-minute rows, the newest 24 h (1440 rows) are counted: more than a single 1000-row page could return
    expect(body.sources.find((s: { id: string }) => s.id === 'nws').runs24h).toBe(1439);
  });

  it('500 with a reason when scan_runs cannot be read', async () => {
    const db = new FakeDb();
    db.failOn['holler_scan_runs.select'] = 'relation does not exist';
    const { GET } = await load({ db });
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('scan_runs_read_failed');
  });
});
