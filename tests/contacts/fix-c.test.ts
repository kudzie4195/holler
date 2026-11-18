/**
 * Round 5 FIX-C: address, city and state of every contact row (review2 P1-1), address parts before they are joined (P1-1, extract.ts),
 * and buyer names (P2-8).
 */
import { describe, expect, it } from 'vitest';
import { cleanAddress, cleanAddressPart, cleanCity, cleanState, sanitizeContact } from '@/lib/contacts/sanitize';
import { extractContacts, type ContactSpec } from '@/lib/contacts/extract';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';

const org = (over: Record<string, string | null>) => sanitizeContact({ role: 'contractor', name: 'ACME ROOFING LLC', ...over });
const site = (address: string) => sanitizeContact({ role: 'site', name: '', address, city: 'Austin', state: 'TX' });

describe('P1-1: the review repro values are no longer stored', () => {
  it('contractor with an email as address, a person in the city, a phone in the state: all three nulled, the company stays', () => {
    const c = sanitizeContact({ role: 'contractor', name: 'ACME ROOFING LLC', address: 'john.smith@gmail.com', city: 'AUSTIN c/o Mary Jones', state: 'TX (cell 512-555-0100)' });
    expect(c).toMatchObject({ role: 'contractor', name: 'ACME ROOFING LLC', address: null, city: null, state: null });
  });
  it('a site keeps the address up to the first role word', () => {
    expect(site('900 CONGRESS AVE UNIT B c/o MARY JONES')?.address).toBe('900 CONGRESS AVE UNIT B');
    expect(site('12 MAIN ST APT 4 ATTN JOHN SMITH')?.address).toBe('12 MAIN ST APT 4');
    expect(site('12 MAIN ST % JOHN SMITH')?.address).toBe('12 MAIN ST');
    expect(site('12 MAIN ST CARE OF JOHN SMITH')?.address).toBe('12 MAIN ST');
    expect(site('12 MAIN ST OWNER JOHN SMITH')?.address).toBe('12 MAIN ST');
  });
  it('the Austin permit repro: a second address line holding a person and a phone is dropped before the join', () => {
    const spec: ContactSpec = {
      verifiedUrl: 'https://example.test', checkedOn: '2026-11-18',
      orgs: [{ role: 'contractor', nameFields: ['contractor_company_name'], addressFields: ['contractor_address1', 'contractor_address2'], cityField: 'contractor_city' }],
    };
    const row: Record<string, string> = {
      contractor_company_name: 'ACME ROOFING LLC', contractor_address1: '12 HOME LN', contractor_address2: 'ATTN JOHN SMITH 512-555-0199', contractor_city: 'AUSTIN',
    };
    const out = extractContacts((f) => row[f] ?? '', spec, { city: 'Austin', state: 'TX' }, 'permit');
    expect(out).toEqual([expect.objectContaining({ role: 'contractor', name: 'ACME ROOFING LLC', address: '12 HOME LN', city: 'AUSTIN' })]);
    expect(JSON.stringify(out)).not.toMatch(/JOHN|SMITH|0199/);
  });
});

