import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeDb, fixtureScript, mockClient } from './fakes';

const KEY = 'fc-test-key-0000000000';

async function load(opts: { key?: string; db?: FakeDb; script?: ReturnType<typeof fixtureScript>; robots?: string } = {}) {
  vi.resetModules();
  vi.stubEnv('CRON_SECRET', 's3cret');
  vi.stubEnv('FIRECRAWL_API_KEY', opts.key ?? KEY);
  vi.stubEnv('HOLLER_BIDS_ENABLED', ''); // the probe must work while bids are still off
  vi.stubEnv('HOLLER_LOCAL_BIDS_ENABLED', '');
  const db = opts.db ?? new FakeDb();
  const mock = mockClient(opts.script ?? fixtureScript('bids-gwinnett', 'same'));
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }));
  vi.doMock('@/lib/firecrawl/client', async (orig) => ({ ...(await orig<typeof import('@/lib/firecrawl/client')>()), createFirecrawlClient: () => mock.client }));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(opts.robots ?? 'User-agent: *\nDisallow: /admin', { status: 200 })));
  const { resetRobotsCache } = await import('@/lib/firecrawl/robots');
  resetRobotsCache();
  const { GET } = await import('../../app/api/admin/firecrawl-probe/route');
  return { GET, db, mock };
}
const req = (path: string, auth: string | null = 'Bearer s3cret') => new Request(`http://x.test${path}`, { headers: auth ? { authorization: auth } : {} });
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.doUnmock('@/lib/firecrawl/client');
});

describe('GET /api/admin/firecrawl-probe', () => {
  it('401 without the secret, with a wrong one, and for ?key= (Bearer only); no Firecrawl call either way', async () => {
    const { GET, mock } = await load();
    expect((await GET(req('/api/admin/firecrawl-probe?source=bids-gwinnett', null))).status).toBe(401);
    expect((await GET(req('/api/admin/firecrawl-probe?source=bids-gwinnett', 'Bearer nope'))).status).toBe(401);
    expect((await GET(req('/api/admin/firecrawl-probe?source=bids-gwinnett&key=s3cret', null))).status).toBe(401);
    expect(mock.calls).toHaveLength(0);
  });
  it('401 when CRON_SECRET is unset, even for an empty Bearer', async () => {
    vi.resetModules();
    vi.stubEnv('CRON_SECRET', '');
    const { GET } = await import('../../app/api/admin/firecrawl-probe/route');
    expect((await GET(req('/api/admin/firecrawl-probe?source=bids-gwinnett', 'Bearer '))).status).toBe(401);
  });
  it('no ?source: 400 with the known ids, no call', async () => {
    const { GET, mock } = await load();
    const res = await GET(req('/api/admin/firecrawl-probe'));
    expect(res.status).toBe(400);
    expect((await res.json()).knownSources).toEqual(['bids-gwinnett', 'bids-rockdale', 'bids-tucker', 'bids-dunwoody', 'bids-pw-houston-city', 'bids-pw-phoenix-opengov']); // + round 20 Firecrawl-only page-watch pages
    expect(mock.calls).toHaveLength(0);
  });
  it('unknown source: 400, no call', async () => {
    const { GET, mock } = await load();
    const res = await GET(req('/api/admin/firecrawl-probe?source=bids-la'));
    expect(res.status).toBe(400);
    expect((await res.json()).status).toBe('unknown_source');
    expect(mock.calls).toHaveLength(0);
  });
  it('no key: 503, no call', async () => {
    const { GET, mock } = await load({ key: '' });
    expect((await GET(req('/api/admin/firecrawl-probe?source=bids-gwinnett'))).status).toBe(503);
    expect(mock.calls).toHaveLength(0);
  });
  it('dry run: kept rows, dropped rows with reasons, credits; writes no signal; works with the bid switches off; never echoes the key', async () => {
    const { GET, db, mock } = await load();
    const res = await GET(req('/api/admin/firecrawl-probe?source=bids-gwinnett'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    expect(text).not.toContain(KEY);
    const body = JSON.parse(text);
    expect(body).toMatchObject({ ok: true, source: 'bids-gwinnett', status: 'ok', rowsExtracted: 28 });
    expect(body.kept).toHaveLength(7);
    expect(body.kept[0]).toMatchObject({ title: expect.any(String), dueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), url: expect.stringContaining('gwinnettcounty.com') });
    expect(body.dropped).toHaveLength(21);
    expect(body.dropped[0]).toMatchObject({ title: expect.any(String), reason: expect.any(String) });
    expect(body.credits).toMatchObject({ calls: 1, estimated: 5, reported: null });
    expect(body.credits.remainingBefore).toBe(900);
    expect(db.inserts).toEqual([expect.objectContaining({ source: '_fc:probe:bids-gwinnett', fetched: 5, error: 'probe' })]); // the spend is on the books, no signal is written
    expect(body.notes).toContain('robots.txt allows the page');
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].formats.some((f) => typeof f === 'object' && f.type === 'changeTracking')).toBe(false);
  });
  it('a disallowed page is reported and costs nothing', async () => {
    const { GET, mock } = await load({ robots: 'User-agent: *\nDisallow: /' });
    const body = await (await GET(req('/api/admin/firecrawl-probe?source=bids-gwinnett'))).json();
    expect(body).toMatchObject({ ok: false, status: 'skipped', reason: 'robots_disallowed' });
    expect(mock.calls).toHaveLength(0);
  });
});
