import { afterEach, describe, expect, it, vi } from 'vitest';
import { ago, D, H, healthyDb, MIN, scanRuns, type MonitorDb } from './helpers';

// The route reads the real clock, so seed relative to now.
const NOWR = new Date();
const rel = (ms: number) => new Date(NOWR.getTime() - ms).toISOString();

function seeded(over: Record<string, Record<string, unknown>[]> = {}): MonitorDb {
  const db = healthyDb();
  db.tables.holler_scan_runs = scanRuns(6 * MIN, null, ['nws', 'spc'], new Date(Date.now())) as never;
  db.tables.holler_signals = [{ id: 1, created_at: rel(H) }];
  db.tables.holler_source_health = [];
  for (const [k, v] of Object.entries(over)) db.tables[k] = v;
  return db;
}

const sendEmail = vi.fn(async () => ({ ok: true as const }));

async function load(db: MonitorDb, env: { admin?: string; support?: string } = { admin: 'owner@example.com' }) {
  vi.resetModules();
  sendEmail.mockClear();
  vi.stubEnv('CRON_SECRET', 's3cret');
  vi.stubEnv('ADMIN_EMAIL', env.admin ?? '');
  vi.stubEnv('SUPPORT_EMAIL', env.support ?? '');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://localholler.com');
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }));
  vi.doMock('@/lib/signals/registry', () => ({ ALL_ADAPTERS: [{ id: 'nws', label: 'NWS', kind: 'alert', cadenceMinutes: 15, sourceUrl: 'x', fetch: async () => [] }] }));
  vi.doMock('@/lib/email', async () => {
    const real = await vi.importActual<typeof import('@/lib/email')>('@/lib/email');
    return { ...real, sendEmail };
  });
  return (await import('../../app/api/cron/health/route')).GET;
}
const req = (path: string, auth: string | null = 'Bearer s3cret') => new Request(`http://x.test${path}`, { headers: auth ? { authorization: auth } : {} });
afterEach(() => vi.unstubAllEnvs());

