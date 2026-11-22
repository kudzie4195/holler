// Round 18 integration: review 3 probe (logs/REV3-LOOKUP-probe-tests) kept as a permanent regression test. Findings fixed at integration
// (P2-1 health line, P3-1 outage stop, P3-2/P3-3 closed listings, P3-5 address forms, P3-6 address before ambiguity, P3-7 tie order) now assert
// the fixed behaviour; every other assertion is the reviewer's as written.
// REV3 probe (r18 LOOKUP redo 2, cac086d), tasks 5 and 6: the owner probe without migration 0026, the alert run without 0026, awardees.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { ContactRecord } from '@/lib/contacts/types';
import { ENV, LOOKUP_URL, SECRETS, dbWithoutCache, fakeFetch, item, jsonRes, listingsBody, newDb, todayRows, type LookupDb } from '../enrich/helpers';

const out: string[] = [];
const say = (id: string, verdict: string, note: string) => out.push(`${id.padEnd(4)} ${verdict.padEnd(8)} ${note}`);
afterAll(async () => {
   
  console.log('\n' + out.join('\n') + '\n');
  const { writeFileSync } = await import('node:fs');
  if (process.env.REV3_OUT) writeFileSync(`${process.env.REV3_OUT}/REV3-LOOKUP-probe-0026-awardee.txt`, out.join('\n') + '\n');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.doUnmock('@/lib/outreach/loader');
  vi.doUnmock('@/lib/supabase/admin');
  vi.doUnmock('@/lib/email');
  vi.restoreAllMocks();
});

async function probe(qs: string, store: unknown, env: Record<string, string>, fetchImpl: unknown, headers: Record<string, string> = { authorization: 'Bearer s3cret' }) {
  vi.resetModules();
  vi.stubEnv('CRON_SECRET', 's3cret');
  for (const k of ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD', 'DATAFORSEO_MONTHLY_CAP_USD', 'HOLLER_LOOKUP_MAX_PER_DAY', 'HOLLER_LOOKUP_MAX_PER_RUN', 'HOLLER_LOOKUP_DRY_RUN']) vi.stubEnv(k, env[k] ?? '');
  vi.stubGlobal('fetch', fetchImpl);
  vi.doMock('server-only', () => ({}));
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => store }));
  const { GET } = await import('@/app/api/admin/lookup-probe/route');
  const res = await GET(new Request(`https://localholler.com/api/admin/lookup-probe${qs}`, { headers }));
  return { res, body: (await res.json()) as Record<string, unknown> };
}
const Q = '?name=Peachtree%20Roofing%20LLC&city=Atlanta&state=GA';
const lookupCalls = (f: { mock: { calls: unknown[][] } }) => f.mock.calls.filter((c) => String(c[0]) === LOOKUP_URL);

