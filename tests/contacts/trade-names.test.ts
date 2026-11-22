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
import { AMBIGUOUS_WORDS, cleanBusinessName, cleanContractorName, FIRM_WORDS, isContractorName } from '@/lib/contacts/trade-name';
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
  'ARRINGTON ROOFING CO INC.', 'TEMPO MECHANICAL', 'CONDOR FENCING',
  'ESPARZA UNDERGROUND INC', 'AMBIENT TECHNOLOGIES INC', 'GULF COAST CUSTOM CABLE INC', 'KIMLEY HORN AND ASSOCIATES INC', 'VERDANTAS LLC', 'DUKE ENERGY',
];
/**
 * Real strings refused: no marker ("ELSTONAIRE"); "Service" is an ambiguous word that never qualifies alone (redo 1, "SERVICE 1ST");
 * "Air" is ambiguous and "A" is an initial ("A #1 AIR").
 */
const STILL_REFUSED_REAL = ['ELSTONAIRE', 'SERVICE 1ST', 'A #1 AIR'];

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
  ['Smith Homes LLC', 'Smith Homes LLC'],
  ['Smith Glass & Glazing', 'Smith Glass & Glazing'],
  ['Smith Heating & Cooling', 'Smith Heating & Cooling'],
  ['Smith Family Roofing', 'Smith Family Roofing'],
  ['John Smith of Smith Roofing', 'Smith Roofing'],
  ['John Smith c/o Smith Roofing', 'Smith Roofing'],
  ['JOHN SMITH C/O ACME ROOFING', 'ACME ROOFING'],
  ['Smith & Sons', 'Smith & Sons'],
  ['Smith Bros Inc', 'Smith Bros Inc'],
  ['Smith Brothers Roofing', 'Smith Brothers Roofing'],
  ['Smith Lawn Services', 'Smith Lawn Services'],
  ['Smith Services LLC', 'Smith Services LLC'],
  ['Smith Roofing Co', 'Smith Roofing Co'],
  ['Acme Services', 'Acme Services'],
  ['Home Depot USA Inc', 'Home Depot USA Inc'],
  ['Power Home Remodeling Group LLC', 'Power Home Remodeling Group LLC'],
  ['J&J Roofing', 'J&J Roofing'],
  ['TruGreen Limited Partnership', 'TruGreen Limited Partnership'],
  ['Hernandez Concrete Works', 'Hernandez Concrete Works'],
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
  // redo 1: surnames that are ambiguous trade words, placeholders, family holdings, a person beside a firm
  'John Drain', 'T Boring', 'Thomas J Boring', 'Mary Mold', 'Deontay Glass', 'Truong Pool', 'Sherlock Homes', 'Mary Cooling', 'Jim Bob Cooling',
  'Saoirse Tile', 'Kevin Tile', 'Gareth Barber', 'Saoirse Kitchen', 'Bashir Market', 'Bashir Power', 'Zooey Glass', 'Romina Power',
  'Self Contractor', 'No Contractor', 'Owner Builder', 'Homeowner', 'Self', 'None', 'N/A', 'TBD', 'Various', 'Unknown', 'Same as owner',
  'SMITH FAMILY LLC', 'JOHN SMITH FAMILY LLC', 'John & Mary Smith Properties', 'Smith Family Services', 'John Smith Property',
  'Roofing Mary Glass', 'John Smith Smith Roofing', 'John Smith The Roofing', 'John Smith Self Services',
  // redo 2: name-like legal forms, Brothers, "& Sons" after a first name, generic firm words next to a person
  'Maria Co', 'TRAN CO', 'VANG PA', 'Lee Pa', 'Kim Lp', 'Smith Co.', 'Smith & Co', 'John Brothers', 'Smith Brothers', 'Smith Bros.', 'Joyce Brothers',
  'John & Sons', 'Mary & Daughters', 'John Smith Services', 'John Smith Group', 'Maria Lopez Company', 'John Company', 'Grace Group',
  'Smith Kids LLC', 'Deontay Holding', 'DIY Roofing', 'To Be Hired Roofing', 'OWNR/BLDR CONSTRUCTION', 'ABC Construction',
  'Mason Carpenter', 'Glass, Mary', 'Bill Painter', 'Homes, Sherlock', 'Carter, Electra', 'Electric, Carter', 'Tree, Ann', 'Glass Mary',
  'Homes Sherlock', 'Mary Glass', 'Ann Stone', 'Kelly Wood', 'Ray Stone', 'Mark Steel', 'Rosa Solar', 'Bill Lawn', 'Pat Mason', 'Ann Mason',
  'Jim Baker', 'Joe Cook', 'Ted Mason Carpenter', 'Robert Plumber', 'Carter Electrician', 'Tom Electrician', 'Chris Builder', 'Bob the Builder',
  'John Smith Handyman', 'Smith Locksmith', 'Mary Smith General Contractor', 'John Smith', 'SMITH, JOHN A', 'SMITH JOHN', 'SMITH JOHN A',
  'JAMES CARTER', 'MARIA L GARCIA', 'CARTER, JAMES A', 'DAVID WILSON', 'MICHAEL T BROWN', 'WILLIAM TAYLOR', 'Maria Lopez', 'Kim Lee', 'J SMITH',
  'D. Wilson', 'Dr. John Smith', 'JOHN SMITH JR', 'Mary & John Smith', 'Smith & Jones', 'John Smith, Qualifier', 'JOHN SMITH QUALIFIER',
  'JOHN SMITH LICENSE HOLDER', 'John Smith Owner', 'JOHN SMITH (OWNER)', 'JOHN SMITH ET AL', 'Jane Doe 512-555-0100', 'Smith, Roofing',
  'Smith Roofing DBA John Smith', 'LINDA MARTINEZ (JAMES CARTER)', 'ROBERT JOHNSON (DAVID WILSON)',
];

