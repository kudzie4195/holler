// The r18 LOOKUP reviewer's probes (logs/REV-LOOKUP-probe-tests/01, 02, 03, 05), kept as permanent regression tests. Every probe that
// reproduced a defect on 3eb9e31 now asserts the fixed behaviour; the ones that already passed keep their assertion. Ids match the review.
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('server-only', () => ({}));
import {
  LOOKUP_PATH,
  attachCachedListings,
  chooseListing,
  lookupBusiness,
  lookupForCards,
  lookupInputFor,
  lookupSettings,
  lookupsToday,
  mayLookUp,
  nameKey,
  namesMatch,
  nameTokens,
  newBudget,
  parseListingResult,
  resolvePlace,
  LOOKUP_ROLES,
  FOUND_TTL_DAYS,
  NOT_FOUND_TTL_DAYS,
} from '@/lib/enrich/business-lookup';
import { isOrganisationName } from '@/lib/contacts/org';
import { usPhone } from '@/lib/contacts/sanitize';
import type { ContactRecord } from '@/lib/contacts/types';
import { emailContact } from '@/lib/outreach/plan';
import { renderDigest } from '@/lib/email/templates';
import { WhoToContact } from '@/components/feed/who-to-contact';
import { ENV, MONTH, NOW, dbWithoutCache, fakeFetch, item, jsonRes, listingsBody, newDb, sentTask, todayRows } from './helpers';

const deps = (db: unknown, fetch: unknown, over: Record<string, unknown> = {}) => ({ db: db as never, fetch: fetch as typeof globalThis.fetch, env: ENV, now: () => NOW, sleep: async () => {}, ...over });
const parse = (list: unknown[], total?: number) => parseListingResult(listingsBody(list, 0.015, total ?? list.length).tasks[0] as never);
const choose = (name: string, place: ReturnType<typeof resolvePlace>, list: unknown[], total?: number) => {
  const p = parse(list, total);
  return chooseListing(name, place!, p.items, p.totalCount);
};
const ATL = resolvePlace('Atlanta', 'GA');
const contractor = (signalId: number, name: string, over: Partial<ContactRecord> = {}): ContactRecord => ({ signalId, role: 'contractor', name, city: null, state: null, ...over });

