/**
 * Round 5 FIX-E, private side (holler_signal_contacts, members only): review3 P0-1, P0-2, P1-1, P1-3 and P2 items 1, 2, 3, 6.
 *  2a. Unknown-word budget is ONE, legal form or not.
 *  2b. The 5,149 US birth-record given names (given-names-extra.ts) and the review's P0-1 vocabulary given names are in GIVEN_NAMES, and
 *      every vocabulary loses them.
 *  2c. The list-free rule R10 (unknown word after a known non-evidence word; a lone unknown word away from the evidence; glued names).
 *  2d. Address, state and city of every role (sanitize.ts); the review3 P1-1 repros.
 *  2f. review3 Appendix A replayed from tests/contacts/fixtures/review3-appendix.json (parsed from the review by script).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanOrgName, holdsGivenName, isListedGivenName, isVocabularyWord } from '@/lib/contacts/org';
import { GIVEN_NAMES_EXTRA } from '@/lib/contacts/given-names-extra';
import { cleanCity, sanitizeContact } from '@/lib/contacts/sanitize';
import { extractContacts } from '@/lib/contacts/extract';
import { CONTACT_SPECS } from '@/lib/signals/adapters/socrata-datasets';
import { FakeDb } from '../ops/fakedb';
import { insertNewSignals } from '@/lib/signals/store';
import type { SupabaseClient } from '@supabase/supabase-js';

const P0_1_LIST =
  'candy carolina christi cleveland marietta princess queen ivory van son thai diamond emerald coral sky unique raleigh columbus cicero ' +
  'roswell arlington tex velvet windy bethel blossom china oral marine les del';

describe('2a: one unknown word, legal form or not (review3 P0-2 fix (a))', () => {
  it('"Gallagher LLC" passes, "Danny Smith LLC" and "Okonjo Zelenskyy LLC" fail', () => {
    expect(cleanOrgName('Gallagher LLC')).toBe('Gallagher LLC');
    expect(cleanOrgName('Danny Smith LLC')).toBeNull();
    expect(cleanOrgName('Okonjo Zelenskyy LLC')).toBeNull();
  });
  it('the review3 P0-2 repros all fail', () => {
    for (const n of ['DANNY SMITH LLC', 'JULIA LOPEZ INC', 'ALEX NGUYEN CORP', 'DANNY SMITH PLUMBING LLC', 'Julia Lopez Insurance Agency LLC',
      'Julia Lopez Realty LLC', 'Kowalski Thaddeus LLC', 'Danny Smith & Sons LLC', 'JT KOWALSKI LLC', 'DANNY LOPEZ LLC']) expect(cleanOrgName(n), n).toBeNull();
  });
});

describe('2b: given names loaded from the review file and the P0-1 line', () => {
  const extra = GIVEN_NAMES_EXTRA.split(/\s+/).filter(Boolean);
  it('the data module holds the 5,149 names of review3-missing-given-names.txt, lower case, distinct', () => {
    expect(extra).toHaveLength(5149);
    expect(new Set(extra).size).toBe(5149);
    expect(extra.every((w) => /^[a-z]+$/.test(w))).toBe(true);
    expect(extra.slice(0, 5)).toEqual(['charlie', 'will', 'frederick', 'alfred', 'charley']);
  });
  it('every one of them, and every P0-1 word, is a listed given name and on no vocabulary (no longer known, no longer evidence)', () => {
    for (const w of [...extra, ...P0_1_LIST.split(' ')]) {
      expect(isListedGivenName(w), w).toBe(true);
      expect(isVocabularyWord(w), w).toBe(false);
    }
  });
  it('the review3 P0-1 repros fail', () => {
    for (const n of ['CAROLINA LOPEZ DAYCARE', 'VAN TRAN ROOFING', 'SON NGUYEN ROOFING', 'THAI NGUYEN ROOFING', 'CLEVELAND JONES ROOFING', 'CHRISTI SMITH DAYCARE',
      'MARIETTA LOPEZ DAYCARE', 'PRINCESS WILLIAMS CATERING', 'IVORY JOHNSON CLEANING', 'QUEEN JONES DAYCARE', 'CANDY LOPEZ', 'ORAL ROBERTS', 'MARINE DUPONT',
      'CAROLINA LOPEZ HOME DAYCARE', 'CANDY SMITH', 'CAROLINA LOPEZ LANDSCAPING', 'VAN TRAN CONSTRUCTION']) expect(cleanOrgName(n), n).toBeNull();
  });
  it('review3 P1-3: an unlisted-before given name with a vocabulary-word surname fails', () => {
    for (const n of ['Danny Bowling', 'Beth Court', 'Kelsey Guard', 'Bernard Board', 'Danny Steel', 'Allen Dance', 'Julia Child Catering']) expect(cleanOrgName(n), n).toBeNull();
  });
});

describe('2c: the list-free rule R10', () => {
  it('still pass: one unknown word next to the evidence, or vocabulary words only', () => {
    for (const n of ['Kowalski Roofing', 'Taqueria Lopez', 'Gallagher LLC', 'Lone Oak Roofing LLC', 'County of Cook', 'Okonjo Roofing Co']) expect(cleanOrgName(n), n).toBe(n);
  });
  it('an unknown word or a surname right after a known non-evidence word fails ("Lone Kowalski Roofing", "Main Street Deli")', () => {
    for (const n of ['Lone Kowalski Roofing', 'Golden Okonjo Catering', 'Main Street Deli', 'Fresh Market', 'The Kowalski Group', 'North Branch Architects LTD'])
      expect(cleanOrgName(n), n).toBeNull();
    expect(cleanOrgName('Kowalski Lone Roofing')).toBeNull(); // FIX-F flip (review4 P1-A): "lone" is a SURNAME_VOCAB word next to the unknown word
    expect(cleanOrgName('Kowalski Premier Roofing')).not.toBeNull(); // unknown word first, next to a vocabulary word that is not a common surname
  });
  it('a lone unknown word not next to the evidence, in a 2 to 4 word name that starts with a known word, fails', () => {
    expect(cleanOrgName('Lone Roofing & Kowalski')).toBeNull();
    expect(cleanOrgName('Lone Roofing & Supply')).toBe('Lone Roofing & Supply');
  });
  it('glued names fail: an inner capital, a given name glued to 3+ letters, an initial glued to a surname', () => {
    for (const n of ['JSmith Roofing', 'KeoniKahale Catering', 'JiPark Trucking', 'CHaddad Construction', 'JSMITH ROOFING', 'DJSMITH ROOFING',
      'CHADDAD CONSTRUCTION', 'DANNYKOWALSKI ROOFING', 'MARIALOPEZ DAYCARE', 'Patterson Plumbing']) expect(cleanOrgName(n), n).toBeNull();
  });
});

// ---- 2d: address, state, city (sanitize.ts) ----------------------------------------------------------------------------------------

describe('2d: review3 P1-1 repros through sanitizeContact', () => {
  const contractor = (over: Record<string, string>) => sanitizeContact({ role: 'contractor', name: 'ACME ROOFING LLC', ...over });
  it('contractor addresses: a person after the street is cut off, a person before the house number gives null', () => {
    const cases: [string, string | null][] = [
      ['123 MAIN ST LOPEZ MARIA', '123 MAIN ST'], ['SMITH, JOHN', null], ['PO BOX 12 SMITH JOHN', 'PO BOX 12'], ['123 MAIN ST STE 4 JULIA LOPEZ', '123 MAIN ST STE 4'],
      ['Julia Lopez 12 Oak', null], ['123 MAIN ST danny at gmail dot com', '123 MAIN ST'],
    ];
    for (const [a, want] of cases) expect(contractor({ address: a })?.address, a).toBe(want);
  });
  it('site addresses', () => {
    const site = (address: string) => sanitizeContact({ role: 'site', name: '', address });
    const cases: [string, string | null][] = [
      ['12 SMITH JOHN', null], ['123 MAIN ST APT 4 SMITH JOHN', '123 MAIN ST APT 4'], ['5521 S KOMENSKY AVE REAR SMITH JOHN', '5521 S KOMENSKY AVE'],
      ['500 COUNTY ROAD 12 SMITH JOHN', '500 COUNTY ROAD'],
    ];
    for (const [a, want] of cases) expect(site(a)?.address ?? null, a).toBe(want);
  });
  it('city and state "LOPEZ MARIA", "SMITH JOHN", "DANNY KOWALSKI", "Julia Lopez", "J. Smith", "M Lopez": null for every role', () => {
    for (const v of ['LOPEZ MARIA', 'SMITH JOHN', 'DANNY KOWALSKI', 'Julia Lopez', 'J. Smith', 'M Lopez']) {
      expect(contractor({ city: v, state: v })).toMatchObject({ city: null, state: null });
      expect(sanitizeContact({ role: 'site', name: '', address: '12 MAIN ST', city: v, state: v })).toMatchObject({ city: null, state: null });
      expect(sanitizeContact({ role: 'business', name: 'ACME ROOFING LLC', city: v, state: v })).toMatchObject({ city: null, state: null });
    }
  });
});

describe('2d: review3 P1-1 repros through extractContacts with the real specs', () => {
  const austin = CONTACT_SPECS['socrata-austin-permits'];
  const chicago = CONTACT_SPECS['socrata-chicago-permits'];
  const read = (r: Record<string, string>) => (f: string) => r[f] ?? '';
  const aRow = { contractor_company_name: 'ACME ROOFING LLC', contractor_address1: '900 CONGRESS AVE', contractor_city: 'AUSTIN', original_address1: '1500 E RIVERSIDE DR' };
  it('austin-permits contractor address lines', () => {
    const run = (over: Record<string, string>) => extractContacts(read({ ...aRow, ...over }), austin, { city: 'Austin', state: 'TX' }, 'permit');
    const c = (over: Record<string, string>) => run(over).find((x) => x.role === 'contractor');
    expect(c({ contractor_address1: 'JOHN SMITH 900 CONGRESS AVE' })?.address).toBeNull();
    expect(c({ contractor_address2: 'DANNY KOWALSKI' })?.address).toBe('900 CONGRESS AVE');
    expect(c({ contractor_address2: 'STE 4 SMITH JOHN' })?.address).toBe('900 CONGRESS AVE STE 4');
    expect(c({})?.city).toBe('AUSTIN'); // the dataset's own city
  });
  it('austin-permits site city and state', () => {
    const s = extractContacts(read({ ...aRow, original_city: 'LOPEZ MARIA', original_state: 'SMITH JOHN' }), austin, { city: 'Austin', state: 'TX' }, 'permit').find((x) => x.role === 'site');
    expect(s).toMatchObject({ address: '1500 E RIVERSIDE DR', city: null, state: null });
  });
  it('chicago-permits contact city and state, and a street name with a person after the suffix', () => {
    const r = {
      street_number: '2318', street_direction: 'W', street_name: '47TH ST SMITH JOHN',
      contact_3_type: 'CONTRACTOR-GENERAL CONTRACTOR', contact_3_name: 'ACME ROOFING LLC', contact_3_city: 'LOPEZ MARIA', contact_3_state: 'SMITH JOHN',
    };
    const out = extractContacts(read(r), chicago, { city: 'Chicago', state: 'IL' }, 'permit');
    expect(out.find((x) => x.role === 'site')?.address).toBe('2318 W 47TH ST');
    expect(out.find((x) => x.role === 'contractor')).toMatchObject({ name: 'ACME ROOFING LLC', city: null, state: null });
    expect(JSON.stringify(out)).not.toMatch(/SMITH|LOPEZ|MARIA|JOHN/);
  });
});

describe('2d: the place vocabulary', () => {
  it('FIX-F (review4 P2-13): only the dataset city is kept; the place vocabulary is gone', () => {
    expect(cleanCity('LOPEZ MARIA')).toBeNull();
    expect(cleanCity('Chicago')).toBeNull();
    expect(cleanCity('Chicago', 'Chicago')).toBe('Chicago');
    expect(cleanCity('AUSTIN', 'Austin')).toBe('AUSTIN');
    for (const v of ['Moore', 'White', 'Rivera', 'Richardson', 'Myers', 'Vista East', 'Lake Johns', 'SKOKIE']) expect(cleanCity(v, 'Chicago'), v).toBeNull();
  });
  it('store.ts re-sanitizes with the signal\'s own city, so the dataset city survives the second pass', async () => {
    const db = new FakeDb();
    await insertNewSignals(db as unknown as SupabaseClient, [{
      source: 'socrata-austin-permits', externalId: 'x1', kind: 'permit', title: 't', summary: null, lat: 30.2, lon: -97.7, city: 'Austin', state: 'TX',
      categories: ['roofing'], severity: 1, occurredAt: '2026-11-12T00:00:00Z', data: { subtype: 'permit' }, placeSlug: 'austin-tx',
      contacts: [{ role: 'site', name: '', address: '1500 E RIVERSIDE DR', city: 'AUSTIN', state: 'TX' }, { role: 'contractor', name: 'ACME ROOFING LLC', city: 'DANNY KOWALSKI' }],
    }]);
    const rows = db.tables.holler_signal_contacts;
    expect(rows.find((r) => r.role === 'site')?.city).toBe('AUSTIN');
    expect(rows.find((r) => r.role === 'contractor')?.city).toBeNull();
  });
});

// ---- 2f: review3 Appendix A replay -------------------------------------------------------------------------------------------------

type Row = { shape: string; input: string; output: string; class: string };
const appendix = (JSON.parse(readFileSync(join(__dirname, 'fixtures/review3-appendix.json'), 'utf8')) as { rows: Row[] }).rows;
const TARGET = /^(FULL PERSONAL NAME|INITIALS PLUS SURNAME|given name only|initial glued to surname)/;

/**
 * The documented residual: given names that are on no list (outside the US birth-record lists the review supplied), in front of a trade
 * word, which is the same shape as "Kowalski Roofing". No list-free rule can tell them apart. None of them holds a listed given name.
 */
