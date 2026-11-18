import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';

const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const row = (source: string, over: Record<string, unknown> = {}) => ({
  source, last_run_at: ago(60_000), last_success_at: ago(60_000), last_error: null, last_record_at: ago(3_600_000),
  rows_seen_last_run: 3, rows_new_last_run: 1, consecutive_failures: 0, status: 'healthy', updated_at: ago(60_000), ...over,
});

async function load(db = new FakeDb()) {
  vi.resetModules();
  vi.stubEnv('CRON_SECRET', 's3cret');
  vi.stubEnv('ADMIN_EMAIL', '');
  vi.stubEnv('SUPPORT_EMAIL', '');
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }));
  vi.doMock('@/lib/signals/registry', () => ({ ALL_ADAPTERS: [{ id: 'nws', label: 'NWS', kind: 'alert', cadenceMinutes: 15, sourceUrl: 'x', fetch: async () => [] }] }));
  return {
    admin: (await import('../../app/api/admin/sources/route')).GET,
    health: (await import('../../app/api/cron/health/route')).GET,
  };
}
const req = (path: string, auth: string | null = 'Bearer s3cret') => new Request(`http://x.test${path}`, { headers: auth ? { authorization: auth } : {} });
afterEach(() => vi.unstubAllEnvs());

describe('GET /api/admin/sources', () => {
  it('refuses without the secret, with a wrong one, and with a wrong ?key=', async () => {
    const { admin } = await load();
    expect((await admin(req('/api/admin/sources', null))).status).toBe(401);
    expect((await admin(req('/api/admin/sources', 'Bearer nope'))).status).toBe(401);
    expect((await admin(req('/api/admin/sources?key=nope', null))).status).toBe(401);
  });
  it('refuses everything when CRON_SECRET is unset', async () => {
    const { admin } = await load();
    vi.resetModules();
    vi.stubEnv('CRON_SECRET', '');
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => new FakeDb() }));
    const { GET } = await import('../../app/api/admin/sources/route');
    expect((await GET(req('/api/admin/sources', 'Bearer '))).status).toBe(401);
    void admin;
  });
  it('returns the table with live status and counts', async () => {
    const db = new FakeDb({ holler_source_health: [row('nws'), row('socrata-nyc-311', { consecutive_failures: 4, last_error: 'timeout' })] });
    const { admin } = await load(db);
    const res = await admin(req('/api/admin/sources'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.counts).toEqual({ healthy: 1, delayed: 0, degraded: 0, unavailable: 1 });
    expect(body.sources.map((s: { source: string }) => s.source)).toEqual(['nws', 'socrata-nyc-311']);
  });
  it('also accepts ?key=', async () => {
    const { admin } = await load();
    expect((await admin(req('/api/admin/sources?key=s3cret', null))).status).toBe(200);
  });
  it('500 with no detail when the read fails', async () => {
    const db = new FakeDb();
    db.failOn['holler_source_health.select'] = 'secret detail';
    const { admin } = await load(db);
    const res = await admin(req('/api/admin/sources'));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret detail');
  });
});

describe('GET /api/cron/health carries the per-source summary', () => {
  it('adds sourceHealth and still refuses without the secret', async () => {
    const db = new FakeDb({ holler_source_health: [row('nws')] });
    const { health } = await load(db);
    expect((await health(req('/api/cron/health?dry=1', null))).status).toBe(401);
    const body = await (await health(req('/api/cron/health?dry=1'))).json();
    expect(body.sourceHealth.counts.healthy).toBe(1);
    expect(body.sourceHealth.sources[0].source).toBe('nws');
  });
  it('sourceHealth is null, and the report still returns, when the table cannot be read', async () => {
    const db = new FakeDb();
    db.failOn['holler_source_health.select'] = 'relation missing';
    const { health } = await load(db);
    const res = await health(req('/api/cron/health?dry=1'));
    expect(res.status).toBe(200);
    expect((await res.json()).sourceHealth).toBeNull();
  });
});
