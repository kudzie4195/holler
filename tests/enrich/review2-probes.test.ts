// The r18 LOOKUP re-review's probes (logs/REV2-LOOKUP-probe-tests/02 and 06, review-LOOKUP-2.md), kept as regression tests, plus the
// commander's redo 2 decisions: closed listings, the site address, awardees, truncated answers, the daily circuit breaker, the owner probe
// paths and one lookup per business per run. Ids match the review.
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  BREAKER_SAMPLE,
  TRUNCATED_TTL_DAYS,
  breakerMessage,
  chooseListing,
  isGenericName,
  listingState,
  lookupBreaker,
  lookupBusiness,
  lookupForCards,
  lookupInputFor,
  lookupSettings,
  nameRefusal,
  newBudget,
  parseListingResult,
  parseStreet,
  resolvePlace,
  sameStreet,
} from '@/lib/enrich/business-lookup';
import type { ContactRecord } from '@/lib/contacts/types';
import { FakeDb } from '../ops/fakedb';
import { ENV, NOW, fakeFetch, item, jsonRes, listingsBody, newDb, sentTask } from './helpers';

const deps = (db: unknown, fetch: unknown, over: Record<string, unknown> = {}) => ({ db: db as never, fetch: fetch as typeof globalThis.fetch, env: ENV, now: () => NOW, sleep: async () => {}, ...over });
const parse = (list: unknown[], total?: number | null) => {
  const body = listingsBody(list, 0.0192, total ?? list.length);
  if (total === null) delete (body.tasks[0].result[0] as { total_count?: number }).total_count;
  return parseListingResult(body.tasks[0] as never);
};
const choose = (name: string, place: ReturnType<typeof resolvePlace>, list: unknown[], total?: number | null) => {
  const p = parse(list, total);
  return chooseListing(name, place!, p.items, p.totalCount);
};
const ATL = resolvePlace('Atlanta', 'GA');
const contractor = (signalId: number, name: string, over: Partial<ContactRecord> = {}): ContactRecord => ({ signalId, role: 'contractor', name, city: null, state: null, ...over });
const one = (c: ContactRecord, city = 'Atlanta', state = 'GA') => [{ signalId: c.signalId, city, state, contact: c }];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('decision 1: closed listings (documented current_status)', () => {
  it('2i (was DEFECT) a listing marked closed_forever or temporarily_closed is never attached', () => {
    for (const status of ['closed_forever', 'temporarily_closed']) {
      expect(choose('Peachtree Roofing LLC', ATL, [item({ work_time: { work_hours: { timetable: null, current_status: status } } })]), status).toEqual({ choice: null, reason: 'closed' });
    }
  });
  it('"close" (outside opening hours) is an open business; a closed same-named listing does not count as a match', () => {
    expect(choose('Peachtree Roofing LLC', ATL, [item({ work_time: { work_hours: { current_status: 'close' } } })]).reason).toBe('found');
    const closed = item({ phone: '+14045559999', work_time: { work_hours: { current_status: 'closed_forever' } } });
    expect(choose('Peachtree Roofing LLC', ATL, [closed, item()])).toMatchObject({ reason: 'found', choice: { listing: { phone: '404-555-0123' }, candidates: 1 } });
  });
});

