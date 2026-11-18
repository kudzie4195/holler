/**
 * Round 5 FIX-F, private side: review4 P1-A (SURNAME_VOCAB), P2-7 (glued names), P2-8 (two initials), P2-9 (joined values), P2-10 (accent
 * folding), P2-11 and P2-12 (address), P2-13 (city).
 */
import { describe, expect, it } from 'vitest';
import { SURNAME_VOCAB, cleanOrgName, isListedGivenName } from '@/lib/contacts/org';
import { cleanAddress, cleanCity, sanitizeContact } from '@/lib/contacts/sanitize';
import { extractContacts } from '@/lib/contacts/extract';
import { CONTACT_SPECS } from '@/lib/signals/adapters/socrata-datasets';

describe('P1-A: an unknown word next to a vocabulary word that is also a common surname', () => {
  it('SURNAME_VOCAB is the 254-word list (Census 2000, 500+ bearers) minus "red" (a listed given name now), and holds the review\'s 134 words', () => {
    expect(SURNAME_VOCAB.size).toBe(253);
    expect(SURNAME_VOCAB.has('red')).toBe(false);
    for (const w of ['bright', 'cotton', 'camp', 'lima', 'lo', 'mesa', 'gold', 'land', 'link', 'hand', 'real', 'steel', 'baltimore']) expect(SURNAME_VOCAB.has(w), w).toBe(true);
    for (const w of SURNAME_VOCAB) expect(isListedGivenName(w), w).toBe(false);
  });
  it('every P1-A reproduction returns null', () => {
    for (const n of ['Thiago Lima LLC', 'Pao Lo Trucking', 'Chue Lo LLC', 'Kwesi Bright LLC', 'Yosvany Mesa Roofing', 'Zakaria Camp Trucking', 'Bashir Gold LLC',
      'Aziz Bright Auto Repair', 'Wojtek Land Construction', 'Dariusz Link Trucking LLC', 'Thang Lo Auto Repair', 'Obadiah Hand Plumbing', 'Fulgencio Real',
      'Barnaby Steel', 'Red Cotton Trucking', 'Thiago Lima Landscaping', 'Danny Bowling', 'Narendra Books', 'Nguyet Music']) expect(cleanOrgName(n), n).toBeNull();
  });
  it('P2-8: two initials before a vocabulary surname return null', () => {
    for (const n of ['AJ Bright Roofing', 'KT Camp Roofing', 'TJ Steel']) expect(cleanOrgName(n), n).toBeNull();
  });
  it('still passes: no unknown word, or an unknown word away from a common-surname word', () => {
    for (const n of ['Kowalski Roofing', 'Gallagher LLC', 'Summit Roofing & Construction', 'Main Street Pharmacy', 'Kowalski Premier Roofing']) expect(cleanOrgName(n), n).toBe(n);
  });
});

describe('P2-7: glued names', () => {
  it('the review reproductions return null', () => {
    for (const n of ['KNOWICKI ROOFING', 'JLEE ROOFING', 'LISAWU MINISTRIES', 'MOLLYTO CONSULTING CORP', 'KARENIN PAINTING', 'Suongtorres Corp', 'KATSUMINGUYEN AUTO REPAIR'])
      expect(cleanOrgName(n), n).toBeNull();
  });
  it('an all-caps unknown word of 5+ letters next to a trade word needs a second vocabulary word', () => {
    expect(cleanOrgName('KOWALSKI ROOFING')).toBeNull();
    expect(cleanOrgName('Kowalski Roofing')).toBe('Kowalski Roofing');
    expect(cleanOrgName('LAKEFRONT ROOFING & SIDING INC')).toBe('LAKEFRONT ROOFING & SIDING INC');
    expect(cleanOrgName('GALLAGHER LLC')).toBe('GALLAGHER LLC');
  });
});

