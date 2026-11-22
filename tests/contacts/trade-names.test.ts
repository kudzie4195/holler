/**
 * Round 18 (NAMES): the contractor trade-name rule (lib/contacts/trade-name.ts) and where it applies (lib/contacts/names.ts).
 *
 * Real strings: the company strings of tests/contacts/classifier-real-examples.test.ts, copied from two public permit feeds on 2026-11-21
 * (Dallas Building Permits e7gq-4sah, the name part of `contractor`; Orlando Right of Way permits 6sbc-v4b9, `contractor`). The repo
 * does not label which feed each of the 12 strings the strict rule refused came from; the split below is by trade (utility and telecom
 * names to the Orlando right-of-way feed, building trades to Dallas) and is ASSUMED. Person names are invented; their shapes are the
 * shapes the review and the owner named ("Mason Carpenter", "Glass, Mary", "Bill Painter", "Homes, Sherlock", "Carter, Electra").
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanOrgName } from '@/lib/contacts/org';
import { cleanBusinessName, cleanContractorName, isContractorName, TRADE_WORDS } from '@/lib/contacts/trade-name';
import { contactNameFor, isStoredContactName } from '@/lib/contacts/names';
import { extractContacts, type ContactSpec } from '@/lib/contacts/extract';
import { sanitizeContact } from '@/lib/contacts/sanitize';

/** Real company strings, before and after (sourced: classifier-real-examples.test.ts). */
const DALLAS_REAL = [
  'ACM PLUMBING CO.', 'BERKEYS LLC', 'SIGNS MANUFACTURING & MAINTENANCE CORPORATION', 'OPTIONS REAL ESTATE', 'URGENT RESTORATION',
  'WEB CITY PROPERTIES', 'REPUBLIC HEATING & AIR CONDITIONING INC', 'VELEX INC.', 'MICROWAVE TRANSMISSION SYSTEM INC', 'PRIORITY SIGNS AND GRAPHICS',
  'GUEL FAMILY BUILDERS INC', 'MILESTONE ELECTRIC', 'GRAND PRAIRIE CONSTRUCTION INC',
  // refused by the strict rule; feed assumed by trade
  'ARRINGTON ROOFING CO INC.', 'TEMPO MECHANICAL', 'CONDOR FENCING', 'ELSTONAIRE', 'SERVICE 1ST', 'A #1 AIR',
];
const ORLANDO_REAL = [
  'SOUTHWEST COMMUNICATIONS SOLUTIONS INC', 'TCS COMMUNICATIONS LLC', 'PRIMORIS DISTRIBUTION SERVICES', 'ADVANCED FACILITY CONTRACTING AND CONSULTING LLC',
  'APL SITE DEVELOPMENT LLC', 'VETERAN CONSTRUCTION SOLUTIONS LLC', 'PRESTO PROPERTY SERVICES INC', 'SMG CONTRACTORS',
  // refused by the strict rule; feed assumed by trade
  'ESPARZA UNDERGROUND INC', 'AMBIENT TECHNOLOGIES INC', 'GULF COAST CUSTOM CABLE INC', 'KIMLEY HORN AND ASSOCIATES INC', 'VERDANTAS LLC', 'DUKE ENERGY',
];
/** The real strings the strict rule refused and the trade-name rule now names (every one listed for a human to eyeball). */
const NEWLY_ACCEPTED_REAL = [
  'ARRINGTON ROOFING CO INC.', 'TEMPO MECHANICAL', 'CONDOR FENCING', 'SERVICE 1ST',
  'ESPARZA UNDERGROUND INC', 'AMBIENT TECHNOLOGIES INC', 'GULF COAST CUSTOM CABLE INC', 'KIMLEY HORN AND ASSOCIATES INC', 'VERDANTAS LLC', 'DUKE ENERGY',
];
/** Real strings still refused: no business marker the rule can read ("ELSTONAIRE"), or a single letter before an ambiguous word ("A #1 AIR"). */
const STILL_REFUSED_REAL = ['ELSTONAIRE', 'A #1 AIR'];