describe('decision 2: a business on a licence or inspection needs the site address', () => {
  const biz: ContactRecord = { signalId: 11, role: 'business', name: 'Lakeview Bakery LLC', city: null, state: null };
  const site: ContactRecord = { signalId: 11, role: 'site', name: '', address: '200 W Addison St', city: 'Chicago', state: 'IL', zip: '60613' };

  it('street normalisation: house number plus street words, suffix and direction written one way, unit dropped', () => {
    expect(parseStreet('200 West Addison Street, Suite 3')).toEqual({ number: '200', street: 'w addison st' });
    expect(parseStreet('200 W. Addison St. #3')).toEqual({ number: '200', street: 'w addison st' });
    expect(sameStreet('200 W Addison St', '200 West Addison Street')).toBe(true);
    expect(sameStreet('200 W Addison St', '200 E Addison St')).toBe(false);
    expect(sameStreet('200 W Addison St', '202 W Addison St')).toBe(false);
    expect(sameStreet('200 W Addison St', '200 Addison St')).toBe(false); // a missing direction is doubt
    expect(parseStreet('W Addison St')).toBeNull();
  });

  it('2c (was DEFECT) the same name at ANOTHER street address is refused', async () => {
    const other = item({ title: 'Lakeview Bakery', phone: '+17735550188', url: null, domain: null, latitude: 41.9385, longitude: -87.6442, address: '3100 N Broadway, Chicago, IL 60657' }, { city: 'Chicago', zip: '60657', address: '3100 N Broadway' });
    const fetch = fakeFetch([other]);
    const got = await lookupForCards(new Map([[11, [biz, site]]]), one(biz, 'Chicago', 'IL'), newBudget(lookupSettings(ENV)), deps(newDb(), fetch));
    expect(sentTask(fetch).location_coordinate).toBe('41.9543,-87.6575,5');
    expect(got.get(11)?.[0].listing).toBeUndefined();
    // same ZIP, another street number: refused too
    const sameZip = item({ title: 'Lakeview Bakery', latitude: 41.9545, longitude: -87.6577 }, { city: 'Chicago', zip: '60613', address: '210 W Addison St' });
    const place = resolvePlace('Chicago', 'IL', '60613', { strict: true, street: '200 W Addison St' })!;
    expect(chooseListing(biz.name, place, parse([sameZip]).items).reason).toBe('address_mismatch');
    // the listing AT the site is attached
    const at = item({ title: 'Lakeview Bakery', phone: '+17735550199', latitude: 41.9470, longitude: -87.6380, address: '200 W Addison St, Chicago, IL 60613' }, { city: 'Chicago', zip: '60613', address: '200 West Addison Street' });
    const got2 = await lookupForCards(new Map([[11, [biz, site]]]), one(biz, 'Chicago', 'IL'), newBudget(lookupSettings(ENV)), deps(newDb(), fakeFetch([at])));
    expect(got2.get(11)?.[0].listing?.phone).toBe('773-555-0199');
  });

  it('2c2 (was DEFECT) a listing far from the ZIP point whose ZIP text is equal is refused unless the street matches', () => {
    const place = resolvePlace('Chicago', 'IL', '60613', { strict: true, street: '200 W Addison St' })!;
    const farSameZip = item({ title: 'Lakeview Bakery', latitude: 41.80, longitude: -87.60, address: '1 E 55th St, Chicago, IL 60613' }, { zip: '60613', address: '1 E 55th St' });
    expect(choose('Lakeview Bakery LLC', place, [farSameZip]).reason).toBe('address_mismatch');
  });

  it('without the site street line, or without its ZIP, a business is not looked up', () => {
    expect(lookupInputFor(biz, [biz, { ...site, address: null }], { city: 'Chicago', state: 'IL' })).toBeNull();
    expect(lookupInputFor(biz, [biz, { ...site, zip: null }], { city: 'Chicago', state: 'IL' })).toBeNull();
    expect(lookupInputFor(biz, [biz], { city: 'Chicago', state: 'IL' })).toBeNull();
    expect(resolvePlace('Chicago', 'IL', '60613', { strict: true, street: null })).toBeNull();
  });

  it('the reviewer\'s 36 generic shop names are never sent', () => {
    const names = ['Food Mart', 'Nail Salon', 'Hair Salon', 'Coin Laundry', 'Car Wash', 'Dry Cleaners', 'Liquor Store', 'Grocery Store', 'Tire Shop', 'Pizza Restaurant', 'Chinese Restaurant', 'Mexican Restaurant', 'Coffee Shop', 'Gas Station', 'Dollar Store', 'Beauty Supply', 'Mini Mart', 'Food Market', 'Currency Exchange', 'Tobacco Shop', 'Smoke Shop', 'Day Spa', 'Pet Grooming', 'Auto Parts', 'Learning Academy', 'Family Dental', 'Dental Care', 'Animal Hospital', 'Beauty Salon', 'Barber Shop', 'Child Development Center', 'Convenience Store', 'Food and Liquor', 'Fast Food', 'Bakery Cafe', 'Laundromat Services'];
    expect(names).toHaveLength(36);
    const sent = names.filter((n) => nameRefusal(n, { city: 'Chicago', state: 'IL' }) === null);
    expect(sent).toEqual([]);
    for (const n of ['Lakeview Bakery LLC', 'Peachtree Roofing LLC', 'Sunbelt Rentals', 'Kowalski Roofing']) expect(nameRefusal(n, { city: 'Chicago', state: 'IL' }), n).toBeNull();
  });
});

