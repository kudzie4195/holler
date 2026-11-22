import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));

import {
  ESTIMATE_PER_LOOKUP_USD,
  FOUND_TTL_DAYS,
  LOOKUP_PATH,
  NAME_MATCH_THRESHOLD,
  NOT_FOUND_TTL_DAYS,
  attachCachedListings,
  chooseListing,
  lookupBusiness,
  lookupForCards,
  lookupRequest,
  lookupSettings,
  mayLookUp,
  nameKey,
  nameScore,
  newBudget,
  parseListingItems,
  resolvePlace,
} from '@/lib/enrich/business-lookup';
import { PRICE_TABLE, estimateUsd } from '@/lib/dataforseo/client';
import type { ContactRecord } from '@/lib/contacts/types';
import { emailContact, outreachPlan } from '@/lib/outreach/plan';
import { renderDigest } from '@/lib/email/templates';
import { loadMemberContacts } from '@/lib/outreach/loader';
import { WhoToContact } from '@/components/feed/who-to-contact';
import { ATLANTA, ENV, MONTH, NOW, SECRETS, dbWithoutCache, fakeFetch, item, jsonRes, listingsBody, newDb } from './helpers';

const contractor = (over: Partial<ContactRecord> = {}): ContactRecord => ({ signalId: 1, role: 'contractor', name: 'Peachtree Roofing LLC', city: null, state: null, ...over });
const card = (c: ContactRecord | null, over: Record<string, unknown> = {}) => ({ signalId: c?.signalId ?? 1, city: 'Atlanta', state: 'GA', contact: c, ...over });
const deps = (db: unknown, fetch: unknown, env: Record<string, string | undefined> = ENV) => ({ db: db as never, fetch: fetch as typeof globalThis.fetch, env, now: () => NOW, sleep: async () => {} });
const settingsBudget = (env: Record<string, string | undefined> = ENV) => newBudget(lookupSettings(env));

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  for (const m of ['log', 'warn', 'error', 'info', 'debug'] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
      logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  // No DataForSEO login, password or Basic token ever reaches a log line.
  for (const s of SECRETS) expect(logs.join('\n')).not.toContain(s);
});

describe('documented endpoint, request and price', () => {
  it('uses the Business Listings search live endpoint at $0.012 + $0.00036 per item, limit 10 is at most $0.0156', () => {
    expect(LOOKUP_PATH).toBe('/v3/business_data/business_listings/search/live');
    expect(PRICE_TABLE.businessListingsSearch).toMatchObject({ perTaskUsd: 0.012, perItemUsd: 0.00036, verified: true });
    expect(estimateUsd('businessListingsSearch', 10)).toBe(0.0156);
    expect(ESTIMATE_PER_LOOKUP_USD).toBe(0.0156);
  });
  it('sends title, location_coordinate "lat,lon,radius_km" and limit, nothing else', () => {
    const place = resolvePlace('Atlanta', 'GA')!;
    expect(lookupRequest('Peachtree Roofing LLC', place)).toEqual({ title: 'Peachtree Roofing LLC', location_coordinate: '33.749,-84.388,25', limit: 10 });
  });
  it('parses the documented item fields and ignores junk', () => {
    const got = parseListingItems(listingsBody([item(), { title: '' }, null, 'x']).tasks[0] as never);
    expect(got).toEqual([
      { title: 'Peachtree Roofing', phone: '+14045550123', url: 'https://www.peachtreeroofing.example/', domain: 'www.peachtreeroofing.example', city: 'Atlanta', region: 'GA', countryCode: 'US', lat: 33.7601, lon: -84.3912 },
    ]);
    expect(parseListingItems({ result: 'nope' } as never)).toEqual([]);
    expect(parseListingItems(null)).toEqual([]);
  });
});