describe('P1-1: address of every role', () => {
  it('FIX-E: cut right after the street suffix and one listed unit; a city, state, ZIP or bare "2B" after it is dropped', () => {
    const cases: [string, string][] = [
      ['1200 W Ben White Blvd Ste 200', '1200 W Ben White Blvd Ste 200'], ['5521 S KOMENSKY AVE 2B', '5521 S KOMENSKY AVE'],
      ['12 MAIN ST APT 4 CHICAGO IL 60601', '12 MAIN ST APT 4'], ['4812 AVENUE H', '4812 AVENUE H'], ['500 COUNTY ROAD 12', '500 COUNTY ROAD'],
      ['77 W WACKER DR SUITE 4100 CHICAGO, IL 60601-1234', '77 W WACKER DR SUITE 4100'], ['12 HOME LN #5B', '12 HOME LN #5B'],
      ['3 PARK PL 1ST FLR', '3 PARK PL'], ['100 MAIN ST SAN ANTONIO TX 78205', '100 MAIN ST'], ['PO BOX 1200', 'PO BOX 1200'],
      ['P.O. BOX 12 SMITH JOHN', 'PO BOX 12'], ['12-14 HOME LN', '12-14 HOME LN'],
    ];
    for (const [a, want] of cases) {
      expect(cleanAddress(a), a).toBe(want);
      expect(org({ address: a })?.address, a).toBe(want);
    }
  });
  it('FIX-E: a phone, an email, a link, a role word or a person after the street is cut off (was: whole address nulled)', () => {
    for (const a of ['12 HOME LN 512-555-0199', '12 HOME LN (512) 555 0199', '12 HOME LN 512/555/0199', '12 HOME LN www.acme.com',
      '12 HOME LN acme.com', '12 HOME LN C/O JOHN SMITH', '12 HOME LN ATTN: BILLING', '12 HOME LN % SMITH', '12 HOME LN CARE OF SMITH']) {
      expect(cleanAddress(a), a).toBe('12 HOME LN');
    }
    for (const [a, want] of [['12 MAIN ST APT 4 JOHN SMITH', '12 MAIN ST APT 4'], ['12 MAIN ST MARY JONES', '12 MAIN ST'], ['12 MAIN ST OWNER', '12 MAIN ST'], ['12 MAIN ST TRUST DEPT', '12 MAIN ST']]) {
      expect(cleanAddress(a), a).toBe(want);
    }
  });
  it('FIX-E: nothing before the house number, and no street suffix gives null', () => {
    for (const a of ['jsmith@mail.com', 'JOHN SMITH', 'JOHN SMITH 900 CONGRESS AVE', 'Julia Lopez 12 Oak', '12 SMITH JOHN', 'SMITH, JOHN', 'HOME LN', '2318 W LOPEZ MARIA', '2150 N DAMEN SMITH JOHN', '2150 N DAMEN 2B']) {
      expect(cleanAddress(a), a).toBeNull();
      expect(org({ address: a })?.address, a).toBeNull();
    }
  });
  it('FIX-E follow-up: no suffix is allowed only for ONE street word (letters or an ordinal) after an optional direction, then a unit', () => {
    for (const a of ['2150 N DAMEN', '4410 W ADDISON', '2318 W 47TH', '123 BROADWAY', '2150 N DAMEN APT 2', '2150 N DAMEN #3R']) expect(cleanAddress(a), a).toBe(a);
  });
  it('a site: starts with a house number, cut after the street suffix and unit', () => {
    for (const a of ['HOME LN', 'C/O JOHN SMITH 12 MAIN ST', 'ATTN JOHN SMITH']) expect(site(a), a).toBeNull();
    expect(site('12 HOME LN 512-555-0199')?.address).toBe('12 HOME LN');
    expect(site('12 MAIN ST APT 4 JOHN SMITH')?.address).toBe('12 MAIN ST APT 4');
    expect(site('5521 S KOMENSKY AVE REAR SMITH JOHN')?.address).toBe('5521 S KOMENSKY AVE');
  });
  it('address parts before the join: role words, contact details and (for organisations) personal names are dropped', () => {
    expect(cleanAddressPart('ATTN JOHN SMITH 512-555-0199')).toBe('');
    expect(cleanAddressPart('Ste 200')).toBe('Ste 200');
    expect(cleanAddressPart('JOHN SMITH', { names: true })).toBe('');
    expect(cleanAddressPart('MARTIN LUTHER KING JR BLVD')).toBe('MARTIN LUTHER KING JR BLVD');
    expect(cleanAddressPart('c/o Mary Jones')).toBe('');
  });
  it('a site address whose street column holds a role word is dropped whole, never cut short', () => {
    const d = SOCRATA_DATASETS.find((x) => x.id === 'socrata-chicago-permits')!;
    const spec: ContactSpec = { verifiedUrl: 'x', checkedOn: '2026-11-18', site: { addressFields: ['street_number', 'street_direction', 'street_name'] } };
    const read = (r: Record<string, string>) => (f: string) => r[f] ?? '';
    expect(extractContacts(read({ street_number: '2150', street_direction: 'N', street_name: 'DAMEN AVE' }), spec, { city: d.city, state: d.state }, 'permit')[0]?.address).toBe('2150 N DAMEN AVE');
    expect(extractContacts(read({ street_number: '2150', street_direction: 'N', street_name: 'DAMEN AVE C/O JOHN SMITH' }), spec, { city: d.city, state: d.state }, 'permit')).toEqual([]);
    // FIX-E follow-up: one street word with no suffix is kept; two need a suffix; trailing text after the suffix is cut
    expect(extractContacts(read({ street_number: '2150', street_direction: 'N', street_name: 'DAMEN' }), spec, { city: d.city, state: d.state }, 'permit')[0]?.address).toBe('2150 N DAMEN');
    expect(extractContacts(read({ street_number: '2318', street_direction: 'W', street_name: 'LOPEZ MARIA' }), spec, { city: d.city, state: d.state }, 'permit')).toEqual([]);
    expect(extractContacts(read({ street_number: '2318', street_direction: 'W', street_name: '47TH ST SMITH JOHN' }), spec, { city: d.city, state: d.state }, 'permit')[0]?.address).toBe('2318 W 47TH ST');
  });
});

