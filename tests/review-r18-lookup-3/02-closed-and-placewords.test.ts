// Round 18 integration: review 3 probe (logs/REV3-LOOKUP-probe-tests) kept as a permanent regression test. Findings fixed at integration
// (P2-1 health line, P3-1 outage stop, P3-2/P3-3 closed listings, P3-5 address forms, P3-6 address before ambiguity, P3-7 tie order) now assert
// the fixed behaviour; every other assertion is the reviewer's as written.
// REV3 probe (r18 LOOKUP redo 2, cac086d), tasks 2 and 3b: closed listings and place words in names.
// Prints two matrices. Assertions freeze what cac086d does; a line marked DEFECT or NOTE is discussed in review-LOOKUP-3.md.
import { afterAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { chooseListing, isClosed, isGenericName, lookupForCards, lookupInputFor, lookupSettings, nameRefusal, newBudget, parseListingResult, resolvePlace } from '@/lib/enrich/business-lookup';
import type { ContactRecord } from '@/lib/contacts/types';
import { isOrganisationName } from '@/lib/contacts/org';
import { ENV, NOW, fakeFetch, item, listingsBody, newDb } from '../enrich/helpers';

const out: string[] = [];
afterAll(async () => {
  // eslint-disable-next-line no-console
  console.log('\n' + out.join('\n') + '\n');
  const { writeFileSync } = await import('node:fs');
  if (process.env.REV3_OUT) writeFileSync(`${process.env.REV3_OUT}/REV3-LOOKUP-closed-placewords.txt`, out.join('\n') + '\n');
});
const ATL = resolvePlace('Atlanta', 'GA')!;
const choose = (name: string, list: unknown[]) => {
  const p = parseListingResult(listingsBody(list).tasks[0] as never);
  return chooseListing(name, ATL, p.items, p.totalCount);
};
const verdict = (r: ReturnType<typeof choose>) => (r.choice ? `ATTACHED ${r.choice.listing.phone}` : `REFUSED(${r.reason})`);

describe('2. closed listings', () => {
  it('the documented path work_time.work_hours.current_status and its four values', () => {
    out.push('## closed listings: one same-named listing, by status');
    const rows: [string, unknown, string][] = [
      ['open', { work_hours: { timetable: null, current_status: 'open' } }, 'ATTACHED 404-555-0123'],
      ['close (documented value; taken as "outside opening hours")', { work_hours: { timetable: null, current_status: 'close' } }, 'ATTACHED 404-555-0123'],
      ['temporarily_closed', { work_hours: { timetable: null, current_status: 'temporarily_closed' } }, 'REFUSED(closed)'],
      ['closed_forever', { work_hours: { timetable: null, current_status: 'closed_forever' } }, 'REFUSED(closed)'],
      ['" closed_forever " (spaces)', { work_hours: { current_status: ' closed_forever ' } }, 'REFUSED(closed)'],
      ['work_time null (no hours on the listing)', null, 'ATTACHED 404-555-0123'],
      ['work_hours without current_status', { work_hours: { timetable: null } }, 'ATTACHED 404-555-0123'],
      // not documented values: since the round 18 integration (review 3 P3-3) the code fails CLOSED on all of them
      ['CLOSED_FOREVER (upper case, not documented)', { work_hours: { current_status: 'CLOSED_FOREVER' } }, 'REFUSED(closed)'],
      ['permanently_closed (not documented)', { work_hours: { current_status: 'permanently_closed' } }, 'REFUSED(closed)'],
      ['closed (not documented)', { work_hours: { current_status: 'closed' } }, 'REFUSED(closed)'],
      ['current_status directly under work_time (not the documented path)', { current_status: 'closed_forever' }, 'ATTACHED 404-555-0123'],
    ];
    for (const [label, wt, want] of rows) {
      const got = verdict(choose('Peachtree Roofing LLC', [item({ work_time: wt })]));
      out.push(`${got.padEnd(24)} ${label}`);
      expect(got, label).toBe(want);
    }
    expect(isClosed({ status: 'close' })).toBe(false);
    out.push('FIXED (P3-3): only the two documented open values (open, close) count as open; any other status string is closed.');
  });

  it('closed never attaches on any path: city, ZIP, site, and through the alert run with the cache row', async () => {
    for (const status of ['temporarily_closed', 'closed_forever']) {
      const closed = item({ work_time: { work_hours: { current_status: status } } });
      const c: ContactRecord = { signalId: 1, role: 'contractor', name: 'Peachtree Roofing LLC', city: null, state: null };
      const db = newDb();
      const budget = newBudget(lookupSettings(ENV));
      const got = await lookupForCards(new Map([[1, [c]]]), [{ signalId: 1, city: 'Atlanta', state: 'GA', contact: c }], budget, { db: db as never, fetch: fakeFetch([closed]) as never, env: ENV, now: () => NOW, sleep: async () => {} });
      expect(got.get(1)?.[0].listing).toBeUndefined();
      expect(budget.refused).toEqual({ closed: 1 });
      expect(db.tables.holler_business_lookup).toEqual([expect.objectContaining({ status: 'not_found', phone: null, website: null })]);
      // site path
      const biz: ContactRecord = { signalId: 2, role: 'business', name: 'Lakeview Bakery LLC', city: null, state: null };
      const site: ContactRecord = { signalId: 2, role: 'site', name: '', address: '200 W Addison St', city: 'Chicago', state: 'IL', zip: '60613' };
      const atSite = item({ title: 'Lakeview Bakery', latitude: 41.9543, longitude: -87.6575, address: '200 W Addison St, Chicago, IL 60613', work_time: { work_hours: { current_status: status } } }, { address: '200 W Addison St', city: 'Chicago', zip: '60613' });
      const got2 = await lookupForCards(new Map([[2, [biz, site]]]), [{ signalId: 2, city: 'Chicago', state: 'IL', contact: biz }], newBudget(lookupSettings(ENV)), { db: newDb() as never, fetch: fakeFetch([atSite]) as never, env: ENV, now: () => NOW, sleep: async () => {} });
      expect(got2.get(2)?.[0].listing).toBeUndefined();
    }
    out.push('REFUSED(closed)          temporarily_closed and closed_forever through lookupForCards: contractor (city path) and business (site path); cached as not_found');
  });

  it('a closed same-named listing next to an open one with ANOTHER phone', () => {
    out.push('', '## a closed listing beside an open one (same name, two phones, both inside 25 km)');
    const open = item({ phone: '+14045550123' });
    for (const status of ['closed_forever', 'temporarily_closed']) {
      const closed = item({ phone: '+14045559999', url: 'https://other-peachtree.example/', domain: 'other-peachtree.example', latitude: 33.80, longitude: -84.40, address: '900 Other Rd, Atlanta, GA 30318', work_time: { work_hours: { current_status: status } } }, { address: '900 Other Rd', zip: '30318' });
      const got = verdict(choose('Peachtree Roofing LLC', [closed, open]));
      out.push(`${got.padEnd(24)} ${status} (phone ...9999) + open (phone ...0123). On ea97b59 this pair was REFUSED(ambiguous).`);
      // FIXED (review 3 P3-2, round 18 integration): closed for good does not count; temporarily closed still exists, so it is a doubt.
      expect(got).toBe(status === 'closed_forever' ? 'ATTACHED 404-555-0123' : 'REFUSED(ambiguous)');
    }
    out.push('FIXED (P3-2): a temporarily closed same-named listing beside an open one is ambiguous; a closed-forever one does not count.');
  });
});

describe('3b. place words in names', () => {
  type Input = { city?: string | null; state?: string | null; zip?: string | null; jobCity?: string | null };
  // [name, input, where, rule wanted (the place-word rule alone), is the rule's decision sensible]
  type Case = [name: string, input: Input, where: string, rule: 'generic' | 'distinct', sensible: string];
  const ATLJOB: Input = { city: 'Atlanta', state: 'GA', jobCity: 'Atlanta' };
  const MARIETTA_ZIP: Input = { city: null, state: 'GA', zip: '30060', jobCity: 'Atlanta' };
  const CHI_SITE: Input = { city: 'Chicago', state: 'IL', zip: '60613', jobCity: 'Chicago' };
  const cases: Case[] = [
    // the brief's names
    ['Atlanta Roofing', ATLJOB, 'Atlanta job', 'generic', 'yes'],
    ['Marietta Street Bakery', ATLJOB, 'Atlanta job', 'distinct', 'yes ("marietta" and "street" are distinctive in Atlanta)'],
    ['Marietta Street Bakery', { city: 'Marietta', state: 'GA', jobCity: 'Marietta' }, 'Marietta job', 'distinct', 'yes ("street" is not a generic word)'],
    ['Georgia Roofing Company', ATLJOB, 'Atlanta job', 'generic', 'safe side (state plus trade; many firms share it)'],
    // place plus trade, in every position
    ['Atlanta Roofing Company', ATLJOB, 'Atlanta job', 'generic', 'yes'],
    ['Roofing Atlanta', ATLJOB, 'Atlanta job', 'generic', 'yes'],
    ['Atlanta Georgia Roofing', ATLJOB, 'Atlanta job', 'generic', 'yes'],
    ['Atlanta Home Services', ATLJOB, 'Atlanta job', 'generic', 'yes'],
    ['Atlanta Gutter Pros', ATLJOB, 'Atlanta job', 'generic', 'yes'],
    ['GA Roofing', ATLJOB, 'Atlanta job', 'generic', 'yes (the state code)'],
    // a distinctive word beside the place word
    ['Peachtree Roofing', ATLJOB, 'Atlanta job', 'distinct', 'yes'],
    ['Atlanta Peachtree Roofing', ATLJOB, 'Atlanta job', 'distinct', 'yes'],
    ['Georgia Power', ATLJOB, 'Atlanta job', 'distinct', 'yes'],
    ['Atlanta Bread Company', ATLJOB, 'Atlanta job', 'distinct', 'yes'],
    ['Atlanta Glass and Mirror', ATLJOB, 'Atlanta job', 'distinct', 'yes'],
    ['Chicago Pizza', ATLJOB, 'Atlanta job', 'distinct', 'yes (Chicago is not this place)'],
    ['New York Pizza', ATLJOB, 'Atlanta job', 'distinct', 'yes'],
    // place words the rule does not know
    ["Atlanta's Best Roofing", ATLJOB, 'Atlanta job', 'distinct', 'NO ("atlantas" is not read as the place word)'],
    ['ATL Roofing', ATLJOB, 'Atlanta job', 'distinct', 'acceptable'],
    ['Metro Atlanta Roofing', ATLJOB, 'Atlanta job', 'distinct', 'NO ("metro" alone makes it pass)'],
    ['Greater Atlanta Plumbing', ATLJOB, 'Atlanta job', 'distinct', 'NO (same)'],
    ['North Georgia Roofing', ATLJOB, 'Atlanta job', 'distinct', 'NO (direction plus state plus trade)'],
    ['Decatur Plumbing', ATLJOB, 'Atlanta job, no contractor address', 'distinct', 'not consistent: a town 9 km away, inside the 25 km search'],
    ['Marietta Roofing', ATLJOB, 'Atlanta job, no contractor address', 'distinct', 'not consistent (same)'],
    ['Fulton County Roofing', ATLJOB, 'Atlanta job', 'distinct', 'not consistent (the county of the job plus a trade)'],
    // the ZIP path and the site path
    ['Marietta Roofing', MARIETTA_ZIP, 'contractor ZIP 30060 (Marietta), Atlanta job', 'generic', 'yes (the ZIP city)'],
    ['Atlanta Roofing', MARIETTA_ZIP, 'contractor ZIP 30060 (Marietta), Atlanta job', 'generic', 'yes (the job city)'],
    ['Cobb Roofing', MARIETTA_ZIP, 'contractor ZIP 30060 (Marietta), Atlanta job', 'distinct', 'acceptable'],
    ['Chicago Pizza', CHI_SITE, 'Chicago site', 'generic', 'yes'],
    ['Lakeview Bakery', CHI_SITE, 'Chicago site', 'distinct', 'yes (and the street address must match)'],
    // real names the place rule refuses
    ['West Roofing', { city: 'Charleston', state: 'WV', jobCity: 'Charleston' }, 'Charleston, West Virginia', 'generic', 'false refusal ("west" is a state word; here a family name)'],
    ['Carolina Roofing', { city: 'Charlotte', state: 'NC', jobCity: 'Charlotte' }, 'Charlotte, North Carolina', 'generic', 'safe side'],
    ['York Plumbing', { city: 'Albany', state: 'NY', jobCity: 'Albany' }, 'Albany, New York', 'generic', 'false refusal ("york" is a state word)'],
    ['Island Pools', { city: 'Providence', state: 'RI', jobCity: 'Providence' }, 'Providence, Rhode Island', 'generic', 'false refusal ("island" is a state word)'],
    ['Jackson Roofing', { city: 'Jackson', state: 'MS', jobCity: 'Jackson' }, 'Jackson, Mississippi', 'generic', 'safe side (cannot be told from city plus trade)'],
    ['Austin Plumbing', { city: 'Austin', state: 'TX', jobCity: 'Austin' }, 'Austin, Texas', 'generic', 'yes'],
    ['Washington Electric', { city: 'Seattle', state: 'WA', jobCity: 'Seattle' }, 'Seattle, Washington', 'generic', 'yes'],
    // shop words
    ['Home Depot', ATLJOB, 'Atlanta job', 'generic', 'safe side (a chain; both words are in the list)'],
    ['Soul Kitchen', ATLJOB, 'Atlanta job', 'generic', 'safe side'],
  ];

  it('decisions', () => {
    out.push(
      '',
      '## place words: decision per name',
      'rule  = the place-word rule alone (isGenericName): generic = never sent, distinct = may be sent',
      'class = the business classifier (lib/contacts/org.ts isOrganisationName, NOT part of this diff), for the name as written / with " LLC" added',
      'final = nameRefusal, for the name as written / with " LLC" added (sent = looked up)',
      `${'name'.padEnd(26)} ${'where'.padEnd(44)} ${'rule'.padEnd(9)} ${'class'.padEnd(12)} ${'final'.padEnd(27)} is the rule sensible?`,
    );
    for (const [name, input, where, want, sensible] of cases) {
      const rule = isGenericName(name, input) ? 'generic' : 'distinct';
      const cls = `${isOrganisationName(name) ? 'org' : 'no'} / ${isOrganisationName(`${name} LLC`) ? 'org' : 'no'}`;
      const fin = `${nameRefusal(name, input) ?? 'sent'} / ${nameRefusal(`${name} LLC`, input) ?? 'sent'}`;
      out.push(`${name.padEnd(26)} ${where.padEnd(44)} ${rule.padEnd(9)} ${cls.padEnd(12)} ${fin.padEnd(27)} ${sensible}`);
      expect(rule, `${name} @ ${where}`).toBe(want);
    }
  });

  it('the brief\'s two names end to end: the classifier refuses both before the place rule is asked', () => {
    for (const n of ['Marietta Street Bakery', 'Marietta Street Bakery LLC', 'Georgia Roofing Company', 'Georgia Roofing Company LLC']) {
      expect(isOrganisationName(n), n).toBe(false);
      expect(nameRefusal(n, ATLJOB), n).toBe('not_business');
    }
    expect(isGenericName('Marietta Street Bakery', ATLJOB)).toBe(false);
    expect(isGenericName('Georgia Roofing Company', ATLJOB)).toBe(true);
    out.push('', 'END TO END: "Marietta Street Bakery" and "Georgia Roofing Company" (with or without LLC) are refused as not_business by lib/contacts/org.ts (the business classifier, outside this diff). The place rule alone would send the first and refuse the second.');
  });

  it('a neighbouring-city name on a job with no contractor address is attached to the one listing in the next town', async () => {
    const c: ContactRecord = { signalId: 3, role: 'contractor', name: 'Decatur Plumbing LLC', city: null, state: null };
    expect(lookupInputFor(c, [c], { city: 'Atlanta', state: 'GA' })).toMatchObject({ city: 'Atlanta', state: 'GA', zip: null });
    const dec = item({ title: 'Decatur Plumbing', phone: '+14045550177', url: null, domain: null, latitude: 33.7748, longitude: -84.2963, address: '1 W Court Sq, Decatur, GA 30030' }, { address: '1 W Court Sq', city: 'Decatur', zip: '30030' });
    const got = await lookupForCards(new Map([[3, [c]]]), [{ signalId: 3, city: 'Atlanta', state: 'GA', contact: c }], newBudget(lookupSettings(ENV)), { db: newDb() as never, fetch: fakeFetch([dec]) as never, env: ENV, now: () => NOW, sleep: async () => {} });
    expect(got.get(3)?.[0].listing).toEqual({ phone: '404-555-0177', website: null });
    // the same name is refused as generic as soon as the record places the contractor in Decatur
    const c2: ContactRecord = { ...c, city: 'Decatur', state: 'GA' };
    const inp = lookupInputFor(c2, [c2], { city: 'Atlanta', state: 'GA' })!;
    expect(nameRefusal(c2.name, { city: inp.city, state: inp.state, zip: inp.zip, jobCity: inp.jobCity })).toBe('generic_name');
    out.push('', 'ATTACHED                 "Decatur Plumbing LLC" on an Atlanta permit with no contractor address: the one "Decatur Plumbing" listing in Decatur (9 km) is attached.', 'generic_name             the same name when the record gives the contractor\'s city as Decatur. One name, two decisions (note N-2).');
  });

  it('a generic name is counted as "no_place" in the run\'s JSON, not as "generic_name"', async () => {
    const c: ContactRecord = { signalId: 4, role: 'contractor', name: 'Atlanta Roofing LLC', city: null, state: null };
    const budget = newBudget(lookupSettings(ENV));
    const fetch = fakeFetch([item({ title: 'Atlanta Roofing' })]);
    await lookupForCards(new Map([[4, [c]]]), [{ signalId: 4, city: 'Atlanta', state: 'GA', contact: c }], budget, { db: newDb() as never, fetch: fetch as never, env: ENV, now: () => NOW, sleep: async () => {} });
    expect(fetch).not.toHaveBeenCalled();
    expect(budget.skipped).toEqual({ no_place: 1 });
    out.push('', `label                    "Atlanta Roofing LLC" on an Atlanta job: no call; the run's JSON counts it under skipped.${Object.keys(budget.skipped)[0]} (the reason is generic_name)`);
  });
});