describe('1. wrong-number matrix (review criterion 1)', () => {
  it('1a two same-named listings with different phones: refused', () => {
    expect(choose('ABC Roofing LLC', ATL, [item({ title: 'ABC Roofing', phone: '+14045550101', url: null, domain: null }), item({ title: 'ABC Roofing', phone: '+14045550102', url: null, domain: null })]).reason).toBe('ambiguous');
  });

  it('1b (was DEFECT) two same-named listings, one phone-only and one website-only: refused', () => {
    const r = choose('ABC Roofing LLC', ATL, [
      item({ title: 'ABC Roofing', phone: '+14045550101', url: null, domain: null, latitude: 33.75, longitude: -84.39 }),
      item({ title: 'ABC Roofing', phone: null, url: 'https://abcroofing-decatur.example/', domain: 'abcroofing-decatur.example', latitude: 33.7748, longitude: -84.2963 }, { city: 'Decatur', zip: '30030' }),
    ]);
    expect(r).toEqual({ choice: null, reason: 'ambiguous' });
  });

  it('1c (was DEFECT) three same-named listings, only one with a phone: refused', () => {
    const r = choose('A and B Plumbing', ATL, [
      item({ title: 'A & B Plumbing', phone: null, url: null, domain: null }),
      item({ title: 'A & B Plumbing', phone: null, url: null, domain: null }, { address: '77 Second St' }),
      item({ title: 'A&B Plumbing', phone: '+14045550199', url: null, domain: null }, { address: '500 Third Ave' }),
    ]);
    expect(r.choice).toBeNull();
  });

  it('1d (was DEFECT) total_count larger than the items returned: refused as truncated', () => {
    expect(choose('ABC Roofing', ATL, [item({ title: 'ABC Roofing' })], 36)).toEqual({ choice: null, reason: 'truncated' });
    expect(choose('Peachtree Roofing', ATL, [item()], 1).reason).toBe('found');
  });

  it('1e franchise branches with different phones: refused', () => {
    expect(choose('Mr Rooter Plumbing', ATL, [item({ title: 'Mr Rooter Plumbing', phone: '+14045550111' }), item({ title: 'Mr Rooter Plumbing', phone: '+14045550112' })]).reason).toBe('ambiguous');
  });

  it('1f (was DEFECT) two branches on one host with different pages and no phones: refused', () => {
    const r = choose('Budget Blinds', ATL, [
      item({ title: 'Budget Blinds', phone: null, url: 'https://budgetblinds.example/buckhead/', domain: 'budgetblinds.example' }),
      item({ title: 'Budget Blinds', phone: null, url: 'https://budgetblinds.example/decatur/', domain: 'budgetblinds.example' }, { city: 'Decatur', zip: '30030' }),
    ]);
    expect(r.choice).toBeNull();
  });

  it('1g same name 37 km away (Alpharetta): refused', () => {
    expect(choose('Peachtree Roofing LLC', ATL, [item({ latitude: 34.0754, longitude: -84.2941 }, { city: 'Alpharetta', zip: '30009' })]).reason).toBe('too_far');
  });

  it('1h (was DEFECT) a Kansas City, KS listing (ZIP 66101) for a Kansas City, MO record: refused with region null or set', () => {
    const KCMO = resolvePlace('Kansas City', 'MO');
    const kck = { title: 'Midwest Roofing', phone: '+19135550144', latitude: 39.1142, longitude: -94.6275, address: '1 Main St, Kansas City, KS 66101' };
    expect(choose('Midwest Roofing LLC', KCMO, [item(kck, { city: 'Kansas City', region: 'Kansas', zip: '66101' })]).choice).toBeNull();
    expect(choose('Midwest Roofing LLC', KCMO, [item(kck, { city: 'Kansas City', region: null, zip: '66101' })]).choice).toBeNull();
  });

  it('1i (was DEFECT) a Springfield, MO listing with no point for a Springfield, IL record: refused', () => {
    const SPI = resolvePlace('Springfield', 'IL');
    const r = choose('Capitol Roofing LLC', SPI, [item({ title: 'Capitol Roofing', phone: '+14175550155', latitude: null, longitude: null, address: null }, { city: 'Springfield', region: null, zip: '65806', country_code: null })]);
    expect(r.choice).toBeNull();
  });

  it('1j no city but a point within 25 km and a ZIP in the state: attached; no point: the ZIP\'s own point decides (review 2, P3-F)', () => {
    expect(choose('Peachtree Roofing', ATL, [item({}, { city: null })]).reason).toBe('found');
    expect(choose('Peachtree Roofing', ATL, [item({ latitude: null, longitude: null }, { city: null })]).reason).toBe('found'); // ZIP 30303 is in Atlanta
    expect(choose('Peachtree Roofing', ATL, [item({ latitude: null, longitude: null, address: null }, { city: null, zip: null })]).reason).toBe('no_state');
  });

  it('1k (was DEFECT for 4+ words) no extra word passes', () => {
    expect(namesMatch('ABC Roofing', 'ABC Roofing and Siding')).toBe(false);
    expect(namesMatch('Peachtree Heating Cooling Plumbing', 'Peachtree Heating Cooling Plumbing Supply')).toBe(false);
    expect(namesMatch('All American Heating Cooling Plumbing', 'All American Heating Cooling')).toBe(false);
  });

  it('1l (was DEFECT) place words are never dropped from a listing name: "Rising Roofing" is not "Phoenix Rising Roofing"', async () => {
    const cases: [string, string, string, string, string][] = [
      ['Detailing Experts LLC', 'Mobile Detailing Experts', 'Mobile', 'AL', '36602'],
      ['Rising Roofing LLC', 'Phoenix Rising Roofing', 'Phoenix', 'AZ', '85004'],
      ['Tree Care LLC', 'Orange Tree Care', 'Orange', 'CA', '92866'],
      ['Sportswear Cleaners LLC', 'Columbia Sportswear Cleaners', 'Columbia', 'SC', '29201'],
      ['Casa Roofing LLC', 'La Casa Roofing', 'New Orleans', 'LA', '70112'],
      ['Home Repair Pros', 'In Home Repair Pros', 'Hammond', 'IN', '46320'],
      ['Power Washing LLC', 'Georgia Power Washing', 'Atlanta', 'GA', '30303'],
    ];
    for (const [q, l, city, state, zip] of cases) {
      expect(namesMatch(q, l), `${q} / ${l}`).toBe(false);
      const place = resolvePlace(city, state, zip)!;
      expect(chooseListing(q, place, parse([item({ title: l, latitude: place.lat, longitude: place.lon }, { city, zip })]).items).choice, `${q} / ${l}`).toBeNull();
    }
    // through the whole lookup: the Phoenix case attaches nothing
    const fetch = fakeFetch([item({ title: 'Phoenix Rising Roofing', phone: '+16025550100', latitude: 33.45, longitude: -112.07 }, { city: 'Phoenix', zip: '85004' })]);
    const r = await lookupBusiness({ name: 'Rising Roofing LLC', city: 'Phoenix', state: 'AZ' }, deps(newDb(), fetch));
    expect(r).toMatchObject({ status: 'not_found', reason: 'no_match' });
  });

  it('1m legal suffixes, "&" vs "and", apostrophes and numbers', () => {
    expect(namesMatch('Acme Roofing LLC', 'Acme Roofing Inc')).toBe(true);
    expect(namesMatch('Acme Roofing Co', 'Acme Roofing Corporation')).toBe(true);
    expect(namesMatch('Smith & Sons Construction', 'Smith and Sons Construction')).toBe(true);
    expect(namesMatch('A & B Roofing', 'AB Roofing')).toBe(false);
    expect(namesMatch("Lowe's Home Improvement", 'Lowes Home Improvement')).toBe(true);
    expect(namesMatch('First Choice Roofing', '1st Choice Roofing')).toBe(false);
    expect(namesMatch('A1 Plumbing Services', 'A-1 Plumbing Services')).toBe(false);
    expect(namesMatch('Roofing 360 Group', 'Roofing 365 Group')).toBe(false);
    expect(isOrganisationName('A1 Plumbing')).toBe(false);
  });

  it('1n cache keys', () => {
    expect(nameKey('Acme Roofing Co')).toBe(nameKey('Acme Roofing Corporation'));
    expect(nameKey('A B Roofing')).not.toBe(nameKey('AB Roofing'));
  });

  it('1o (was DEFECT) the Indiana contractor (ZIP 46320) on a Chicago permit is looked up in Hammond, IN, and a Chicago listing is not attached', async () => {
    const c = contractor(7, 'Summit Roofing LLC', { state: 'IN', zip: '46320' });
    expect(lookupInputFor(c, [c], { city: 'Chicago', state: 'IL' })).toEqual({ name: 'Summit Roofing LLC', city: null, state: 'IN', zip: '46320', jobCity: 'Chicago' });
    const chicago = item({ title: 'Summit Roofing', phone: '+13125550166', latitude: 41.88, longitude: -87.63, address: '1 W Wacker Dr, Chicago, IL 60601' }, { city: 'Chicago', zip: '60601' });
    const fetch = fakeFetch([chicago]);
    const got = await lookupForCards(new Map([[7, [c]]]), [{ signalId: 7, city: 'Chicago', state: 'IL', contact: c }], newBudget(lookupSettings(ENV)), deps(newDb(), fetch));
    expect(sentTask(fetch).location_coordinate).toBe('41.6099,-87.5079,25');
    expect(got.get(7)?.[0].listing).toBeUndefined();
    // its own Hammond listing is found
    const hammond = item({ title: 'Summit Roofing', phone: '+12195550177', latitude: 41.61, longitude: -87.51, address: '5 State St, Hammond, IN 46320' }, { city: 'Hammond', zip: '46320' });
    const got2 = await lookupForCards(new Map([[7, [c]]]), [{ signalId: 7, city: 'Chicago', state: 'IL', contact: c }], newBudget(lookupSettings(ENV)), deps(newDb(), fakeFetch([hammond])));
    expect(got2.get(7)?.[0].listing?.phone).toBe('219-555-0177');
  });

  it('1p (was RISK) a suburb ZIP (Round Rock 78664) on an Austin permit is looked up at that ZIP, not 25 km round Austin', () => {
    const c = contractor(8, 'Summit Roofing LLC', { state: 'TX', zip: '78664' });
    const input = lookupInputFor(c, [c], { city: 'Austin', state: 'TX' })!;
    expect(input).toMatchObject({ state: 'TX', zip: '78664' });
    expect(resolvePlace(input.city, input.state, input.zip)).toMatchObject({ lat: 30.5145, lon: -97.668, zip: '78664' });
  });

  it('1q another state named with no city or ZIP: not looked up at all', () => {
    expect(lookupInputFor(contractor(9, 'Summit Roofing LLC', { state: 'IN' }), [], { city: 'Chicago', state: 'IL' })).toBeNull();
  });

  it('1r a business on a licence is looked up at its site ZIP within 5 km and needs the site\'s street address (fixture updated in redo 2)', async () => {
    const biz: ContactRecord = { signalId: 11, role: 'business', name: 'Lakeview Bakery LLC', city: null, state: null };
    const site: ContactRecord = { signalId: 11, role: 'site', name: '', address: '200 W Addison St', city: 'Chicago', state: 'IL', zip: '60613' };
    const input = lookupInputFor(biz, [biz, site], { city: 'Chicago', state: 'IL' })!;
    expect(input).toMatchObject({ zip: '60613', strict: true, street: '200 W Addison St' });
    const place = resolvePlace(input.city, input.state, input.zip, { strict: true, street: input.street })!;
    expect(place.radiusKm).toBe(5);
    const far = parse([item({ title: 'Lakeview Bakery', latitude: 41.87, longitude: -87.63, address: null }, { city: 'Chicago', zip: '60605', address: '200 W Addison St' })]);
    expect(chooseListing('Lakeview Bakery LLC', place, far.items).reason).toBe('address_mismatch');
    const near = parse([item({ title: 'Lakeview Bakery', latitude: place.lat, longitude: place.lon, address: null }, { city: 'Chicago', zip: '60613', address: '200 West Addison Street' })]);
    expect(chooseListing('Lakeview Bakery LLC', place, near.items).reason).toBe('found');
    // without a site ZIP a business is not looked up (a city-wide search is not close enough)
    expect(lookupInputFor(biz, [biz], { city: 'Chicago', state: 'IL' })).toBeNull();
  });
});

