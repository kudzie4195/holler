import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));

import {
  ESTIMATE_PER_LOOKUP_USD,
  FOUND_TTL_DAYS,
  LOOKUP_PATH,
  NOT_FOUND_TTL_DAYS,
  RETRY_TTL_HOURS,
  attachCachedListings,
  chooseListing,
  isGenericName,
  lookupBusiness,
  lookupForCards,
  lookupInputFor,
  lookupRequest,
  lookupSettings,
  mayLookUp,
  nameKey,
  namesMatch,
  newBudget,
  parseListingItems,
  parseListingResult,
  resolvePlace,
  titleForRequest,
} from '@/lib/enrich/business-lookup';
import { PRICE_TABLE, estimateUsd } from '@/lib/dataforseo/client';
import type { ContactRecord } from '@/lib/contacts/types';
import { emailContact, outreachPlan } from '@/lib/outreach/plan';
import { renderDigest } from '@/lib/email/templates';
import { loadMemberContacts } from '@/lib/outreach/loader';
import { WhoToContact } from '@/components/feed/who-to-contact';
import { ATLANTA, ENV, MONTH, NOW, SECRETS, dbWithoutCache, fakeFetch, item, jsonRes, listingsBody, newDb, sentTask, todayRows } from './helpers';

const contractor = (over: Partial<ContactRecord> = {}): ContactRecord => ({ signalId: 1, role: 'contractor', name: 'Peachtree Roofing LLC', city: null, state: null, ...over });
const card = (c: ContactRecord | null, over: Record<string, unknown> = {}) => ({ signalId: c?.signalId ?? 1, city: 'Atlanta', state: 'GA', contact: c, ...over });
const deps = (db: unknown, fetch: unknown, env: Record<string, string | undefined> = ENV) => ({ db: db as never, fetch: fetch as typeof globalThis.fetch, env, now: () => NOW, sleep: async () => {} });
const settingsBudget = (env: Record<string, string | undefined> = ENV) => newBudget(lookupSettings(env));
const ATL = () => resolvePlace('Atlanta', 'GA')!;

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
  vi.unstubAllEnvs();
  // No DataForSEO login, password or Basic token ever reaches a log line.
  for (const s of SECRETS) expect(logs.join('\n')).not.toContain(s);
});

describe('documented endpoint, request and price', () => {
  it('uses the Business Listings search live endpoint at $0.012 + $0.00036 per item, limit 20 is at most $0.0192', () => {
    expect(LOOKUP_PATH).toBe('/v3/business_data/business_listings/search/live');
    expect(PRICE_TABLE.businessListingsSearch).toMatchObject({ perTaskUsd: 0.012, perItemUsd: 0.00036, verified: true });
    expect(estimateUsd('businessListingsSearch', 20)).toBe(0.0192);
    expect(ESTIMATE_PER_LOOKUP_USD).toBe(0.0192);
  });
  it('sends title without the legal form, location_coordinate "lat,lon,radius_km" and limit, nothing else', () => {
    expect(lookupRequest('Peachtree Roofing LLC', ATL())).toEqual({ title: 'Peachtree Roofing', location_coordinate: '33.749,-84.388,25', limit: 20 });
    expect(titleForRequest('Peachtree Roofing, L.L.C.')).toBe('Peachtree Roofing');
    expect(titleForRequest('Acme Roofing Co. Inc.')).toBe('Acme Roofing');
    expect(titleForRequest('Smith & Sons Construction')).toBe('Smith & Sons Construction');
  });
  it('parses the documented item fields and total_count, never region, and ignores junk', () => {
    const got = parseListingResult(listingsBody([item(), { title: '' }, null, 'x'], 0.01, 36).tasks[0] as never);
    expect(got.totalCount).toBe(36);
    expect(got.items).toEqual([
      { title: 'Peachtree Roofing', phone: '+14045550123', url: 'https://www.peachtreeroofing.example/', domain: 'www.peachtreeroofing.example', address: '100 Example St NW, Atlanta, GA 30303', street: '100 Example St NW', city: 'Atlanta', zip: '30303', countryCode: 'US', status: 'open', lat: 33.7601, lon: -84.3912 },
    ]);
    expect(parseListingItems({ result: 'nope' } as never)).toEqual([]);
    expect(parseListingItems(null)).toEqual([]);
  });
});

