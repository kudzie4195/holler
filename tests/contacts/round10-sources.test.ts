/**
 * Round 10 (U3): contact extraction for the permit sources added to CONTACT_SPECS / ARCGIS_CONTACT_SPECS.
 *
 * FIXTURE PROVENANCE (read this): tests/contacts/fixtures/round10-*-synthetic.json are HAND WRITTEN in the shape of the columns the commander
 * named on 2026-11-19. They are NOT real portal rows: the WebFetch of every portal's metadata and sample rows was blocked in this unit (see
 * /home/claude/runlog/u3-contacts.md). All names, numbers and emails are invented. Replace them with real rows once they can be fetched; the
 * assertions describe the rules (company in, person out, no homeowner phone or email) and should still hold.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSocrata } from '@/lib/signals/adapters/socrata';
import { buildArcgisQuery, parseArcgis } from '@/lib/signals/adapters/arcgis';
import { CONTACT_SPECS, SOCRATA_DATASETS, type SocrataDataset } from '@/lib/signals/adapters/socrata-datasets';
import { ARCGIS_CONTACT_SPECS, ARCGIS_DATASETS, type ArcgisDataset } from '@/lib/signals/adapters/arcgis-datasets';
import { extractContacts, contactSpecFields } from '@/lib/contacts/extract';
import type { SignalInput } from '@/lib/signals/types';

const fx = (n: string): unknown => JSON.parse(readFileSync(join(__dirname, 'fixtures', `round10-${n}-synthetic.json`), 'utf8'));
const sds = (id: string): SocrataDataset => SOCRATA_DATASETS.find((d) => d.id === id)!;
const ads = (id: string): ArcgisDataset => ARCGIS_DATASETS.find((d) => d.id === id)!;
const brief = (s: SignalInput) => (s.contacts ?? []).map((c) => [c.role, c.name, c.address, c.phone]);
const hay = (items: SignalInput[]) => JSON.stringify(items).toLowerCase();
function absent(items: SignalInput[], needles: string[]) {
  const h = hay(items);
  for (const n of needles) expect(h.includes(n.toLowerCase()), `found "${n}"`).toBe(false);
}

describe('Orlando permits', () => {
  const items = parseSocrata(fx('orlando'), sds('socrata-orlando-permits'));
  it('contractor company with its business phone and address, corporate owner, and the site', () => {
    expect(brief(items[0])).toEqual([
      ['site', '', '1520 E Colonial Dr', null],
      ['contractor', 'Summit Roofing Inc', '900 Orange Ave', '407-555-0142'],
      ['business', 'Meridian Property Holdings LLC', null, null],
    ]);
  });
  it('a person as contractor and owner gives no company and no phone; a phone with no company name is not stored', () => {
    expect(brief(items[1])).toEqual([['site', '', '77 Lake Eola Dr', null]]);
    expect(brief(items[2])).toEqual([['site', '', '410 W Central Blvd', null]]);
    absent(items, ['407-555-0177', '407-555-0188', 'Maria Lopez', 'Danny Smith']);
  });
  it('job value stays in the summary the way other sources show it, and not on a zero', () => {
    expect(items[0].summary).toContain('$14,200 job value');
    expect(items[2].summary).not.toMatch(/job value/);
  });
});

describe('NYC permits', () => {
  const items = parseSocrata(fx('nyc'), sds('socrata-nyc-permits'));
  it('applicant and owner business names are kept when they are companies; licence and first/last name never', () => {
    expect(brief(items[0])).toEqual([
      ['site', '', '245 W 45 STREET', null],
      ['business', 'Harbor Plumbing & Heating Corp', null, null],
      ['business', 'Meridian Realty Holdings LLC', null, null],
    ]);
    absent(items, ['0012345', '0099999', 'Ventresca', 'Carla']);
  });
  it('a person written into the business-name columns is rejected', () => {
    expect(brief(items[1])).toEqual([['site', '', '18 BEDFORD AVENUE', null]]);
    absent([items[1]], ['Rinaldi', 'Joseph']);
  });
  it('job value in the summary', () => expect(items[0].summary).toContain('$6,500 job value'));
});

describe('NOLA permits', () => {
  const items = parseSocrata(fx('nola'), sds('socrata-nola-permits'));
  it('contractor, owner LLC and applicant company; one company named twice is one contact', () => {
    expect(brief(items[0])).toEqual([
      ['site', '', '2401 Esplanade Ave', null],
      ['contractor', 'Crescent City Roofing LLC', null, null],
      ['business', 'Bayou Property Holdings LLC', null, null],
    ]);
  });
  it('person owner, applicant and contractor are rejected', () => {
    expect(brief(items[1])).toEqual([['site', '', '1600 Magazine St', null]]);
    absent(items, ['Tyrone', 'Angela', 'Williams']);
  });
  it('job value (constrval) in the summary', () => expect(items[0].summary).toContain('$21,500 job value'));
});

describe('Buffalo permits', () => {
  const items = parseSocrata(fx('buffalo'), sds('socrata-buffalo-permits'));
  it('an applicant company is kept; a person applicant is not; the licence number is never stored; no site (street name only)', () => {
    expect(brief(items[0])).toEqual([['business', 'Buffalo Electric Co', null, null]]);
    expect(items[1].contacts).toBeUndefined();
    absent(items, ['E-1234', 'E-4321', 'Whitfield']);
  });
  it('job value in the summary', () => expect(items[0].summary).toContain('$4,500 job value'));
});

describe('Seattle permits', () => {
  const items = parseSocrata(fx('seattle'), sds('socrata-seattle-permits'));
  it('contractor company and site; the word OWNER in the company column gives nothing', () => {
    expect(brief(items[0])).toEqual([['site', '', '1234 5TH AVE', null], ['contractor', 'Rainier Roofing Company', null, null]]);
    expect(brief(items[1])).toEqual([['site', '', '500 NE 65TH ST', null]]);
  });
  it('job value in the summary', () => expect(items[0].summary).toContain('$12,000 job value'));
});

describe('Baton Rouge permits', () => {
  const items = parseSocrata(fx('batonrouge'), sds('socrata-batonrouge-permits'));
  it('contractor, owner LLC; the applicant that is the same company is not stored twice', () => {
    expect(brief(items[0])).toEqual([
      ['site', '', '2100 Perkins Rd', null],
      ['contractor', 'Capital Area Roofing LLC', null, null],
      ['business', 'Westside Partners LLC', null, null],
    ]);
  });
  it('person contractor, owner and applicant give nothing', () => {
    expect(brief(items[1])).toEqual([['site', '', '455 Highland Rd', null]]);
    absent([items[1]], ['Landry', 'Robert']);
  });
  it('job value in the summary', () => expect(items[0].summary).toContain('$16,000 job value'));
});

describe('Raleigh permits (ArcGIS)', () => {
  const items = parseArcgis(fx('raleigh'), ads('arcgis-raleigh-permits'));
  it('contractor company with its business phone, corporate parcel owner, and the site', () => {
    expect(brief(items[0])).toEqual([
      ['site', '', '3401 Hillsborough St', null],
      ['contractor', 'Metro Roofing & Restoration Inc', null, '919-555-0150'],
      ['business', 'Lakeview Investments LLC', null, null],
    ]);
  });
  it('a sole trader (person name, DBA with the same surname) gives no company and its phone is not stored', () => {
    expect(brief(items[1])).toEqual([['site', '', '812 Wake Forest Rd', null]]);
    absent(items, ['919-555-0123', 'Greene', 'Thomas']);
  });
  it('licence numbers are not stored', () => absent(items, ['12345', 'L-998']));
  it('the query asks for the contact columns', () => {
    const f = buildArcgisQuery(ads('arcgis-raleigh-permits')).get('outFields')!.split(',');
    for (const c of ['contractorcompanyname', 'contractordba', 'contractorphone', 'parcelownername']) expect(f).toContain(c);
  });
});

describe('DeKalb permits (ArcGIS)', () => {
  const items = parseArcgis(fx('dekalb'), ads('arcgis-dekalb-permits'));
  it('a company primary contact is kept with its phone (contractor type gives role contractor); the email is never stored', () => {
    expect(brief(items[0])).toEqual([['site', '', '2540 Candler Rd', null], ['contractor', 'Peachtree Heating & Air LLC', null, '404-555-0142']]);
    absent(items, ['peachtreeheating.example', '@']);
  });
  it('a person primary contact gives no company, no phone, no email', () => {
    expect(brief(items[1])).toEqual([['site', '', '101 Clairemont Ave', null]]);
    absent(items, ['404-555-0177', 'latoya', 'Brown']);
  });
  it('a company owner without a contractor type is a business contact', () => {
    expect(brief(items[2])).toEqual([['site', '', '330 Memorial Dr', null], ['business', 'Decatur Rental Holdings LLC', null, '404-555-0188']]);
  });
  it('two valuation columns print one job value: the first non-zero one, in config order', () => {
    expect(items[0].summary).toContain('$8,500 job value');
    expect(items[0].summary).not.toContain('$9,000');
    expect(items[1].summary).toContain('$5,200 job value');
    expect(items[2].summary).not.toMatch(/job value/);
  });
  it('the email column is not requested from the layer', () => {
    const f = buildArcgisQuery(ads('arcgis-dekalb-permits')).get('outFields')!.split(',');
    expect(f).not.toContain('primaryContactEMailAddress');
    for (const c of ['primaryContactName', 'primaryContactPhone', 'primaryContactType', 'calculatedValuation', 'declaredValuation']) expect(f).toContain(c);
  });
});

describe('DC permits (ArcGIS)', () => {
  const items = parseArcgis(fx('dc'), ads('arcgis-dc-permits'));
  it('applicant and owner companies are kept (one company named twice once); persons are not', () => {
    expect(brief(items[0])).toEqual([['site', '', '1400 U STREET', null], ['business', 'Pinnacle Roofing LLC', null, null], ['business', 'Northgate Partners LLC', null, null]]);
    expect(brief(items[1])).toEqual([['site', '', '612 CORCORAN ST', null]]);
    absent(items, ['Whitfield', 'Marcus']);
  });
});

describe('spec rules', () => {
  const socrata = Object.entries(CONTACT_SPECS).map(([id, s]) => [id, s] as const);
  const arcgis = Object.entries(ARCGIS_CONTACT_SPECS).map(([id, s]) => [id, s] as const);
  it('every spec belongs to a configured dataset and is attached to it; Socrata verifiedUrl is the portal metadata URL', () => {
    for (const [id, s] of socrata) expect(sds(id).contacts, id).toBe(s);
    for (const [id, s] of arcgis) {
      expect(ads(id).contacts, id).toBe(s);
      expect(s.verifiedUrl, id).toBe(ads(id).verifiedUrl);
    }
    for (const [id, s] of socrata) expect(s.verifiedUrl).toBe(`https://${sds(id).domain}/api/views/${sds(id).datasetId}.json`);
  });
  it('no spec reads a person-name, e-mail, description or comment column, and owner/applicant columns only as organisation names', () => {
    const never = /first_?name|last_?name|full_?name|e-?mail|desc|comment|requestor|complainant|tenant|homeowner/i;
    const nameOnly = /owner|applicant/i;
    for (const [id, s] of [...socrata, ...arcgis]) {
      const nonName = [
        ...(s.site?.addressFields ?? []), s.site?.cityField, s.site?.stateField, s.site?.zipField,
        ...(s.orgs ?? []).flatMap((o) => [...(o.addressFields ?? []), o.cityField, o.stateField, o.zipField, o.phoneField, o.typeField]),
        ...(s.typedContractors?.pairs ?? []).flatMap((p) => [p.typeField, p.cityField, p.stateField, p.zipField]),
      ].filter(Boolean) as string[];
      const names = [...(s.orgs ?? []).flatMap((o) => o.nameFields), ...(s.typedContractors?.pairs ?? []).map((p) => p.nameField)];
      for (const c of nonName) expect(nameOnly.test(c), `${id} reads ${c} as a non-name column`).toBe(false);
      for (const c of [...nonName, ...names]) expect(never.test(c), `${id} reads ${c}`).toBe(false);
    }
  });
  it('an owner or applicant column is never a phone column, so no homeowner phone can be stored', () => {
    for (const [id, s] of [...socrata, ...arcgis]) for (const o of s.orgs ?? []) if (o.phoneField) expect(/owner|applicant/i.test(o.phoneField), `${id} ${o.phoneField}`).toBe(false);
  });
  it('the Mecklenburg owner columns are not read', () => {
    expect(contactSpecFields(ARCGIS_CONTACT_SPECS['arcgis-mecklenburg-permits']).join(',')).not.toMatch(/owner/i);
  });
  it('no 311, violation or event dataset has a spec', () => {
    for (const d of [...SOCRATA_DATASETS, ...ARCGIS_DATASETS]) if (['311', 'violation', 'event-permit'].includes(d.subtype)) expect(d.contacts, d.id).toBeUndefined();
  });
});

describe('extractContacts: a company named in two columns is one contact; the type column never decides company vs person', () => {
  const spec = {
    verifiedUrl: 'test', checkedOn: '2026-11-22',
    orgs: [
      { role: 'business' as const, nameFields: ['n'], phoneField: 'p', typeField: 't', contractorTypes: /contract/i },
      { role: 'business' as const, nameFields: ['m'] },
    ],
  };
  const run = (r: Record<string, string>) => extractContacts((f) => r[f] ?? '', spec, { city: 'Atlanta', state: 'GA' }, 'permit');
  it('same company twice', () => expect(run({ n: 'Apex Roofing Co', m: 'APEX ROOFING CO', t: 'Contractor', p: '404-555-0142' }).map((c) => [c.role, c.phone])).toEqual([['contractor', '404-555-0142']]));
  it('type "Contractor" on a person gives nothing and no phone', () => expect(run({ n: 'Latoya Brown', t: 'Contractor', p: '404-555-0177' })).toEqual([]));
});