describe('decision 3: federal awardees are not looked up', () => {
  it('2j (was DEFECT) an awardee makes no call and gets no listing', async () => {
    const c: ContactRecord = { signalId: 21, role: 'awardee', name: 'Summit Construction Inc', city: null, state: null };
    const fetch = fakeFetch([item({ title: 'Summit Construction', phone: '+14045550199' })]);
    const got = await lookupForCards(new Map([[21, [c]]]), one(c), newBudget(lookupSettings(ENV)), deps(newDb(), fetch));
    expect(got.get(21)?.[0].listing).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(lookupInputFor(c, [c], { city: 'Atlanta', state: 'GA' })).toBeNull();
  });
});

describe('decision 4: unknown title matching', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => item({ title: i === 0 ? 'Peachtree Roofing' : `Brand${String.fromCharCode(65 + (i % 26))} Roofing`, phone: `+1404555${1000 + i}` }));

  it('4a / 6c (was P3) a truncated answer is cached as "truncated" for 7 days, then asked again', async () => {
    const db = newDb();
    const fetch = vi.fn(async () => jsonRes(listingsBody(many(20), 0.0192, 137)));
    const r = await lookupBusiness({ name: 'Peachtree Roofing LLC', city: 'Atlanta', state: 'GA' }, deps(db, fetch));
    expect(r).toMatchObject({ status: 'not_found', reason: 'truncated', costUsd: 0.0192 });
    expect(db.tables.holler_business_lookup).toEqual([expect.objectContaining({ status: 'truncated', phone: null, website: null, listing_name: null })]);
    const at = (days: number) => () => new Date(NOW.getTime() + days * 86_400_000);
    expect(await lookupBusiness({ name: 'Peachtree Roofing LLC', city: 'Atlanta', state: 'GA' }, deps(db, fetch, { now: at(TRUNCATED_TTL_DAYS - 0.5) }))).toMatchObject({ status: 'not_found', source: 'cache', reason: 'truncated' });
    expect(fetch).toHaveBeenCalledTimes(1);
    await lookupBusiness({ name: 'Peachtree Roofing LLC', city: 'Atlanta', state: 'GA' }, deps(db, fetch, { now: at(TRUNCATED_TTL_DAYS + 0.5) }));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('P3-A (was open) no total_count and a full page counts as truncated; a short page without total_count is read', () => {
    expect(choose('Peachtree Roofing LLC', ATL, many(20), null).reason).toBe('truncated');
    expect(choose('Peachtree Roofing LLC', ATL, [item()], null).reason).toBe('found');
  });

  it('4b the circuit breaker: the first 5 answers of the UTC day without a found listing stop lookups for the day, with the owner line', async () => {
    const db = newDb();
    const names = ['Zorvex Roofing', 'Quillon Roofing', 'Brantex Roofing', 'Veltrix Roofing', 'Norvane Roofing', 'Kestrol Roofing', 'Dynavo Roofing'];
    const fetch = vi.fn(async () => jsonRes(listingsBody(many(20), 0.0192, 90)));
    const budget = newBudget(lookupSettings({ ...ENV, HOLLER_LOOKUP_MAX_PER_RUN: '20' }), 60_000);
    for (const n of names) await lookupBusiness({ name: n, city: 'Atlanta', state: 'GA' }, deps(db, fetch, { env: { ...ENV, HOLLER_LOOKUP_MAX_PER_RUN: '20' } }), { budget });
    expect(fetch).toHaveBeenCalledTimes(BREAKER_SAMPLE);
    expect(budget.skipped.breaker).toBe(2);
    expect(budget.breaker).toBe('Business lookups returned no usable match today (5 tried). Run the lookup probe.');
    expect(budget.refused).toEqual({ truncated: 5 });
    expect(await lookupBreaker(db as never, NOW)).toEqual({ tripped: true, tried: 5, message: breakerMessage(5) });
    // the next UTC day starts fresh
    expect(await lookupBreaker(db as never, new Date('2026-11-23T00:10:00Z'))).toEqual({ tripped: false, tried: 0, message: null });
    // the owner probe is not stopped by the breaker
    const r = await lookupBusiness({ name: 'Peachtree Roofing LLC', city: 'Atlanta', state: 'GA' }, deps(db, fakeFetch([item()])), { probe: true });
    expect(r.status).toBe('found');
  });

  it('4b one found answer among the first 5 keeps lookups on for the day', async () => {
    const at = (min: number) => new Date(NOW.getTime() - 3_600_000 + min * 60_000).toISOString();
    const rows = ['not_found', 'found', 'not_found', 'truncated', 'not_found', 'not_found'].map((status, i) => ({ name_key: `x${i} roofing`, city_key: 'atlanta', state: 'GA', status, phone: status === 'found' ? '404-555-0123' : null, website: null, listing_name: status === 'found' ? 'x' : null, checked_at: at(i) }));
    expect(await lookupBreaker(newDb({ holler_business_lookup: rows }) as never, NOW)).toMatchObject({ tripped: false, tried: 6 });
    // retry claims are not answers
    const retries = Array.from({ length: 5 }, (_, i) => ({ name_key: `r${i} roofing`, city_key: 'atlanta', state: 'GA', status: 'retry', phone: null, website: null, listing_name: null, checked_at: at(i) }));
    expect(await lookupBreaker(newDb({ holler_business_lookup: retries }) as never, NOW)).toMatchObject({ tripped: false, tried: 0 });
  });

  it('4b the health email shows the breaker line in Watch, and its JSON carries it', async () => {
    vi.resetModules();
    const sendEmail = vi.fn(async () => ({ ok: true, id: 'em' }));
    vi.stubEnv('CRON_SECRET', 's3cret');
    vi.stubEnv('ADMIN_EMAIL', 'owner@x.test');
    vi.stubEnv('DATAFORSEO_LOGIN', ENV.DATAFORSEO_LOGIN);
    vi.stubEnv('DATAFORSEO_PASSWORD', ENV.DATAFORSEO_PASSWORD);
    const today = new Date();
    const rows = Array.from({ length: 5 }, (_, i) => ({ name_key: `x${i} roofing`, city_key: 'atlanta', state: 'GA', status: i % 2 ? 'truncated' : 'not_found', phone: null, website: null, listing_name: null, checked_at: new Date(Math.max(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()), today.getTime() - 60_000 + i)).toISOString() }));
    const db = new FakeDb({ holler_scan_runs: [], holler_business_lookup: rows });
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }));
    vi.doMock('@/lib/signals/registry', () => ({ ALL_ADAPTERS: [] }));
    vi.doMock('@/lib/email', async (orig) => ({ ...(await orig<typeof import('@/lib/email')>()), sendEmail }));
    const { GET } = await import('@/app/api/cron/health/route');
    const res = await GET(new Request('http://x.test/api/cron/health', { headers: { authorization: 'Bearer s3cret' } }));
    const body = await res.json();
    expect(body.lookup).toEqual({ tripped: true, tried: 5, message: breakerMessage(5) });
    expect(body.watch[0]).toBe('Business lookups returned no usable match today (5 tried). Run the lookup probe.');
    expect((sendEmail.mock.calls[0] as unknown as [{ text: string }])[0].text).toContain('Business lookups returned no usable match today (5 tried). Run the lookup probe.');
    vi.doUnmock('@/lib/supabase/admin');
    vi.doUnmock('@/lib/signals/registry');
    vi.doUnmock('@/lib/email');
  });

  it('the health route reads nothing about lookups without DataForSEO credentials', async () => {
    vi.resetModules();
    vi.stubEnv('CRON_SECRET', 's3cret');
    vi.stubEnv('DATAFORSEO_LOGIN', '');
    vi.stubEnv('DATAFORSEO_PASSWORD', '');
    const db = new FakeDb({ holler_scan_runs: [] });
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }));
    vi.doMock('@/lib/signals/registry', () => ({ ALL_ADAPTERS: [] }));
    const { GET } = await import('@/app/api/cron/health/route');
    const body = await (await GET(new Request('http://x.test/api/cron/health?dry=1', { headers: { authorization: 'Bearer s3cret' } }))).json();
    expect(body.lookup).toBeNull();
    expect(db.calls.filter((c) => c.startsWith('holler_business_lookup'))).toEqual([]);
    vi.doUnmock('@/lib/supabase/admin');
    vi.doUnmock('@/lib/signals/registry');
  });
});