/** Trade names under a person's name: a business by the owner's decision, in a contractor column only (invented). */
const TRADE_NAMES: [string, string][] = [
  ['Carter Electric', 'Carter Electric'],
  ['Smith Roofing', 'Smith Roofing'],
  ['Mary Jones Plumbing LLC', 'Mary Jones Plumbing LLC'],
  ['JOHN SMITH ROOFING', 'JOHN SMITH ROOFING'],
  ['ROBERT JOHNSON PLUMBING', 'ROBERT JOHNSON PLUMBING'],
  ['LINDA MARTINEZ ELECTRIC', 'LINDA MARTINEZ ELECTRIC'],
  ['JENNIFER DAVIS HVAC', 'JENNIFER DAVIS HVAC'],
  ['Kowalski Roofing', 'Kowalski Roofing'],
  ['Smith & Sons', 'Smith & Sons'],
  ['Smith Bros.', 'Smith Bros.'],
  ['J. Smith Roofing', 'J. Smith Roofing'],
  ['Smith Heating & A/C', 'Smith Heating & A/C'],
  ['Smith Plumbing Pros', 'Smith Plumbing Pros'],
  ['Danny Smith LLC', 'Danny Smith LLC'],
  ['Lone Star Roofing LLC', 'Lone Star Roofing LLC'],
  ['NORTH BRANCH ARCHITECTS LTD', 'NORTH BRANCH ARCHITECTS LTD'],
  ['Smith Roofing, Inc.', 'Smith Roofing Inc.'],
  ['John Smith DBA Smith Roofing', 'Smith Roofing'],
  ['MICHAEL T BROWN (SMITH ROOFING)', 'SMITH ROOFING'],
  ['MICHAEL T BROWN (SOUTHWEST COMMUNICATIONS SOLUTIONS INC)', 'SOUTHWEST COMMUNICATIONS SOLUTIONS INC'],
  ['JAMES CARTER (PRESTO PROPERTY SERVICES INC)', 'PRESTO PROPERTY SERVICES INC'],
];

/** Invented person shapes: never named, in any column (at least 25; the tricky ones first). */
const PERSONS = [
  'Mason Carpenter', 'Glass, Mary', 'Bill Painter', 'Homes, Sherlock', 'Carter, Electra', 'Electric, Carter', 'Tree, Ann', 'Glass Mary',
  'Homes Sherlock', 'Mary Glass', 'Ann Stone', 'Kelly Wood', 'Ray Stone', 'Mark Steel', 'Rosa Solar', 'Bill Lawn', 'Pat Mason', 'Ann Mason',
  'Jim Baker', 'Joe Cook', 'Ted Mason Carpenter', 'Robert Plumber', 'Carter Electrician', 'Tom Electrician', 'Chris Builder', 'Bob the Builder',
  'John Smith Handyman', 'Smith Locksmith', 'Mary Smith General Contractor', 'John Smith', 'SMITH, JOHN A', 'SMITH JOHN', 'SMITH JOHN A',
  'JAMES CARTER', 'MARIA L GARCIA', 'CARTER, JAMES A', 'DAVID WILSON', 'MICHAEL T BROWN', 'WILLIAM TAYLOR', 'Maria Lopez', 'Kim Lee', 'J SMITH',
  'D. Wilson', 'Dr. John Smith', 'JOHN SMITH JR', 'Mary & John Smith', 'Smith & Jones', 'John Smith, Qualifier', 'JOHN SMITH QUALIFIER',
  'JOHN SMITH LICENSE HOLDER', 'John Smith Owner', 'JOHN SMITH (OWNER)', 'JOHN SMITH ET AL', 'Jane Doe 512-555-0100', 'Smith, Roofing',
  'Smith Roofing DBA John Smith', 'LINDA MARTINEZ (JAMES CARTER)', 'ROBERT JOHNSON (DAVID WILSON)', 'JOHN SMITH C/O ACME ROOFING',
];