const RESIDUAL = new Set([
  'Bronislaw Plumbing', 'Wladyslaw Daycare', 'Narendra Trucking', 'Surinder Electric', 'Harjit Roofing', 'Nguyet Daycare', 'Thien Catering',
  'Kwadwo Landscaping', 'Olusegun Cleaning', 'Chukwudi Construction', 'Nnamdi Painting', 'Babajide Trucking', 'Tendai Electric', 'Farai Roofing',
  'Takumi Plumbing', 'Haruki Daycare', 'Shinji Catering', 'Zhiwei Construction', 'Yuxuan Trucking', 'Byung Electric', 'Tarek Plumbing', 'Hatem Daycare',
  'Wael Catering', 'Fadi Landscaping', 'Zakaria Cleaning', 'Soraya Construction', 'Habib Trucking', 'Reza Electric', 'Mehdi Roofing', 'Shirin Plumbing',
  'Dariush Daycare', 'Fermin Construction', 'Bienvenido Trucking', 'Chukwudi Golf', 'Chukwudi Golf Electric',
  // FIX-F (review4 P1-A): 'Narendra Books', 'Narendra Books Painting', 'Nguyet Music', 'Nguyet Music Trucking' now return null
]);

describe('2f: review3 Appendix A (814 accepted strings), replayed', () => {
  it('the fixture holds all 814 rows of the appendix', () => {
    expect(appendix).toHaveLength(814);
    expect(appendix.filter((r) => TARGET.test(r.class))).toHaveLength(682);
  });
  it('every full personal name, initials plus surname, given name and glued initial returns null, except the documented residual', () => {
    const accepted = appendix.filter((r) => TARGET.test(r.class) && cleanOrgName(r.input) !== null).map((r) => r.input);
    expect(accepted.sort()).toEqual([...RESIDUAL].sort());
  });
  it('target: no output of any appendix row holds a listed given name', () => {
    for (const r of appendix) {
      const out = cleanOrgName(r.input);
      if (out !== null) expect(holdsGivenName(out), `${r.input} -> ${out}`).toBe(false);
    }
  });
  it('the company-only rows return no word of the person', () => {
    for (const r of appendix.filter((x) => x.class.startsWith('no part'))) {
      const out = cleanOrgName(r.input);
      if (out !== null) expect(out.length, r.input).toBeLessThan(r.input.length);
    }
  });
});