describe('the re-review\'s other probes (P3)', () => {
  it('2a / P3-C two branches with the same phone and host: the stored website is the host\'s home page, not one branch\'s page', () => {
    const a = item({ title: 'Budget Blinds', phone: '+18005550100', url: 'https://budgetblinds.example/buckhead/', latitude: 33.84, longitude: -84.38 }, { zip: '30305' });
    const b = item({ title: 'Budget Blinds', phone: '+18005550100', url: 'https://budgetblinds.example/decatur/', latitude: 33.7748, longitude: -84.2963 }, { city: 'Decatur', zip: '30030' });
    expect(choose('Budget Blinds LLC', ATL, [a, b]).choice?.listing).toMatchObject({ phone: '800-555-0100', website: 'https://budgetblinds.example/' });
    const far = item({ title: 'Budget Blinds', phone: '+18005550100', url: 'https://budgetblinds.example/macon/', latitude: 32.84, longitude: -83.63 }, { city: 'Macon', zip: '31201' });
    expect(choose('Budget Blinds LLC', ATL, [a, far]).reason).toBe('too_far');
  });

  it('2b / P3-F (was DEFECT) no coordinates and the lookup city as text, but a ZIP 360 km away: refused', () => {
    const sav = { title: 'Summit Roofing', phone: '+19125550100', address: '1 Bull St, Savannah, GA 31401', latitude: null, longitude: null };
    expect(choose('Summit Roofing LLC', ATL, [item(sav, { city: 'Atlanta', zip: '31401' })]).reason).toBe('too_far');
  });

  it('2e / P3-K (was false refusal) a numeric zip and an address ending ", USA" or ", United States" are read', () => {
    const st = (zip: unknown, address: string | null) => listingState(parse([item({ address }, { zip })]).items[0]);
    expect(st(30303, '1 Main St, Atlanta')).toEqual({ state: 'GA', zip: '30303' });
    expect(st(2134, null)).toEqual({ state: 'MA', zip: '02134' });
    expect(st(null, '1 Main St, Atlanta, GA 30303, USA')).toEqual({ state: 'GA', zip: '30303' });
    expect(st(null, '7800 W 87th St, Bridgeview, IL 60455, United States')).toEqual({ state: 'IL', zip: '60455' });
    expect(st('1303030', null)).toBeNull();
    expect(st(null, '1 Main St, Kansas City, KS 64101, USA')).toBeNull();
  });

  it('2f / P3-E (was DEFECT) a phone also on other-named listings in the same answer (call tracking) is refused', () => {
    const tracking = '+14045550100';
    const list = [
      item({ title: 'Peachtree Roofing', phone: tracking, url: 'https://atlanta-roofers.example/peachtree' }),
      item({ title: 'Buckhead Roof Repair', phone: tracking, url: 'https://atlanta-roofers.example/buckhead' }),
      item({ title: 'Midtown Roofing Pros', phone: tracking, url: 'https://atlanta-roofers.example/midtown' }),
    ];
    expect(choose('Peachtree Roofing LLC', ATL, list).reason).toBe('shared_phone');
  });

  it('2g / 2m / P3-D (was DEFECT) the job city and the ZIP\'s own city are place words for the generic rule', async () => {
    const c: ContactRecord = { signalId: 5, role: 'contractor', name: 'Atlanta Roofing LLC', city: null, state: 'GA', zip: '30060' };
    const fetch = fakeFetch([item({ title: 'Atlanta Roofing', phone: '+14045550155' })]);
    const got = await lookupForCards(new Map([[5, [c]]]), one(c), newBudget(lookupSettings(ENV)), deps(newDb(), fetch));
    expect(got.get(5)?.[0].listing).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    const r = await lookupBusiness({ name: 'Atlanta Roofing LLC', city: null, state: 'GA', zip: '30318' }, deps(newDb(), fetch));
    expect(r).toMatchObject({ status: 'skipped', reason: 'generic_name' });
    expect(isGenericName('Chicago Plumbing Inc', { state: 'IL', zip: '60618' })).toBe(true);
  });

  it('6a / P3-H (was open) one contractor on three cards of one email: one call, all three cards get the listing', async () => {
    const contacts = new Map<number, ContactRecord[]>();
    const cards = [1, 2, 3].map((id) => {
      const c = contractor(id, 'Peachtree Roofing LLC');
      contacts.set(id, [c]);
      return { signalId: id, city: 'Atlanta', state: 'GA', contact: c };
    });
    const db = newDb();
    const fetch = fakeFetch([item()]);
    const budget = newBudget(lookupSettings(ENV));
    const got = await lookupForCards(contacts, cards, budget, deps(db, fetch));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(budget.runLeft).toBe(4);
    expect([1, 2, 3].map((id) => got.get(id)?.[0].listing?.phone)).toEqual(['404-555-0123', '404-555-0123', '404-555-0123']);
  });

  it('6b / P3-I a first-pass schema rejecting the retry claim makes no call (safe); the convergent 0026 fixes the schema (see migration-0026 test)', async () => {
    const db = newDb();
    db.failOn['holler_business_lookup.upsert'] = 'new row for relation "holler_business_lookup" violates check constraint "holler_business_lookup_status_check"';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetch = fakeFetch([item()]);
    const budget = newBudget(lookupSettings(ENV));
    await lookupForCards(new Map([[1, [contractor(1, 'Peachtree Roofing LLC')]]]), one(contractor(1, 'Peachtree Roofing LLC')), budget, deps(db, fetch));
    expect(fetch).not.toHaveBeenCalled();
    expect(budget.skipped).toEqual({ cache_error: 1 });
  });

  it('6e malformed items do not throw and attach nothing', () => {
    const weird = [{ title: 'Peachtree Roofing', phone: 4045550123, url: 12, domain: {}, address: [], address_info: 'x', latitude: '33.7', longitude: null, work_time: 'x' }, null, 'x', { title: '' }, { title: 'Peachtree Roofing', address_info: { zip: {} }, url: 'https://[::1]/', work_time: { work_hours: 'x' } }];
    const p = parseListingResult(listingsBody(weird).tasks[0] as never);
    expect(() => chooseListing('Peachtree Roofing', ATL!, p.items, p.totalCount)).not.toThrow();
    expect(chooseListing('Peachtree Roofing', ATL!, p.items, p.totalCount).choice).toBeNull();
  });

  it('note: a claim is removed when the call was refused before it was sent (no 6 hour block for nothing)', async () => {
    // the ledger already holds 25 lookups today with ids below this call's reservation: the admission refuses after the claim was written
    const db = newDb();
    let n = 0;
    const realFrom = db.from.bind(db);
    // make the cheap pre-check see 0 rows, so the call gets as far as the admission, which then sees 26
    (db as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const b = realFrom(t) as unknown as { select: (...a: unknown[]) => unknown };
      if (t === 'holler_dataforseo_spend' && n++ === 0) {
        return { select: () => ({ eq: () => ({ gte: () => ({ neq: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }) };
      }
      return b;
    };
    for (let i = 0; i < 25; i++) db.tables.holler_dataforseo_spend.push({ id: i + 1, month: '2026-11-01', endpoint: '/v3/business_data/business_listings/search/live', cost_usd: 0.0192, status: 'ok', created_at: '2026-11-22T01:00:00Z' });
    const fetch = fakeFetch([item()]);
    const r = await lookupBusiness({ name: 'Peachtree Roofing LLC', city: 'Atlanta', state: 'GA' }, deps(db, fetch));
    expect(r).toMatchObject({ status: 'skipped', reason: 'day_cap' });
    expect(fetch).not.toHaveBeenCalled();
    expect(db.tables.holler_business_lookup).toEqual([]);
  });

  it('note: a cache row dated more than 10 minutes in the future is ignored', async () => {
    const future = new Date(NOW.getTime() + 3_600_000).toISOString();
    const db = newDb({ holler_business_lookup: [{ name_key: 'peachtree roofing', city_key: 'atlanta', state: 'GA', status: 'retry', phone: null, website: null, listing_name: null, checked_at: future }] });
    const fetch = fakeFetch([item()]);
    expect(await lookupBusiness({ name: 'Peachtree Roofing LLC', city: 'Atlanta', state: 'GA' }, deps(db, fetch))).toMatchObject({ status: 'found' });
  });
});

describe('decision 5: the owner probe tests the ZIP path and the site path and says why', () => {
  async function probe(qs: string, fetchImpl: ReturnType<typeof vi.fn>) {
    vi.resetModules();
    vi.stubEnv('CRON_SECRET', 's3cret');
    vi.stubEnv('DATAFORSEO_LOGIN', ENV.DATAFORSEO_LOGIN);
    vi.stubEnv('DATAFORSEO_PASSWORD', ENV.DATAFORSEO_PASSWORD);
    vi.stubGlobal('fetch', fetchImpl);
    vi.doMock('server-only', () => ({}));
    const store = newDb({}, () => new Date());
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => store }));
    const { GET } = await import('@/app/api/admin/lookup-probe/route');
    const res = await GET(new Request(`https://localholler.com/api/admin/lookup-probe${qs}`, { headers: { authorization: 'Bearer s3cret' } }));
    vi.unstubAllGlobals();
    vi.doUnmock('@/lib/supabase/admin');
    return { res, body: (await res.json()) as Record<string, unknown>, store };
  }
  const q = (o: Record<string, string>) => '?' + new URLSearchParams(o).toString();

  it('zip= searches at the ZIP; address= checks the street; refusals carry the reason', async () => {
    const hammond = item({ title: 'Summit Roofing', phone: '+12195550177', latitude: 41.61, longitude: -87.51, address: '5 State St, Hammond, IN 46320' }, { city: 'Hammond', zip: '46320' });
    const f1 = fakeFetch([hammond]);
    const zip = await probe(q({ name: 'Summit Roofing LLC', state: 'IN', zip: '46320' }), f1);
    expect(zip.body).toMatchObject({ status: 'found', path: 'zip', wouldAttach: { phone: '219-555-0177' } });
    expect(sentTask(f1).location_coordinate).toBe('41.6099,-87.5079,25');

    const at = item({ title: 'Lakeview Bakery', phone: '+17735550199', latitude: 41.947, longitude: -87.638 }, { city: 'Chicago', zip: '60613', address: '200 W Addison St' });
    const elsewhere = item({ title: 'Lakeview Bakery', phone: '+17735550199', latitude: 41.947, longitude: -87.638 }, { city: 'Chicago', zip: '60613', address: '210 W Addison St' });
    expect((await probe(q({ name: 'Lakeview Bakery LLC', city: 'Chicago', state: 'IL', zip: '60613', address: '200 W Addison St' }), fakeFetch([at]))).body).toMatchObject({ status: 'found', path: 'site' });
    expect((await probe(q({ name: 'Lakeview Bakery LLC', city: 'Chicago', state: 'IL', zip: '60613', address: '200 W Addison St' }), fakeFetch([elsewhere]))).body).toMatchObject({ status: 'not_found', reason: 'address_mismatch' });

    const reasons: [unknown[], string, number?][] = [
      [[item({ work_time: { work_hours: { current_status: 'closed_forever' } } })], 'closed'],
      [[item(), item({ phone: '+14045559999' })], 'ambiguous'],
      [[item()], 'truncated', 40],
      [[item({}, { zip: '35203' })], 'state_mismatch'],
    ];
    for (const [items, reason, total] of reasons) {
      const f = vi.fn(async () => jsonRes(listingsBody(items, 0.013, total ?? items.length)));
      expect((await probe(q({ name: 'Peachtree Roofing LLC', city: 'Atlanta', state: 'GA' }), f)).body, reason).toMatchObject({ status: 'not_found', reason });
    }
    const generic = await probe(q({ name: 'Coin Laundry', city: 'Chicago', state: 'IL' }), fakeFetch([]));
    expect(generic.body).toMatchObject({ status: 'skipped', reason: 'generic_name' });
    expect((await probe(q({ name: 'Lakeview Bakery LLC', city: 'Chicago', state: 'IL', address: '200 W Addison St' }), fakeFetch([]))).res.status).toBe(400);
  });

  it('the probe writes nothing to the cache, even when the table exists', async () => {
    const { store } = await probe(q({ name: 'Peachtree Roofing LLC', city: 'Atlanta', state: 'GA' }), fakeFetch([item()]));
    expect(store.tables.holler_business_lookup).toEqual([]);
    expect(store.tables.holler_dataforseo_spend).toHaveLength(1);
  });
});

describe('re-review probe 05: the day cap under overlapping runs', () => {
  const MADE_UP = ['Zorvex', 'Quillon', 'Brantex', 'Veltrix', 'Norvane', 'Kestrol', 'Dynavo', 'Luxora', 'Trivant', 'Solvex', 'Cendara', 'Fintrex', 'Halvory', 'Jorvald', 'Maxtera', 'Novarix', 'Orbanta', 'Pellarix', 'Quorva', 'Rivanta', 'Sintera', 'Tavorix', 'Ulvane', 'Vextra', 'Wyndora', 'Xantrel', 'Yarvon', 'Zentiva', 'Arkelon', 'Bolvara'];
  const POOL = ['Roofing', 'Plumbing', 'Painting', 'Fencing', 'Paving', 'Masonry', 'Drywall', 'Flooring'].flatMap((t) => MADE_UP.map((w) => `${w} ${t}`)).filter((n) => nameRefusal(n, { city: 'Atlanta', state: 'GA' }) === null);
  const cardsFor = (run: number) => {
    const contacts = new Map<number, ContactRecord[]>();
    const cards = POOL.slice(run * 10, run * 10 + 10).map((name, i) => {
      const c = contractor(run * 100 + i + 1, name);
      contacts.set(c.signalId, [c]);
      return { signalId: c.signalId, city: 'Atlanta', state: 'GA', contact: c };
    });
    return { contacts, cards };
  };
  const booked = (db: ReturnType<typeof newDb>) => db.tables.holler_dataforseo_spend.filter((r) => r.status !== 'refused').length;
  async function overlap(runs: number, already: number, env: Record<string, string> = ENV, found = true) {
    const db = newDb({ holler_dataforseo_spend: Array.from({ length: already }, (_, i) => ({ id: i + 1, month: '2026-11-01', endpoint: '/v3/business_data/business_listings/search/live', cost_usd: 0.0192, status: 'ok', created_at: '2026-11-22T01:00:00Z' })) });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    // found=true: every lookup finds its own listing (the circuit breaker never trips); false: every answer is empty
    const fetch = vi.fn(async (_u?: unknown, init?: unknown) => (await gate, jsonRes(listingsBody(found ? [item({ title: JSON.parse((init as { body: string }).body)[0].title })] : []))));
    const ps = Array.from({ length: runs }, (_, run) => {
      const { contacts, cards } = cardsFor(run);
      const budget = newBudget(lookupSettings(env), 60_000);
      return lookupForCards(contacts, cards, budget, deps(db, fetch, { env })).then(() => budget);
    });
    await new Promise((r) => setTimeout(r, 60));
    release();
    const budgets = await Promise.all(ps);
    return { db, fetch, budgets };
  }

  it('5a / 5b 3 runs at 20, 8 runs from 0, 6 runs at 24, cap 1 with 3 runs: exactly the cap, never stuck', async () => {
    expect(POOL.length).toBeGreaterThanOrEqual(80);
    const a = await overlap(3, 20);
    expect(booked(a.db)).toBe(25);
    expect(a.fetch.mock.calls.length).toBe(5);
    const b = await overlap(8, 0);
    expect(booked(b.db)).toBe(25);
    expect(b.fetch.mock.calls.length).toBe(25);
    const c = await overlap(6, 24);
    expect(c.fetch.mock.calls.length).toBe(1);
    const d = await overlap(3, 0, { ...ENV, HOLLER_LOOKUP_MAX_PER_DAY: '1' });
    expect(d.fetch.mock.calls.length).toBe(1);
  });

  it('8 overlapping runs whose answers are all empty: never over the cap, and the circuit breaker stops the day once 5 answers are in', async () => {
    const e = await overlap(8, 0, ENV, false);
    expect(booked(e.db)).toBeLessThanOrEqual(25);
    expect(await lookupBreaker(e.db as never, NOW)).toMatchObject({ tripped: true });
    // a later run the same day makes no call
    const { contacts, cards } = cardsFor(9);
    const later = fakeFetch([]);
    const budget = newBudget(lookupSettings(ENV));
    await lookupForCards(contacts, cards, budget, deps(e.db, later));
    expect(later).not.toHaveBeenCalled();
    expect(budget.breaker).toMatch(/^Business lookups returned no usable match today \(\d+ tried\)\. Run the lookup probe\.$/);
  });
});