describe('P2-9: joined values compared on 4+ letter substrings; particles count against a person-shaped part', () => {
  it('the review reproductions return null', () => {
    for (const n of ['JohnnyRamey obo Ramey Construction pllc', 'Potts Cafe by LydiaPotts', 'Rosa La = La Landscaping pc', 'Sonya El; El Trucking'])
      expect(cleanOrgName(n), n).toBeNull();
  });
  it('a company joined to an unrelated person still returns the company', () => {
    expect(cleanOrgName('ACME ROOFING DBA DARIUS WHITFIELD')).toBe('ACME ROOFING');
    expect(cleanOrgName('BRENT KOWALSKI @ APEX ROOFING LLC')).toBe('APEX ROOFING LLC');
  });
});

describe('P2-10: the returned name is accent-folded ASCII', () => {
  it('folds accents and keeps case; the folded output is stable', () => {
    expect(cleanOrgName('Café Brazil Restaurant')).toBe('Cafe Brazil Restaurant');
    expect(cleanOrgName('Cafe Brazil Restaurant')).toBe('Cafe Brazil Restaurant');
    expect(cleanOrgName('Andrée Line Associates')).toBeNull();
  });
});

describe('P2-11, P2-12: address of every role', () => {
  const org = (address: string) => sanitizeContact({ role: 'contractor', name: 'ACME ROOFING LLC', address })?.address ?? null;
  it('a name in the unit or type-first position is not kept', () => {
    const cases: [string, string | null][] = [
      ['12 SMITH APT JOHN', null], ['12 MAIN ST #MARIA', '12 MAIN ST'], ['123 MAIN ST STE JSMITH', '123 MAIN ST'], ['4812 AVENUE JOHN', null], ['100 ROAD MARY', null],
      ['12 N MARIA APT LOPEZ', null], ['12 MAIN ST APT 4B', '12 MAIN ST APT 4B'], ['12 MAIN ST STE A', '12 MAIN ST STE A'], ['12 MAIN ST UNIT REAR', '12 MAIN ST UNIT REAR'],
      ['4812 AVENUE H', '4812 AVENUE H'], ['100 ROAD 12', '100 ROAD 12'], ['2150 N DAMEN #3R', '2150 N DAMEN #3R'], ['2150 N DAMEN APT JOHN', null],
    ];
    for (const [a, want] of cases) {
      expect(cleanAddress(a), a).toBe(want);
      expect(org(a), a).toBe(want);
    }
  });
  it('phone digits, a dotted domain and four name words in the street position are refused', () => {
    for (const a of ['100 312-555-0199 MAIN ST', '312555 0199 MAIN ST', '100 john.smith.gmail.com ST', '12-312555 0199 RD', '12-555019 9 RD', '100 JOHN Q SMITH JR ST'])
      expect(cleanAddress(a), a).toBeNull();
  });
  it('through extractContacts with the real Austin spec', () => {
    const row: Record<string, string> = { contractor_company_name: 'ACME ROOFING LLC', contractor_address1: '12-312555 0199 RD', original_address1: '100 john.smith.gmail.com ST' };
    const out = extractContacts((f) => row[f] ?? '', CONTACT_SPECS['socrata-austin-permits'], { city: 'Austin', state: 'TX' }, 'permit');
    expect(JSON.stringify(out)).not.toMatch(/312555|0199|john|gmail/);
  });
  it('street names stay free up to three words (a street name is not a person)', () => {
    expect(cleanAddress('100 MARTIN LUTHER KING BLVD')).toBe('100 MARTIN LUTHER KING BLVD');
    expect(cleanAddress('100 S MARTIN LUTHER KING BLVD')).toBe('100 S MARTIN LUTHER KING BLVD');
  });
});

describe('P2-13: city', () => {
  it('only the dataset city', () => {
    expect(cleanCity('CHICAGO', 'Chicago')).toBe('CHICAGO');
    for (const v of ['Moore', 'White', 'Rivera', 'Richardson', 'Myers', 'Vista East', 'Lake Johns', 'Evanston']) expect(cleanCity(v, 'Chicago'), v).toBeNull();
  });
});