describe('name matching', () => {
  it('ignores legal forms, punctuation, case, accents and "&" vs "and"', () => {
    expect(nameScore('Acme Roofing, L.L.C.', 'ACME ROOFING INC')).toBe(1);
    expect(nameScore('Smith & Sons Construction LLC', 'Smith and Sons Construction')).toBe(1);
    expect(nameScore('Café Brazil Restaurant', 'Cafe Brazil Restaurant')).toBe(1);
    expect(nameKey('The Acme Roofing Co.')).toBe('acme roofing');
  });
  it('ignores a listing word that is only the city or state', () => {
    expect(nameScore('Peachtree Roofing LLC', 'Peachtree Roofing Atlanta', { city: 'Atlanta', state: 'GA' })).toBe(1);
    expect(nameScore('Peachtree Roofing LLC', 'Peachtree Roofing of Georgia', { city: 'Atlanta', state: 'GA' })).toBe(1);
  });
  it(`refuses near misses below ${NAME_MATCH_THRESHOLD}`, () => {
    for (const [a, b] of [
      ['Peachtree Roofing LLC', 'Peachtree Roofing Supply'],
      ['ABC Electric LLC', 'ABC Electrical Contractors'],
      ['Smith Brothers Roofing', 'Smith Brothers Roofing Contractors'],
      ['Peachtree Roofing LLC', 'Peachtree Plumbing'],
    ]) expect(nameScore(a, b), `${a} / ${b}`).toBeLessThan(NAME_MATCH_THRESHOLD);
  });
});

