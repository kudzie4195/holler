// Round 18 LOOKUP through the real routes: GET /api/cron/notify (the lookup runs for the cards about to be emailed, inside the run's time
// budget, and the email shows the listing) and GET /api/admin/lookup-probe (one call, only the ledger row written). DataForSEO, the
// database and the mailer are fakes. Includes the reviewer's route-time probe (logs/REV-LOOKUP-probe-tests/04) as a regression test.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ENV, LOOKUP_URL, NOW, SECRETS, hangingFetch, item, jsonRes, listingsBody, newDb, type LookupDb } from './helpers';

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

const NAMES = ['Peachtree Roofing LLC', 'Summit Roofing LLC', 'Midwest Roofing LLC', 'Sunbelt Rentals', 'Budget Blinds', 'Gallagher Roofing LLC'];

describe('GET /api/cron/notify with the lookup', () => {
  const sent: { html: string; text: string; at: number }[] = [];

  function adminFake(matches: unknown[], store: LookupDb) {
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

  async function run(store: LookupDb, env: Record<string, string>, fetchImpl: ReturnType<typeof vi.fn>, names: string[] = NAMES.slice(0, 1)) {
    sent.length = 0;
    vi.resetModules();
    vi.stubEnv('CRON_SECRET', 's3cret');
    // An email provider is configured (sendEmail itself is faked below): without one the run looks nothing up.
    vi.stubEnv('RESEND_API_KEY', env.RESEND_API_KEY ?? 're_test_key');
    vi.stubEnv('EMAIL_FROM', 'Holler <alerts@holler.test>');
    for (const k of ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD', 'HOLLER_LOOKUP_MAX_PER_RUN', 'HOLLER_LOOKUP_MAX_PER_DAY', 'HOLLER_LOOKUP_DRY_RUN']) vi.stubEnv(k, env[k] ?? '');
    vi.stubGlobal('fetch', fetchImpl);
    vi.doMock('server-only', () => ({}));
    const matches = names.map((_, i) => ({
      id: 10 + i,
      user_id: 'u1',
      created_at: new Date(Date.now() - 60_000 - i).toISOString(),
      signal: { id: i + 1, kind: 'permit', source: 'socrata-atlanta-permits', title: `Permit ${i + 1}`, url: 'https://example.com', city: 'Atlanta', state: 'GA', occurred_at: new Date(Date.now() - 3_600_000).toISOString() },
    }));
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminFake(matches, store) }));
    const loader = async () => new Map(names.map((name, i) => [i + 1, [{ signalId: i + 1, role: 'contractor', name, city: null, state: null }]]));
    vi.doMock('@/lib/outreach/loader', async (orig) => {
      const real = await orig<typeof import('@/lib/outreach/loader')>();
      return { ...real, loadMemberContacts: (o: Parameters<typeof real.loadMemberContacts>[0]) => real.loadMemberContacts({ ...o, loader: loader as never }) };
    });
    const t0 = Date.now();
    vi.doMock('@/lib/email', async (orig) => ({
      ...(await orig<typeof import('@/lib/email')>()),
      sendEmail: async (m: { html: string; text: string }) => (sent.push({ ...m, at: Date.now() - t0 }), { ok: true, id: 'x' }),
    }));
    const mod = await import('@/app/api/cron/notify/route');
    const res = await mod.GET(new Request('http://localhost/api/cron/notify', { headers: { authorization: 'Bearer s3cret' } }));
    return { res, body: (await res.json()) as Record<string, unknown> & { lookup: Record<string, unknown> }, maxDuration: mod.maxDuration };
  }

  const lookupCalls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.filter((c) => String(c[0]) === LOOKUP_URL);

  it('found: one call for the emailed card, the email shows Phone and Website from the public listing, ledger and cache written', async () => {
    const logs = captureLogs();
    const store = newDb({}, () => new Date());
    const fetch = vi.fn(async (url: unknown) => (String(url) === LOOKUP_URL ? jsonRes(listingsBody([item()])) : jsonRes({})));
    const { res, body } = await run(store, ENV, fetch);
    expect(res.status).toBe(200);
    expect(lookupCalls(fetch)).toHaveLength(1);
    expect(body.lookup).toMatchObject({ calls: 1, found: 1, cacheHits: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('Contact: Peachtree Roofing LLC (Named on this permit) \u00b7 Phone: 404-555-0123 \u00b7 Website: https://www.peachtreeroofing.example/');
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
    const store = newDb();
    const fetch = vi.fn(async () => jsonRes(listingsBody([item()])));
    const { res, body } = await run(store, {}, fetch);
    expect(res.status).toBe(200);
    expect(lookupCalls(fetch)).toHaveLength(0);
    expect(body.lookup).toMatchObject({ calls: 0, found: 0 });
    expect(sent[0].text).toContain('Contact: Peachtree Roofing LLC (Named on this permit)\n');
    expect(sent[0].text).not.toContain('Phone:');
    expect(sent[0].html).not.toContain('public listing');
    expect(store.tables.holler_dataforseo_spend).toEqual([]);
    expect(store.calls).toEqual([]);
  });

  it('dry-run flag: no call, nothing booked, no read', async () => {
    const store = newDb();
    const fetch = vi.fn(async () => jsonRes(listingsBody([item()])));
    const { body } = await run(store, { ...ENV, HOLLER_LOOKUP_DRY_RUN: '1' }, fetch);
    expect(lookupCalls(fetch)).toHaveLength(0);
    expect(body.lookup).toMatchObject({ calls: 0 });
    expect(store.tables.holler_dataforseo_spend).toEqual([]);
  });

  it('no email provider: nothing is emailed, so nothing is looked up', async () => {
    const store = newDb();
    const fetch = vi.fn(async () => jsonRes(listingsBody([item()])));
    const { body } = await run(store, { ...ENV, RESEND_API_KEY: '' }, fetch);
    expect(lookupCalls(fetch)).toHaveLength(0);
    expect(body.lookup).toMatchObject({ calls: 0 });
    expect(store.tables.holler_dataforseo_spend).toEqual([]);
  });

  it('(review P1-3, probe 04) a hung DataForSEO: the email goes out inside the 6 s lookup budget, at most 3 calls, and the timeouts are cached as retry so the next run makes no call', async () => {
    const store = newDb({}, () => new Date());
    const hang = hangingFetch();
    const { res, body, maxDuration } = await run(store, ENV, hang, NAMES);
    expect(res.status).toBe(200);
    expect(maxDuration).toBe(60);
    expect(sent).toHaveLength(1);
    expect(sent[0].at).toBeLessThan(6_500); // was 40 810 ms on 3eb9e31
    expect(lookupCalls(hang).length).toBeGreaterThan(0);
    expect(lookupCalls(hang).length).toBeLessThanOrEqual(3);
    expect(body.lookup).toMatchObject({ timedOut: lookupCalls(hang).length, found: 0 });
    expect(sent[0].text).not.toContain('Phone:');
    const retry = store.tables.holler_business_lookup.filter((r) => r.status === 'retry');
    expect(retry).toHaveLength(lookupCalls(hang).length);
    // the next run 15 minutes later: the timed-out businesses are not tried again
    const hang2 = hangingFetch();
    const again = await run(store, ENV, hang2, NAMES.slice(0, lookupCalls(hang).length));
    expect(lookupCalls(hang2)).toHaveLength(0);
    expect(again.body.lookup).toMatchObject({ calls: 0 });
    expect(sent[0].at).toBeLessThan(1_000);
  }, 30_000);

  it('a DataForSEO that ignores the abort signal still cannot hold the email past the run\'s lookup budget', async () => {
    const store = newDb({}, () => new Date());
    const never = hangingFetch({ ignoreAbort: true });
    await run(store, ENV, never, NAMES);
    expect(sent).toHaveLength(1);
    expect(sent[0].at).toBeLessThan(6_500);
  }, 30_000);
});

describe('GET /api/admin/lookup-probe', () => {
  async function probe(qs: string, store: unknown, env: Record<string, string>, fetchImpl: ReturnType<typeof vi.fn>, auth = 'Bearer s3cret') {
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
    const store = newDb({}, () => new Date());
    const fetch = vi.fn(async () => jsonRes(listingsBody([item()], 0.0156)));
    const { res, body } = await probe('?name=Peachtree%20Roofing%20LLC&city=Atlanta&state=GA', store, ENV, fetch);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body).toEqual({ status: 'found', path: 'city', wouldAttach: { phone: '404-555-0123', website: 'https://www.peachtreeroofing.example/' }, listingName: 'Peachtree Roofing', candidates: 1, costUsd: 0.0156 });
    expect(store.tables.holler_dataforseo_spend).toEqual([expect.objectContaining({ endpoint: '/v3/business_data/business_listings/search/live', cost_usd: 0.0156, status: 'ok' })]);
    expect(store.tables.holler_business_lookup).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
    for (const s of SECRETS) expect(JSON.stringify(body) + logs.join('\n')).not.toContain(s);
  });

  it('?dry=1 makes no call and returns the request and estimate; a person or generic name is never sent; missing parameters are 400; no Bearer is 401', async () => {
    const store = newDb();
    const fetch = vi.fn(async () => jsonRes(listingsBody([item()])));
    const dry = await probe('?name=Peachtree%20Roofing%20LLC&city=Atlanta&state=GA&dry=1', store, ENV, fetch);
    expect(dry.body).toMatchObject({ status: 'skipped', reason: 'dry_run', costUsd: 0, estimateUsd: 0.0192, request: { title: 'Peachtree Roofing', location_coordinate: '33.749,-84.388,25', limit: 20 } });
    expect((await probe('?name=John%20Smith&city=Atlanta&state=GA', store, ENV, fetch)).body).toMatchObject({ status: 'skipped', reason: 'not_business', wouldAttach: null });
    expect((await probe('?name=General%20Contractor&city=Atlanta&state=GA', store, ENV, fetch)).body).toMatchObject({ status: 'skipped', wouldAttach: null });
    expect((await probe('?name=Peachtree%20Roofing%20LLC', store, ENV, fetch)).res.status).toBe(400);
    expect((await probe('?name=Peachtree%20Roofing%20LLC&city=Atlanta&state=GA', store, ENV, fetch, '')).res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
    expect(store.tables.holler_dataforseo_spend).toEqual([]);
  });

  it('credentials absent: not_configured, no call', async () => {
    const fetch = vi.fn(async () => jsonRes(listingsBody([item()])));
    const { body } = await probe('?name=Peachtree%20Roofing%20LLC&city=Atlanta&state=GA', newDb(), {}, fetch);
    expect(body).toMatchObject({ status: 'skipped', reason: 'not_configured' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

it('NOW fixture is a fixed date', () => expect(NOW.toISOString()).toBe('2026-11-22T12:00:00.000Z'));
