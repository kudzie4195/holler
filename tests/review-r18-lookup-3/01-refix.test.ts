// Round 18 integration: review 3 probe (logs/REV3-LOOKUP-probe-tests) kept as a permanent regression test. Findings fixed at integration
// (P2-1 health line, P3-1 outage stop, P3-2/P3-3 closed listings, P3-5 address forms, P3-6 address before ambiguity, P3-7 tie order) now assert
// the fixed behaviour; every other assertion is the reviewer's as written.
// REV3 probe (r18 LOOKUP redo 2, cac086d), task 1: each P2 and P3 of review-LOOKUP-2.md, checked again with new fixtures.
// (Closed listings: 02. Site address: 03. Awardees, probe paths: 06. Migration: migration-0026-converge.sh.)
import { afterAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { chooseListing, listingState, lookupBusiness, lookupForCards, lookupSettings, nameRefusal, newBudget, parseListingResult, resolvePlace } from '@/lib/enrich/business-lookup';
import type { ContactRecord } from '@/lib/contacts/types';
import { ENV, NOW, fakeFetch, item, jsonRes, listingsBody, newDb, todayRows } from '../enrich/helpers';

const out: string[] = [];
const say = (id: string, verdict: string, note: string) => out.push(`${id.padEnd(6)} ${verdict.padEnd(10)} ${note}`);
afterAll(async () => {
  // eslint-disable-next-line no-console
  console.log('\n' + out.join('\n') + '\n');
  const { writeFileSync } = await import('node:fs');
  if (process.env.REV3_OUT) writeFileSync(`${process.env.REV3_OUT}/REV3-LOOKUP-refix.txt`, out.join('\n') + '\n');
});
const ATL = resolvePlace('Atlanta', 'GA')!;
const choose = (name: string, list: unknown[], total?: number | null, place = ATL) => {
  const body = listingsBody(list, 0.0192, total ?? list.length);
  if (total === null) delete (body.tasks[0].result[0] as { total_count?: number }).total_count;
  const p = parseListingResult(body.tasks[0] as never);
  return chooseListing(name, place, p.items, p.totalCount);
};
const deps = (db: unknown, fetch: unknown) => ({ db: db as never, fetch: fetch as never, env: ENV, now: () => NOW, sleep: async () => {} });

describe('1. review 2 findings on cac086d', () => {
  it('P2-2 generic shop names: the 36 names of review 2 and 20 new ones', () => {
    const old = ['Food Mart', 'Nail Salon', 'Hair Salon', 'Coin Laundry', 'Car Wash', 'Dry Cleaners', 'Liquor Store', 'Grocery Store', 'Tire Shop', 'Pizza Restaurant', 'Chinese Restaurant', 'Mexican Restaurant', 'Coffee Shop', 'Gas Station', 'Dollar Store', 'Beauty Supply', 'Mini Mart', 'Food Market', 'Currency Exchange', 'Tobacco Shop', 'Smoke Shop', 'Day Spa', 'Pet Grooming', 'Auto Parts', 'Learning Academy', 'Family Dental', 'Dental Care', 'Animal Hospital', 'Beauty Salon', 'Barber Shop', 'Child Development Center', 'Convenience Store', 'Food and Liquor', 'Fast Food', 'Bakery Cafe', 'Laundromat Services'];
    const sentOld = old.filter((n) => nameRefusal(n, { city: 'Chicago', state: 'IL', zip: '60613' }) === null);
    expect(sentOld).toEqual([]);
    // names the list was not written from
    const fresh = ['Hot Dogs', 'Taco Restaurant', 'Sushi Bar', 'Donut Shop', 'Ice Cream Shop', 'Flower Shop', 'Hardware Store', 'Book Store', 'Thrift Store', 'Vape Shop', 'Juice Bar', 'Sandwich Shop', 'Burger Restaurant', 'Wine and Spirits', 'Meat Market', 'Fish Market', 'Print Shop', 'Mobile Phone Repair', 'Hand Car Wash', 'Bridal Boutique'];
    const sentFresh = fresh.filter((n) => nameRefusal(n, { city: 'Chicago', state: 'IL', zip: '60613' }) === null);
    say('P2-2', 'FIXED', `review 2's 36 generic shop names: ${sentOld.length} sent (was 25)`);
    say('P2-2', 'NOTE', `20 new generic shop names: ${sentFresh.length} still sent (${sentFresh.join(', ')}). They cost a call each; a wrong attach still needs the same word set at the same street address`);
    expect(sentFresh.length).toBeGreaterThan(0);
  });

  it('P3-A a full page with no total_count is truncated', () => {
    const many = Array.from({ length: 20 }, (_, i) => item({ title: i === 0 ? 'Peachtree Roofing' : `Other ${i} Roofing`, phone: `+1404555${String(1000 + i)}` }));
    expect(choose('Peachtree Roofing LLC', many, null).reason).toBe('truncated');
    expect(choose('Peachtree Roofing LLC', many.slice(0, 19), null).reason).toBe('found');
    expect(choose('Peachtree Roofing LLC', many, 20).reason).toBe('found');
    expect(choose('Peachtree Roofing LLC', many, 21).reason).toBe('truncated');
    say('P3-A', 'FIXED', '20 items, no total_count: truncated; 19 items, no total_count: read; 20 of 20: read; 20 of 21: truncated');
  });

  it('P3-C two branches, one phone and host: the home page is stored', () => {
    const a = item({ title: 'Budget Blinds', phone: '+18005550100', url: 'https://www.budgetblinds.example/buckhead/?utm=x', latitude: 33.84, longitude: -84.38 }, { zip: '30305' });
    const b = item({ title: 'Budget Blinds', phone: '+18005550100', url: 'https://budgetblinds.example/decatur/', latitude: 33.7748, longitude: -84.2963 }, { city: 'Decatur', zip: '30030' });
    const r = choose('Budget Blinds LLC', [a, b]);
    expect(r.choice?.listing).toMatchObject({ phone: '800-555-0100', website: 'https://www.budgetblinds.example/' });
    say('P3-C', 'FIXED', `two branch pages on one host: website stored as ${r.choice?.listing.website}`);
  });

  it('P3-D the ZIP city and the job city are place words', () => {
    expect(nameRefusal('Atlanta Roofing LLC', { city: null, state: 'GA', zip: '30060', jobCity: 'Atlanta' })).toBe('generic_name');
    expect(nameRefusal('Atlanta Roofing LLC', { city: null, state: 'GA', zip: '30303', jobCity: null })).toBe('generic_name');
    expect(nameRefusal('Peachtree Roofing LLC', { city: null, state: 'GA', zip: '30303', jobCity: 'Atlanta' })).toBeNull();
    say('P3-D', 'FIXED', '"Atlanta Roofing LLC" with a Marietta ZIP on an Atlanta job, and with an Atlanta ZIP and no city: generic_name');
  });

  it('P3-E a phone shared with other-named listings', () => {
    const mine = item({ title: 'Peachtree Roofing', phone: '+18005550111' });
    const others = ['Acme Plumbing', 'Zeta Electric', 'Delta Painting'].map((t) => item({ title: t, phone: '(800) 555-0111' }));
    expect(choose('Peachtree Roofing LLC', [mine, ...others]).reason).toBe('shared_phone');
    expect(choose('Peachtree Roofing LLC', [mine, others[0]]).reason).toBe('shared_phone');
    // a shared host with no phone on the chosen listing is not checked
    const noPhone = item({ title: 'Peachtree Roofing', phone: null, url: 'https://leadgen.example/peachtree', domain: 'leadgen.example' });
    const sameHost = item({ title: 'Acme Plumbing', phone: '+14045550999', url: 'https://leadgen.example/acme', domain: 'leadgen.example' });
    const r = choose('Peachtree Roofing LLC', [noPhone, sameHost]);
    expect(r.choice?.listing).toEqual({ phone: null, website: 'https://leadgen.example/peachtree', name: 'Peachtree Roofing' });
    say('P3-E', 'FIXED', 'the phone also on 1 or 3 other-named listings: shared_phone');
    say('P3-E', 'NOTE', 'the same test is not made for the website: a listing with no phone whose host is shared with an other-named listing is attached with that website');
  });

  it('P3-F no coordinates: the listing ZIP point decides', () => {
    const far = item({ title: 'Summit Roofing', latitude: null, longitude: null, address: '1 Bull St, Atlanta, GA 31401' }, { city: 'Atlanta', zip: '31401' });
    expect(choose('Summit Roofing LLC', [far]).reason).toBe('too_far');
    const near = item({ title: 'Summit Roofing', latitude: null, longitude: null }, { zip: '30303' });
    expect(choose('Summit Roofing LLC', [near]).reason).toBe('found');
    say('P3-F', 'FIXED', 'no coordinates, city text "Atlanta", ZIP 31401 (Savannah): too_far; ZIP 30303: found');
  });

  it('P3-H one business on several cards: one call', async () => {
    const mk = (id: number, name: string): ContactRecord => ({ signalId: id, role: 'contractor', name, city: null, state: null });
    const cs = [mk(1, 'Peachtree Roofing LLC'), mk(2, 'PEACHTREE ROOFING LLC'), mk(3, 'Peachtree Roofing Inc'), mk(4, 'Peachtree Roofing Co')];
    const fetch = fakeFetch([item()]);
    const db = newDb();
    const budget = newBudget(lookupSettings(ENV));
    const got = await lookupForCards(new Map(cs.map((c) => [c.signalId, [c]])), cs.map((c) => ({ signalId: c.signalId, city: 'Atlanta', state: 'GA', contact: c })), budget, deps(db, fetch));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(budget.runLeft).toBe(4);
    for (const c of cs) expect(got.get(c.signalId)?.[0].listing).toEqual({ phone: '404-555-0123', website: 'https://www.peachtreeroofing.example/' });
    expect(db.tables.holler_business_lookup).toHaveLength(1);
    say('P3-H', 'FIXED', '4 cards, 4 spellings of one contractor: 1 request, 1 run slot, 1 cache row, all 4 cards get the listing');
  });

  it('P3-K a numeric ZIP and an address ending in the country', () => {
    expect(listingState({ zip: 2134 as never, address: null, countryCode: 'US' })).toEqual({ state: 'MA', zip: '02134' });
    const p = parseListingResult(listingsBody([item({ address: '100 Example St NW, Atlanta, GA 30303, United States' }, { zip: null }), item({ address: '100 Example St NW, Atlanta, GA 30303, USA' }, { zip: null }), item({}, { zip: 30303 })]).tasks[0] as never);
    expect(p.items.map((it) => listingState(it))).toEqual([{ state: 'GA', zip: '30303' }, { state: 'GA', zip: '30303' }, { state: 'GA', zip: '30303' }]);
    say('P3-K', 'FIXED', 'ZIP as the JSON number 2134 reads 02134 (MA); addresses ending ", United States" and ", USA" give GA 30303');
  });

  it('notes: a claim is dropped when the admission refuses; a retry row dated ahead does not block', async () => {
    // 24 booked, then a row slips in between the pre-check and the admission: the call is refused after the claim was written
    const db = newDb({ holler_dataforseo_spend: todayRows(24) });
    const origFrom = db.from.bind(db);
    let slipped = false;
    (db as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const b = origFrom(t) as unknown as { upsert: (...a: unknown[]) => unknown };
      if (t === 'holler_business_lookup' && !slipped) {
        const up = b.upsert.bind(b);
        b.upsert = (...a: unknown[]) => {
          slipped = true;
          db.tables.holler_dataforseo_spend.push({ ...todayRows(1, 'ok', 25)[0] });
          return up(...a);
        };
      }
      return b;
    };
    const fetch = fakeFetch([item()]);
    const r = await lookupBusiness({ name: 'Peachtree Roofing LLC', city: 'Atlanta', state: 'GA' }, deps(db, fetch));
    expect(r).toMatchObject({ status: 'skipped', reason: 'day_cap' });
    expect(fetch).not.toHaveBeenCalled();
    expect(db.tables.holler_business_lookup).toEqual([]);
    say('note', 'FIXED', 'call refused by the day-cap admission after the claim was written: the retry row is removed, nothing is blocked for 6 hours');
    const ahead = newDb({ holler_business_lookup: [{ name_key: 'peachtree roofing', city_key: 'atlanta', state: 'GA', status: 'retry', phone: null, website: null, listing_name: null, checked_at: new Date(NOW.getTime() + 11 * 60_000).toISOString() }] });
    const f2 = fakeFetch([item()]);
    expect(await lookupBusiness({ name: 'Peachtree Roofing LLC', city: 'Atlanta', state: 'GA' }, deps(ahead, f2))).toMatchObject({ status: 'found' });
    const soon = newDb({ holler_business_lookup: [{ name_key: 'peachtree roofing', city_key: 'atlanta', state: 'GA', status: 'retry', phone: null, website: null, listing_name: null, checked_at: new Date(NOW.getTime() + 9 * 60_000).toISOString() }] });
    expect(await lookupBusiness({ name: 'Peachtree Roofing LLC', city: 'Atlanta', state: 'GA' }, deps(soon, f2))).toMatchObject({ status: 'skipped', reason: 'retry_later' });
    say('note', 'FIXED', 'a retry row dated 11 minutes ahead is ignored; one dated 9 minutes ahead still blocks');
  });

  it('P3-L the mobile feed still passes no places', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('lib/mobile/feed.ts', 'utf8');
    const call = src.slice(src.indexOf('loadMemberContacts({'), src.indexOf('loadMemberContacts({') + 200);
    expect(call).not.toContain('places');
    say('P3-L', 'NOT FIXED', 'lib/mobile/feed.ts calls loadMemberContacts without `places`: the mobile app shows no listing (declared as skipped; safe)');
  });

  it('a truncated answer: 7 days, full price, counted by reason', async () => {
    const db = newDb();
    const many = Array.from({ length: 20 }, (_, i) => item({ title: `Other ${i} Roofing` }));
    const fetch = vi.fn(async () => jsonRes(listingsBody(many, 0.0192, 44)));
    const budget = newBudget(lookupSettings(ENV));
    const r = await lookupBusiness({ name: 'Peachtree Roofing LLC', city: 'Atlanta', state: 'GA' }, deps(db, fetch), { budget });
    expect(r).toMatchObject({ status: 'not_found', reason: 'truncated', costUsd: 0.0192 });
    expect(db.tables.holler_business_lookup).toEqual([expect.objectContaining({ status: 'truncated', cost_usd: 0.0192 })]);
    expect(budget.refused).toEqual({ truncated: 1 });
    say('P3-J', 'FIXED', 'a truncated answer is cached as "truncated" (7 days) and counted in lookup.refused.truncated; the probe takes zip= and address= (see 5.7)');
  });
});