describe('name matching: equal word sets after trailing legal forms', () => {
  it('legal forms, punctuation, case, accents and "&" vs "and" are ignored', () => {
    expect(namesMatch('Acme Roofing, L.L.C.', 'ACME ROOFING INC')).toBe(true);
    expect(namesMatch('Smith & Sons Construction LLC', 'Smith and Sons Construction')).toBe(true);
    expect(namesMatch('Café Brazil Restaurant', 'Cafe Brazil Restaurant')).toBe(true);
    expect(nameKey('Acme Roofing Co.')).toBe('acme roofing');
  });
  it('no extra word, no place word dropped', () => {
    for (const [a, b] of [
      ['Peachtree Roofing LLC', 'Peachtree Roofing Supply'],
      ['Peachtree Roofing LLC', 'Peachtree Roofing Atlanta'],
      ['Peachtree Heating Cooling Plumbing', 'Peachtree Heating Cooling Plumbing Supply'],
      ['Rising Roofing LLC', 'Phoenix Rising Roofing'],
      ['Casa Roofing LLC', 'La Casa Roofing'],
      ['Smith Brothers Roofing', 'Smith Brothers Roofing Contractors'],
    ]) expect(namesMatch(a, b), `${a} / ${b}`).toBe(false);
  });
});

describe('placeholders and generic names are never sent', () => {
  it('the documented list and the distinctive-word rule', () => {
    for (const n of ['General Contractor', 'Home Daycare', 'Owner', 'Self', 'Unknown', 'N/A', 'TBD', 'Various', 'Roofing Contractor', 'Family Child Care Home', 'Property Management', 'Handyman Services', 'Contractor TBD', 'Self Contractor']) {
      expect(isGenericName(n), n).toBe(true);
    }
    expect(isGenericName('Atlanta Roofing', { city: 'Atlanta', state: 'GA' })).toBe(true);
    expect(isGenericName('Peachtree Roofing LLC')).toBe(false);
    expect(isGenericName('Kowalski Roofing')).toBe(false);
  });
  it('a generic name makes no call and gets no listing', async () => {
    const fetch = fakeFetch([item({ title: 'Home Daycare' })]);
    for (const name of ['General Contractor', 'Home Daycare', 'Roofing Contractor', 'Atlanta Roofing']) {
      const r = await lookupBusiness({ name, city: 'Atlanta', state: 'GA' }, deps(newDb(), fetch));
      expect(r.status === 'skipped' && ['generic_name', 'not_business'].includes(r.reason), name).toBe(true);
      expect(mayLookUp(contractor({ name })) && !isGenericName(name, { city: 'Atlanta', state: 'GA' }), name).toBe(false);
    }
    expect(fetch).not.toHaveBeenCalled();
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
    expect(String(fetch.mock.calls[0][0])).toBe(`https://api.dataforseo.com${LOOKUP_PATH}`);
    expect(sentTask(fetch)).toEqual({ title: 'Peachtree Roofing', location_coordinate: '33.749,-84.388,25', limit: 20 });
    expect(db.tables.holler_dataforseo_spend).toEqual([expect.objectContaining({ month: MONTH, endpoint: LOOKUP_PATH, units: 20, estimated_usd: 0.0192, cost_usd: 0.01596, status: 'ok' })]);
    // the retry claim was replaced by the answer (merge upsert)
    expect(db.tables.holler_business_lookup).toEqual([
      expect.objectContaining({ name_key: 'peachtree roofing', city_key: 'atlanta', state: 'GA', status: 'found', phone: '404-555-0123', website: 'https://www.peachtreeroofing.example/', listing_name: 'Peachtree Roofing', cost_usd: 0.01596, checked_at: NOW.toISOString() }),
    ]);
    expect(budget).toMatchObject({ calls: 1, found: 1, runLeft: 4, spentUsd: 0.01596 });
  });

  it('a listing in a nearby town within 25 km and the same state is accepted (Decatur, about 9 km)', async () => {
    const r = await lookupBusiness({ name: 'Peachtree Roofing LLC', city: 'Atlanta', state: 'GA' }, deps(newDb(), fakeFetch([item({ latitude: 33.7748, longitude: -84.2963 }, { city: 'Decatur', zip: '30030' })])));
    expect(r).toMatchObject({ status: 'found', source: 'api' });
  });

  it('the contact\'s own ZIP is where it is looked up (Marietta), not the job city', async () => {
    const db = newDb();
    const fetch = fakeFetch([item({ latitude: 33.9526, longitude: -84.5499 }, { city: 'Marietta', zip: '30060' })]);
    const c = contractor({ city: null, state: 'GA', zip: '30060' });
    const out = await lookupForCards(new Map([[1, [c]]]), [card(c)], settingsBudget(), deps(db, fetch));
    expect(out.get(1)![0].listing?.phone).toBe('404-555-0123');
    expect(sentTask(fetch).location_coordinate).toBe('33.9382,-84.5403,25');
    expect(db.tables.holler_business_lookup[0]).toMatchObject({ city_key: 'marietta 30060', state: 'GA' });
  });

  it('two listings that are plainly the same business (same phone AND same host) are accepted', () => {
    const r = chooseListing('Peachtree Roofing LLC', ATL(), parseListingItems(listingsBody([item(), item({ url: 'https://peachtreeroofing.example/contact' })]).tasks[0] as never));
    expect(r).toMatchObject({ reason: 'found', choice: { candidates: 2 } });
  });
});

