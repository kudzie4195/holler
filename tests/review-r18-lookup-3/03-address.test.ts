// Round 18 integration: review 3 probe (logs/REV3-LOOKUP-probe-tests) kept as a permanent regression test. Findings fixed at integration
// (P2-1 health line, P3-1 outage stop, P3-2/P3-3 closed listings, P3-5 address forms, P3-6 address before ambiguity, P3-7 tie order) now assert
// the fixed behaviour; every other assertion is the reviewer's as written.
// REV3 probe (r18 LOOKUP redo 2, cac086d), task 3: the street-address match for a business at its site (licence, inspection).
// Each row runs the real chooseListing with a strict place built from the record's street line and one listing at the listing's street
// line, same name, same ZIP unless the row says otherwise. Printed: ATTACHED or REFUSED(reason). `want` is what a careful person would do.
// A row where got !== want is marked WRONG-ATTACH (a wrong shop gets the phone) or FALSE-REFUSAL (a right shop is refused).
import { afterAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { chooseListing, lookupForCards, lookupInputFor, lookupSettings, newBudget, parseListingResult, parseStreet, resolvePlace, sameStreet } from '@/lib/enrich/business-lookup';
import type { ContactRecord } from '@/lib/contacts/types';
import { ENV, NOW, fakeFetch, item, listingsBody, newDb } from '../enrich/helpers';

const out: string[] = [];
afterAll(async () => {
  // eslint-disable-next-line no-console
  console.log('\n' + out.join('\n') + '\n');
  const { writeFileSync } = await import('node:fs');
  if (process.env.REV3_OUT) writeFileSync(`${process.env.REV3_OUT}/REV3-LOOKUP-address-matrix.txt`, out.join('\n') + '\n');
});

const NAME = 'Lakeview Bakery LLC';
const ZIP = '60613';
const PT = { latitude: 41.9543, longitude: -87.6575 };
const listing = (street: string | null, over: Record<string, unknown> = {}, addr: Record<string, unknown> = {}) =>
  item(
    { title: 'Lakeview Bakery', phone: '+17735550188', url: 'https://lakeviewbakery.example/', domain: 'lakeviewbakery.example', address: street ? `${street}, Chicago, IL ${ZIP}` : null, ...PT, ...over },
    { address: street, city: 'Chicago', zip: ZIP, ...addr },
  );
function run(recordStreet: string, items: unknown[], zip = ZIP): string {
  const place = resolvePlace('Chicago', 'IL', zip, { strict: true, street: recordStreet });
  if (!place) return 'NOT LOOKED UP(no_place)';
  const p = parseListingResult(listingsBody(items).tasks[0] as never);
  const r = chooseListing(NAME, place, p.items, p.totalCount);
  return r.choice ? 'ATTACHED' : `REFUSED(${r.reason})`;
}
type Row = [id: string, record: string, listingStreet: string, want: 'attach' | 'refuse', note: string];
function table(title: string, rows: Row[]): { wrongAttach: string[]; falseRefusal: string[] } {
  const wrongAttach: string[] = [];
  const falseRefusal: string[] = [];
  out.push('', `## ${title}`);
  for (const [id, rec, lst, want, note] of rows) {
    const got = run(rec, [listing(lst)]);
    const attached = got === 'ATTACHED';
    const flag = attached && want === 'refuse' ? 'WRONG-ATTACH' : !attached && want === 'attach' ? 'FALSE-REFUSAL' : 'ok';
    if (flag === 'WRONG-ATTACH') wrongAttach.push(id);
    if (flag === 'FALSE-REFUSAL') falseRefusal.push(id);
    out.push(`${id.padEnd(5)} ${flag.padEnd(14)} ${got.padEnd(26)} record "${rec}"  vs  listing "${lst}"${note ? `  (${note})` : ''}`);
  }
  return { wrongAttach, falseRefusal };
}

describe('3. the site address match: wrong-shop attacks (every row must be REFUSED)', () => {
  it('the nine attack classes of the brief', () => {
    const r = table('wrong-shop attacks (want: refuse)', [
      ['a1', '100 Main St', '100 Oak St', 'refuse', 'same house number, another street'],
      ['a2', '100 Main St', '102 Main St', 'refuse', 'same street, another number'],
      ['a3', '100 Main St', '1000 Main St', 'refuse', 'number is a prefix'],
      ['a4', '100 W Main St', '100 E Main St', 'refuse', 'W versus E'],
      ['a5', '100 N Main St', '100 S Main St', 'refuse', 'N versus S'],
      ['a6', '100 Main St NE', '100 Main St NW', 'refuse', 'quadrant'],
      ['a7', '100 Main St', '100 Main Ave', 'refuse', 'St versus Ave'],
      ['a8', '100 Main St', '100 Main Ct', 'refuse', 'St versus Ct'],
      ['a9', '100 Park Pl', '100 Park Plz', 'refuse', 'Place versus Plaza'],
      ['a10', '100 5th St', '100 5th Ave', 'refuse', 'numbered street, other type'],
      ['a11', '100 5th St', '100 15th St', 'refuse', '5th versus 15th'],
      ['a12', '100 E 5th St', '100 W 5th St', 'refuse', 'numbered street, other side'],
      ['a13', '1200 Hwy 120', '1200 Hwy 20', 'refuse', 'another highway number'],
      ['a14', '1200 Hwy 92 N', '1200 Hwy 92 S', 'refuse', 'highway, other direction'],
      ['a15', '1200 GA-120', '1200 GA-20', 'refuse', 'state route number'],
      ['a16', '100A Main St', '100 Main St', 'refuse', 'house number with a letter'],
      ['a17', '100 1/2 Main St', '100 Main St', 'refuse', 'a half number is another door'],
      ['a18', '100 Main St', '100 Main St W', 'refuse', 'a post-direction is another street in some grids'],
    ]);
    expect(r.wrongAttach).toEqual([]);
  });

  it('another ZIP, no ZIP, another state', () => {
    out.push('', '## ZIP attacks');
    // the same street address text in the neighbouring ZIP (a street that runs through two ZIPs, or two towns that each have a Main St)
    const other = run('100 Main St', [listing('100 Main St', { address: '100 Main St, Chicago, IL 60657' }, { zip: '60657' })]);
    out.push(`z1    ${other.padEnd(26)} same street line, listing ZIP 60657, record ZIP 60613`);
    expect(other).toBe('REFUSED(address_mismatch)');
    // listing with no ZIP anywhere
    const none = run('100 Main St', [listing('100 Main St', { address: '100 Main St, Chicago' }, { zip: null })]);
    out.push(`z2    ${none.padEnd(26)} same street line, listing has no ZIP in address_info or in address`);
    expect(none).toBe('REFUSED(no_state)');
    // listing ZIP only in the address text
    const text = run('100 Main St', [listing('100 Main St', {}, { zip: null })]);
    out.push(`z3    ${text.padEnd(26)} same street line, listing ZIP only in the address text ("..., IL 60613")`);
    expect(text).toBe('ATTACHED');
    // ZIP+4 and a JSON number
    expect(run('100 Main St', [listing('100 Main St', {}, { zip: '60613-1234' })])).toBe('ATTACHED');
    expect(run('100 Main St', [listing('100 Main St', {}, { zip: 60613 })])).toBe('ATTACHED');
    out.push(`z4    ATTACHED                   listing ZIP "60613-1234" and ZIP as the JSON number 60613`);
    // the record has no ZIP: never looked up
    const biz: ContactRecord = { signalId: 1, role: 'business', name: NAME, city: null, state: null };
    const siteNoZip: ContactRecord = { signalId: 1, role: 'site', name: '', address: '100 Main St', city: 'Chicago', state: 'IL', zip: null };
    expect(lookupInputFor(biz, [biz, siteNoZip], { city: 'Chicago', state: 'IL' })).toBeNull();
    const siteBadZip: ContactRecord = { ...siteNoZip, zip: '6061' };
    expect(lookupInputFor(biz, [biz, siteBadZip], { city: 'Chicago', state: 'IL' })).toBeNull();
    const siteNoStreet: ContactRecord = { ...siteNoZip, zip: '60613', address: null };
    expect(lookupInputFor(biz, [biz, siteNoStreet], { city: 'Chicago', state: 'IL' })).toBeNull();
    out.push(`z5    NOT LOOKED UP              record site with no ZIP, with an unreadable ZIP ("6061"), or with a ZIP and no street line`);
    // record ZIP in another state than the record's state
    const siteWrong: ContactRecord = { ...siteNoZip, zip: '46320' }; // Hammond, Indiana
    const inp = lookupInputFor(biz, [biz, siteWrong], { city: 'Chicago', state: 'IL' })!;
    expect(resolvePlace(inp.city, inp.state, inp.zip, { strict: true, street: inp.street })).toBeNull();
    out.push(`z6    NOT LOOKED UP              record says IL with ZIP 46320 (Indiana)`);
    // a street line with no house number, a PO box, an intersection
    for (const s of ['W Addison St', 'PO Box 123', 'Main St & 5th Ave', 'N56W13585 Silver Spring Dr']) expect(parseStreet(s), s).toBeNull();
    out.push(`z7    NOT LOOKED UP              record street "W Addison St", "PO Box 123", "Main St & 5th Ave", "N56W13585 Silver Spring Dr" (no leading house number)`);
  });

  it('a shopping centre: several shops at one street address', () => {
    out.push('', '## one street address, several shops (record: "Lakeview Bakery LLC", 3100 N Broadway Ste 10)');
    const rec = '3100 N Broadway Ste 10';
    const shop = (title: string, suite: string, phone: string) => listing(`3100 N Broadway ${suite}`.trim(), { title, phone, url: null, domain: null });
    const cases: [string, unknown[], string][] = [
      ['s1 similar name, other suite ("Lakeview Bakery & Cafe")', [shop('Lakeview Bakery & Cafe', 'Ste 14', '+17735550101')], 'REFUSED(no_match)'],
      ['s2 similar name ("Lakeview Bake Shop")', [shop('Lakeview Bake Shop', 'Ste 12', '+17735550102')], 'REFUSED(no_match)'],
      ['s3 similar name ("Lake View Bakery", two words)', [shop('Lake View Bakery', 'Ste 10', '+17735550103')], 'REFUSED(no_match)'],
      ['s4 three neighbours, none with the name', [shop('Lakeview Nails', 'Ste 11', '+17735550104'), shop('Lakeview Cleaners', 'Ste 12', '+17735550105'), shop('Broadway Bakery', 'Ste 13', '+17735550106')], 'REFUSED(no_match)'],
      ['s5 the same name twice in the centre, two suites, two phones', [shop('Lakeview Bakery', 'Ste 10', '+17735550107'), shop('Lakeview Bakery', 'Ste 30', '+17735550108')], 'REFUSED(ambiguous)'],
      ['s6 the same name, a neighbour shares its phone (centre office number)', [shop('Lakeview Bakery', 'Ste 10', '+17735550109'), shop('Broadway Shopping Center', '', '+17735550109')], 'REFUSED(shared_phone)'],
      ['s7 the same name once, in ANOTHER suite of the same address', [shop('Lakeview Bakery', 'Ste 30', '+17735550110')], 'ATTACHED'],
      ['s8 the same name once, same suite', [shop('Lakeview Bakery', 'Ste 10', '+17735550111')], 'ATTACHED'],
    ];
    for (const [label, items, want] of cases) {
      const got = run(rec, items);
      out.push(`${got.padEnd(26)} ${label}`);
      expect(got, label).toBe(want);
    }
    out.push('note s7: the suite is not compared (parseStreet drops the unit). One same-named listing in another suite of the same street address is attached.');
  });

  it('the listing sits at the right address but ANOTHER same-named listing is elsewhere in the 5 km disc', () => {
    out.push('', '## a chain with two branches inside 5 km (record: the Addison branch)');
    const here = listing('200 W Addison St', { phone: '+17735550201', url: 'https://lakeviewbakery.example/addison' });
    const there = listing('3100 N Broadway', { phone: '+17735550202', url: 'https://lakeviewbakery.example/broadway', address: '3100 N Broadway, Chicago, IL 60657' }, { zip: '60657' });
    const twoPhones = run('200 W Addison St', [here, there]);
    out.push(`${twoPhones.padEnd(26)} two branches, each its own phone: the address picks the right one (review 3 P3-6, fixed at integration)`);
    expect(twoPhones).toBe('ATTACHED');
    {
      const place = resolvePlace('Chicago', 'IL', ZIP, { strict: true, street: '200 W Addison St' })!;
      const p = parseListingResult(listingsBody([here, there]).tasks[0] as never);
      expect(chooseListing(NAME, place, p.items, p.totalCount).choice?.listing.phone).toBe('773-555-0201');
    }
    const onePhone = run('200 W Addison St', [here, { ...there, phone: '+17735550201' }]);
    out.push(`${onePhone.padEnd(26)} two branches, one shared phone and host: only the listing at the site address is read (P3-6)`);
    expect(onePhone).toBe('ATTACHED');
    // a closed listing at the site and an open one elsewhere
    const closedHere = listing('200 W Addison St', { work_time: { work_hours: { current_status: 'closed_forever' } } });
    const openElsewhere = listing('3100 N Broadway', { phone: '+17735550203', address: '3100 N Broadway, Chicago, IL 60657' }, { zip: '60657' });
    const moved = run('200 W Addison St', [closedHere, openElsewhere]);
    out.push(`${moved.padEnd(26)} closed_forever at the site, open same name at another address`);
    expect(moved).toBe('REFUSED(address_mismatch)');
  });

  it('through lookupForCards: the record line of a Chicago licence against one listing next door', async () => {
    const biz: ContactRecord = { signalId: 7, role: 'business', name: NAME, city: null, state: null };
    const site: ContactRecord = { signalId: 7, role: 'site', name: '', address: '200 W ADDISON ST', city: 'CHICAGO', state: 'IL', zip: '60613' };
    const nextDoor = listing('202 W Addison St');
    const db = newDb();
    const got = await lookupForCards(new Map([[7, [biz, site]]]), [{ signalId: 7, city: 'Chicago', state: 'IL', contact: biz }], newBudget(lookupSettings(ENV)), { db: db as never, fetch: fakeFetch([nextDoor]) as never, env: ENV, now: () => NOW, sleep: async () => {} });
    expect(got.get(7)?.[0].listing).toBeUndefined();
    expect(db.tables.holler_business_lookup).toEqual([expect.objectContaining({ status: 'not_found', city_key: 'chicago 60613 site 200 w addison st' })]);
    const right = listing('200 W Addison St');
    const got2 = await lookupForCards(new Map([[7, [biz, site]]]), [{ signalId: 7, city: 'Chicago', state: 'IL', contact: biz }], newBudget(lookupSettings(ENV)), { db: newDb() as never, fetch: fakeFetch([right]) as never, env: ENV, now: () => NOW, sleep: async () => {} });
    expect(got2.get(7)?.[0].listing).toEqual({ phone: '773-555-0188', website: 'https://lakeviewbakery.example/' });
    out.push('', 'route: licence "200 W ADDISON ST" 60613, one listing at 202 W Addison St: refused, cached not_found under "chicago 60613 site 200 w addison st"; listing at 200 W Addison St: attached');
  });
});

describe('3. the site address match: plain formatting differences (every row SHOULD attach)', () => {
  it('formatting that is read as the same address', () => {
    const r = table('formatting differences that pass (want: attach)', [
      ['f1', '200 W ADDISON ST', '200 W Addison St', 'attach', 'upper case'],
      ['f2', '200 West Addison Street', '200 W Addison St', 'attach', 'spelled out'],
      ['f3', '200 W. Addison St.', '200 W Addison St', 'attach', 'periods'],
      ['f4', '200  W  Addison   St ', '200 W Addison St', 'attach', 'spaces'],
      ['f5', '200 W Addison St, Chicago, IL', '200 W Addison St', 'attach', 'record carries the city'],
      ['f6', '200 W Addison St Ste 3', '200 W Addison St', 'attach', 'suite on the record'],
      ['f7', '200 W Addison St', '200 W Addison St #3', 'attach', '# unit on the listing'],
      ['f8', '200 W Addison St Unit B', '200 W Addison St, Suite 200', 'attach', 'units on both'],
      ['f9', '200 W Addison St Bldg 2', '200 W Addison St', 'attach', 'building'],
      ['f10', '1200 Cobb Pkwy NW', '1200 Cobb Parkway Northwest', 'attach', 'suffix and quadrant spelled out'],
      ['f11', '1200 US-41', '1200 US 41', 'attach', 'hyphen'],
      ['f12', '100 E 31ST ST', '100 E 31st St', 'attach', 'ordinal, same spelling'],
      ['f13', '100 Peña Blvd', '100 Pena Boulevard', 'attach', 'accent'],
      ['f14', "100 O'Hare Way", '100 OHare Way', 'attach', 'apostrophe'],
      ['f15', '100 Martin Luther King Jr. Blvd', '100 Martin Luther King Jr Boulevard', 'attach', ''],
    ]);
    expect(r.falseRefusal).toEqual([]);
    expect(r.wrongAttach).toEqual([]);
  });

  it('the listing gives the street only inside `address` (address_info.address null)', () => {
    const got = run('200 W Addison St', [listing(null, { address: '200 W Addison St, Chicago, IL 60613' })]);
    out.push('', `${got.padEnd(26)} address_info.address null, address "200 W Addison St, Chicago, IL 60613"`);
    expect(got).toBe('ATTACHED');
  });

  it('formatting differences that are REFUSED today (false refusals; safe, but they cost the call and the phone)', () => {
    const r = table('formatting differences that are refused (want: attach)', [
      ['r1', '100 5th St', '100 Fifth St', 'attach', 'numbered street: "5th" versus "Fifth"'],
      ['r2', '100 E 53 St', '100 E 53rd St', 'attach', 'numbered street with no ordinal ending (New York records)'],
      ['r3', '100 1st Ave', '100 First Ave', 'attach', ''],
      ['r4', '1200 GA-120', '1200 Hwy 120', 'attach', 'highway: state route written two ways'],
      ['r5', '1200 Hwy 120', '1200 State Route 120', 'attach', ''],
      ['r6', '1200 GA Hwy 120', '1200 GA-120', 'attach', ''],
      ['r7', '1200 Hwy 120', '1200 Marietta Hwy', 'attach', 'route number versus the road name Google shows'],
      ['r8', '9500 S IH 35', '9500 S I-35 Frontage Rd', 'attach', 'Austin records write "IH 35"'],
      ['r9', '1234 County Road 12', '1234 CR 12', 'attach', ''],
      ['r10', '1234 FM 1960 Rd W', '1234 FM 1960 W', 'attach', ''],
      ['r11', '100 St Charles Ave', '100 Saint Charles Ave', 'attach', 'St as Saint'],
      ['r12', '100 MLK Jr Blvd', '100 Martin Luther King Jr Blvd', 'attach', ''],
      ['r13', '200 Addison St', '200 W Addison St', 'attach', 'record without the direction (documented as doubt)'],
      ['r14', '100 Peachtree St', '100 Peachtree St NE', 'attach', 'record without the quadrant'],
      ['r15', '100 Broadway', '100 Broadway St', 'attach', 'suffix missing on one side'],
      ['r16', '3714 S HALSTED ST 1ST', '3714 S Halsted St', 'attach', 'a floor with no unit word (how Chicago licence rows are said to be written; not verified)'],
      ['r17', '233 S WACKER DR 4500', '233 S Wacker Dr', 'attach', 'a suite number with no unit word'],
      ['r18', '200 W Addison St B', '200 W Addison St Unit B', 'attach', 'unit letter with no unit word'],
      ['r19', '100-102 Main St', '100 Main St', 'attach', 'a number range'],
      ['r20', '100 No. Main St', '100 N Main St', 'attach', '"No." for North is read as a unit word'],
      ['r21', '100 O’Hare Way', "100 O'Hare Way", 'attach', 'curly apostrophe'],
    ]);
    out.push(`false refusals in this table: ${r.falseRefusal.length} of 21`);
    expect(r.wrongAttach).toEqual([]);
    // Round 18 integration (review 3 P3-5, commander's list): "5th"/"Fifth", "E 53 St"/"E 53rd St", "1st"/"First", "Hwy 120"/"Highway
    // 120"/"GA-120" (and "GA Hwy 120", "State Route 120"), "St"/"Saint" leading a name, and a unit with no unit word now attach. The rest
    // stay refused on purpose (the safe side; each needs real rows): Marietta Hwy, IH 35, CR 12, FM 1960 Rd, MLK, a missing direction,
    // quadrant or street type, a number range, "No." for North, a curly apostrophe.
    expect(r.falseRefusal).toEqual(['r7', 'r8', 'r9', 'r10', 'r12', 'r13', 'r14', 'r15', 'r19', 'r20', 'r21']);
  });

  it('the listing street line starts with a place name (the documented sample "Project, 53 22 Market Pl")', () => {
    const got = run('200 W Addison St', [listing('Lakeview Plaza, 200 W Addison St')]);
    out.push('', `${got.padEnd(26)} address_info.address "Lakeview Plaza, 200 W Addison St" (only the first comma part is read)`);
    expect(got).toBe('REFUSED(address_mismatch)');
    const suiteFirst = run('200 W Addison St', [listing('Suite 3, 200 W Addison St')]);
    out.push(`${suiteFirst.padEnd(26)} address_info.address "Suite 3, 200 W Addison St"`);
    expect(suiteFirst).toBe('REFUSED(address_mismatch)');
  });

  it('two different streets that normalise to the same words', () => {
    out.push('', '## different streets with equal normalised words');
    for (const [a, b] of [['100 E St', '100 East St'], ['100 S St', '100 South St'], ['100 N Ave', '100 North Ave'], ['100 Court St', '100 Ct St']]) {
      const same = sameStreet(a, b);
      out.push(`${(same ? 'EQUAL' : 'different').padEnd(26)} "${a}"  vs  "${b}"  -> ${JSON.stringify(parseStreet(a))} / ${JSON.stringify(parseStreet(b))}`);
      expect(same).toBe(true);
    }
    out.push('note: a direction word is rewritten wherever it stands, so "E St" (the letter street) and "East St" are one street to the match. They would also need the same ZIP, the same house number and the same business name.');
  });
});