describe('trade-name rule on real contractor strings: accepted before and after, per source', () => {
  const rate = (xs: string[], f: (x: string) => string | null) => xs.filter((x) => f(x)).length;
  it('Dallas: 13 of 19 before, 17 of 19 after; Orlando: 8 of 14 before, 14 of 14 after; all real: 21 of 33 (64%) -> 31 of 33 (94%)', () => {
    expect(rate(DALLAS_REAL, cleanOrgName)).toBe(13);
    expect(rate(DALLAS_REAL, cleanContractorName)).toBe(17);
    expect(rate(ORLANDO_REAL, cleanOrgName)).toBe(8);
    expect(rate(ORLANDO_REAL, cleanContractorName)).toBe(14);
    const all = [...DALLAS_REAL, ...ORLANDO_REAL];
    expect(rate(all, cleanContractorName) / all.length).toBeGreaterThanOrEqual(0.7);
  });
  it('the newly accepted real strings are exactly the listed ones, returned unchanged', () => {
    const newly = [...DALLAS_REAL, ...ORLANDO_REAL].filter((x) => !cleanOrgName(x) && cleanContractorName(x));
    expect(newly.sort()).toEqual([...NEWLY_ACCEPTED_REAL].sort());
    for (const x of newly) expect(cleanContractorName(x)).toBe(x);
  });
  it.each(STILL_REFUSED_REAL)('still refuses %s (no marker the rule can read)', (x) => expect(cleanContractorName(x)).toBeNull());
  it('every name the strict rule accepted is still accepted, unchanged', () => {
    for (const x of [...DALLAS_REAL, ...ORLANDO_REAL]) if (cleanOrgName(x)) expect(cleanContractorName(x)).toBe(cleanOrgName(x));
  });
});

describe('trade names under a person name are businesses in a contractor column', () => {
  it.each(TRADE_NAMES)('%s -> %s', (raw, want) => {
    expect(cleanContractorName(raw)).toBe(want);
    expect(contactNameFor('contractor', raw)).toBe(want);
  });
});

describe('person shapes are never named', () => {
  it('has at least 60 examples in all, and at least 25 person shapes', () => {
    expect(PERSONS.length).toBeGreaterThanOrEqual(25);
    expect(DALLAS_REAL.length + ORLANDO_REAL.length + TRADE_NAMES.length + PERSONS.length).toBeGreaterThanOrEqual(60);
  });
  it.each(PERSONS)('%s: no name under any role', (p) => {
    expect(cleanContractorName(p)).toBeNull();
    for (const role of ['contractor', 'business', 'owner', 'awardee'] as const) expect(contactNameFor(role, p), role).toBeNull();
  });
});

describe('the rule applies to contractor columns only', () => {
  it('an owner column never uses the trade-name rule (registered company only)', () => {
    for (const x of ['Smith Roofing', 'Carter Electric', 'JOHN SMITH ROOFING', 'TEMPO MECHANICAL', 'Smith & Sons']) expect(contactNameFor('owner', x), x).toBeNull();
    expect(contactNameFor('owner', 'ACME HOLDINGS LLC')).toBe('ACME HOLDINGS LLC');
  });
  it('a business licence or inspection name refuses a person plus a trade word (the site can be a home)', () => {
    for (const x of ['Carter Electric', 'JOHN SMITH ROOFING', 'Maria Lopez Home Daycare', 'MARIALOPEZ DAYCARE', 'Rossi Pizza', 'J R Pizza']) expect(cleanBusinessName(x), x).toBeNull();
    for (const x of ['SUNSET PIZZA', 'FLATBUSH LOCKSMITH', 'COLONIAL GRILL AND BAR', 'Bayview Bookkeeping']) expect(cleanBusinessName(x), x).toBe(x);
  });
  it('a Chicago owner, applicant or tenant type with a trade name is still dropped; a contractor type with one is kept', () => {
    const spec: ContactSpec = {
      verifiedUrl: 'https://example.test', checkedOn: '2026-11-22',
      typedContractors: { pairs: [1, 2, 3, 4].map((i) => ({ typeField: `t${i}`, nameField: `n${i}` })), acceptType: /CONTRACT/i, rejectType: /OWNER|APPLICANT|TENANT/i },
    };
    const row: Record<string, string> = {
      t1: 'OWNER', n1: 'SMITH ROOFING', t2: 'APPLICANT', n2: 'CARTER ELECTRIC', t3: 'TENANT', n3: 'JONES PLUMBING', t4: 'ELECTRICAL CONTRACTOR', n4: 'CARTER ELECTRIC',
    };
    const out = extractContacts((f) => row[f] ?? '', spec, { city: 'Chicago', state: 'IL' }, 'permit');
    expect(out.map((c) => c.name)).toEqual(['CARTER ELECTRIC']);
  });
  it('a phone is kept only from a contractor phone column and only next to a name that passed', () => {
    const spec: ContactSpec = { verifiedUrl: 'https://example.test', checkedOn: '2026-11-22', orgs: [{ role: 'contractor', nameFields: ['c'], phoneField: 'p' }] };
    const run = (c: string) => extractContacts((f) => ({ c, p: '214-555-0101', owner_phone: '214-555-0199' } as Record<string, string>)[f] ?? '', spec, { city: 'Dallas', state: 'TX' }, 'permit');
    expect(run('SMITH ROOFING')).toEqual([expect.objectContaining({ role: 'contractor', name: 'SMITH ROOFING', phone: '214-555-0101' })]);
    expect(run('JOHN SMITH')).toEqual([]);
    expect(JSON.stringify(run('SMITH ROOFING'))).not.toContain('0199');
  });
  it('Dallas run-together string: the trade name and its phone, never the person', () => {
    const spec: ContactSpec = { verifiedUrl: 'https://example.test', checkedOn: '2026-11-22', orgs: [{ role: 'contractor', nameFields: ['contractor'], runTogether: true }] };
    const run = (v: string) => extractContacts((f) => (f === 'contractor' ? v : ''), spec, { city: 'Dallas', state: 'TX' }, 'permit');
    expect(run('TEMPO MECHANICAL 12 ELM ST, DALLAS, TX 75201 214-555-0101')).toEqual([expect.objectContaining({ name: 'TEMPO MECHANICAL', phone: '214-555-0101', address: null })]);
    expect(run('JAMES CARTER 12 ELM ST, DALLAS, TX 75201 214-555-0101')).toEqual([]);
  });
});

