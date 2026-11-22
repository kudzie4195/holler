import { describe, expect, it } from 'vitest';
import { cleanOrgName, isOrganisationName } from '@/lib/contacts/org';

/**
 * Round 10 (R12): a name that carries a clear business-entity marker is a company even when other words in it are also listed as
 * given names or surnames ("Queen", "Harbor Point", "Capitol"). Plain personal names, a person plus a role word and a person plus
 * "DBA <person>" are still rejected. Hand written; none is a real record.
 */

/** The five names reported as false rejections. */
const REPORTED = [
  'Capitol Roofing Inc',
  'Queen City Electric Co',
  'Triangle Roofing Co',
  'Harbor Point Holdings LLC',
  'Magnolia Rental Properties LLC',
];

/** Realistic contractor, developer and public-body names: legal forms, trade words and institution words mixed. */
const CONTRACTORS = [
  'Peachtree Plumbing Services LLC', 'Blue Ridge Electrical Contractors Inc', 'Summit Heating & Cooling LLC', 'Atlas Construction Group',
  'Liberty Mechanical Inc', 'Patriot Restoration Services LLC', 'Pinnacle Landscaping LLC', 'Evergreen Tree Service Inc',
  'Sterling Painting Co', 'Phoenix Remodeling LLC', 'Delta Concrete Corp', 'Lakeside Paving Inc', 'Riverbend Fence Company',
  'Rose City Homes LLC', 'Cardinal Development Partners LP', 'Union Realty Group', 'Heritage Property Management LLC',
  'Gateway Builders Inc', 'Keystone Contracting Co', 'Crown Air Conditioning Inc', 'Premier Lawn Care LLC', 'Ironwood Associates LLC',
  'Cobb County Water Authority', 'Fulton County School District', 'City of Marietta', 'State of Georgia', 'First National Bank',
  'Oakwood Christian School', 'Atlanta Metropolitan Heating LLC', 'North Star HVAC Inc', 'Southern Comfort Heating and Air LLC',
  'Bridgeway Enterprises LLC', 'Colony Square Management Co', 'Midtown Solutions Group LLC', 'Harmony Rental Homes LLC',
  'Beacon Hill Development LLC', 'Madison Park Properties LLC', 'Savannah Electric Co', 'Dixie Concrete Co',
  'Hudson Mechanical Services Inc', 'River Valley Restoration LLC', 'Magnolia Lawn Care Inc', 'Queen Creek Paving LLC',
  'Triangle Air LP', 'Harbor Point Construction Co', 'Georgia Tech University', 'Ashford Park Properties LLC',
  'Willow Creek Builders Inc', 'Triangle Plumbing & Heating Inc', 'Capitol Electric Corp', 'Magnolia Homes LLC',
  'Capitol Contractors LLP', 'Harbor Point Realty PLLC', 'Queen City Painting Ltd', 'Triangle Fence Company', 'City of Queen Creek',
];

/** Personal names in every format that must still be rejected. */
const PERSONS = [
  // plain, middle initial, suffix
  'John Smith', 'Smith, John A', 'J. Smith', 'John A. Smith Jr', 'Marcus T. Williams III', 'SMITH, ROBERT SR', 'William H. Brown Sr.',
  'Brandon Lee Carter', 'Mary Ann Whitaker', "Brian K. O'Connor", 'Dr. Alicia Moreno', 'Patricia Anne Brown-Taylor',
  // Hispanic, particles, two surnames
  'Maria de la Cruz', 'Jose Luis Hernandez Garcia', 'Ana Sofia Martinez Lopez', 'Carlos Alberto Mendoza Ruiz', 'Juan Carlos de la Torre',
  'Roberto Fernandez Villanueva', 'GARCIA RAMIREZ, LUIS', 'Rodriguez de Santos, Elena', 'DE LA CRUZ, MARIA', 'ELENA PEREZ-GOMEZ',
  'Lucia Torres Navarro', 'Pedro Sanchez Ortega',
  // Vietnamese
  'Nguyen Thi Lan', 'Tran Van Hung', 'Le Minh Tuan', 'Pham Quoc Bao', 'Vo Thi Mai', 'Dang Hoang Nam', 'Hoang, Thanh Tam', 'Ngoc Anh Tran',
  'NGUYEN, VAN MINH', 'Bui Thi Hoa',
  // other
  'Fatima Al-Hassan', 'Olusegun Adeyemi', 'Kwame Mensah', 'Lakshmi Narayanan', 'Yuki Tanaka', 'Sofia Rossi', 'Smith-Jones, Patricia',
];