describe('P1-1, FIX-E: city and state', () => {
  it('state: a US code or a full state name, normalized to the code', () => {
    for (const [v, want] of [['TX', 'TX'], ['tx', 'TX'], ['Illinois', 'IL'], ['new york', 'NY'], ['DC', 'DC'], ['PR', 'PR'], ['N.Y.', 'NY']]) expect(cleanState(v), v).toBe(want);
    for (const v of ['SMITH JOHN', 'LOPEZ MARIA', 'DANNY KOWALSKI', 'Julia Lopez', 'J. Smith', 'M Lopez', 'XX', 'TX 78701', 'TX (cell 512-555-0100)', 'Texas c/o Mary'])
      expect(cleanState(v), v).toBeNull();
  });
  it('city: the dataset\'s own city, whatever its words ("AUSTIN" is a listed given name)', () => {
    expect(cleanCity('AUSTIN', 'Austin')).toBe('AUSTIN');
    expect(cleanCity('austin', 'Austin')).toBe('austin');
    expect(cleanCity('AUSTIN')).toBeNull();
    expect(cleanCity('New York City', 'New York City')).toBe('New York City');
  });
  it('FIX-F (review4 P2-13): any other city is null, a real one included', () => {
    for (const v of ['Chicago', 'SKOKIE', 'Seattle', 'Chicago Heights', 'LOPEZ MARIA', 'SMITH JOHN', 'DANNY KOWALSKI', 'Julia Lopez', 'J. Smith', 'M Lopez',
      'AUSTIN c/o Mary Jones', 'TX (cell 512-555-0100)', 'Austin, TX', 'MARY JONES', 'JOHN SMITH', 'X', 'Owner', 'AUSTIN%', 'SAINT PAUL', 'Moore']) {
      expect(cleanCity(v), v).toBeNull();
      expect(org({ city: v, state: v })).toMatchObject({ city: null, state: null });
    }
  });
});

describe('P2-8, FIX-E: no buyer is stored at all (review3 P2-1)', () => {
  const buyer = (name: string) => sanitizeContact({ role: 'buyer', name });
  it('every buyer value gives null, a public office or a person', () => {
    for (const n of ['Zendaya Okonjo, Library', 'GSA www.gsa.gov Office', 'Mary Jones Library', 'JOHN', 'SMITH', 'DANNY', 'JSMITH', 'Office of Candy Smith',
      'DOE', 'GSA', 'USACE', 'VA', 'City of Austin, Purchasing Office', 'Travis County Purchasing Office', 'Department of the Navy', 'Office of the Mayor']) {
      expect(buyer(n), n).toBeNull();
    }
  });
  it('website is never stored (review3 P2-2)', () => {
    for (const w of ['https://example.com/?contact=john.smith@gmail.com&tel=5125550100', 'https://facebook.com/john.smith.9484', 'acme.com'])
      expect(org({ website: w })?.website, w).toBeNull();
  });
});