describe('trade-name rule on real contractor strings: accepted before and after, per source', () => {
  const rate = (xs: string[], f: (x: string) => string | null) => xs.filter((x) => f(x)).length;
  it('Dallas: 13 of 19 before, 16 of 19 after; Orlando: 8 of 14 before, 14 of 14 after; all real: 21 of 33 (64%) -> 30 of 33 (91%)', () => {
    expect(rate(DALLAS_REAL, cleanOrgName)).toBe(13);
    expect(rate(DALLAS_REAL, cleanContractorName)).toBe(16);
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
    // Awardees (federal recipients) keep the strict org.ts rule; placeholders are refused there too (redo rule 2).
    for (const role of ['contractor', 'business', 'owner'] as const) expect(contactNameFor(role, p), role).toBeNull();
  });
});

describe('the rule applies to contractor columns only', () => {
  it('an owner column never uses the trade-name rule (registered company only)', () => {
    for (const x of ['Smith Roofing', 'Carter Electric', 'JOHN SMITH ROOFING', 'TEMPO MECHANICAL', 'Smith & Sons']) expect(contactNameFor('owner', x), x).toBeNull();
    expect(contactNameFor('owner', 'MIDWEST REALTY GROUP LLC')).toBe('MIDWEST REALTY GROUP LLC');
  });
  it('placeholders are refused under every role, awardees included', () => {
    for (const x of ['Self Contractor', 'No Contractor', 'Owner Builder', 'Homeowner', 'Self', 'None', 'N/A', 'TBD', 'Various', 'Unknown', 'Same as owner'])
      for (const role of ['contractor', 'business', 'owner', 'awardee'] as const) expect(contactNameFor(role, x), `${role} ${x}`).toBeNull();
  });
  it('a business licence or inspection name refuses a person, a possessive, a home-based activity (redo rule 6: the site can be a home)', () => {
    for (const x of ['Carter Electric', 'JOHN SMITH ROOFING', 'Maria Lopez Home Daycare', 'MARIALOPEZ DAYCARE', 'Rossi Pizza', 'J R Pizza', 'Gareth Barber',
      'Saoirse Kitchen', 'Bashir Market', 'MARIAS DAYCARE', 'Lopez Daycare', 'JOES LAWN CARE', 'Marias Cleaning', "John's Lawn Care", 'Ifeoma Salon',
      'Freya Spa', 'Sherlock Homes', 'Sunset Daycare', 'Sunset Child Care', 'REGINALD JACKSON HOME IMPROVEMENT LLC', 'Danny Smith LLC', 'Taqueria Lopez'])
      expect(cleanBusinessName(x), x).toBeNull();
    for (const x of ['SUNSET PIZZA', 'SUMMIT CITY CAFE', 'SUMMIT CONSULTING GROUP', 'APEX HOME REMODELING LLC', 'Main Street Deli', 'Sunset Daycare LLC']) expect(cleanBusinessName(x), x).toBe(x);
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
    expect(run('JOHN DRAIN 12 ELM ST, DALLAS, TX 75201 214-555-0101')).toEqual([]);
    expect(run('JAMES CARTER 12 ELM ST, DALLAS, TX 75201 214-555-0101')).toEqual([]);
  });
});

