import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const h = vi.hoisted(() => ({ secret: 'cron-secret-not-real' as string | undefined, admin: 'ADMIN' as unknown, run: vi.fn(), calls: [] as unknown[] }));
vi.mock('@/lib/env', () => ({
  env: new Proxy({}, { get: (_t, k) => (k === 'CRON_SECRET' ? h.secret : undefined) }),
  siteUrl: 'https://localholler.com',
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    if (!h.admin) throw new Error('not configured');
    return h.admin;
  },
}));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/lifecycle', () => ({
  createStore: (db: unknown) => ({ db }),
  runLifecycle: (...a: unknown[]) => h.run(...a),
}));

import { GET, maxDuration } from '@/app/api/cron/lifecycle/route';

const req = (qs = '', headers: Record<string, string> = {}) => new Request(`https://x.test/api/cron/lifecycle${qs}`, { headers });

beforeEach(() => {
  h.secret = 'cron-secret-not-real';
  h.admin = 'ADMIN';
  h.run = vi.fn(async () => ({ ok: true, sent: { welcome: 1, trial_ending: 0, trial_ended: 0 } }));
});

describe('GET /api/cron/lifecycle', () => {
  it('is protected like the other cron routes', async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req('', { authorization: 'Bearer wrong' }))).status).toBe(401);
    expect((await GET(req('?key=wrong'))).status).toBe(401);
    expect(h.run).not.toHaveBeenCalled();
  });
  it('without CRON_SECRET nothing is authorized', async () => {
    h.secret = undefined;
    expect((await GET(req('', { authorization: 'Bearer undefined' }))).status).toBe(401);
    expect(h.run).not.toHaveBeenCalled();
  });
  it('runs with a bearer token, live by default; ?key= with the right secret is 401', async () => {
    const a = await GET(req('', { authorization: 'Bearer cron-secret-not-real' }));
    expect(a.status).toBe(200);
    expect(h.run.mock.calls[0][0]).toMatchObject({ dry: false, siteUrl: 'https://localholler.com', secret: 'cron-secret-not-real' });
    const b = await GET(req('?key=cron-secret-not-real'));
    expect(b.status).toBe(401);
    expect(h.run).toHaveBeenCalledTimes(1);
  });
  it('?dry=1 asks for a dry run; other values do not', async () => {
    await GET(req('?dry=1', { authorization: 'Bearer cron-secret-not-real' }));
    expect(h.run.mock.calls[0][0].dry).toBe(true);
    await GET(req('?dry=0', { authorization: 'Bearer cron-secret-not-real' }));
    await GET(req('?dry=true', { authorization: 'Bearer cron-secret-not-real' }));
    expect(h.run.mock.calls[1][0].dry).toBe(false);
    expect(h.run.mock.calls[2][0].dry).toBe(false);
  });
  it('answers 503 when the database is not configured and 500 (no detail) when the run throws', async () => {
    h.admin = null;
    expect((await GET(req('', { authorization: 'Bearer cron-secret-not-real' }))).status).toBe(503);
    h.admin = 'ADMIN';
    h.run = vi.fn(async () => {
      throw new Error('secret detail');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(req('', { authorization: 'Bearer cron-secret-not-real' }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret detail');
    vi.restoreAllMocks();
  });
  it('fits inside the 60 second function limit used by the other cron routes', () => {
    expect(maxDuration).toBe(60);
  });
});