describe('found and attached', () => {
  it('a matching listing in the same city is attached to the named contact, cached and booked in the ledger', async () => {
    const db = newDb();
    const fetch = fakeFetch([item()]);
    const c = contractor();
    const contacts = new Map([[1, [c]]]);
    const budget = settingsBudget();
    const out = await lookupForCards(contacts, [card(c)], budget, deps(db, fetch));
    expect(out.get(1)![0].listing).toEqual({ phone: '404-555-0123', website: 'https://www.peachtreeroofing.example/' });
    expect(contacts.get(1)![0].listing).toBeUndefined(); // the input map is not changed
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.dataforseo.com${LOOKUP_PATH}`);
    expect(JSON.parse(String(init.body))).toEqual([{ title: 'Peachtree Roofing LLC', location_coordinate: '33.749,-84.388,25', limit: 10 }]);
    // the ledger row: the existing DataForSEO spend table, this endpoint, settled to the response cost
    expect(db.tables.holler_dataforseo_spend).toHaveLength(1);
    expect(db.tables.holler_dataforseo_spend[0]).toMatchObject({ month: MONTH, endpoint: LOOKUP_PATH, units: 10, estimated_usd: 0.0156, cost_usd: 0.01396, status: 'ok' });
    // the cache row
    expect(db.tables.holler_business_lookup).toEqual([
      expect.objectContaining({ name_key: 'peachtree roofing', city_key: 'atlanta', state: 'GA', status: 'found', phone: '404-555-0123', website: 'https://www.peachtreeroofing.example/', listing_name: 'Peachtree Roofing', cost_usd: 0.01396, checked_at: NOW.toISOString() }),
    ]);
    expect(budget).toMatchObject({ calls: 1, found: 1, runLeft: 4, spentUsd: 0.01396 });
  });

  it('a listing in a nearby town within 25 km is accepted (Decatur, about 9 km from the Atlanta centre)', async () => {
    const db = newDb();
    const r = await lookupBusiness({ name: 'Peachtree Roofing LLC', city: 'Atlanta', state: 'GA' }, deps(db, fakeFetch([item({ latitude: 33.7748, longitude: -84.2963 }, { city: 'Decatur' })])));
    expect(r).toMatchObject({ status: 'found', source: 'api' });
  });

  it('the contact uses its own city and state when the record gives both', async () => {
    const db = newDb();
    const fetch = fakeFetch([item({ latitude: 33.9526, longitude: -84.5499 }, { city: 'Marietta' })]);
    const c = contractor({ city: 'Marietta', state: 'GA' });
    const out = await lookupForCards(new Map([[1, [c]]]), [card(c)], settingsBudget(), deps(db, fetch));
    expect(out.get(1)![0].listing?.phone).toBe('404-555-0123');
    expect(JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))[0].location_coordinate).toBe('33.9526,-84.5499,25');
  });
});

describe('rejected: on any doubt nothing is attached', () => {
  async function one(items: unknown[], name = 'Peachtree Roofing LLC') {
    const db = newDb();
    const c = contractor({ name });
    const out = await lookupForCards(new Map([[1, [c]]]), [card(c)], settingsBudget(), deps(db, fakeFetch(items)));
    return { listing: out.get(1)![0].listing, db };
  }

  it('near-miss name is rejected and cached as not found', async () => {
    const { listing, db } = await one([item({ title: 'Peachtree Roofing Supply' })]);
    expect(listing).toBeUndefined();
    expect(db.tables.holler_business_lookup).toEqual([expect.objectContaining({ status: 'not_found', phone: null, website: null, listing_name: null })]);
  });

  it('wrong city is rejected (Savannah, GA for an Atlanta record)', async () => {
    const { listing } = await one([item({ latitude: 32.0835, longitude: -81.0998 }, { city: 'Savannah' })]);
    expect(listing).toBeUndefined();
  });

  it('another state or country is rejected even with the same city name and point', async () => {
    expect((await one([item({}, { region: 'AL' })])).listing).toBeUndefined();
    expect((await one([item({}, { country_code: 'CA' })])).listing).toBeUndefined();
  });

  it('same city name but far from the centre, or no city and no point, is rejected', async () => {
    expect((await one([item({ latitude: 34.9, longitude: -84.388 })])).listing).toBeUndefined();
    expect((await one([item({ latitude: null, longitude: null }, { city: null })])).listing).toBeUndefined();
  });

  it('two matching listings with different phones are ambiguous', async () => {
    expect((await one([item(), item({ phone: '+14045559999' })])).listing).toBeUndefined();
  });

  it('a listing with an unusable phone and no website gives nothing', async () => {
    expect((await one([item({ phone: '+441615322922', url: null, domain: null })])).listing).toBeUndefined();
  });

  it('chooseListing says why', () => {
    const place = resolvePlace('Atlanta', 'GA')!;
    expect(chooseListing('Peachtree Roofing LLC', place, []).reason).toBe('no_listing');
    expect(chooseListing('Peachtree Roofing LLC', place, parseListingItems(listingsBody([item({ title: 'Other Co Roofing' })]).tasks[0] as never)).reason).toBe('no_match');
  });
});

describe('never a person, never a buyer, never a contact with its own details', () => {
  it('a person-shaped name is never sent, never looked up and never gets a listing', async () => {
    const db = newDb();
    const fetch = fakeFetch([item({ title: 'John Smith' })]);
    for (const name of ['John Smith', 'JOHN SMITH ROOFING', 'Maria Lopez']) {
      expect(mayLookUp(contractor({ name }))).toBe(false);
      expect(await lookupBusiness({ name, city: 'Atlanta', state: 'GA' }, deps(db, fetch))).toMatchObject({ status: 'skipped', reason: 'not_business' });
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(db.calls).toEqual([]);
  });

  it('a public buyer, a site and a contact that has a phone or website on the record are not looked up', async () => {
    const db = newDb();
    const fetch = fakeFetch([item()]);
    const list = [
      contractor({ role: 'buyer', name: 'City of Atlanta Department of Procurement' }),
      contractor({ role: 'site', name: '', address: '12 Main St' }),
      contractor({ phone: '404-555-0100' }),
      contractor({ website: 'peachtree.example' }),
    ];
    for (const c of list) {
      expect(mayLookUp(c)).toBe(false);
      await lookupForCards(new Map([[1, [c]]]), [card(c)], settingsBudget(), deps(db, fetch));
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a one-word name (after legal forms) is too vague to look up', async () => {
    const fetch = fakeFetch([item({ title: 'Gallagher Roofing' })]);
    expect(await lookupBusiness({ name: 'Gallagher Roofing LLC', city: 'Atlanta', state: 'GA' }, deps(newDb(), fetch))).toMatchObject({ status: 'found' });
    const r = await lookupBusiness({ name: 'Kowalski LLC', city: 'Atlanta', state: 'GA' }, deps(newDb(), fetch));
    expect(r.status === 'skipped' && ['short_name', 'not_business'].includes(r.reason)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('an unknown city (no coordinates) is not looked up', async () => {
    const fetch = fakeFetch([item()]);
    expect(await lookupBusiness({ name: 'Peachtree Roofing LLC', city: 'Nowhereville', state: 'GA' }, deps(newDb(), fetch))).toMatchObject({ status: 'skipped', reason: 'no_place' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('cache', () => {
  const row = (over: Record<string, unknown>) => ({ name_key: 'peachtree roofing', city_key: 'atlanta', state: 'GA', status: 'found', phone: '404-555-0123', website: 'https://www.peachtreeroofing.example/', listing_name: 'Peachtree Roofing', checked_at: NOW.toISOString(), ...over });
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

  it('a fresh found row is used with no call', async () => {
    const db = newDb({ holler_business_lookup: [row({ checked_at: daysAgo(FOUND_TTL_DAYS - 1) })] });
    const fetch = fakeFetch([item()]);
    const c = contractor();
    const budget = settingsBudget();
    const out = await lookupForCards(new Map([[1, [c]]]), [card(c)], budget, deps(db, fetch));
    expect(out.get(1)![0].listing).toEqual({ phone: '404-555-0123', website: 'https://www.peachtreeroofing.example/' });
    expect(fetch).not.toHaveBeenCalled();
    expect(db.tables.holler_dataforseo_spend).toEqual([]);
    expect(budget).toMatchObject({ cacheHits: 1, calls: 0 });
  });

  it('a fresh not-found row is used with no call and attaches nothing', async () => {
    const db = newDb({ holler_business_lookup: [row({ status: 'not_found', phone: null, website: null, listing_name: null, checked_at: daysAgo(NOT_FOUND_TTL_DAYS - 1) })] });
    const fetch = fakeFetch([item()]);
    const c = contractor();
    const out = await lookupForCards(new Map([[1, [c]]]), [card(c)], settingsBudget(), deps(db, fetch));
    expect(out.get(1)![0].listing).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('found expires after 90 days and not-found after 30: then one new call', async () => {
    for (const r of [row({ checked_at: daysAgo(FOUND_TTL_DAYS + 1) }), row({ status: 'not_found', phone: null, website: null, listing_name: null, checked_at: daysAgo(NOT_FOUND_TTL_DAYS + 1) })]) {
      const fetch = fakeFetch([item()]);
      const got = await lookupBusiness({ name: 'Peachtree Roofing LLC', city: 'Atlanta', state: 'GA' }, deps(newDb({ holler_business_lookup: [r] }), fetch));
      expect(got).toMatchObject({ status: 'found', source: 'api' });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it('display side: attachCachedListings reads the cache only (no call) and checks the classifier and place again', async () => {
    const db = newDb({ holler_business_lookup: [row({}), row({ name_key: 'john smith' })] });
    const contacts = new Map<number, ContactRecord[]>([
      [1, [contractor()]],
      [2, [contractor({ signalId: 2, name: 'John Smith' })]],
      [3, [contractor({ signalId: 3, phone: '404-555-0100' })]],
    ]);
    const places = new Map([1, 2, 3].map((id) => [id, { city: 'Atlanta', state: 'GA' }]));
    const out = await attachCachedListings(db as never, contacts, places, NOW);
    expect(out.get(1)![0].listing).toEqual({ phone: '404-555-0123', website: 'https://www.peachtreeroofing.example/' });
    expect(out.get(2)![0].listing).toBeUndefined();
    expect(out.get(3)![0].listing).toBeUndefined();
    // another city: no listing
    const other = await attachCachedListings(db as never, contacts, new Map([[1, { city: 'Savannah', state: 'GA' }]]), NOW);
    expect(other.get(1)![0].listing).toBeUndefined();
  });
});

describe('spend control', () => {
  it('cap reached: no call, cards unchanged, the refused reservation costs nothing', async () => {
    const db = newDb({ holler_dataforseo_spend: [{ id: 1, month: MONTH, endpoint: '/v3/keywords_data/google_ads/search_volume/live', cost_usd: 29.999, status: 'ok' }] });
    const fetch = fakeFetch([item()]);
    const c = contractor();
    const c2 = contractor({ signalId: 2, name: 'Gallagher Roofing LLC' });
    const budget = settingsBudget();
    const out = await lookupForCards(new Map([[1, [c]], [2, [c2]]]), [card(c), card(c2)], budget, deps(db, fetch));
    expect(fetch).not.toHaveBeenCalled();
    expect(out.get(1)![0].listing).toBeUndefined();
    expect(budget.skipped).toEqual({ cap_reached: 1 }); // the second card is not even tried
    expect(db.tables.holler_dataforseo_spend.slice(1)).toEqual([expect.objectContaining({ status: 'refused', cost_usd: 0 })]);
    expect(db.tables.holler_business_lookup).toEqual([]);
  });

  it('credentials absent: a no-op with no database access at all', async () => {
    for (const env of [{}, { DATAFORSEO_LOGIN: 'x' }, { DATAFORSEO_PASSWORD: 'y' }]) {
      const db = newDb();
      const fetch = fakeFetch([item()]);
      const c = contractor();
      const contacts = new Map([[1, [c]]]);
      const out = await lookupForCards(contacts, [card(c)], settingsBudget(env), deps(db, fetch, env));
      expect(out).toEqual(contacts);
      expect(fetch).not.toHaveBeenCalled();
      expect(db.calls).toEqual([]);
    }
  });

  it('migration 0026 missing (PGRST205 and 42P01): no call, no ledger row, cards unchanged, and the display read changes nothing', async () => {
    for (const code of ['PGRST205', '42P01'] as const) {
      const db = dbWithoutCache(code);
      const fetch = fakeFetch([item()]);
      const c = contractor();
      const c2 = contractor({ signalId: 2, name: 'Gallagher Roofing LLC' });
      const contacts = new Map([[1, [c]], [2, [c2]]]);
      const budget = settingsBudget();
      const out = await lookupForCards(contacts, [card(c), card(c2)], budget, deps(db, fetch));
      expect(out).toEqual(contacts);
      expect(fetch).not.toHaveBeenCalled();
      expect(db.tables.holler_dataforseo_spend).toEqual([]);
      expect(budget.skipped).toEqual({ cache_missing: 1 }); // stops after the first: one read per run, not one per card
      expect(await attachCachedListings(db as never, contacts, new Map([[1, { city: 'Atlanta', state: 'GA' }]]), NOW)).toEqual(contacts);
    }
  });

  it('per-run cap: at most HOLLER_LOOKUP_MAX_PER_RUN calls', async () => {
    const env = { ...ENV, HOLLER_LOOKUP_MAX_PER_RUN: '1' };
    const db = newDb();
    const fetch = fakeFetch([item({ title: 'Nobody Matches Here' })]);
    const cs = [contractor(), contractor({ signalId: 2, name: 'Gallagher Roofing LLC' })];
    const budget = settingsBudget(env);
    await lookupForCards(new Map(cs.map((c) => [c.signalId, [c]])), cs.map((c) => card(c)), budget, deps(db, fetch, env));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(budget.calls).toBe(1);
  });

  it('per-day cap: today\'s ledger rows for this endpoint count, refused ones do not', async () => {
    const today = (status: string) => ({ month: MONTH, endpoint: LOOKUP_PATH, cost_usd: 0.014, status, created_at: '2026-11-22T01:00:00Z' });
    const env = { ...ENV, HOLLER_LOOKUP_MAX_PER_DAY: '2' };
    const full = newDb({ holler_dataforseo_spend: [today('ok'), today('error')] });
    const fetch = fakeFetch([item()]);
    expect(await lookupBusiness({ name: 'Peachtree Roofing LLC', city: 'Atlanta', state: 'GA' }, deps(full, fetch, env))).toMatchObject({ status: 'skipped', reason: 'day_cap' });
    const notFull = newDb({ holler_dataforseo_spend: [today('ok'), today('refused'), { ...today('ok'), created_at: '2026-11-21T23:00:00Z' }] });
    expect(await lookupBusiness({ name: 'Peachtree Roofing LLC', city: 'Atlanta', state: 'GA' }, deps(notFull, fetch, env))).toMatchObject({ status: 'found' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('defaults and zero', () => {
    expect(lookupSettings({})).toEqual({ maxPerRun: 5, maxPerDay: 25, dryRun: false, configured: false });
    expect(lookupSettings({ ...ENV, HOLLER_LOOKUP_MAX_PER_RUN: 'abc', HOLLER_LOOKUP_MAX_PER_DAY: '-1' })).toMatchObject({ maxPerRun: 5, maxPerDay: 25, configured: true });
    expect(lookupSettings({ HOLLER_LOOKUP_MAX_PER_RUN: '0', HOLLER_LOOKUP_DRY_RUN: 'yes' })).toMatchObject({ maxPerRun: 0, dryRun: true });
  });

  it('a cap of 0 or the dry-run flag makes no call', async () => {
    for (const env of [{ ...ENV, HOLLER_LOOKUP_MAX_PER_RUN: '0' }, { ...ENV, HOLLER_LOOKUP_MAX_PER_DAY: '0' }, { ...ENV, HOLLER_LOOKUP_DRY_RUN: '1' }]) {
      const db = newDb();
      const fetch = fakeFetch([item()]);
      const c = contractor();
      const out = await lookupForCards(new Map([[1, [c]]]), [card(c)], settingsBudget(env), deps(db, fetch, env));
      expect(out.get(1)![0].listing).toBeUndefined();
      expect(fetch).not.toHaveBeenCalled();
      expect(db.tables.holler_dataforseo_spend).toEqual([]);
    }
    expect(await lookupBusiness({ name: 'Peachtree Roofing LLC', city: 'Atlanta', state: 'GA' }, deps(newDb(), fakeFetch([item()])), { dryRun: true })).toMatchObject({
      status: 'skipped',
      reason: 'dry_run',
      estimateUsd: 0.0156,
      request: { title: 'Peachtree Roofing LLC', location_coordinate: '33.749,-84.388,25', limit: 10 },
    });
  });
});

describe('no secret in logs, results or stored rows', () => {
  it('HTTP 500 twice, a 401, a network error and a bad body: outcomes, rows and logs never hold the login, password or Basic token', async () => {
    const bodies: (() => Promise<Response>)[] = [
      async () => jsonRes({ status_code: 50000, status_message: `Internal error for ${ENV.DATAFORSEO_LOGIN}` }, 500),
      async () => jsonRes({ status_code: 40100, status_message: 'You are not authorized' }, 401),
      async () => {
        throw new TypeError('fetch failed');
      },
      async () => new Response('<html>oops</html>', { status: 200 }),
      async () => jsonRes(listingsBody([item()])),
    ];
    const seen: string[] = [];
    for (const b of bodies) {
      const db = newDb();
      const fetch = vi.fn(b);
      const r = await lookupBusiness({ name: 'Peachtree Roofing LLC', city: 'Atlanta', state: 'GA' }, deps(db, fetch));
      seen.push(JSON.stringify(r), JSON.stringify(db.tables));
    }
    for (const s of SECRETS) expect(seen.join('\n')).not.toContain(s);
  });
});

describe('display: card and email, English and Spanish', () => {
  const listing = { phone: '404-555-0123', website: 'https://www.peachtreeroofing.example/' };
  const signal = { source: 'socrata-atlanta-permits', kind: 'permit', city: 'Atlanta', state: 'GA' };

  it('the card entry carries the listing lines; a contact with its own phone shows no listing', () => {
    const plan = outreachPlan(signal, [{ role: 'contractor', name: 'Peachtree Roofing LLC', listing }], 'en');
    expect(plan?.type).toBe('org');
    const e = plan!.type === 'org' ? plan!.entries[0] : null;
    expect(e?.listing).toEqual({ phone: '404-555-0123', website: { href: 'https://www.peachtreeroofing.example/', text: 'peachtreeroofing.example' }, note: "Phone and website from the business's public listing, not from the public record." });
    const own = outreachPlan(signal, [{ role: 'contractor', name: 'Peachtree Roofing LLC', phone: '404-555-0100', listing }], 'en');
    expect(own!.type === 'org' && own!.entries[0].listing).toBeNull();
    const none = outreachPlan(signal, [{ role: 'contractor', name: 'Peachtree Roofing LLC' }], 'en');
    expect(none!.type === 'org' && none!.entries[0].listing).toBeNull();
  });

  it('the card renders Phone and Website under the name, the link has rel="noopener noreferrer nofollow", in English and Spanish', () => {
    const contacts = [{ role: 'contractor' as const, name: 'Peachtree Roofing LLC', listing }];
    const en = renderToStaticMarkup(createElement(WhoToContact, { item: signal, contacts, lang: 'en' }));
    expect(en).toContain('Phone: 404-555-0123');
    expect(en).toMatch(/Website:\s*<a href="https:\/\/www\.peachtreeroofing\.example\/" target="_blank" rel="noopener noreferrer nofollow"[^>]*>peachtreeroofing\.example<\/a>/);
    expect(en).toContain('Phone and website from the business&#x27;s public listing, not from the public record.');
    expect(en.indexOf('Peachtree Roofing LLC')).toBeLessThan(en.indexOf('Phone: 404-555-0123'));
    const es = renderToStaticMarkup(createElement(WhoToContact, { item: signal, contacts, lang: 'es' }));
    expect(es).toContain('Teléfono: 404-555-0123');
    expect(es).toContain('Sitio web:');
    expect(es).toContain('Teléfono y sitio web tomados de la ficha pública del negocio, no del registro público.');
  });

  it('a javascript: or odd website is never a link', () => {
    const plan = outreachPlan(signal, [{ role: 'contractor', name: 'Peachtree Roofing LLC', listing: { phone: null, website: 'javascript:alert(1)' } }], 'en');
    expect(plan!.type === 'org' && plan!.entries[0].listing).toBeNull();
  });

  it('the email shows the listing under the Contact line, html and text, English and Spanish; without a listing it is as before', () => {
    const contact = emailContact(signal, [{ role: 'contractor', name: 'Peachtree Roofing LLC', listing }], 'en');
    expect(contact).toMatchObject({ name: 'Peachtree Roofing LLC', listing: { phone: '404-555-0123' } });
    const item0 = { kind: 'permit', source: 'socrata-atlanta-permits', title: 'New roofing permit', place: 'Atlanta, GA', occurredAt: NOW.toISOString() };
    const mail = renderDigest({ businessName: 'Acme', items: [{ ...item0, contact }], appUrl: 'https://x.test/app', unsubscribeUrl: 'https://x.test/u', now: NOW });
    expect(mail.html).toContain('Phone: 404-555-0123');
    expect(mail.html).toContain('Website: <a href="https://www.peachtreeroofing.example/" rel="noopener noreferrer nofollow"');
    expect(mail.html).toContain('Phone and website from the business&#39;s public listing') ;
    expect(mail.text).toContain('Contact: Peachtree Roofing LLC (Named on this permit)\nPhone: 404-555-0123\nWebsite: https://www.peachtreeroofing.example/\nPhone and website from');
    const esContact = emailContact(signal, [{ role: 'contractor', name: 'Peachtree Roofing LLC', listing }], 'es');
    const esMail = renderDigest({ businessName: 'Acme', items: [{ ...item0, contact: esContact }], appUrl: 'https://x.test/app', unsubscribeUrl: 'https://x.test/u', now: NOW, lang: 'es' });
    expect(esMail.text).toContain('Teléfono: 404-555-0123');
    expect(esMail.text).toContain('Sitio web: https://www.peachtreeroofing.example/');
    // no listing: exactly the old shape and the old lines
    expect(emailContact(signal, [{ role: 'contractor', name: 'Peachtree Roofing LLC' }], 'en')).toEqual({ name: 'Peachtree Roofing LLC', role: 'Named on this permit' });
    const plain = renderDigest({ businessName: 'Acme', items: [{ ...item0, contact: { name: 'Peachtree Roofing LLC', role: 'Named on this permit' } }], appUrl: 'https://x.test/app', unsubscribeUrl: 'https://x.test/u', now: NOW });
    expect(plain.html).not.toContain('public listing');
    expect(plain.text).not.toContain('Phone:');
  });

  it('a locked member gets no contacts and no listing: the loader is not called and the cache is not read', async () => {
    const db = newDb({ holler_business_lookup: [{ name_key: 'peachtree roofing', city_key: 'atlanta', state: 'GA', status: 'found', phone: '404-555-0123', website: null, listing_name: 'x', checked_at: NOW.toISOString() }] });
    const loader = vi.fn(async () => new Map([[1, [contractor()]]]));
    const out = await loadMemberContacts({ db: db as never, userId: 'u1', signalIds: [1], locked: true, loader, places: new Map([[1, { city: 'Atlanta', state: 'GA' }]]) });
    expect(out.size).toBe(0);
    expect(loader).not.toHaveBeenCalled();
    expect(db.calls).toEqual([]);
    // unlocked: the cached listing rides along
    const open = await loadMemberContacts({ db: db as never, userId: 'u1', signalIds: [1], loader, places: new Map([[1, { city: 'Atlanta', state: 'GA' }]]) });
    expect(open.get(1)![0].listing).toEqual({ phone: '404-555-0123', website: null });
    // no places passed (the mobile feed): unchanged
    const noPlaces = await loadMemberContacts({ db: db as never, userId: 'u1', signalIds: [1], loader });
    expect(noPlaces.get(1)![0].listing).toBeUndefined();
  });

  it('ATLANTA fixture matches the city list', () => {
    expect(resolvePlace('atlanta', 'ga')).toMatchObject(ATLANTA);
  });
});