describe('stability and the stored-name re-check', () => {
  const all = [...DALLAS_REAL, ...ORLANDO_REAL, ...TRADE_NAMES.map((x) => x[0]), ...PERSONS];
  it('cleanContractorName is stable and isContractorName agrees with it', () => {
    for (const x of all) {
      const c = cleanContractorName(x);
      if (c === null) continue;
      expect(cleanContractorName(c), x).toBe(c);
      expect(isContractorName(c), x).toBe(true);
      expect(isStoredContactName('contractor', c), x).toBe(true);
    }
  });
  it('sanitizeContact keeps a contractor trade name and drops the same string under the strict business rule', () => {
    expect(sanitizeContact({ role: 'contractor', name: 'Carter Electric', phone: '404-555-0101' })).toMatchObject({ name: 'Carter Electric', phone: '404-555-0101' });
    expect(sanitizeContact({ role: 'business', name: 'Carter Electric', phone: '404-555-0101' })).toBeNull();
    expect(sanitizeContact({ role: 'awardee', name: 'Carter Electric' })).toBeNull();
  });
  it('the trade-word list is documented and holds no singular agent noun that is a person role or surname', () => {
    for (const w of ['roofing', 'plumbing', 'electric', 'electrical', 'heating', 'cooling', 'hvac', 'mechanical', 'construction', 'contracting', 'contractors', 'builders', 'homes', 'remodeling', 'restoration', 'painting', 'landscaping', 'lawn', 'tree', 'paving', 'concrete', 'fence', 'flooring', 'glass', 'solar', 'pools', 'services', 'group', 'enterprises', 'company'])
      expect(TRADE_WORDS.has(w), w).toBe(true);
    for (const w of ['painter', 'carpenter', 'mason', 'roofer', 'plumber', 'builder', 'contractor', 'handyman', 'locksmith', 'electrician', 'qualifier'])
      expect(TRADE_WORDS.has(w), w).toBe(false);
  });
});

describe('review3 appendix replay (adversarial strings): what the contractor rule names always carries a business marker', () => {
  const rows = (JSON.parse(readFileSync(join(__dirname, 'fixtures/review3-appendix.json'), 'utf8')) as { rows: { input: string }[] }).rows;
  const LEGAL = /\b(?:llc|l\.l\.c\.?|inc\.?|incorporated|corp\.?|corporation|co\.?|company|lp|llp|lllp|pllc|ltd\.?|limited|pc|pa)$/i;
  it('no accepted value is a bare person name: each ends with a legal form, a family phrase, or has a trade word', () => {
    let accepted = 0;
    for (const r of rows) {
      const out = cleanContractorName(r.input);
      if (!out) continue;
      accepted++;
      const words = out.toLowerCase().replace(/\./g, '').split(/\s+/);
      const marker = LEGAL.test(out) || /\b(?:sons?|bros|brothers|associates)$/i.test(out) || words.some((w) => TRADE_WORDS.has(w)) || cleanOrgName(r.input) === out;
      expect(marker, `${r.input} -> ${out}`).toBe(true);
    }
    expect(accepted).toBeGreaterThan(0);
  });
});