describe('GET /api/cron/health?monitor=1 (the hourly job)', () => {
  it('needs the secret', async () => {
    const GET = await load(seeded());
    expect((await GET(req('/api/cron/health?monitor=1', null))).status).toBe(401);
    expect((await GET(req('/api/cron/health?monitor=1', 'Bearer nope'))).status).toBe(401);
  });
  it('runs only the monitor: no daily report fields, and quiet when healthy', async () => {
    const GET = await load(seeded());
    const res = await GET(req('/api/cron/health?monitor=1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(Object.keys(body)).toEqual(['monitor']);
    expect(body.monitor).toMatchObject({ status: 'ok', conditions: [], email: { status: 'quiet' } });
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it('sends one email to ADMIN_EMAIL when the scan has stopped, and not again the next call', async () => {
    const db = seeded({ holler_scan_runs: scanRuns(3 * H, null, ['nws'], new Date()) as never });
    const GET = await load(db);
    const body = await (await GET(req('/api/cron/health?monitor=1'))).json();
    expect(body.monitor.email).toMatchObject({ status: 'sent', to: 'owner@example.com', subject: 'Holler ingest: scan has stopped' });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const first = sendEmail.mock.calls[0] as unknown as [{ to: string; subject: string; text: string }];
    expect(first[0].to).toBe('owner@example.com');
    expect(first[0].text).toContain('https://localholler.com/api/admin/sources');
    await GET(req('/api/cron/health?monitor=1'));
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
  it('falls back to SUPPORT_EMAIL like the daily health email', async () => {
    const GET = await load(seeded({ holler_scan_runs: [] }), { support: 'help@example.com' });
    const body = await (await GET(req('/api/cron/health?monitor=1'))).json();
    expect(body.monitor.email.to).toBe('help@example.com');
  });
  it('?dry=1 returns the conditions and sends and stores nothing', async () => {
    const db = seeded({ holler_scan_runs: [] });
    const GET = await load(db);
    const body = await (await GET(req('/api/cron/health?monitor=1&dry=1'))).json();
    expect(body.monitor.conditions.map((c: { key: string }) => c.key)).toEqual(['scan:stale']);
    expect(body.monitor.email.status).toBe('would_send');
    expect(sendEmail).not.toHaveBeenCalled();
    expect(db.tables.holler_ops_alerts).toEqual([]);
  });
  it('before 0018: says "monitor table missing" and sends nothing', async () => {
    const db = seeded({ holler_scan_runs: [] });
    db.failOn['holler_ops_alerts.select'] = `Could not find the table 'public.holler_ops_alerts' in the schema cache`;
    const GET = await load(db);
    const body = await (await GET(req('/api/cron/health?monitor=1'))).json();
    expect(body.monitor).toMatchObject({ status: 'table_missing', note: 'monitor table missing' });
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it('the monitor never changes the status: 200 even when every table read fails', async () => {
    const db = seeded();
    for (const t of ['holler_scan_runs', 'holler_source_health', 'holler_signals', 'holler_ops_alerts']) db.failOn[`${t}.select`] = 'boom';
    const GET = await load(db);
    const res = await GET(req('/api/cron/health?monitor=1'));
    expect(res.status).toBe(200);
  });
});

describe('GET /api/cron/health (the daily run) reports the monitor but never sends or stores for it', () => {
  it('adds a monitor field next to the report and the source health summary', async () => {
    const GET = await load(seeded());
    const body = await (await GET(req('/api/cron/health?dry=1'))).json();
    expect(body.monitor.status).toBe('ok');
    expect(body.email.status).toBe('not_sent_dry');
    expect(body).toHaveProperty('sourceHealth');
    expect(body).toHaveProperty('problems');
  });
  it('with a real problem, the daily run sends exactly the one daily report email and the monitor stays read only', async () => {
    const db = seeded({ holler_scan_runs: [] });
    const GET = await load(db);
    const body = await (await GET(req('/api/cron/health'))).json();
    expect(body.monitor.conditions.map((c: { key: string }) => c.key)).toEqual(['scan:stale']);
    expect(body.monitor.email.status).toBe('would_send');
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect((sendEmail.mock.calls[0] as unknown as [{ subject: string }])[0].subject).toMatch(/^Holler health:/);
    expect(db.tables.holler_ops_alerts).toEqual([]);
  });
  it('a monitor that throws does not break the report', async () => {
    vi.resetModules();
    vi.stubEnv('CRON_SECRET', 's3cret');
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => seeded() }));
    vi.doMock('@/lib/signals/registry', () => ({ ALL_ADAPTERS: [] }));
    vi.doMock('@/lib/monitor/run', () => ({ runMonitor: async () => { throw new Error('boom'); } }));
    const { GET } = await import('../../app/api/cron/health/route');
    const res = await GET(req('/api/cron/health?dry=1'));
    expect(res.status).toBe(200);
    expect((await res.json()).monitor).toMatchObject({ status: 'error', note: 'monitor failed' });
    vi.doUnmock('@/lib/monitor/run');
  });
});
void ago; void D;

describe('GET /api/cron/health?monitor=1 judges only enabled sources (review r4)', () => {
  it('a source whose env key is missing, or that left the registry, never alerts', async () => {
    const silent = { last_run_at: rel(10 * D), last_success_at: rel(10 * D), last_new_at: rel(10 * D), last_record_at: rel(10 * D), last_error: null, consecutive_failures: 0, rows_seen_last_run: 0, rows_new_last_run: 0, status: 'healthy', updated_at: rel(10 * D), last_rows_seen_at: rel(10 * D), tracked_since: rel(30 * D) };
    const db = seeded({ holler_source_health: [{ source: 'bluesky', ...silent }, { source: 'retired-source', ...silent }, { source: 'nws', ...silent }] as never });
    const GET = await load(db);
    vi.resetModules();
    vi.doMock('@/lib/signals/registry', () => ({
      ALL_ADAPTERS: [
        { id: 'nws', label: 'NWS', kind: 'alert', cadenceMinutes: 15, sourceUrl: 'x', fetch: async () => [] },
        { id: 'bluesky', label: 'Bluesky', kind: 'social', cadenceMinutes: 60, sourceUrl: 'x', requiresEnv: ['HOLLER_TEST_MISSING_KEY'], fetch: async () => [] },
      ],
    }));
    void GET;
    const GET2 = (await import('../../app/api/cron/health/route')).GET;
    const body = await (await GET2(req('/api/cron/health?monitor=1&dry=1'))).json();
    // nws is on and silent for 10 days: it alerts. bluesky (key missing) and retired-source (not in the registry) do not.
    expect(body.monitor.conditions.map((c: { key: string }) => c.key)).toEqual(['source:nws:silent']);
  });
});
