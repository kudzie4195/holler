// Round 18 LOOKUP through the real routes: GET /api/cron/notify (the lookup runs for the cards about to be emailed and the email shows the
// listing) and GET /api/admin/lookup-probe (one call, only the ledger row written). DataForSEO, the database and the mailer are fakes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import { ENV, NOW, SECRETS, item, jsonRes, listingsBody } from './helpers';

const LOOKUP_URL = 'https://api.dataforseo.com/v3/business_data/business_listings/search/live';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.doUnmock('@/lib/outreach/loader');
  vi.doUnmock('@/lib/supabase/admin');
  vi.doUnmock('@/lib/email');
  vi.restoreAllMocks();
});

function captureLogs(): string[] {
  const logs: string[] = [];
  for (const m of ['log', 'warn', 'error', 'info'] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
      logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
    });
  }
  return logs;
}

describe('GET /api/cron/notify with the lookup', () => {
  const sent: { html: string; text: string }[] = [];

  function adminFake(matches: unknown[], store: FakeDb) {
    return {
      from(table: string) {
        if (table === 'holler_business_lookup' || table === 'holler_dataforseo_spend') return store.from(table);
        const q: Record<string, unknown> = {};
        let patch: unknown = null;
        for (const m of ['select', 'eq', 'order', 'limit', 'gte', 'neq', 'is', 'not', 'lte', 'lt', 'gt', 'insert', 'upsert']) q[m] = () => q;
        q.range = () => Promise.resolve({ data: table === 'holler_matches' ? matches : [], error: null });
        q.update = (p: unknown) => ((patch = p), q);
        q.in = () =>
          patch
            ? Promise.resolve({ error: null })
            : Promise.resolve({
                data:
                  table === 'holler_profiles'
                    ? [{ user_id: 'u1', business_name: 'Acme', alert_email: true, subscription_status: 'active', trial_ends_at: null, last_notified_at: '2026-11-20T00:00:00Z', email_verified_at: '2026-11-01T00:00:00Z', created_at: '2026-11-01T00:00:00Z' }]
                    : [],
                error: null,
              });
        q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
        return q;
      },
      auth: { admin: { getUserById: async () => ({ data: { user: { email: 'owner@acme.test' } }, error: null }) } },
    };
  }

  async function run(store: FakeDb, env: Record<string, string>, fetchImpl: ReturnType<typeof vi.fn>) {
    sent.length = 0;
    vi.resetModules();
    vi.stubEnv('CRON_SECRET', 's3cret');
    // An email provider is configured (sendEmail itself is faked below): without one the run looks nothing up.
    vi.stubEnv('RESEND_API_KEY', env.RESEND_API_KEY ?? 're_test_key');
    vi.stubEnv('EMAIL_FROM', 'Holler <alerts@holler.test>');
    for (const k of ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD', 'HOLLER_LOOKUP_MAX_PER_RUN', 'HOLLER_LOOKUP_MAX_PER_DAY', 'HOLLER_LOOKUP_DRY_RUN']) vi.stubEnv(k, env[k] ?? '');
    vi.stubGlobal('fetch', fetchImpl);
    vi.doMock('server-only', () => ({}));
    const matches = [
      {
        id: 10,
        user_id: 'u1',
        created_at: new Date(Date.now() - 60_000).toISOString(),
        signal: { id: 1, kind: 'permit', source: 'socrata-atlanta-permits', title: 'Permit 1', url: 'https://example.com', city: 'Atlanta', state: 'GA', occurred_at: new Date(Date.now() - 3_600_000).toISOString() },
      },
    ];
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminFake(matches, store) }));
    const loader = async () => new Map([[1, [{ signalId: 1, role: 'contractor', name: 'Peachtree Roofing LLC', city: null, state: null }]]]);
    vi.doMock('@/lib/outreach/loader', async (orig) => {
      const real = await orig<typeof import('@/lib/outreach/loader')>();
      return { ...real, loadMemberContacts: (o: Parameters<typeof real.loadMemberContacts>[0]) => real.loadMemberContacts({ ...o, loader: loader as never }) };
    });
    vi.doMock('@/lib/email', async (orig) => ({
      ...(await orig<typeof import('@/lib/email')>()),
      sendEmail: async (m: { html: string; text: string }) => (sent.push(m), { ok: true, id: 'x' }),
    }));
    const GET = (await import('@/app/api/cron/notify/route')).GET;
    const res = await GET(new Request('http://localhost/api/cron/notify', { headers: { authorization: 'Bearer s3cret' } }));
    return { res, body: (await res.json()) as Record<string, unknown> };
  }

  const lookupCalls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.filter((c) => String(c[0]) === LOOKUP_URL);

  it('found: one call for the emailed card, the email shows Phone and Website from the public listing, ledger and cache written', async () => {
    const logs = captureLogs();
    const store = new FakeDb({ holler_dataforseo_spend: [], holler_business_lookup: [] });
    const fetch = vi.fn(async (url: unknown) => (String(url) === LOOKUP_URL ? jsonRes(listingsBody([item()])) : jsonRes({})));
    const { res, body } = await run(store, ENV, fetch);
    expect(res.status).toBe(200);
    expect(lookupCalls(fetch)).toHaveLength(1);
    expect(body.lookup).toMatchObject({ calls: 1, found: 1, cacheHits: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('Contact: Peachtree Roofing LLC (Named on this permit)\nPhone: 404-555-0123\nWebsite: https://www.peachtreeroofing.example/');
    expect(sent[0].html).toContain('rel="noopener noreferrer nofollow"');
    expect(store.tables.holler_dataforseo_spend).toEqual([expect.objectContaining({ endpoint: '/v3/business_data/business_listings/search/live', status: 'ok' })]);
    expect(store.tables.holler_business_lookup).toEqual([expect.objectContaining({ status: 'found', phone: '404-555-0123' })]);
    const everything = JSON.stringify(body) + sent.map((m) => m.html + m.text).join('') + logs.join('\n') + JSON.stringify(store.tables);
    for (const s of SECRETS) expect(everything).not.toContain(s);

    // The next run reads the cache: no call, same lines.
    const fetch2 = vi.fn(async () => jsonRes({}));
    const again = await run(store, ENV, fetch2);
    expect(lookupCalls(fetch2)).toHaveLength(0);
    expect(again.body.lookup).toMatchObject({ calls: 0 });
    expect(sent[0].text).toContain('Phone: 404-555-0123');
  });

  it('credentials absent: no call, the email is exactly what it was before the lookup existed', async () => {
    const store = new FakeDb({ holler_dataforseo_spend: [], holler_business_lookup: [] });
    const fetch = vi.fn(async () => jsonRes(listingsBody([item()])));
    const { res, body } = await run(store, {}, fetch);
    expect(res.status).toBe(200);
    expect(lookupCalls(fetch)).toHaveLength(0);
    expect(body.lookup).toMatchObject({ calls: 0, found: 0 });
    expect(sent[0].text).toContain('Contact: Peachtree Roofing LLC (Named on this permit)\n');
    expect(sent[0].text).not.toContain('Phone:');
    expect(sent[0].html).not.toContain('public listing');
    expect(store.tables.holler_dataforseo_spend).toEqual([]);
  });

  it('dry-run flag: no call, nothing booked', async () => {
    const store = new FakeDb({ holler_dataforseo_spend: [], holler_business_lookup: [] });
    const fetch = vi.fn(async () => jsonRes(listingsBody([item()])));
    const { body } = await run(store, { ...ENV, HOLLER_LOOKUP_DRY_RUN: '1' }, fetch);
    expect(lookupCalls(fetch)).toHaveLength(0);
    expect(body.lookup).toMatchObject({ calls: 0, skipped: { dry_run: 1 } });
    expect(store.tables.holler_dataforseo_spend).toEqual([]);
  });

  it('no email provider: nothing is emailed, so nothing is looked up', async () => {
    const store = new FakeDb({ holler_dataforseo_spend: [], holler_business_lookup: [] });
    const fetch = vi.fn(async () => jsonRes(listingsBody([item()])));
    const { body } = await run(store, { ...ENV, RESEND_API_KEY: '' }, fetch);
    expect(lookupCalls(fetch)).toHaveLength(0);
    expect(body.lookup).toMatchObject({ calls: 0 });
    expect(store.tables.holler_dataforseo_spend).toEqual([]);
  });
});