describe('rejected: on any doubt nothing is attached', () => {
  async function one(items: unknown[], name = 'Peachtree Roofing LLC', totalCount?: number) {
    const db = newDb();
    const c = contractor({ name });
    const fetch = vi.fn(async () => jsonRes(listingsBody(items, 0.015, totalCount ?? items.length)));
    const out = await lookupForCards(new Map([[1, [c]]]), [card(c)], settingsBudget(), deps(db, fetch));
    return { listing: out.get(1)![0].listing, db };
  }

  it('near-miss name is rejected and cached as not found', async () => {
    const { listing, db } = await one([item({ title: 'Peachtree Roofing Supply' })]);
    expect(listing).toBeUndefined();
    expect(db.tables.holler_business_lookup).toEqual([expect.objectContaining({ status: 'not_found', phone: null, website: null, listing_name: null })]);
  });

  it('wrong city is rejected (Savannah, GA for an Atlanta record)', async () => {
    expect((await one([item({ latitude: 32.0835, longitude: -81.0998 }, { city: 'Savannah', zip: '31401' })])).listing).toBeUndefined();
  });

  it('another state by ZIP, another country, or no readable ZIP: rejected (region is never read)', async () => {
    expect((await one([item({}, { zip: '35203' })])).listing).toBeUndefined(); // an Alabama ZIP
    expect((await one([item({}, { country_code: 'CA' })])).listing).toBeUndefined();
    expect((await one([item({ address: '100 Example St NW, Atlanta' }, { zip: null })])).listing).toBeUndefined();
    expect((await one([item({ address: null }, { region: 'GA', zip: null })])).listing).toBeUndefined(); // a region alone is no proof of state
  });

  it('same city name but far away, or no point and a ZIP far away (city text alone never decides, review 2 P3-F): rejected', async () => {
    expect((await one([item({ latitude: 34.9, longitude: -84.388 })])).listing).toBeUndefined();
    expect((await one([item({ latitude: null, longitude: null, address: null }, { city: 'Atlanta', zip: '31401' })])).listing).toBeUndefined();
  });

  it('two same-named listings that are not plainly the same business are ambiguous', async () => {
    expect((await one([item(), item({ phone: '+14045559999' })])).listing).toBeUndefined();
    expect((await one([item({ url: null, domain: null }), item({ phone: null })])).listing).toBeUndefined();
  });

  it('total_count larger than the items returned is ambiguous', async () => {
    expect((await one([item()], 'Peachtree Roofing LLC', 36)).listing).toBeUndefined();
  });

  it('a listing with an unusable phone and no website gives nothing', async () => {
    expect((await one([item({ phone: '+441615322922', url: null, domain: null })])).listing).toBeUndefined();
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
    const fetch = fakeFetch([item()]);
    for (const c of [
      contractor({ role: 'buyer', name: 'City of Atlanta Department of Procurement' }),
      contractor({ role: 'site', name: '', address: '12 Main St' }),
      contractor({ phone: '404-555-0100' }),
      contractor({ website: 'peachtree.example' }),
    ]) {
      expect(mayLookUp(c)).toBe(false);
      await lookupForCards(new Map([[1, [c]]]), [card(c)], settingsBudget(), deps(newDb(), fetch));
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

  it('an unknown city (no coordinates) or another state with no city or ZIP is not looked up', async () => {
    const fetch = fakeFetch([item()]);
    expect(await lookupBusiness({ name: 'Peachtree Roofing LLC', city: 'Nowhereville', state: 'GA' }, deps(newDb(), fetch))).toMatchObject({ status: 'skipped', reason: 'no_place' });
    expect(lookupInputFor(contractor({ state: 'AL' }), [], { city: 'Atlanta', state: 'GA' })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('cache', () => {
  const row = (over: Record<string, unknown>) => ({ name_key: 'peachtree roofing', city_key: 'atlanta', state: 'GA', status: 'found', phone: '404-555-0123', website: 'https://www.peachtreeroofing.example/', listing_name: 'Peachtree Roofing', checked_at: NOW.toISOString(), ...over });
  const empty = { phone: null, website: null, listing_name: null };
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
  const DAY = 86_400_000;

  it('a fresh found row is used with no call', async () => {
    const db = newDb({ holler_business_lookup: [row({ checked_at: ago((FOUND_TTL_DAYS - 1) * DAY) })] });
    const fetch = fakeFetch([item()]);
    const c = contractor();
    const budget = settingsBudget();
    const out = await lookupForCards(new Map([[1, [c]]]), [card(c)], budget, deps(db, fetch));
    expect(out.get(1)![0].listing).toEqual({ phone: '404-555-0123', website: 'https://www.peachtreeroofing.example/' });
    expect(fetch).not.toHaveBeenCalled();
    expect(db.tables.holler_dataforseo_spend).toEqual([]);
    expect(budget).toMatchObject({ cacheHits: 1, calls: 0 });
  });

  it('a fresh not-found row and a fresh retry row are used with no call and attach nothing', async () => {
    for (const r of [row({ status: 'not_found', ...empty, checked_at: ago((NOT_FOUND_TTL_DAYS - 1) * DAY) }), row({ status: 'retry', ...empty, checked_at: ago((RETRY_TTL_HOURS - 1) * 3_600_000) })]) {
      const fetch = fakeFetch([item()]);
      const c = contractor();
      const out = await lookupForCards(new Map([[1, [c]]]), [card(c)], settingsBudget(), deps(newDb({ holler_business_lookup: [r] }), fetch));
      expect(out.get(1)![0].listing).toBeUndefined();
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it('found expires after 90 days, not-found after 30, retry after 6 hours: then one new call that replaces the row', async () => {
    for (const r of [row({ checked_at: ago((FOUND_TTL_DAYS + 1) * DAY), phone: '404-555-0999' }), row({ status: 'not_found', ...empty, checked_at: ago((NOT_FOUND_TTL_DAYS + 1) * DAY) }), row({ status: 'retry', ...empty, checked_at: ago((RETRY_TTL_HOURS + 1) * 3_600_000) })]) {
      const fetch = fakeFetch([item()]);
      const db = newDb({ holler_business_lookup: [r] });
      const got = await lookupBusiness({ name: 'Peachtree Roofing LLC', city: 'Atlanta', state: 'GA' }, deps(db, fetch));
      expect(got).toMatchObject({ status: 'found', source: 'api', listing: { phone: '404-555-0123' } });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(db.tables.holler_business_lookup).toEqual([expect.objectContaining({ status: 'found', phone: '404-555-0123', checked_at: NOW.toISOString() })]);
    }
  });

  it('display side: reads the cache only, checks the classifier and place again; not-found is marked null; nothing without credentials', async () => {
    const db = newDb({ holler_business_lookup: [row({}), row({ name_key: 'john smith' }), row({ name_key: 'gallagher roofing', status: 'not_found', ...empty })] });
    const contacts = new Map<number, ContactRecord[]>([
      [1, [contractor()]],
      [2, [contractor({ signalId: 2, name: 'John Smith' })]],
      [3, [contractor({ signalId: 3, phone: '404-555-0100' })]],
      [4, [contractor({ signalId: 4, name: 'Gallagher Roofing LLC' })]],
    ]);
    const places = new Map([1, 2, 3, 4].map((id) => [id, { city: 'Atlanta', state: 'GA' }]));
    const out = await attachCachedListings(db as never, contacts, places, NOW, ENV);
    expect(out.get(1)![0].listing).toEqual({ phone: '404-555-0123', website: 'https://www.peachtreeroofing.example/' });
    expect(out.get(2)![0].listing).toBeUndefined();
    expect(out.get(3)![0].listing).toBeUndefined();
    expect(out.get(4)![0].listing).toBeNull();
    const other = await attachCachedListings(db as never, contacts, new Map([[1, { city: 'Savannah', state: 'GA' }]]), NOW, ENV);
    expect(other.get(1)![0].listing).toBeUndefined();
    const calls = db.calls.length;
    expect(await attachCachedListings(db as never, contacts, places, NOW, {})).toEqual(contacts);
    expect(db.calls.length).toBe(calls);
  });
});

describe('spend control', () => {
  it('cap reached: no call and no ledger row, cards unchanged, the run stops', async () => {
    const db = newDb({ holler_dataforseo_spend: [{ id: 1, month: MONTH, endpoint: '/v3/keywords_data/google_ads/search_volume/live', cost_usd: 29.999, status: 'ok' }] });
    const fetch = fakeFetch([item()]);
    const c = contractor();
    const c2 = contractor({ signalId: 2, name: 'Gallagher Roofing LLC' });
    const budget = settingsBudget();
    const out = await lookupForCards(new Map([[1, [c]], [2, [c2]]]), [card(c), card(c2)], budget, deps(db, fetch));
    expect(fetch).not.toHaveBeenCalled();
    expect(out.get(1)![0].listing).toBeUndefined();
    expect(budget.skipped.cap_reached).toBeGreaterThanOrEqual(1);
    expect(db.tables.holler_dataforseo_spend).toHaveLength(1); // checked before booking: no refused row every run
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
      expect(budget.skipped.cache_missing).toBeGreaterThanOrEqual(1);
      expect(await attachCachedListings(db as never, contacts, new Map([[1, { city: 'Atlanta', state: 'GA' }]]), NOW, ENV)).toEqual(contacts);
    }
  });

  it('per-run cap: at most HOLLER_LOOKUP_MAX_PER_RUN calls', async () => {
    const env = { ...ENV, HOLLER_LOOKUP_MAX_PER_RUN: '1' };
    const db = newDb();
    const fetch = fakeFetch([item({ title: 'Nobody Matches Here' })]);
    const cs = [contractor(), contractor({ signalId: 2, name: 'Gallagher Roofing LLC' }), contractor({ signalId: 3, name: 'Summit Roofing LLC' })];
    const budget = settingsBudget(env);
    await lookupForCards(new Map(cs.map((c) => [c.signalId, [c]])), cs.map((c) => card(c)), budget, deps(db, fetch, env));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(budget.calls).toBe(1);
  });

  it('per-day cap: today\'s ledger rows for this endpoint count, refused ones and yesterday\'s do not', async () => {
    const env = { ...ENV, HOLLER_LOOKUP_MAX_PER_DAY: '2' };
    const fetch = fakeFetch([item()]);
    const full = newDb({ holler_dataforseo_spend: [...todayRows(1), ...todayRows(1, 'error', 2)] });
    expect(await lookupBusiness({ name: 'Peachtree Roofing LLC', city: 'Atlanta', state: 'GA' }, deps(full, fetch, env))).toMatchObject({ status: 'skipped', reason: 'day_cap' });
    const notFull = newDb({ holler_dataforseo_spend: [...todayRows(1), ...todayRows(1, 'refused', 2), { ...todayRows(1, 'ok', 3)[0], created_at: '2026-11-21T23:00:00Z' }] });
    expect(await lookupBusiness({ name: 'Peachtree Roofing LLC', city: 'Atlanta', state: 'GA' }, deps(notFull, fetch, env))).toMatchObject({ status: 'found' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('defaults, zero, and a set but unreadable value means off (fails closed)', () => {
    expect(lookupSettings({})).toEqual({ maxPerRun: 5, maxPerDay: 25, dryRun: false, configured: false });
    expect(lookupSettings({ ...ENV, HOLLER_LOOKUP_MAX_PER_RUN: 'abc', HOLLER_LOOKUP_MAX_PER_DAY: '-1' })).toMatchObject({ maxPerRun: 0, maxPerDay: 0, configured: true });
    expect(lookupSettings({ HOLLER_LOOKUP_MAX_PER_DAY: 'off' })).toMatchObject({ maxPerDay: 0 });
    expect(lookupSettings({ HOLLER_LOOKUP_MAX_PER_RUN: '0', HOLLER_LOOKUP_DRY_RUN: 'yes' })).toMatchObject({ maxPerRun: 0, dryRun: true });
  });

  it('a cap of 0 or the dry-run flag makes no call and no database read', async () => {
    for (const env of [{ ...ENV, HOLLER_LOOKUP_MAX_PER_RUN: '0' }, { ...ENV, HOLLER_LOOKUP_MAX_PER_DAY: '0' }, { ...ENV, HOLLER_LOOKUP_DRY_RUN: '1' }]) {
      const db = newDb();
      const fetch = fakeFetch([item()]);
      const c = contractor();
      const out = await lookupForCards(new Map([[1, [c]]]), [card(c)], settingsBudget(env), deps(db, fetch, env));
      expect(out.get(1)![0].listing).toBeUndefined();
      expect(fetch).not.toHaveBeenCalled();
      expect(db.calls).toEqual([]);
    }
    expect(await lookupBusiness({ name: 'Peachtree Roofing LLC', city: 'Atlanta', state: 'GA' }, deps(newDb(), fakeFetch([item()])), { dryRun: true })).toMatchObject({
      status: 'skipped',
      reason: 'dry_run',
      estimateUsd: 0.0192,
      request: { title: 'Peachtree Roofing', location_coordinate: '33.749,-84.388,25', limit: 20 },
    });
  });
});

describe('no secret in logs, results or stored rows', () => {
  it('HTTP 500, a 401, a network error and a bad body: outcomes, rows and logs never hold the login, password or Basic token; one request each', async () => {
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
      expect(fetch).toHaveBeenCalledTimes(1); // no retry
      seen.push(JSON.stringify(r), JSON.stringify(db.tables));
    }
    for (const s of SECRETS) expect(seen.join('\n')).not.toContain(s);
  });
});

describe('display: card and email, English and Spanish', () => {
  const listing = { phone: '404-555-0123', website: 'https://www.peachtreeroofing.example/' };
  const signal = { source: 'socrata-atlanta-permits', kind: 'permit', city: 'Atlanta', state: 'GA' };

  it('the card entry carries the listing lines; a contact with its own phone or a null listing shows none', () => {
    const plan = outreachPlan(signal, [{ role: 'contractor', name: 'Peachtree Roofing LLC', listing }], 'en');
    const e = plan!.type === 'org' ? plan!.entries[0] : null;
    expect(e?.listing).toEqual({ phone: '404-555-0123', website: { href: 'https://www.peachtreeroofing.example/', text: 'peachtreeroofing.example' }, note: "Phone and website from the business's public listing, not from the public record." });
    const own = outreachPlan(signal, [{ role: 'contractor', name: 'Peachtree Roofing LLC', phone: '404-555-0100', listing }], 'en');
    expect(own!.type === 'org' && own!.entries[0].listing).toBeNull();
    const none = outreachPlan(signal, [{ role: 'contractor', name: 'Peachtree Roofing LLC', listing: null }], 'en');
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
    // Round 23: the listing's own caveat is said once, at the end of the email, instead of under every card that has a listing.
    expect(mail.html).toContain("comes from the business&#39;s own public listing, not from the public record");
    expect(mail.html.match(/own public listing/g)).toHaveLength(1);
    expect(mail.text).toContain('Contact: Peachtree Roofing LLC (Named on this permit) \u00b7 Phone: 404-555-0123 \u00b7 Website: https://www.peachtreeroofing.example/');
    const esContact = emailContact(signal, [{ role: 'contractor', name: 'Peachtree Roofing LLC', listing }], 'es');
    const esMail = renderDigest({ businessName: 'Acme', items: [{ ...item0, contact: esContact }], appUrl: 'https://x.test/app', unsubscribeUrl: 'https://x.test/u', now: NOW, lang: 'es' });
    expect(esMail.text).toContain('Teléfono: 404-555-0123');
    expect(esMail.text).toContain('Sitio web: https://www.peachtreeroofing.example/');
    expect(emailContact(signal, [{ role: 'contractor', name: 'Peachtree Roofing LLC' }], 'en')).toEqual({ name: 'Peachtree Roofing LLC', role: 'Named on this permit' });
    const plain = renderDigest({ businessName: 'Acme', items: [{ ...item0, contact: { name: 'Peachtree Roofing LLC', role: 'Named on this permit' } }], appUrl: 'https://x.test/app', unsubscribeUrl: 'https://x.test/u', now: NOW });
    expect(plain.html).not.toContain('public listing');
    expect(plain.html).toContain('Contact: Peachtree Roofing LLC (Named on this permit)');
    expect(plain.text).not.toContain('Phone:');
  });

  it('a website that is not https is dropped from the email but the phone stays (review probe 7d)', () => {
    const item0 = { kind: 'permit', source: 'socrata-atlanta-permits', title: 'New roofing permit', place: 'Atlanta, GA', occurredAt: NOW.toISOString() };
    const mail = renderDigest({ businessName: 'Acme', items: [{ ...item0, contact: { name: 'Peachtree Roofing LLC', role: 'Named on this permit', listing: { phone: '404-555-0123', website: { href: 'http://plain.example/', text: 'plain.example' }, note: 'n' } } }], appUrl: 'https://x.test/app', unsubscribeUrl: 'https://x.test/u', now: NOW });
    expect(mail.text).toContain('Phone: 404-555-0123');
    expect(mail.text).not.toContain('plain.example');
    expect(mail.html).not.toContain('plain.example');
  });

  it('a locked member gets no contacts and no listing: the loader is not called and the cache is not read', async () => {
    vi.stubEnv('DATAFORSEO_LOGIN', ENV.DATAFORSEO_LOGIN);
    vi.stubEnv('DATAFORSEO_PASSWORD', ENV.DATAFORSEO_PASSWORD);
    const db = newDb({ holler_business_lookup: [{ name_key: 'peachtree roofing', city_key: 'atlanta', state: 'GA', status: 'found', phone: '404-555-0123', website: null, listing_name: 'x', checked_at: NOW.toISOString() }] });
    const loader = vi.fn(async () => new Map([[1, [contractor()]]]));
    const out = await loadMemberContacts({ db: db as never, userId: 'u1', signalIds: [1], locked: true, loader, places: new Map([[1, { city: 'Atlanta', state: 'GA' }]]) });
    expect(out.size).toBe(0);
    expect(loader).not.toHaveBeenCalled();
    expect(db.calls).toEqual([]);
    const open = await loadMemberContacts({ db: db as never, userId: 'u1', signalIds: [1], loader, places: new Map([[1, { city: 'Atlanta', state: 'GA' }]]) });
    expect(open.get(1)![0].listing).toEqual({ phone: '404-555-0123', website: null });
    const noPlaces = await loadMemberContacts({ db: db as never, userId: 'u1', signalIds: [1], loader });
    expect(noPlaces.get(1)![0].listing).toBeUndefined();
  });

  it('ATLANTA fixture matches the city list', () => {
    expect(resolvePlace('atlanta', 'ga')).toMatchObject(ATLANTA);
  });
});