describe('5. the owner probe without migration 0026', () => {
  it('Bearer only: no header, a wrong secret, ?key=, a cookie, x-cron-secret, Basic: all 401, no call, no database touch', async () => {
    const tries: [string, string, Record<string, string>][] = [
      ['no header', Q, {}],
      ['wrong secret', Q, { authorization: 'Bearer wrong' }],
      ['?key=', `${Q}&key=s3cret`, {}],
      ['?secret=', `${Q}&secret=s3cret`, {}],
      ['x-cron-secret header', Q, { 'x-cron-secret': 's3cret' }],
      ['cookie', Q, { cookie: 'CRON_SECRET=s3cret' }],
      ['Basic', Q, { authorization: `Basic ${Buffer.from('s3cret:').toString('base64')}` }],
      ['bearer in lower case with no space', Q, { authorization: 'Bearers3cret' }],
    ];
    for (const [label, qs, h] of tries) {
      const store = dbWithoutCache('PGRST205');
      const fetch = fakeFetch([item()]);
      const { res, body } = await probe(qs, store, ENV, fetch, h);
      expect(res.status, label).toBe(401);
      expect(body).toEqual({ error: 'unauthorized' });
      expect(fetch).not.toHaveBeenCalled();
      expect(store.calls).toEqual([]);
      expect(store.touched).toEqual([]);
    }
    say('5.1', 'ok', '8 ways without the Bearer secret (no header, wrong secret, ?key=, ?secret=, x-cron-secret, cookie, Basic, malformed): 401, no call, no query');
  });

  for (const code of ['PGRST205', '42P01'] as const) {
    it(`0026 not applied (${code}): one call, one ledger row, the cache table is never touched, no secret in the answer`, async () => {
      const store = dbWithoutCache(code);
      const fetch = vi.fn(async () => jsonRes(listingsBody([item()], 0.01236)));
      const { res, body } = await probe(Q, store, ENV, fetch);
      expect(res.status).toBe(200);
      expect(body).toEqual({ status: 'found', path: 'city', wouldAttach: { phone: '404-555-0123', website: 'https://www.peachtreeroofing.example/' }, listingName: 'Peachtree Roofing', candidates: 1, costUsd: 0.01236 });
      expect(lookupCalls(fetch)).toHaveLength(1);
      expect(store.touched).toEqual([]); // holler_business_lookup: no read, no write, no breaker read
      expect(Object.keys(store.tables).filter((t) => store.tables[t].length > 0)).toEqual(['holler_dataforseo_spend']);
      expect(store.tables.holler_dataforseo_spend).toEqual([expect.objectContaining({ endpoint: '/v3/business_data/business_listings/search/live', units: 20, estimated_usd: 0.0192, cost_usd: 0.01236, status: 'ok' })]);
      expect([...new Set(store.calls.map((c) => c.split('.')[0]))]).toEqual(['holler_dataforseo_spend']);
      for (const s of SECRETS) expect(JSON.stringify(body) + JSON.stringify(store.tables)).not.toContain(s);
      say('5.2', 'ok', `${code}: status found, 1 request, 1 ledger row (units 20, estimate 0.0192, cost 0.01236, ok); tables queried: holler_dataforseo_spend only; holler_business_lookup touched 0 times`);
    });
  }

  it('a refused answer and a failed call also write only the ledger', async () => {
    const store = dbWithoutCache('PGRST205');
    const closed = item({ work_time: { work_hours: { current_status: 'closed_forever' } } });
    const r1 = await probe(Q, store, ENV, vi.fn(async () => jsonRes(listingsBody([closed], 0.01236))));
    expect(r1.body).toEqual({ status: 'not_found', path: 'city', wouldAttach: null, reason: 'closed', costUsd: 0.01236 });
    const r2 = await probe(Q, store, ENV, vi.fn(async () => new Response('{}', { status: 503 })));
    expect(r2.body).toMatchObject({ status: 'skipped', reason: 'api_error', wouldAttach: null });
    expect(store.touched).toEqual([]);
    expect(store.tables.holler_dataforseo_spend.map((r) => r.status)).toEqual(['ok', 'error']);
    say('5.3', 'ok', 'closed listing: not_found with reason "closed"; HTTP 503: skipped api_error; ledger rows ok and error; cache table untouched (no retry claim, no cache row)');
  });

  it('the monthly cap: refused at $29.99 of $30, allowed at $29.98; an unreadable cap means 0', async () => {
    const spent = (usd: number) => [{ id: 1, month: '2026-11-01', endpoint: '/v3/keywords_data/google_ads/search_volume/live', units: 1, estimated_usd: usd, cost_usd: usd, status: 'ok', created_at: new Date().toISOString() }];
    const month = new Date().toISOString().slice(0, 7) + '-01';
    const seed = (usd: number) => ({ holler_dataforseo_spend: spent(usd).map((r) => ({ ...r, month })) });
    const full = dbWithoutCache('PGRST205', seed(29.99));
    const f1 = fakeFetch([item()]);
    const r1 = await probe(Q, full, ENV, f1);
    expect(r1.body).toMatchObject({ status: 'skipped', reason: 'cap_reached', costUsd: 0 });
    expect(f1).not.toHaveBeenCalled();
    expect(full.tables.holler_dataforseo_spend).toHaveLength(1); // no refused row either
    const room = dbWithoutCache('PGRST205', seed(29.98));
    const f2 = fakeFetch([item()]);
    const r2 = await probe(Q, room, ENV, f2);
    expect(r2.body).toMatchObject({ status: 'found' });
    expect(lookupCalls(f2)).toHaveLength(1);
    // a lower cap from the environment
    const low = dbWithoutCache('PGRST205', seed(0.99));
    const f3 = fakeFetch([item()]);
    const r3 = await probe(Q, low, { ...ENV, DATAFORSEO_MONTHLY_CAP_USD: '1' }, f3);
    expect(r3.body).toMatchObject({ status: 'skipped', reason: 'cap_reached' });
    expect(f3).not.toHaveBeenCalled();
    say('5.4', 'ok', 'month spend $29.99 of $30: skipped cap_reached, no request, no ledger row; $29.98: one request; DATAFORSEO_MONTHLY_CAP_USD=1 with $0.99 spent: cap_reached');
  });

  it('the daily lookup cap, the dry run and missing credentials apply to the probe', async () => {
    const today = new Date().toISOString();
    const capped = dbWithoutCache('PGRST205', { holler_dataforseo_spend: todayRows(25).map((r) => ({ ...r, created_at: today, month: today.slice(0, 7) + '-01' })) });
    const f1 = fakeFetch([item()]);
    expect((await probe(Q, capped, ENV, f1)).body).toMatchObject({ status: 'skipped', reason: 'day_cap' });
    expect(f1).not.toHaveBeenCalled();
    const off = dbWithoutCache('PGRST205');
    const f2 = fakeFetch([item()]);
    expect((await probe(Q, off, { ...ENV, HOLLER_LOOKUP_MAX_PER_DAY: '0' }, f2)).body).toMatchObject({ status: 'skipped', reason: 'day_cap' });
    const f3 = fakeFetch([item()]);
    const dry = await probe(`${Q}&dry=1`, off, ENV, f3);
    expect(dry.body).toMatchObject({ status: 'skipped', reason: 'dry_run', estimateUsd: 0.0192, request: { title: 'Peachtree Roofing', location_coordinate: '33.749,-84.388,25', limit: 20 } });
    const f4 = fakeFetch([item()]);
    expect((await probe(Q, off, { ...ENV, HOLLER_LOOKUP_DRY_RUN: '1' }, f4)).body).toMatchObject({ status: 'skipped', reason: 'dry_run' });
    const f5 = fakeFetch([item()]);
    expect((await probe(Q, off, {}, f5)).body).toMatchObject({ status: 'skipped', reason: 'not_configured' });
    for (const f of [f2, f3, f4, f5]) expect(f).not.toHaveBeenCalled();
    expect(off.tables.holler_dataforseo_spend).toEqual([]);
    expect(off.touched).toEqual([]);
    say('5.5', 'ok', '25 lookups booked today: day_cap; HOLLER_LOOKUP_MAX_PER_DAY=0: day_cap; ?dry=1 and HOLLER_LOOKUP_DRY_RUN=1: dry_run with the request and the estimate; no credentials: not_configured. No request and no row in any of them');
  });

  it('no ledger table (0011 missing): no call', async () => {
    const store = {
      calls: [] as string[],
      from(table: string) {
        store.calls.push(table);
        const q: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'neq', 'gte', 'lt', 'in', 'limit', 'insert', 'order', 'update']) q[m] = () => q;
        q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` } }).then(res);
        return q;
      },
    };
    const f = fakeFetch([item()]);
    const { body } = await probe(Q, store, ENV, f);
    expect(body).toMatchObject({ status: 'skipped', reason: 'spend_unavailable' });
    expect(f).not.toHaveBeenCalled();
    say('5.6', 'ok', 'the ledger table itself missing: skipped spend_unavailable, no request');
  });

  it('the site path and the ZIP path of the probe use the alert run\'s checks', async () => {
    const store = dbWithoutCache('PGRST205');
    const at = (street: string) => item({ title: 'Lakeview Bakery', latitude: 41.9543, longitude: -87.6575, address: `${street}, Chicago, IL 60613` }, { address: street, city: 'Chicago', zip: '60613' });
    const q = '?name=Lakeview%20Bakery%20LLC&state=IL&zip=60613&address=200%20W%20Addison%20St';
    const f1 = fakeFetch([at('202 W Addison St')]);
    expect((await probe(q, store, ENV, f1)).body).toMatchObject({ status: 'not_found', path: 'site', reason: 'address_mismatch' });
    const f2 = fakeFetch([at('200 West Addison Street')]);
    expect((await probe(q, store, ENV, f2)).body).toMatchObject({ status: 'found', path: 'site' });
    expect((await probe('?name=Lakeview%20Bakery%20LLC&state=IL&address=200%20W%20Addison%20St&city=Chicago', store, ENV, f2)).res.status).toBe(400);
    expect((await probe('?name=Lakeview%20Bakery%20LLC&state=IL&zip=60613&address=Addison', store, ENV, f2)).body).toMatchObject({ status: 'skipped', reason: 'no_place' });
    say('5.7', 'ok', 'address= with zip=: 202 W Addison St is address_mismatch, "200 West Addison Street" is found; address without zip: 400; an address with no house number: skipped no_place');
    // the probe does not know the job city, the alert run does
    const f3 = fakeFetch([item({ title: 'Atlanta Roofing', latitude: 33.95, longitude: -84.55, address: '1 Square, Marietta, GA 30060' }, { address: '1 Square', city: 'Marietta', zip: '30060' })]);
    const r = await probe('?name=Atlanta%20Roofing%20LLC&state=GA&zip=30060', store, ENV, f3);
    expect(r.body).toMatchObject({ status: 'found', path: 'zip' });
    say('5.7', 'NOTE', 'probe name=Atlanta Roofing LLC, zip=30060: found. The alert run refuses the same contractor on an Atlanta job as generic_name (the job city is a place word); the probe has no job city parameter');
  });
});

describe('5. the alert run without migration 0026', () => {
  const sent: { text: string }[] = [];
  function adminFake(matches: unknown[], store: { from: (t: string) => unknown }) {
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
                data: table === 'holler_profiles' ? [{ user_id: 'u1', business_name: 'Acme', alert_email: true, subscription_status: 'active', trial_ends_at: null, last_notified_at: '2026-11-20T00:00:00Z', email_verified_at: '2026-11-01T00:00:00Z', created_at: '2026-11-01T00:00:00Z' }] : [],
                error: null,
              });
        q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
        return q;
      },
      auth: { admin: { getUserById: async () => ({ data: { user: { email: 'owner@acme.test' } }, error: null }) } },
    };
  }
  async function run(store: { from: (t: string) => unknown }, fetchImpl: unknown, people: ContactRecord[][], kinds: { source: string; kind: string }[] = []) {
    sent.length = 0;
    vi.resetModules();
    vi.stubEnv('CRON_SECRET', 's3cret');
    vi.stubEnv('RESEND_API_KEY', 're_test_key');
    vi.stubEnv('EMAIL_FROM', 'Holler <alerts@holler.test>');
    for (const k of ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD']) vi.stubEnv(k, (ENV as Record<string, string>)[k]);
    for (const k of ['HOLLER_LOOKUP_MAX_PER_RUN', 'HOLLER_LOOKUP_MAX_PER_DAY', 'HOLLER_LOOKUP_DRY_RUN']) vi.stubEnv(k, '');
    vi.stubGlobal('fetch', fetchImpl);
    vi.doMock('server-only', () => ({}));
    const matches = people.map((_, i) => ({
      id: 10 + i,
      user_id: 'u1',
      created_at: new Date(Date.now() - 60_000 - i).toISOString(),
      signal: { id: i + 1, kind: kinds[i]?.kind ?? 'permit', source: kinds[i]?.source ?? 'socrata-atlanta-permits', title: `Record ${i + 1}`, url: 'https://example.com', city: 'Atlanta', state: 'GA', occurred_at: new Date(Date.now() - 3_600_000).toISOString() },
    }));
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminFake(matches, store) }));
    const loader = async () => new Map(people.map((list, i) => [i + 1, list.map((c) => ({ ...c, signalId: i + 1 }))]));
    vi.doMock('@/lib/outreach/loader', async (orig) => {
      const real = await orig<typeof import('@/lib/outreach/loader')>();
      return { ...real, loadMemberContacts: (o: Parameters<typeof real.loadMemberContacts>[0]) => real.loadMemberContacts({ ...o, loader: loader as never }) };
    });
    vi.doMock('@/lib/email', async (orig) => ({ ...(await orig<typeof import('@/lib/email')>()), sendEmail: async (m: { text: string }) => (sent.push(m), { ok: true, id: 'x' }) }));
    const mod = await import('@/app/api/cron/notify/route');
    const res = await mod.GET(new Request('http://localhost/api/cron/notify', { headers: { authorization: 'Bearer s3cret' } }));
    return { res, body: (await res.json()) as Record<string, unknown> & { lookup: Record<string, unknown> } };
  }
  const contractor = (name: string): ContactRecord => ({ signalId: 0, role: 'contractor', name, city: null, state: null });
  const SIX = ['Peachtree Roofing LLC', 'Summit Roofing LLC', 'Midwest Roofing LLC', 'Sunbelt Rentals', 'Budget Blinds', 'Gallagher Roofing LLC'].map((n) => [contractor(n)]);

  for (const code of ['PGRST205', '42P01'] as const) {
    it(`no call with the table missing (${code}), six cards, through the real route`, async () => {
      const store = dbWithoutCache(code);
      const fetch = vi.fn(async (url: unknown) => (String(url) === LOOKUP_URL ? jsonRes(listingsBody([item()])) : jsonRes({})));
      const { res, body } = await run(store, fetch, SIX);
      expect(res.status).toBe(200);
      expect(lookupCalls(fetch)).toHaveLength(0);
      expect(body.lookup).toMatchObject({ calls: 0, found: 0, spentUsd: 0, breaker: null });
      expect(store.tables.holler_dataforseo_spend).toEqual([]);
      expect(sent).toHaveLength(1);
      expect(sent[0].text).not.toContain('Phone:');
      say('5.8', 'ok', `${code}: alert run with 6 named contractors: 0 requests, 0 ledger rows, email sent with no Phone line; lookup block ${JSON.stringify(body.lookup)}; cache table queried ${store.touched.length} time(s)`);
    });
  }

  it('a column missing (PGRST204 / 42703) or the first-pass table that refuses the retry claim: no call', async () => {
    for (const [code, message] of [['PGRST204', "Could not find the 'checked_at' column of 'holler_business_lookup' in the schema cache"], ['42703', 'column holler_business_lookup.checked_at does not exist']] as const) {
      const inner = newDb();
      const touched: string[] = [];
      const store = {
        tables: inner.tables,
        from(table: string) {
          if (table !== 'holler_business_lookup') return inner.from(table);
          touched.push(table);
          const q: Record<string, unknown> = {};
          for (const m of ['select', 'eq', 'in', 'limit', 'upsert', 'order', 'gte', 'delete']) q[m] = () => q;
          q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code, message } }).then(res);
          return q;
        },
      };
      const fetch = vi.fn(async (url: unknown) => (String(url) === LOOKUP_URL ? jsonRes(listingsBody([item()])) : jsonRes({})));
      const { body } = await run(store, fetch, SIX);
      expect(lookupCalls(fetch)).toHaveLength(0);
      expect(inner.tables.holler_dataforseo_spend).toEqual([]);
      say('5.9', 'ok', `${code}: 0 requests, 0 ledger rows; skipped ${JSON.stringify(body.lookup.skipped)}`);
    }
    // the first-pass 0026 (status check without 'retry'): the claim write fails with 23514, so no call
    const inner = newDb();
    const store = {
      tables: inner.tables,
      from(table: string) {
        const b = inner.from(table) as unknown as Record<string, unknown>;
        if (table === 'holler_business_lookup') b.upsert = () => Promise.resolve({ data: null, error: { code: '23514', message: 'new row violates check constraint "holler_business_lookup_status_check"' } });
        return b;
      },
    };
    const fetch = vi.fn(async (url: unknown) => (String(url) === LOOKUP_URL ? jsonRes(listingsBody([item()])) : jsonRes({})));
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { body } = await run(store as never, fetch, SIX);
    logs.mockRestore();
    expect(lookupCalls(fetch)).toHaveLength(0);
    expect(inner.tables.holler_dataforseo_spend).toEqual([]);
    say('5.9', 'ok', `an old 0026 whose status check refuses "retry" (23514): 0 requests, 0 ledger rows; skipped ${JSON.stringify(body.lookup.skipped)}`);
  });

  // ---- 6. awardees ---------------------------------------------------------------------------------------------------------------
  it('6. a federal award card is not even mailed (market_insight), so the alert run never reaches the lookup for an awardee', async () => {
    const cached = { name_key: 'summit construction', city_key: 'atlanta', state: 'GA', status: 'found', phone: '404-555-0190', website: 'https://summit.example/', listing_name: 'Summit Construction', cost_usd: 0.0192, checked_at: new Date(Date.now() - 3_600_000).toISOString() };
    const store = newDb({ holler_business_lookup: [cached] }, () => new Date()) as LookupDb;
    const fetch = vi.fn(async (url: unknown) => (String(url) === LOOKUP_URL ? jsonRes(listingsBody([item({ title: 'Summit Construction' })])) : jsonRes({})));
    const awardee: ContactRecord = { signalId: 0, role: 'awardee', name: 'Summit Construction Inc', city: null, state: null };
    const AWARD = { source: 'usaspending', kind: 'contract' };
    const { body } = await run(store, fetch, [[awardee]], [AWARD]);
    expect(lookupCalls(fetch)).toHaveLength(0);
    expect(body).toMatchObject({ emailed: 0, matches_skipped_marked: 1, lookup: { calls: 0, found: 0, cacheHits: 0 } });
    expect(sent).toHaveLength(0);
    expect(store.tables.holler_dataforseo_spend).toEqual([]);
    expect(store.calls.filter((c) => c.startsWith('holler_business_lookup'))).toEqual([]);
    // mixed email: an award and a permit that names the SAME company as contractor. Only the permit card is mailed, and only it gets the cached phone.
    const contractorSame: ContactRecord = { signalId: 0, role: 'contractor', name: 'Summit Construction Inc', city: null, state: null };
    const r2 = await run(store, fetch, [[awardee], [contractorSame]], [AWARD]);
    expect(lookupCalls(fetch)).toHaveLength(0);
    expect(sent).toHaveLength(1);
    expect((sent[0].text.match(/Phone: 404-555-0190/g) ?? []).length).toBe(1);
    say('6.1', 'ok', `usaspending award naming "Summit Construction Inc" through the real route: not mailed (emailed 0, matches_skipped_marked 1: a federal award is market_insight), 0 requests, 0 cache reads, with a fresh found row for "summit construction|atlanta|GA" in the cache. With a permit naming the same company as contractor in the same run: 1 email, exactly 1 Phone line (the permit card). lookup block: ${JSON.stringify(r2.body.lookup)}`);
  });
});

describe('6. awardees on every other path', () => {
  it('mayLookUp, lookupInputFor, lookupForCards, attachCachedListings, with an address, a ZIP, a phone-less record, any place', async () => {
    vi.resetModules();
    vi.doMock('server-only', () => ({}));
    const m = await import('@/lib/enrich/business-lookup');
    expect([...m.LOOKUP_ROLES].sort()).toEqual(['business', 'contractor']);
    const shapes: ContactRecord[] = [
      { signalId: 1, role: 'awardee', name: 'Summit Construction Inc', city: null, state: null },
      { signalId: 1, role: 'awardee', name: 'Summit Construction Inc', city: 'Atlanta', state: 'GA', zip: '30303', address: '100 Main St' },
      { signalId: 1, role: 'awardee', name: 'Summit Construction Inc', city: 'Reston', state: 'VA', zip: '20190' },
    ];
    const cached = { name_key: 'summit construction', city_key: 'atlanta', state: 'GA', status: 'found', phone: '404-555-0190', website: null, listing_name: 'Summit Construction', cost_usd: 0.0192, checked_at: new Date(Date.now() - 3_600_000).toISOString() };
    for (const c of shapes) {
      expect(m.mayLookUp(c)).toBe(false);
      expect(m.lookupInputFor(c, [c], { city: 'Atlanta', state: 'GA' })).toBeNull();
      const db = newDb({ holler_business_lookup: [cached, { ...cached, city_key: 'atlanta 30303' }, { ...cached, city_key: 'reston 20190', state: 'VA' }] }, () => new Date());
      const fetch = fakeFetch([item({ title: 'Summit Construction' })]);
      const budget = m.newBudget(m.lookupSettings(ENV));
      const got = await m.lookupForCards(new Map([[1, [c]]]), [{ signalId: 1, city: 'Atlanta', state: 'GA', contact: c }], budget, { db: db as never, fetch: fetch as never, env: ENV, sleep: async () => {} });
      expect(got.get(1)?.[0].listing).toBeUndefined();
      expect(fetch).not.toHaveBeenCalled();
      expect(db.calls).toEqual([]);
      const shown = await m.attachCachedListings(db as never, new Map([[1, [c]]]), new Map([[1, { city: 'Atlanta', state: 'GA' }]]), new Date(), ENV);
      expect(shown.get(1)?.[0].listing).toBeUndefined();
      expect(db.calls).toEqual([]);
    }
    // a site row beside the awardee does not make it a "business at its site"
    const aw = shapes[0];
    const site: ContactRecord = { signalId: 1, role: 'site', name: '', address: '100 Main St', city: 'Atlanta', state: 'GA', zip: '30303' };
    expect(m.lookupInputFor(aw, [aw, site], { city: 'Atlanta', state: 'GA' })).toBeNull();
    // roles that never existed in LOOKUP_ROLES
    for (const role of ['buyer', 'site'] as const) expect(m.mayLookUp({ role, name: 'Summit Construction Inc', phone: null, website: null })).toBe(false);
    say('6.2', 'ok', 'awardee with no address, with an Atlanta address and ZIP, with a Virginia ZIP: mayLookUp false, lookupInputFor null, lookupForCards 0 requests and 0 queries, attachCachedListings attaches nothing and reads nothing, with fresh found rows cached under every key it could use');
    vi.doUnmock('server-only');
  });

  it('where the role comes from: usaspending writes "awardee" only, and no other adapter writes a federal recipient as contractor or business', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const dir = 'lib/signals/adapters';
    const hits: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts')) continue;
      const src = readFileSync(`${dir}/${f}`, 'utf8');
      for (const mm of src.matchAll(/role: ?'(business|contractor|awardee)'/g)) hits.push(`${f}:${mm[1]}`);
    }
    const byFile = [...new Set(hits)].sort();
    expect(byFile.filter((h) => h.startsWith('usaspending'))).toEqual(['usaspending.ts:awardee']);
    expect(byFile.filter((h) => h.endsWith(':awardee'))).toEqual(['usaspending.ts:awardee']);
    say('6.3', 'ok', `roles written by adapters: ${byFile.join(', ')}`);
  });
});