describe('2. privacy and generic names (review criterion 2)', () => {
  it('2a only business and contractor are ever looked up or shown a listing (awardee removed in redo 2)', async () => {
    expect([...LOOKUP_ROLES].sort()).toEqual(['business', 'contractor']);
    const fetch = fakeFetch([item({ title: 'Peachtree Roofing' })]);
    const db = newDb({ holler_business_lookup: [{ name_key: 'peachtree roofing', city_key: 'atlanta', state: 'GA', status: 'found', phone: '404-555-0123', website: null, listing_name: 'Peachtree Roofing', checked_at: NOW.toISOString() }] });
    for (const role of ['owner', 'applicant', 'site', 'buyer', 'tenant', 'agent', 'awardee', '']) {
      const c = { signalId: 1, role, name: 'Peachtree Roofing LLC', city: null, state: null } as unknown as ContactRecord;
      expect(mayLookUp(c), role).toBe(false);
      const got = await lookupForCards(new Map([[1, [c]]]), [{ signalId: 1, city: 'Atlanta', state: 'GA', contact: c }], newBudget(lookupSettings(ENV)), deps(newDb(), fetch));
      expect(got.get(1)?.[0].listing, role).toBeUndefined();
      const shown = await attachCachedListings(db as never, new Map([[1, [c]]]), new Map([[1, { city: 'Atlanta', state: 'GA' }]]), NOW, ENV);
      expect(shown.get(1)?.[0].listing, role).toBeUndefined();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('2b sixty person-shaped names are never sent', async () => {
    const people = ['John Smith', 'Maria Lopez', 'Rich Baker', 'Will Power', 'Art Painter', 'Stone Mason', 'Forrest Gardener', 'Crystal Glass', 'Rusty Gates', 'Jack Hammer', 'Clay Potter', 'Brick Mason', 'Tile Mason', 'Mason Tile', 'Paige Turner', 'Penny Lane', 'Sky Walker', 'Flint Stone', 'Baker Mason', 'Mason Baker LLC', 'Taylor Painter', 'Carpenter Cook', 'Hunter Fisher LLC', 'Miller Brewer', 'Page Turner LLC', 'Day Knight LLC', 'Bishop King LLC', 'J Smith', 'Smith, John', 'JOHN SMITH ROOFING', 'Mary Jones Plumbing LLC', 'MARIA LOPEZ HOME DAYCARE', 'Roofing By Mike', 'Daycare Maria', 'Homeowner', 'Owner Builder', 'OWNER BUILDER LLC', 'Home Owner Construction', 'Same As Owner', 'Not Applicable', 'Homeowner Self', 'Private Residence', 'c/o John Smith Roofing', 'Smith Jones LLC', 'Okonjo Zelenskyy LLC', 'Danny Smith LLC', 'Carolina Lopez Daycare', 'Van Tran Roofing', 'Dr Roof', 'Uncle Bobs Roofing', 'Smith LLC', 'Gallagher LLC', 'Lee Roofing', 'Kim Cleaners', 'Nguyen Nails', 'Patel Brothers', 'Walker Roofing', 'Parker Plumbing', 'Dean Roofing LLC', 'Carter Electric'];
    const fetch = fakeFetch([item()]);
    for (const name of people) {
      const r = await lookupBusiness({ name, city: 'Atlanta', state: 'GA' }, deps(newDb(), fetch));
      expect(r.status, name).toBe('skipped');
      expect(mayLookUp({ role: 'contractor', name, phone: null, website: null }) && nameTokens(name).length >= 2, name).toBe(false);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('2c a surname with a trade word is a trading name and is sent (by design)', async () => {
    const fetch = fakeFetch([]);
    for (const name of ['Kowalski Roofing', 'Singh Construction', 'Lopez Daycare', 'Mikes Roofing', 'Grandmas Daycare', 'Cook Plumbing']) await lookupBusiness({ name, city: 'Atlanta', state: 'GA' }, deps(newDb(), fetch));
    expect(fetch.mock.calls.map((_, i) => sentTask(fetch, i).title)).toEqual(['Kowalski Roofing', 'Singh Construction', 'Lopez Daycare', 'Mikes Roofing', 'Grandmas Daycare', 'Cook Plumbing']);
  });

  it('2d (was DEFECT) placeholders and generic descriptors are never sent and never attached', async () => {
    const generic = ['General Contractor', 'Self Contractor', 'No Contractor', 'Contractor TBD', 'Various Contractors', 'Licensed Contractor', 'Roofing Contractor', 'Plumbing Contractor', 'Electrical Contractor', 'Home Daycare', 'Family Daycare', 'Family Child Care Home', 'Property Management', 'Handyman Services', 'Owner', 'Self', 'Unknown', 'N/A', 'TBD', 'Various'];
    const fetch = fakeFetch([]);
    for (const name of generic) {
      const r = await lookupBusiness({ name, city: 'Atlanta', state: 'GA' }, deps(newDb(), fetch));
      expect(r.status === 'skipped' && ['generic_name', 'not_business'].includes(r.reason), name).toBe(true);
    }
    expect(fetch).not.toHaveBeenCalled();
    const c: ContactRecord = { signalId: 3, role: 'business', name: 'Home Daycare', city: null, state: null };
    const site: ContactRecord = { signalId: 3, role: 'site', name: '', address: '1 Main St', city: 'Atlanta', state: 'GA', zip: '30303' };
    const f2 = fakeFetch([item({ title: 'Home Daycare', phone: '+14045550177', url: null, domain: null })]);
    const got = await lookupForCards(new Map([[3, [c, site]]]), [{ signalId: 3, city: 'Atlanta', state: 'GA', contact: c }], newBudget(lookupSettings(ENV)), deps(newDb(), f2));
    expect(got.get(3)?.[0].listing).toBeUndefined();
    expect(f2).not.toHaveBeenCalled();
  });
});

describe('3. spend and time (review criterion 3)', () => {
  const MADE_UP = ['Zorvex', 'Quillon', 'Brantex', 'Veltrix', 'Norvane', 'Kestrol', 'Dynavo', 'Luxora', 'Trivant', 'Solvex', 'Cendara', 'Fintrex', 'Halvory', 'Jorvald', 'Maxtera', 'Novarix', 'Orbanta', 'Pellarix', 'Quorva', 'Rivanta', 'Sintera', 'Tavorix', 'Ulvane', 'Vextra', 'Wyndora', 'Xantrel', 'Yarvon', 'Zentiva', 'Arkelon', 'Bolvara'];
  const POOL = ['Roofing', 'Plumbing', 'Painting', 'Fencing'].flatMap((t) => MADE_UP.map((w) => `${w} ${t}`)).filter((n) => isOrganisationName(n) && mayLookUp({ role: 'contractor', name: n, phone: null, website: null }));
  const namesForRun = (run: number) => POOL.slice(run * 10, run * 10 + 10);
  const cardsFor = (names: string[], base = 0) => {
    const contacts = new Map<number, ContactRecord[]>();
    const cards = names.map((name, i) => {
      const c = contractor(base + i + 1, name);
      contacts.set(c.signalId, [c]);
      return { signalId: c.signalId, city: 'Atlanta', state: 'GA', contact: c };
    });
    return { contacts, cards };
  };
  const bookedToday = (db: ReturnType<typeof newDb>) => db.tables.holler_dataforseo_spend.filter((r) => r.endpoint === LOOKUP_PATH && r.status !== 'refused').length;

  it('3a sequential runs: per-run 5 and per-day 25 hold (6 runs of 10 cards)', async () => {
    expect(POOL.length).toBeGreaterThanOrEqual(60);
    const db = newDb();
    // every lookup finds its own listing, so the daily circuit breaker never trips here (it has its own tests)
    const fetch = vi.fn(async (_u?: unknown, init?: unknown) => jsonRes(listingsBody([item({ title: JSON.parse((init as { body: string }).body)[0].title })])));
    let made = 0;
    for (let run = 0; run < 6; run++) {
      const { contacts, cards } = cardsFor(namesForRun(run), run * 100);
      const budget = newBudget(lookupSettings(ENV));
      await lookupForCards(contacts, cards, budget, deps(db, fetch));
      made += budget.calls;
      expect(budget.calls).toBeLessThanOrEqual(5);
    }
    expect(fetch.mock.calls.length).toBe(made);
    expect(made).toBe(25);
    expect(await lookupsToday(db as never, NOW, 25)).toBe(25);
  });

  it('3b (was DEFECT) three OVERLAPPING runs at 20 of 25 stay at or under the day cap', async () => {
    const db = newDb({ holler_dataforseo_spend: todayRows(20) });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetch = vi.fn(async () => (await gate, jsonRes(listingsBody([]))));
    const runs = [0, 1, 2].map((run) => {
      const { contacts, cards } = cardsFor(namesForRun(run), run * 100);
      const budget = newBudget(lookupSettings(ENV), 60_000);
      return lookupForCards(contacts, cards, budget, deps(db, fetch)).then(() => budget);
    });
    await new Promise((r) => setTimeout(r, 50)); // every run has booked its reservations and waits on the API
    release();
    const budgets = await Promise.all(runs);
    expect(bookedToday(db)).toBeLessThanOrEqual(25);
    expect(fetch.mock.calls.length).toBe(bookedToday(db) - 20);
    expect(fetch.mock.calls.length).toBe(5);
    expect(budgets.reduce((n, b) => n + (b.skipped.day_cap ?? 0), 0)).toBeGreaterThan(0);
  });

  it('3c the day is the UTC day; failed, unknown and reserved rows count, refused do not', async () => {
    const rows = todayRows(25).map((r) => ({ ...r, created_at: '2026-11-22T23:59:00Z' }));
    expect(await lookupsToday(newDb({ holler_dataforseo_spend: rows }) as never, new Date('2026-11-22T23:59:30Z'), 25)).toBe(25);
    expect(await lookupsToday(newDb({ holler_dataforseo_spend: rows }) as never, new Date('2026-11-23T00:00:30Z'), 25)).toBe(0);
    const mixed = [...todayRows(5, 'error'), ...todayRows(5, 'unknown'), ...todayRows(5, 'reserved'), ...todayRows(5, 'refused')].map((r, i) => ({ ...r, id: i + 1 }));
    expect(await lookupsToday(newDb({ holler_dataforseo_spend: mixed }) as never, NOW, 25)).toBe(15);
  });

  it('3d (was P3-2) an HTTP 500 is one request and one ledger row; the run stops after it; the business is not retried for 6 hours', async () => {
    const db = newDb();
    const fetch = vi.fn(async () => jsonRes({ status_code: 50000 }, 500));
    const { contacts, cards } = cardsFor(namesForRun(0));
    const budget = newBudget(lookupSettings(ENV));
    await lookupForCards(contacts, cards, budget, deps(db, fetch));
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(3); // at most the calls already started in parallel
    expect(db.tables.holler_dataforseo_spend.length).toBe(fetch.mock.calls.length);
    expect(db.tables.holler_business_lookup.every((r) => r.status === 'retry')).toBe(true);
    expect(db.tables.holler_business_lookup.length).toBe(fetch.mock.calls.length);
  });

  it('3e nothing is called: no credentials, monthly cap reached, dry run, 0026 missing (PGRST205 and 42P01), cap 0', async () => {
    const { contacts, cards } = cardsFor(namesForRun(0));
    const fetch = fakeFetch([item()]);
    await lookupForCards(contacts, cards, newBudget(lookupSettings({})), deps(newDb(), fetch, { env: {} }));
    const capDb = newDb({ holler_dataforseo_spend: [{ id: 1, month: MONTH, endpoint: 'x', units: 0, estimated_usd: 30, cost_usd: 30, status: 'ok', created_at: '2026-11-02T00:00:00Z' }] });
    const capBudget = newBudget(lookupSettings(ENV));
    await lookupForCards(contacts, cards, capBudget, deps(capDb, fetch));
    expect(capBudget.skipped.cap_reached).toBeGreaterThanOrEqual(1);
    expect(capDb.tables.holler_dataforseo_spend).toHaveLength(1);
    const dryEnv = { ...ENV, HOLLER_LOOKUP_DRY_RUN: 'true' };
    await lookupForCards(contacts, cards, newBudget(lookupSettings(dryEnv)), deps(newDb(), fetch, { env: dryEnv }));
    for (const code of ['PGRST205', '42P01'] as const) {
      const db = dbWithoutCache(code);
      const b = newBudget(lookupSettings(ENV));
      await lookupForCards(contacts, cards, b, deps(db, fetch));
      expect(b.skipped.cache_missing).toBeGreaterThanOrEqual(1);
      expect(db.tables.holler_dataforseo_spend).toEqual([]);
    }
    for (const k of ['HOLLER_LOOKUP_MAX_PER_RUN', 'HOLLER_LOOKUP_MAX_PER_DAY']) {
      const env = { ...ENV, [k]: '0' };
      await lookupForCards(contacts, cards, newBudget(lookupSettings(env)), deps(newDb(), fetch, { env }));
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('3f (reversed in redo 2, decision 4c) the owner probe works BEFORE 0026 is applied: one call, the ledger only, the cache table untouched', async () => {
    const fetch = fakeFetch([item()]);
    const db = dbWithoutCache('PGRST205');
    const r = await lookupBusiness({ name: 'Peachtree Roofing LLC', city: 'Atlanta', state: 'GA' }, deps(db, fetch), { probe: true });
    expect(r).toMatchObject({ status: 'found', source: 'api' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(db.touched).toEqual([]);
    expect(db.tables.holler_dataforseo_spend).toHaveLength(1);
    // the alert run still makes no call without 0026
    const f2 = fakeFetch([item()]);
    expect(await lookupBusiness({ name: 'Peachtree Roofing LLC', city: 'Atlanta', state: 'GA' }, deps(dbWithoutCache('42P01'), f2))).toMatchObject({ status: 'skipped', reason: 'cache_missing' });
    expect(f2).not.toHaveBeenCalled();
  });

  it('3g (was DEFECT) a hanging DataForSEO: lookupForCards returns at its deadline, at most 3 calls, all left as retry', async () => {
    const hang = vi.fn((_u: unknown, init?: { signal?: AbortSignal }) => new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('timeout'), { name: 'TimeoutError' })))));
    const db = newDb();
    const { contacts, cards } = cardsFor(namesForRun(0));
    const budget = newBudget(lookupSettings(ENV), 1_500);
    const t0 = Date.now();
    await lookupForCards(contacts, cards, budget, deps(db, hang, { timeoutMs: 1_200 }));
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(1_900);
    expect(hang.mock.calls.length).toBeLessThanOrEqual(3);
    expect(budget.msLeft).toBeLessThan(1_500); // the time used is taken off the run's budget
    await new Promise((r) => setTimeout(r, 50));
    expect(db.tables.holler_business_lookup.filter((r) => r.status === 'retry').length).toBe(hang.mock.calls.length);
  });

  it('3h (was DEFECT) a DataForSEO that ignores the abort signal still cannot hold the caller past the deadline', async () => {
    const never = vi.fn(() => new Promise<Response>(() => {}));
    const { contacts, cards } = cardsFor(namesForRun(1));
    const t0 = Date.now();
    await lookupForCards(contacts, cards, newBudget(lookupSettings(ENV), 1_200), deps(newDb(), never));
    expect(Date.now() - t0).toBeLessThan(1_600);
  });
});

describe('5. cache and 7. display security (review criteria 5, 7)', () => {
  const row = (status: 'found' | 'not_found', ageDays: number) => ({ name_key: 'peachtree roofing', city_key: 'atlanta', state: 'GA', status, phone: status === 'found' ? '404-555-0999' : null, website: null, listing_name: status === 'found' ? 'Old' : null, cost_usd: 0.01, checked_at: new Date(NOW.getTime() - ageDays * 86_400_000).toISOString() });
  const lookup = (db: unknown, fetch: unknown) => lookupBusiness({ name: 'Peachtree Roofing LLC', city: 'Atlanta', state: 'GA' }, deps(db, fetch));
  const signal = { source: 'socrata-atlanta-permits', kind: 'permit', city: 'Atlanta', state: 'GA' };
  const item0 = { kind: 'permit', source: 'socrata-atlanta-permits', title: 'New roofing permit', place: 'Atlanta, GA', occurredAt: NOW.toISOString() };

  it('5a found is reused for 90 days, not-found for 30; then one new call', async () => {
    for (const [status, ttl] of [['found', FOUND_TTL_DAYS], ['not_found', NOT_FOUND_TTL_DAYS]] as const) {
      const fresh = fakeFetch([item()]);
      expect((await lookup(newDb({ holler_business_lookup: [row(status, ttl - 0.01)] }), fresh)).status).toBe(status);
      expect(fresh).not.toHaveBeenCalled();
      const stale = fakeFetch([item()]);
      expect(await lookup(newDb({ holler_business_lookup: [row(status, ttl + 0.01)] }), stale)).toMatchObject({ status: 'found', source: 'api', listing: { phone: '404-555-0123' } });
      expect(stale).toHaveBeenCalledTimes(1);
    }
  });

  it('5b the refresh is an upsert on (name_key, city_key, state) carrying every column', async () => {
    const seen: { rows: unknown; opts: unknown }[] = [];
    const inner = newDb({ holler_business_lookup: [row('not_found', 31)] });
    const db = { tables: inner.tables, from: (t: string) => { const b = inner.from(t) as unknown as { upsert: (r: unknown, o: unknown) => unknown }; const up = b.upsert.bind(b); b.upsert = (r: unknown, o: unknown) => (seen.push({ rows: r, opts: o }), up(r, o)); return b; } };
    await lookup(db, fakeFetch([item()]));
    expect(seen.map((s) => (s.rows as { status: string }[])[0].status)).toEqual(['retry', 'found']);
    expect(seen[1]).toEqual({ rows: [expect.objectContaining({ name_key: 'peachtree roofing', city_key: 'atlanta', state: 'GA', status: 'found', phone: '404-555-0123', checked_at: NOW.toISOString() })], opts: { onConflict: 'name_key,city_key,state' } });
  });

  it('5c display: a stale found row attaches nothing, a not-found row marks null, a future row is ignored', async () => {
    const c = contractor(1, 'Peachtree Roofing LLC');
    const places = new Map([[1, { city: 'Atlanta', state: 'GA' }]]);
    for (const [r, want] of [[row('found', 91), undefined], [row('not_found', 1), null], [row('found', -2), undefined]] as const) {
      const got = await attachCachedListings(newDb({ holler_business_lookup: [r] }) as never, new Map([[1, [c]]]), places, NOW, ENV);
      expect(got.get(1)?.[0].listing).toBe(want);
    }
    const ok = await attachCachedListings(newDb({ holler_business_lookup: [row('found', 89)] }) as never, new Map([[1, [c]]]), places, NOW, ENV);
    expect(ok.get(1)?.[0].listing).toEqual({ phone: '404-555-0999', website: null });
  });

  it('5d (was DEFECT) cached not-found businesses cost no per-card read in the alert run (the batch read marks them); dry run reads nothing', async () => {
    const names = namesForRunLocal();
    const db = newDb({ holler_business_lookup: names.map((n) => ({ ...row('not_found', 1), name_key: nameKey(n) })) });
    const contacts = new Map<number, ContactRecord[]>(names.map((n, i) => [i + 1, [contractor(i + 1, n)]]));
    const marked = await attachCachedListings(db as never, contacts, new Map(names.map((_, i) => [i + 1, { city: 'Atlanta', state: 'GA' }])), NOW, ENV);
    const before = db.calls.length;
    const fetch = fakeFetch([]);
    await lookupForCards(marked, names.map((_, i) => ({ signalId: i + 1, city: 'Atlanta', state: 'GA', contact: marked.get(i + 1)![0] })), newBudget(lookupSettings(ENV)), deps(db, fetch));
    expect(fetch).not.toHaveBeenCalled();
    expect(db.calls.length).toBe(before);
    const dry = newDb();
    const env = { ...ENV, HOLLER_LOOKUP_DRY_RUN: '1' };
    await lookupForCards(contacts, names.map((_, i) => ({ signalId: i + 1, city: 'Atlanta', state: 'GA', contact: contacts.get(i + 1)![0] })), newBudget(lookupSettings(env)), { ...deps(dry, fetch), env });
    expect(dry.calls).toEqual([]);
  });

  it('7a hostile or malformed websites never become a link and are never stored', async () => {
    const bad = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', 'file:///etc/passwd', 'ftp://files.example.com/', 'https://user:pass@evil.example/', 'http://', 'https://', 'https://exa mple.com/', 'https://localhost/', 'https://intranet/', 'http://127.0.0.1/admin', `https://long.example/${'a'.repeat(400)}`, 'mailto:x@y.example', 'tel:+14045550123', '\u0000javascript:alert(1)', 'java\nscript:alert(1)', ' javascript:alert(1)', 'https://ok.example:8443/', 'https://xn--pple-43d.example/'];
    for (const url of bad) {
      const db = newDb();
      const r = await lookupBusiness({ name: 'Peachtree Roofing LLC', city: 'Atlanta', state: 'GA' }, deps(db, fakeFetch([item({ url, domain: null, phone: null })])));
      expect(r.status, url).toBe('not_found');
      expect(db.tables.holler_business_lookup[0]?.website ?? null, url).toBeNull();
    }
  });

  it('7b a stored website always renders as an https link with rel nofollow, escaped', async () => {
    const db = newDb();
    const c = contractor(1, 'Peachtree Roofing LLC');
    await lookupBusiness({ name: c.name, city: 'Atlanta', state: 'GA' }, deps(db, fakeFetch([item({ url: 'https://ok.example/Path?x="><script>alert(1)</script>#top', domain: null })])));
    const contacts = (await attachCachedListings(db as never, new Map([[1, [c]]]), new Map([[1, { city: 'Atlanta', state: 'GA' }]]), NOW, ENV)).get(1)!;
    const card = renderToStaticMarkup(createElement(WhoToContact, { item: signal, contacts, lang: 'en' }));
    const mail = renderDigest({ businessName: 'Acme', items: [{ ...item0, contact: emailContact(signal, contacts, 'en') }], appUrl: 'https://x.test/app', unsubscribeUrl: 'https://x.test/u', now: NOW });
    expect(card + mail.html).not.toMatch(/<script/i);
    expect(card).toMatch(/href="https:\/\/ok\.example\/[^"]*" target="_blank" rel="noopener noreferrer nofollow"/);
    expect(mail.html).toMatch(/<a href="https:\/\/ok\.example\/[^"]*" rel="noopener noreferrer nofollow"/);
  });

  it('7c only a 10-digit NANP phone is shown', () => {
    const cases: [unknown, string | null][] = [['+14045550123', '404-555-0123'], ['(404) 555-0123', '404-555-0123'], ['+441615322922', null], ['404-555-0123<script>alert(1)</script>', null], ['404-555-0123 or 404-555-0124', null], ['911', null], ['000-000-0000', null], [{ a: 1 }, null]];
    for (const [v, want] of cases) expect(usPhone(v), String(v)).toBe(want);
  });

  function namesForRunLocal() {
    return ['Peachtree Roofing LLC', 'Summit Roofing LLC', 'Midwest Roofing LLC', 'Sunbelt Rentals', 'Budget Blinds', 'Detailing Experts LLC', 'Rising Roofing LLC', 'Casa Roofing LLC', 'Kowalski Roofing', 'Yilmaz Construction'];
  }
});