describe('GET /api/admin/lookup-probe', () => {
  async function probe(qs: string, store: FakeDb, env: Record<string, string>, fetchImpl: ReturnType<typeof vi.fn>, auth = 'Bearer s3cret') {
    vi.resetModules();
    vi.stubEnv('CRON_SECRET', 's3cret');
    for (const k of ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD']) vi.stubEnv(k, env[k] ?? '');
    vi.stubGlobal('fetch', fetchImpl);
    vi.doMock('server-only', () => ({}));
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => store }));
    const { GET } = await import('@/app/api/admin/lookup-probe/route');
    const res = await GET(new Request(`https://localholler.com/api/admin/lookup-probe${qs}`, { headers: { authorization: auth } }));
    return { res, body: (await res.json()) as Record<string, unknown> };
  }

  it('returns what would be attached and the cost; writes only the ledger row; never the credentials', async () => {
    const logs = captureLogs();
    const store = new FakeDb({ holler_dataforseo_spend: [], holler_business_lookup: [] });
    const fetch = vi.fn(async () => jsonRes(listingsBody([item()], 0.0156)));
    const { res, body } = await probe('?name=Peachtree%20Roofing%20LLC&city=Atlanta&state=GA', store, ENV, fetch);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body).toEqual({ status: 'found', wouldAttach: { phone: '404-555-0123', website: 'https://www.peachtreeroofing.example/' }, listingName: 'Peachtree Roofing', candidates: 1, costUsd: 0.0156 });
    expect(store.tables.holler_dataforseo_spend).toEqual([expect.objectContaining({ endpoint: '/v3/business_data/business_listings/search/live', cost_usd: 0.0156, status: 'ok' })]);
    expect(store.tables.holler_business_lookup).toEqual([]);
    for (const s of SECRETS) expect(JSON.stringify(body) + logs.join('\n')).not.toContain(s);
  });

  it('?dry=1 makes no call and returns the request and estimate; a person name is never sent; missing parameters are 400; no Bearer is 401', async () => {
    const store = new FakeDb({ holler_dataforseo_spend: [], holler_business_lookup: [] });
    const fetch = vi.fn(async () => jsonRes(listingsBody([item()])));
    const dry = await probe('?name=Peachtree%20Roofing%20LLC&city=Atlanta&state=GA&dry=1', store, ENV, fetch);
    expect(dry.body).toMatchObject({ status: 'skipped', reason: 'dry_run', costUsd: 0, estimateUsd: 0.0156, request: { title: 'Peachtree Roofing LLC', location_coordinate: '33.749,-84.388,25', limit: 10 } });
    const person = await probe('?name=John%20Smith&city=Atlanta&state=GA', store, ENV, fetch);
    expect(person.body).toMatchObject({ status: 'skipped', reason: 'not_business', wouldAttach: null });
    const missing = await probe('?name=Peachtree%20Roofing%20LLC', store, ENV, fetch);
    expect(missing.res.status).toBe(400);
    const noAuth = await probe('?name=Peachtree%20Roofing%20LLC&city=Atlanta&state=GA', store, ENV, fetch, '');
    expect(noAuth.res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
    expect(store.tables.holler_dataforseo_spend).toEqual([]);
  });

  it('credentials absent: not_configured, no call', async () => {
    const store = new FakeDb({ holler_dataforseo_spend: [], holler_business_lookup: [] });
    const fetch = vi.fn(async () => jsonRes(listingsBody([item()])));
    const { body } = await probe('?name=Peachtree%20Roofing%20LLC&city=Atlanta&state=GA', store, {}, fetch);
    expect(body).toMatchObject({ status: 'skipped', reason: 'not_configured' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

it('NOW fixture is a fixed date', () => expect(NOW.toISOString()).toBe('2026-11-22T12:00:00.000Z'));