describe('redo rule 5: a contractor\'s own address only with a legal form; the phone rule is unchanged', () => {
  it('no legal form: name and business phone kept, own street, city, state and zip dropped', () => {
    expect(sanitizeContact({ role: 'contractor', name: 'Carter Electric', address: '12 MAIN ST', city: 'Austin', state: 'TX', zip: '78701', phone: '512-555-0101' }, { datasetCity: 'Austin' })).toMatchObject({
      name: 'Carter Electric', address: null, city: null, state: null, zip: null, phone: '512-555-0101',
    });
  });
  it('a legal form: the address stays', () => {
    expect(sanitizeContact({ role: 'contractor', name: 'Carter Electric LLC', address: '12 MAIN ST', city: 'Austin', state: 'TX', zip: '78701' }, { datasetCity: 'Austin' })).toMatchObject({
      address: '12 MAIN ST', city: 'Austin', state: 'TX', zip: '78701',
    });
  });
  it('a business licence keeps its site address (licence rule decides the name instead)', () => {
    expect(sanitizeContact({ role: 'business', name: 'SUNSET PIZZA', address: '12 MAIN ST' })?.address).toBe('12 MAIN ST');
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
  it('the two documented lists: unambiguous business forms and ambiguous words that never qualify alone (redo rule 1)', () => {
    for (const w of ['roofing', 'plumbing', 'electric', 'electrical', 'heating', 'cooling', 'hvac', 'mechanical', 'construction', 'contracting', 'contractors', 'builders', 'remodeling', 'restoration', 'painting', 'landscaping', 'paving', 'fencing', 'flooring', 'enterprises', 'services'])
      expect(FIRM_WORDS.has(w) && !AMBIGUOUS_WORDS.has(w), w).toBe(true);
    for (const w of ['glass', 'pool', 'power', 'cable', 'service', 'drain', 'mold', 'boring', 'mason', 'carpenter', 'painter', 'gardner', 'stone', 'wood', 'steel', 'tile', 'homes', 'tree', 'lawn', 'fence', 'roof', 'plumb', 'barber', 'kitchen', 'market'])
      expect(AMBIGUOUS_WORDS.has(w) && !FIRM_WORDS.has(w), w).toBe(true);
    for (const w of ['roofer', 'plumber', 'builder', 'contractor', 'handyman', 'electrician', 'qualifier']) expect(FIRM_WORDS.has(w), w).toBe(false);
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
      const marker = LEGAL.test(out) || /\b(?:sons?|bros|brothers|associates|daughters)$/i.test(out) || words.some((w) => FIRM_WORDS.has(w)) || cleanOrgName(r.input) === out;
      expect(marker, `${r.input} -> ${out}`).toBe(true);
    }
    expect(accepted).toBeGreaterThan(0);
  });
});
