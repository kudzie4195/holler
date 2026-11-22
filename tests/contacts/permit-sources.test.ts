/**
 * Round 15 Unit G fixtures, one per permit source (PLAN-2.0 1.2 contractor or company, 1.3 project value and site address).
 * Rows are hand written in the shape of the columns each portal publishes (see the `verifiedUrl` and the sourced/assumed label of
 * each spec). Every person, phone and owner in these rows is invented. For each source: the company, phone and licence that may
 * come out, the declared job value in data.jobValue, the site address, and the proof that no private party appears in the output.
 */
import { describe, expect, it } from 'vitest';
import { parseSocrata } from '@/lib/signals/adapters/socrata';
import { parseArcgis } from '@/lib/signals/adapters/arcgis';
import { SOCRATA_DATASETS, type SocrataDataset } from '@/lib/signals/adapters/socrata-datasets';
import { ARCGIS_DATASETS, type ArcgisDataset } from '@/lib/signals/adapters/arcgis-datasets';
import type { SignalInput } from '@/lib/signals/types';

const sds = (id: string): SocrataDataset => SOCRATA_DATASETS.find((d) => d.id === id)!;
const ads = (id: string): ArcgisDataset => ARCGIS_DATASETS.find((d) => d.id === id)!;
const hay = (items: SignalInput[]) => JSON.stringify(items).toLowerCase();
const notIn = (items: SignalInput[], needles: string[]) => {
  for (const n of needles) expect(hay(items).includes(n.toLowerCase()), `found "${n}" in the output`).toBe(false);
};
const role = (s: SignalInput, r: string) => s.contacts?.filter((c) => c.role === r) ?? [];
const jobValue = (s: SignalInput) => (s.data as Record<string, unknown>).jobValue;