/** A person followed by a role word that is not an entity, or by DBA and another person: no entity marker anywhere. */
const PERSON_PLUS_ROLE = [
  'John Smith Owner', 'Smith John Applicant', 'Maria Lopez Homeowner', 'SMITH, JOHN TENANT', 'John Smith Owner/Builder', 'Mary Jones Resident',
  'Nguyen Van Minh Applicant', 'John Smith DBA Mary Jones', 'JOHN SMITH DBA JANE DOE', 'Maria Lopez d/b/a Rosa Garcia',
  'Tran Van Hung DBA Hung Tran', 'John Smith C/O Mary Smith', 'Smith John A Contact', 'Jose Garcia Agent',
];

describe('R12 entity markers: the five reported false rejections', () => {
  for (const n of REPORTED) {
    it(`accepts ${JSON.stringify(n)}`, () => {
      expect(cleanOrgName(n)).toBe(n);
      expect(isOrganisationName(n)).toBe(true);
    });
  }
});

describe('R12 entity markers: realistic contractor and public-body names', () => {
  it('has at least 30 cases', () => {
    expect(new Set(CONTRACTORS).size).toBe(CONTRACTORS.length);
    expect(CONTRACTORS.length).toBeGreaterThanOrEqual(30);
  });
  for (const n of CONTRACTORS) it(`accepts ${JSON.stringify(n)}`, () => expect(cleanOrgName(n)).toBe(n));
  it('is stable: cleaning a cleaned name changes nothing', () => {
    for (const n of [...REPORTED, ...CONTRACTORS]) expect(cleanOrgName(cleanOrgName(n) as string)).toBe(n);
  });
  it('accepts upper case and extra whitespace, and drops edge punctuation', () => {
    expect(cleanOrgName('  QUEEN CITY ELECTRIC CO.  ')).toBe('QUEEN CITY ELECTRIC CO');
    expect(cleanOrgName('"Capitol   Roofing,  Inc."')).toBe('Capitol Roofing Inc.');
  });
});

describe('R12 entity markers: personal names stay rejected', () => {
  it('has at least 30 cases', () => {
    expect(new Set(PERSONS).size).toBe(PERSONS.length);
    expect(PERSONS.length).toBeGreaterThanOrEqual(30);
  });
  it('accepts none of them', () => expect(PERSONS.filter((n) => cleanOrgName(n) !== null || isOrganisationName(n))).toEqual([]));
  for (const n of PERSONS) it(`rejects person ${JSON.stringify(n)}`, () => expect(cleanOrgName(n)).toBeNull());
});

describe('R12 entity markers: a person plus a role word, or plus DBA another person, is still a person', () => {
  it('accepts none of them', () => expect(PERSON_PLUS_ROLE.filter((n) => cleanOrgName(n) !== null)).toEqual([]));
  for (const n of PERSON_PLUS_ROLE) it(`rejects ${JSON.stringify(n)}`, () => expect(cleanOrgName(n)).toBeNull());
});

describe('R12 entity markers: the marker never rescues a person name', () => {
  // A listed given name (also one that is a surname) next to a marker: a sole trader's name. The review3/review2 privacy tables pin
  // these as people, so they stay rejected until that policy is changed on purpose.
  const SOLE_TRADERS = [
    'John Smith LLC', 'John Smith Roofing', 'Smith Roofing', 'Mary Jones Plumbing LLC', 'Maria Lopez Roofing LLC', 'John Smith Holdings LLC',
    'J Smith Plumbing LLC', 'Allen Landscaping', 'Magnolia Smith Plumbing',
  ];
  for (const n of SOLE_TRADERS) it(`still rejects ${JSON.stringify(n)}`, () => expect(cleanOrgName(n)).toBeNull());
  it('an institution word next to one name word needs a third word', () => {
    for (const n of ['Grace Church', 'Anna Bank', 'Queen Bank', 'Georgia Church', 'Karen Temple']) expect(cleanOrgName(n)).toBeNull();
  });
  it('"City of" takes exactly one place word, never a person', () => {
    for (const n of ['City of John Smith', 'Town of John Smith', 'City of Austin John Smith', 'County of Mary Jones']) expect(cleanOrgName(n)).toBeNull();
  });
  it('an unknown first name next to a surname word and a marker is still a person shape', () => {
    for (const n of ['Kwesi Bright Roofing LLC', 'Thiago Lima Roofing', 'Queen Latifah Roofing']) expect(cleanOrgName(n)).toBeNull();
  });
});