// ---------------------------------------------------------------------------------------------------------------------------------
describe('NYC DOB NOW approved permits (rbx6-tga4): permittee business and licence, never the owner', () => {
  const rows = [
    {
      work_permit: '123456789-I1-GC', issued_date: '2026-11-12T00:00:00.000', job_description: 'Replace roof membrane', work_type: 'General Construction',
      estimated_job_costs: '125000', borough: 'BROOKLYN', house_no: '742', street_name: 'EVERGREEN TERRACE', zip_code: '11201', latitude: '40.69', longitude: '-73.99',
      permittee_s_business_name: 'METRO BUILDING SERVICES LLC', permittee_s_license_number: '626543', permittee_s_license_type: 'GC',
      owner_s_business_name: 'JANE OWNERSON', owner_s_first_name: 'JANE', owner_s_last_name: 'OWNERSON', owner_s_phone: '718-555-0188',
    },
    {
      work_permit: '123456790-I1-GC', issued_date: '2026-11-12T00:00:00.000', job_description: 'Interior renovation', work_type: 'General Construction',
      estimated_job_costs: '0', borough: 'QUEENS', house_no: '5', street_name: 'MAPLE AVE', zip_code: '11375', latitude: '40.71', longitude: '-73.84',
      permittee_s_business_name: 'JAMES CARTER', permittee_s_license_number: '000111', owner_s_business_name: 'Not Applicable',
    },
  ];
  const items = parseSocrata(rows, sds('socrata-nyc-permits'));
  it('company, value and site for a business permittee (no licence number); owner and phone never read', () => {
    expect(items).toHaveLength(2);
    // Review HSK G-P1-2: the DOB NOW licence number belongs to an individual licensee, so it is not read at all.
    expect(role(items[0], 'contractor')).toEqual([expect.objectContaining({ name: 'METRO BUILDING SERVICES LLC', phone: null })]);
    expect(role(items[0], 'contractor')[0]).not.toHaveProperty('license');
    notIn([items[0]], ['626543']);
    expect(role(items[0], 'site')[0]).toMatchObject({ address: '742 EVERGREEN TERRACE', zip: '11201' });
    expect(jobValue(items[0])).toBe(125000);
    notIn(items, ['OWNERSON', '718-555-0188', '7185550188']);
  });
  it('a permittee that is a person gives no company and no licence; a zero value gives no jobValue', () => {
    expect(role(items[1], 'contractor')).toEqual([]);
    expect(jobValue(items[1])).toBeUndefined();
    notIn([items[1]], ['JAMES CARTER', '000111']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('Orlando permit applications (ryhf-m453): contractor company, phone, licence (assumed columns)', () => {
  const base = { issue_permit_date: '2026-11-12T00:00:00.000', application_type: 'Building', worktype: 'Reroof', permit_address: '1200 N MILLS AVE', estimated_cost: '$18,500.00' };
  const rows = [
    { ...base, permit_number: 'BLD2026-01', contractor_company_name: 'PRESTO PROPERTY SERVICES INC', contractor_phone_number: '(407) 555-0142', contractor_license_number: 'CBC1234567' },
    { ...base, permit_number: 'BLD2026-02', contractor: 'MICHAEL T BROWN (TCS COMMUNICATIONS LLC)', contractor_phone: '407-555-0199', estimated_cost: '' },
    { ...base, permit_number: 'BLD2026-03', contractor_name: 'JAMES CARTER', contractor_phone_number: '407-555-0100', applicant_phone: '407-555-0111' },
  ];
  const items = parseSocrata(rows, sds('socrata-orlando-permits'));
  it('company with its business phone, no licence; value parsed from "$18,500.00"', () => {
    expect(role(items[0], 'contractor')).toEqual([expect.objectContaining({ name: 'PRESTO PROPERTY SERVICES INC', phone: '407-555-0142' })]);
    notIn([items[0]], ['CBC1234567']); // Florida contractor licences are issued to the individual licensee: not read
    expect(jobValue(items[0])).toBe(18500);
  });
  it('the "PERSON (COMPANY)" shape keeps only the company; no value gives no jobValue', () => {
    expect(role(items[1], 'contractor')).toEqual([expect.objectContaining({ name: 'TCS COMMUNICATIONS LLC', phone: '407-555-0199' })]);
    expect(jobValue(items[1])).toBeUndefined();
    notIn([items[1]], ['MICHAEL', 'BROWN']);
  });
  it('a person contractor gives no company and no phone', () => {
    expect(role(items[2], 'contractor')).toEqual([]);
    notIn([items[2]], ['JAMES CARTER', '407-555-0100', '407-555-0111']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('Seattle building permits (76t5-zqzr): contractorcompanyname (sourced), value, site', () => {
  const rows = [
    { permitnum: '6900001-CN', issueddate: '2026-11-12T00:00:00.000', description: 'Remodel kitchen', permittypedesc: 'Residential Building', permitclass: 'Single Family/Duplex', estprojectcost: '85000', originaladdress1: '1234 5TH AVE N', originalcity: 'SEATTLE', originalstate: 'WA', originalzip: '98109', latitude: '47.62', longitude: '-122.35', contractorcompanyname: 'LAKEFRONT ROOFING & SIDING INC' },
    { permitnum: '6900002-CN', issueddate: '2026-11-12T00:00:00.000', description: 'Deck', permittypedesc: 'Residential Building', permitclass: 'Single Family/Duplex', estprojectcost: '9000', originaladdress1: '77 PINE ST', originalcity: 'SEATTLE', originalstate: 'WA', originalzip: '98101', latitude: '47.61', longitude: '-122.34', contractorcompanyname: 'OWNER' },
  ];
  const items = parseSocrata(rows, sds('socrata-seattle-permits'));
  it('company, value and the job site', () => {
    expect(role(items[0], 'contractor')[0]).toMatchObject({ name: 'LAKEFRONT ROOFING & SIDING INC' });
    expect(jobValue(items[0])).toBe(85000);
    expect(role(items[0], 'site')[0]).toMatchObject({ address: '1234 5TH AVE', zip: '98109' });
  });
  it('"OWNER" in the company column is not a company', () => {
    expect(role(items[1], 'contractor')).toEqual([]);
    expect(jobValue(items[1])).toBe(9000);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('Dallas building permits (e7gq-4sah): one run-together contractor string (sourced from the CSV)', () => {
  const rows = [
    { permit_number: '1801000001', issued_date: '2026-11-12T00:00:00.000', permit_type: 'Building (BU) Commercial Alteration', value: '42000', work_description: 'Tenant finish out', street_address: '2400 MAIN ST', zip_code: '75201', contractor: 'MILESTONE ELECTRIC 7501 US HWY 287, Suite C4, ARLINGTON, TX 76001 (817) 969-5050' },
    { permit_number: '1801000002', issued_date: '2026-11-12T00:00:00.000', permit_type: 'Plumbing (PL) Residential', value: '1200', work_description: 'Water heater', street_address: '9 ELM ST', zip_code: '75202', contractor: 'JAMES CARTER 12 ELM ST, DALLAS, TX 75201 214-555-0101' },
  ];
  const items = parseSocrata(rows, sds('socrata-dallas-permits'));
  it('name and phone of the company; the contractor street, city and zip are not stored', () => {
    expect(role(items[0], 'contractor')).toEqual([expect.objectContaining({ name: 'MILESTONE ELECTRIC', phone: '817-969-5050', address: null })]);
    expect(jobValue(items[0])).toBe(42000);
    notIn([items[0]], ['7501 US HWY', 'ARLINGTON', '76001']);
  });
  it('a person at the start of the string gives no company and no phone', () => {
    expect(role(items[1], 'contractor')).toEqual([]);
    notIn([items[1]], ['JAMES CARTER', '214-555-0101', '12 ELM']);
  });
  it('the dataset stays disabled (text dates, 2018 rows) until the owner re-checks the feed', () => {
    expect(sds('socrata-dallas-permits').verified).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('New Orleans and Baton Rouge permits: candidate contractor columns (assumed), value and site', () => {
  it('NOLA: company from `contractors`, value from constrval, address from `address`', () => {
    const items = parseSocrata(
      [{ numstring: '26-12345-NEWC', issuedate: '2026-11-12T00:00:00.000', type: 'Residential New Construction', currentstatus: 'Issued', description: 'New house', constrval: '310000', address: '2100 PRYTANIA ST', location_1: { type: 'Point', coordinates: [-90.08, 29.93] }, contractors: 'CRESCENT CITY BUILDERS LLC' }],
      sds('socrata-nola-permits'),
    );
    expect(items).toHaveLength(1);
    expect(role(items[0], 'contractor')[0]).toMatchObject({ name: 'CRESCENT CITY BUILDERS LLC' });
    expect(role(items[0], 'site')[0]).toMatchObject({ address: '2100 PRYTANIA ST' });
    expect(jobValue(items[0])).toBe(310000);
  });
  it('Baton Rouge: company, value from projectvalue, address and zip', () => {
    const items = parseSocrata(
      [{ permitnumber: 'BR-2026-77', issueddate: '2026-11-12T00:00:00.000', permittype: 'Commercial Building', designation: 'Remodel', projectdescription: 'Tenant improvement', projectvalue: '56000', streetaddress: '8200 BLUEBONNET BLVD', zip: '70810', lat: '30.40', long: '-91.10', contractorname: 'BAYOU CONSTRUCTION SERVICES LLC', owner: 'JANE OWNERSON', ownerphone: '225-555-0190' }],
      sds('socrata-batonrouge-permits'),
    );
    expect(items).toHaveLength(1);
    expect(role(items[0], 'contractor')[0]).toMatchObject({ name: 'BAYOU CONSTRUCTION SERVICES LLC' });
    expect(jobValue(items[0])).toBe(56000);
    notIn(items, ['OWNERSON', '225-555-0190']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('Buffalo permits (9p2d-f3yt): site address and value only, no contractor column is known', () => {
  const items = parseSocrata(
    [{ apno: 'BP-26-1', issued: '2026-11-12T00:00:00.000', aptype: 'Electrical', descofwork: 'Service upgrade', value: '4500', stname: '216 WOODBRIDGE', zip: '14214', latitude: '42.93', longitude: '-78.85', owner: 'JANE OWNERSON' }],
    sds('socrata-buffalo-permits'),
  );
  it('gives the site and the value, and no organisation contact', () => {
    expect(items[0].contacts).toEqual([expect.objectContaining({ role: 'site', address: '216 WOODBRIDGE' })]);
    expect(jobValue(items[0])).toBe(4500);
    notIn(items, ['OWNERSON']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('Raleigh permits (FeatureServer): company, phone and licence number', () => {
  const rows = {
    features: [
      { attributes: { permitnum: 'BLDR-1', issueddate: 1762905600000, description: 'Reroof', permittype: 'Residential Building', workclass: 'Repair', estprojectcost: 12500, originaladdress1: '100 TEST ST', originalzip: '27601', contractorcompanyname: 'SUMMIT ROOFING & SIDING INC', contractorphone: '919-555-0150', contractorlicnum: '75000', contractorfullname: 'JANE CONTRACTORPERSON', parcelownername: 'OWNER PERSONNAME', ownerphone: '919-555-0123' }, geometry: { x: -78.64, y: 35.78 } },
    ],
  };
  const items = parseArcgis(rows, ads('arcgis-raleigh-permits'));
  it('company, phone, licence, value and site', () => {
    expect(role(items[0], 'contractor')).toEqual([expect.objectContaining({ name: 'SUMMIT ROOFING & SIDING INC', phone: '919-555-0150', license: '75000' })]);
    expect(jobValue(items[0])).toBe(12500);
    expect(role(items[0], 'site')[0]).toMatchObject({ address: '100 TEST ST' });
  });
  it('the contractor full name, the owner and the owner phone never appear', () => {
    notIn(items, ['CONTRACTORPERSON', 'PERSONNAME', '919-555-0123']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('DeKalb County permit applications: the primary contact is shown only when its type is on a contractor allow-list', () => {
  const mk = (n: string, name: string, type: string | undefined, phone: string, declared: unknown, calc: unknown = null) => ({
    attributes: { applicationNumber: n, issuedDateTime: 1762905600000, WorkTypeDescription: 'Alteration', OccupancyTypeDescription: 'Single Family', statusDescription: 'Issued', location: '1 TEST RD', locationLine1: '1 TEST RD', primaryContactName: name, ...(type === undefined ? {} : { primaryContactType: type }), primaryContactPhone: phone, declaredValuation: declared, calculatedValuation: calc },
    geometry: { x: -84.3, y: 33.77 },
  });
  const rows = {
    features: [
      mk('D1', 'SOUTHERN ROOFING & SIDING INC', 'Contractor', '404-555-0140', 15000),
      mk('D2', 'METRO BUILDING SERVICES LLC', 'Owner', '404-555-0141', 0, 22000),
      mk('D3', 'METRO BUILDING SERVICES LLC', 'Property Owner/Resident', '404-555-0142', null),
      mk('D4', 'JAMES CARTER', 'Contractor', '404-555-0143', 800),
      mk('D5', 'METRO BUILDING SERVICES LLC', 'Applicant', '404-555-0144', 5000),
      mk('D6', 'METRO BUILDING SERVICES LLC', 'Agent', '404-555-0145', 5000),
      mk('D7', 'METRO BUILDING SERVICES LLC', 'Owner/Builder', '404-555-0146', 5000),
      mk('D8', 'METRO BUILDING SERVICES LLC', 'Licensed Professional', '404-555-0147', 5000),
      mk('D9', 'METRO BUILDING SERVICES LLC', 'General Contractor', '404-555-0148', 5000),
      mk('D10', 'METRO BUILDING SERVICES LLC', '', '404-555-0149', 5000),
      mk('D11', 'METRO BUILDING SERVICES LLC', 'Something New', '404-555-0150', 5000),
    ],
  };
  const items = parseArcgis(rows, ads('arcgis-dekalb-permits'));
  const names = (i: number) => role(items[i], 'contractor').map((c) => c.name);
  it('a contractor-typed company gives name and business phone; declared value is read first, calculated when declared is 0', () => {
    expect(items).toHaveLength(11);
    expect(role(items[0], 'contractor')[0]).toMatchObject({ name: 'SOUTHERN ROOFING & SIDING INC', phone: '404-555-0140' });
    expect(jobValue(items[0])).toBe(15000);
    expect(jobValue(items[1])).toBe(22000);
  });
  it('an owner, resident, applicant, agent or owner-builder type shows nothing even when the name looks like a company', () => {
    for (const i of [1, 2, 4, 5, 6]) expect(names(i), `row ${i}`).toEqual([]);
    notIn([items[1], items[2], items[4], items[5], items[6]], ['404-555-0141', '404-555-0142', '404-555-0144', '404-555-0145', '404-555-0146']);
  });
  it('contractor, general contractor and licensed professional types are on the allow-list', () => {
    expect(names(7)).toEqual(['METRO BUILDING SERVICES LLC']);
    expect(names(8)).toEqual(['METRO BUILDING SERVICES LLC']);
  });
  it('a blank or unknown type shows nothing (fail closed)', () => {
    expect(names(9)).toEqual([]);
    expect(names(10)).toEqual([]);
    notIn([items[9], items[10]], ['404-555-0149', '404-555-0150']);
  });
  it('when the layer has no primaryContactType at all, no contact is stored', () => {
    const noType = parseArcgis({ features: [mk('D20', 'METRO BUILDING SERVICES LLC', undefined, '404-555-0151', 7000)] }, ads('arcgis-dekalb-permits'));
    expect(role(noType[0], 'contractor')).toEqual([]);
    notIn(noType, ['404-555-0151', 'METRO BUILDING']);
    expect(jobValue(noType[0])).toBe(7000);
  });
  it('a person name gives nothing; a row with no value has no jobValue', () => {
    expect(names(3)).toEqual([]);
    notIn([items[3]], ['JAMES CARTER', '404-555-0143']);
    expect(jobValue(items[2])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('Washington DC permits: the applicant is never stored as the contractor (review HSK G-P1-1)', () => {
  const rows = {
    features: [
      { attributes: { PERMIT_ID: 'P1', ISSUE_DATE: 1762905600000, DESC_OF_WORK: 'Interior alteration', PERMIT_TYPE_NAME: 'CONSTRUCTION', PERMIT_SUBTYPE_NAME: 'ALTERATION', FULL_ADDRESS: '1600 K ST NW', ZIPCODE: '20006', LATITUDE: 38.9, LONGITUDE: -77.04, PERMIT_APPLICANT: 'PREMIER ROOFING SERVICES LLC', ESTIMATED_COST: 64000 }, geometry: { x: -77.04, y: 38.9 } },
      { attributes: { PERMIT_ID: 'P2', ISSUE_DATE: 1762905600000, DESC_OF_WORK: 'Interior alteration', PERMIT_TYPE_NAME: 'CONSTRUCTION', PERMIT_SUBTYPE_NAME: 'ALTERATION', FULL_ADDRESS: '12 Q ST NW', ZIPCODE: '20001', LATITUDE: 38.91, LONGITUDE: -77.03, PERMIT_APPLICANT: 'MARIA L GARCIA' }, geometry: { x: -77.03, y: 38.91 } },
    ],
  };
  const items = parseArcgis(rows, ads('arcgis-dc-permits'));
  it('a company applicant is not a contractor and not stored; the site stays', () => {
    expect(ads('arcgis-dc-permits').contacts?.orgs).toBeUndefined();
    for (const s of items) expect(s.contacts?.map((c) => c.role)).toEqual(['site']);
    notIn(items, ['PREMIER ROOFING', 'GARCIA']);
  });
  it('value from the first plausible candidate column', () => {
    expect(jobValue(items[0])).toBe(64000);
    expect(jobValue(items[1])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('Mecklenburg County permits: site only, the owner phone is never read', () => {
  const rows = {
    features: [
      { attributes: { permit_number: 'M1', issue_date: 1762905600000, description_of_work: 'Reroof', permit_type: 'Residential', type_of_work: 'Repair', total_square_feet: 1800, project_address: '9541 SOUTH BLVD', zip_code: '28273', latitude: 35.1, longitude: -80.9, owner_name: 'JANE OWNERSON', owner_phone: '704-555-0166', project_cost: 9800 }, geometry: { x: -80.9, y: 35.1 } },
    ],
  };
  const items = parseArcgis(rows, ads('arcgis-mecklenburg-permits'));
  it('site and value, no organisation, no owner phone anywhere', () => {
    expect(items[0].contacts?.map((c) => c.role)).toEqual(['site']);
    expect(jobValue(items[0])).toBe(9800);
    notIn(items, ['OWNERSON', '704-555-0166', '7045550166']);
  });
  it('no spec of any dataset names an owner or applicant phone column', () => {
    for (const d of [...SOCRATA_DATASETS, ...ARCGIS_DATASETS]) {
      const spec = d.contacts;
      if (!spec) continue;
      for (const o of spec.orgs ?? []) {
        for (const f of [o.phoneField, ...(o.phoneFields ?? [])]) if (f) expect(f, d.id).not.toMatch(/owner|applicant|homeowner|resident/i);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('every permit source: the privacy sweep', () => {
  it('no organisation contact carries a person-looking name, and every phone sits next to an organisation', () => {
    const all = [
      ...parseSocrata([{ work_permit: 'X', issued_date: '2026-11-12T00:00:00.000', job_description: 'Roof', work_type: 'General Construction', house_no: '1', street_name: 'A ST', permittee_s_business_name: 'METRO BUILDING SERVICES LLC' }], sds('socrata-nyc-permits')),
    ];
    for (const s of all) for (const c of s.contacts ?? []) {
      if (c.phone) expect(c.role).not.toBe('site');
      if (c.role === 'site') expect(c.name).toBe('');
    }
  });
  it('every spec that names a contractor column reads it through the classifier only (no spec lists a *_full_name, owner or applicant name column; the DeKalb filer column only behind a type allow-list)', () => {
    for (const d of [...SOCRATA_DATASETS, ...ARCGIS_DATASETS]) {
      for (const o of d.contacts?.orgs ?? []) {
        for (const f of o.nameFields) {
          if (d.id === 'arcgis-dekalb-permits' && f === 'primaryContactName') {
            expect(o.acceptType, 'DeKalb needs the allow-list').toBeInstanceOf(RegExp); // the one filer column, gated by an allow-list
            continue;
          }
          expect(f, `${d.id}:${f}`).not.toMatch(/owner|applicant|tenant|full_?name|first|last/i);
        }
      }
    }
  });
});

describe('licence numbers: only where the record says it is a contractor licence', () => {
  it('only the Raleigh contractor licence column is read (NYC and DOB NOW licences belong to individuals; Orlando columns are unconfirmed)', () => {
    const withLicense = [...SOCRATA_DATASETS, ...ARCGIS_DATASETS].filter((d) => d.contacts?.orgs?.some((o) => o.licenseFields?.length)).map((d) => d.id);
    expect(withLicense).toEqual(['arcgis-raleigh-permits']);
  });
});

describe('DeKalb primaryContactType allow-list matches whole types (review HSK re-verification)', () => {
  const ds = ARCGIS_DATASETS.find((d) => d.id === 'arcgis-dekalb-permits')!;
  const org = ds.contacts!.orgs![0];
  const shown = (t: string) => org.acceptType!.test(t) && !org.rejectType!.test(t);
  it.each([['Contractor'], ['General Contractor'], ['Subcontractor'], ['Sub-Contractor'], ['Licensed Contractor'], ['Builder'], ['Licensed Professional'], ['contractor'], ['Contractor - Residential']])(
    'shows %s',
    (t) => expect(shown(t)).toBe(true),
  );
  it.each([
    ['Non-Contractor'], ['Not a Contractor'], ['Landlord Contractor'], ['Self Builder'], ['Owner/Contractor'], ['Contractor (Owner)'], ['Owner-Builder'],
    ['Owner/Builder'], ['Applicant/Contractor'], ['Tenant Contractor'], ['Contractor Agent'], ['Home Owner'], ['Resident'], ['Applicant'], ['Agent'],
    ['Architect'], ['Engineer'], [''], ['Unknown'], ['Property Manager'], ['Not Contractor'], ['Self-Contractor'],
  ])('does not show %j', (t) => expect(shown(t)).toBe(false));
});
