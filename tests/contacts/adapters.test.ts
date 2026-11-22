/**
 * Contact extraction per adapter. Each fixture row (tests/contacts/fixtures/*-contacts.json, hand written in the shape of the columns
 * read from the portal metadata on 2026-11-17) carries an owner or applicant name, an owner or applicant phone and a contractor or
 * business company: only the company and the site address may come out, and nothing personal may appear anywhere in the SignalInput.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSocrata } from '@/lib/signals/adapters/socrata';
import { buildArcgisQuery, parseArcgis } from '@/lib/signals/adapters/arcgis';
import { parseUsaSpending } from '@/lib/signals/adapters/usaspending';
import { CONTACT_SPECS, SOCRATA_DATASETS, type SocrataDataset } from '@/lib/signals/adapters/socrata-datasets';
import { ARCGIS_DATASETS, type ArcgisDataset } from '@/lib/signals/adapters/arcgis-datasets';
import type { SignalInput } from '@/lib/signals/types';

const fx = (n: string): unknown => JSON.parse(readFileSync(join(__dirname, 'fixtures', n), 'utf8'));
const ds = (id: string): SocrataDataset => SOCRATA_DATASETS.find((d) => d.id === id)!;
const all = (items: SignalInput[]) => JSON.stringify(items).toLowerCase();

function expectAbsent(items: SignalInput[], needles: string[]) {
  const hay = all(items);
  for (const n of needles) expect(hay.includes(n.toLowerCase()), `found "${n}" in the output`).toBe(false);
}

describe('Chicago permits (contact_N_type / contact_N_name pairs)', () => {
  const items = parseSocrata(fx('socrata-chicago-permits-contacts.json'), ds('socrata-chicago-permits'));
  it('keeps only contractor-type companies and the exact job site', () => {
    expect(items).toHaveLength(2);
    // FIX-E: "NORTH BRANCH ARCHITECTS LTD" fails the strict rule R10 ("BRANCH", a listed surname, right after the known word "NORTH").
    // Round 18 (NAMES): a contractor-type column uses the trade-name rule, and a final legal form (LTD) is a business marker, so it is named.
    expect(items[0].contacts).toEqual([
      { role: 'site', name: '', attn: null, address: '2150 N DAMEN', city: 'Chicago', state: 'IL', zip: null, phone: null, email: null, website: null },
      { role: 'contractor', name: 'LAKEFRONT ROOFING & SIDING INC', attn: null, address: null, city: null, state: 'IL', zip: '60076', phone: null, email: null, website: null }, // FIX-F (review4 P2-13): city only when it is the dataset city
      { role: 'contractor', name: 'NORTH BRANCH ARCHITECTS LTD', attn: null, address: null, city: 'CHICAGO', state: 'IL', zip: '60622', phone: null, email: null, website: null },
    ]);
  });
  it('drops owner, owner-as-contractor, tenant, applicant and expediter types, and a contractor that is a person', () => {
    expectAbsent(items, ['HOMEOWNER', 'OWNERBUILDER', 'TENANT HOLDINGS', 'PERMIT RUNNERS', 'DESHAWN', 'SPARKS', 'SMITH, JANE', 'TOM ELECTRICIAN', '773-555-0187', '7735550187', 'john.homeowner@example.com']);
    expect(items[1].contacts).toEqual([
      { role: 'site', name: '', attn: null, address: '4410 W ADDISON', city: 'Chicago', state: 'IL', zip: null, phone: null, email: null, website: null },
    ]);
  });
  it('contractor names never reach the public title, summary or data (the street address in the summary is today\'s behaviour)', () => {
    for (const s of items) {
      expect(`${s.title} ${s.summary ?? ''} ${JSON.stringify(s.data)}`).not.toMatch(/LAKEFRONT|ARCHITECTS|SKOKIE|60076/);
    }
  });
});

describe('Austin permits (contractor_company_name)', () => {
  const items = parseSocrata(fx('socrata-austin-permits-contacts.json'), ds('socrata-austin-permits'));
  it('round 18: "Lone Star Roofing LLC" (refused by the strict rule since FIX-C, "Star" is a listed given name) is a trade name in the contractor column', () => {
    expect(items).toHaveLength(3);
    expect(items[0].contacts).toEqual([
      { role: 'site', name: '', attn: null, address: '4812 AVENUE H', city: 'AUSTIN', state: 'TX', zip: '78751', phone: null, email: null, website: null },
      {
        role: 'contractor', name: 'Lone Star Roofing LLC', attn: null, address: '1200 W Ben White Blvd Ste 200', city: 'AUSTIN', state: null, zip: '78704',
        phone: '512-555-0142', email: null, website: null,
      },
    ]);
  });
  it('keeps the contractor company with its business phone and address, and the job site; an address line with a person is dropped', () => {
    expect(items[2].contacts).toEqual([
      { role: 'site', name: '', attn: null, address: '1500 E RIVERSIDE DR', city: 'AUSTIN', state: 'TX', zip: '78741', phone: null, email: null, website: null },
      {
        role: 'contractor', name: 'Lone Oak Roofing LLC', attn: null, address: '1200 W Ben White Blvd', city: 'AUSTIN', state: null, zip: '78704',
        phone: '512-555-0142', email: null, website: null,
      },
    ]);
  });
  it('a contractor company column holding a person gives no contractor (and no phone), the site stays', () => {
    expect(items[1].contacts).toEqual([
      { role: 'site', name: '', attn: null, address: '907 E 46TH ST', city: 'AUSTIN', state: 'TX', zip: '78751', phone: null, email: null, website: null },
    ]);
  });
  it('applicant name and phone, contractor full name and the person-run company never appear anywhere', () => {
    expectAbsent(items, ['Jane Applicant', '512-555-0177', '5125550177', 'Contractorperson', 'Billy Ray', 'Ricky Gomez', '512-555-0110', '88 HOME ST', 'JOHN SMITH', '512-555-0199']);
  });
});

describe('Chicago food inspections (dba_name)', () => {
  const items = parseSocrata(fx('socrata-chicago-inspections-contacts.json'), ds('socrata-chicago-inspections'));
  it('a business establishment gives the business and its address', () => {
    expect(items).toHaveLength(3);
    // FIX-E input change: "HALSTED STREET PIZZERIA" now fails R10 ("HALSTED" starts with the listed given name "HAL"), so the fixture
    // row uses "SUMMIT STREET PIZZERIA" to keep this path covered.
    expect(items[2].contacts).toEqual([
      { role: 'site', name: '', attn: null, address: '1550 N HALSTED ST', city: 'CHICAGO', state: 'IL', zip: '60642', phone: null, email: null, website: null },
      { role: 'business', name: 'SUMMIT STREET PIZZERIA', attn: null, address: null, city: null, state: null, zip: null, phone: null, email: null, website: null },
    ]);
  });
  it('FIX-C: "JOES TACO SHACK" is no longer an organisation ("Taco" is a listed given name): no contact, not even the address', () => {
    expect(items[0].contacts).toBeUndefined();
  });
  it('a home daycare under a person name gives no contact at all, not even the address', () => {
    expect(items[1].contacts).toBeUndefined();
  });
});

describe('Austin food inspections (restaurant_name)', () => {
  const items = parseSocrata(fx('socrata-austin-inspections-contacts.json'), ds('socrata-austin-inspections'));
  it('business plus site for an establishment, nothing for a person-named row', () => {
    expect(items).toHaveLength(2);
    expect(items[0].contacts?.map((c) => [c.role, c.name, c.address, c.city, c.state, c.zip])).toEqual([
      ['site', '', '1107 E 7th St', 'Austin', 'TX', '78702'],
      ['business', 'Taqueria Lopez', null, null, null, null], // FIX-C: a trailing store number is stripped (R1); FIX-E input: was "Taqueria Arandas #3" (now fails R10)
    ]);
    expect(items[1].contacts).toBeUndefined();
  });
});

describe('Chicago new business licences (doing_business_as_name, then legal_name)', () => {
  const items = parseSocrata(fx('socrata-chicago-business-contacts.json'), ds('socrata-chicago-business'));
  it('a business DBA gives the business and its address', () => {
    expect(items[0].contacts?.map((c) => [c.role, c.name, c.address, c.zip])).toEqual([
      ['site', '', '1840 W DIVISION ST', '60622'],
      ['business', 'SUMMIT CITY CAFE', null, null], // FIX-E input: was "WINDY CITY CAFE" ("windy" is a listed given name now)
    ]);
  });
  it('a person as DBA and legal name gives nothing, and the home address stays out', () => {
    expect(items[1].contacts).toBeUndefined();
    expectAbsent([items[1]], ['Olga', 'TORRES', '2318 W 47TH']);
  });
  it('FIX-C: a person DBA with a legal name that starts with the person gives nothing (the sole-trader allowance is withdrawn)', () => {
    expect(items[2].contacts).toBeUndefined();
    expectAbsent([items[2]], ['REGINALD', 'CHAPPEL']);
  });
  it('a person DBA with an organisation legal name keeps only the company', () => {
    expect(items[3].contacts?.map((c) => [c.role, c.name])).toEqual([
      ['site', ''],
      ['business', 'APEX HOME REMODELING LLC'], // FIX-E input: was "NORTHSIDE HOME IMPROVEMENT LLC" (two unknown words)
    ]);
    expect(JSON.stringify(items[3].contacts)).not.toMatch(/DARNELL|SPARKS/);
  });
  it('business titles and summaries still carry no name and no street address', () => {
    for (const s of items) expect(`${s.title} ${s.summary ?? ''} ${JSON.stringify(s.data)}`).not.toMatch(/SUMMIT|TORRES|Olga|REGINALD|DIVISION|47TH|CHAPPEL|APEX|DARNELL|SPARKS|CLARK/i);
  });
});

describe('USAspending awards (Recipient Name)', () => {
  const items = parseUsaSpending(fx('usaspending-awards-contacts.json'));
  it('a company recipient becomes the awardee; a person recipient gives no contact', () => {
    expect(items).toHaveLength(2);
    expect(items[0].contacts).toEqual([
      { role: 'awardee', name: 'ACME FACILITY SERVICES LLC', attn: null, address: null, city: null, state: null, zip: null, phone: null, email: null, website: null },
    ]);
    expect(items[1].contacts).toBeUndefined();
  });
});

describe('ArcGIS: contact specs (round 15) are explicit, labelled and never ask for owner columns', () => {
  const WITH_SPEC = [
    'arcgis-atlanta-permits', 'arcgis-cobb-commercial-permits', 'arcgis-cobb-multiunit-permits', 'arcgis-cobb-residential-permits',
    'arcgis-dc-permits', 'arcgis-dekalb-permits', 'arcgis-mecklenburg-permits', 'arcgis-raleigh-permits',
  ];
  it('exactly the permit layers named in PLAN-2.0 1.2 and 1.3 carry a spec; no violation, 311 or business layer does', () => {
    expect(ARCGIS_DATASETS.filter((d) => d.contacts).map((d) => d.id).sort()).toEqual(WITH_SPEC);
    for (const d of ARCGIS_DATASETS) if (d.subtype !== 'permit') expect(d.contacts, d.id).toBeUndefined();
    for (const d of ARCGIS_DATASETS.filter((x) => x.contacts)) expect(['sourced', 'assumed'], d.id).toContain(d.contacts!.fieldStatus);
  });
  it('the query asks for the contractor column, never an owner column; with an allow-list only fields the layer has are asked for', () => {
    const raleigh = ARCGIS_DATASETS.find((d) => d.id === 'arcgis-raleigh-permits')!;
    const all = buildArcgisQuery(raleigh, new Date('2026-11-17T00:00:00Z')).get('outFields')!;
    expect(all).toContain('contractorcompanyname');
    expect(all).toContain('contractorlicnum');
    expect(all).not.toMatch(/owner|contractorfullname/i);
    const only = buildArcgisQuery(raleigh, new Date('2026-11-17T00:00:00Z'), new Set(['contractorcompanyname'])).get('outFields')!;
    expect(only).toContain('contractorcompanyname');
    expect(only).not.toContain('contractorphone');
    expect(only).not.toContain('contractorlicnum');
    expect(only).toContain('permitnum');
  });
  it('a TEST-ONLY spec (hypothetical columns) extracts the company and the site, never the owner', () => {
    const base = ARCGIS_DATASETS.find((d) => d.id === 'arcgis-raleigh-permits')!;
    const test: ArcgisDataset = {
      ...base,
      contacts: {
        verifiedUrl: 'test-only', checkedOn: '2026-11-17',
        site: { addressFields: ['originaladdress1'], zipField: 'originalzip' },
        orgs: [{ role: 'contractor', nameFields: ['contractorcompanyname'], phoneField: 'contractorphone' }],
      },
    };
    expect(buildArcgisQuery(test).get('outFields')).toContain('contractorcompanyname');
    const items = parseArcgis(fx('arcgis-synthetic-contacts.json'), test);
    expect(items).toHaveLength(1);
    expect(items[0].contacts?.map((c) => [c.role, c.name, c.address, c.phone])).toEqual([
      ['site', '', '100 TEST ST', null],
      ['contractor', 'Summit Roofing Co.', null, '919-555-0150'], // FIX-E input: was "Triangle Roofing Co." (now fails R10)
    ]);
    expectAbsent(items, ['PERSONNAME', '919-555-0123']);
    // and the public part is identical with or without the spec
    const plain = parseArcgis(fx('arcgis-synthetic-contacts.json'), { ...base, contacts: undefined });
    const { contacts: _c, ...pub } = items[0];
    void _c;
    expect(pub).toEqual(plain[0]);
  });
});

describe('contact specs: only verified datasets, only explicit company columns', () => {
  it('every dataset with a spec has its portal metadata URL as verifiedUrl, and is the same object as CONTACT_SPECS', () => {
    const withSpec = SOCRATA_DATASETS.filter((d) => d.contacts).map((d) => d.id).sort();
    // The five of round 5, the permit feeds of round 15 (PLAN-2.0 1.2 and 1.3), and round 18: the four other business-licence feeds
    // (the business on the licence is the prospect) and two code-violation feeds (owner company only).
    expect(withSpec).toEqual([
      'socrata-austin-inspections', 'socrata-austin-permits', 'socrata-austin-violations', 'socrata-batonrouge-permits', 'socrata-buffalo-permits',
      'socrata-cambridge-permits', 'socrata-chicago-business', 'socrata-chicago-inspections', 'socrata-chicago-permits', 'socrata-chicago-violations',
      'socrata-cincinnati-permits', 'socrata-dallas-permits', 'socrata-la-business', 'socrata-la-permits', 'socrata-montgomery-permits',
      'socrata-nola-permits', 'socrata-norfolk-permits', 'socrata-nyc-business', 'socrata-nyc-permits', 'socrata-orlando-business',
      'socrata-orlando-permits', 'socrata-seattle-permits', 'socrata-sf-business', 'socrata-sf-permits',
    ]);
    for (const id of withSpec) {
      const d = ds(id);
      expect(d.contacts!.verifiedUrl, id).toMatch(/^https:\/\//);
      expect(CONTACT_SPECS[id]).toBe(d.contacts);
    }
  });
  it('no 311, event or other no-contact feed has a spec; a violation spec names only an owner company column (round 18)', () => {
    for (const d of SOCRATA_DATASETS) if (['311', 'event-permit'].includes(d.subtype)) expect(d.contacts, d.id).toBeUndefined();
    for (const d of SOCRATA_DATASETS.filter((x) => x.subtype === 'violation' && x.contacts)) {
      const spec = d.contacts!;
      expect(spec.site, d.id).toBeUndefined();
      expect(spec.typedContractors, d.id).toBeUndefined();
      for (const o of spec.orgs ?? []) {
        expect(o.role, d.id).toBe('owner');
        expect([o.phoneField, ...(o.phoneFields ?? []), ...(o.licenseFields ?? []), ...(o.addressFields ?? []), o.cityField, o.zipField].filter(Boolean), d.id).toEqual([]);
      }
    }
  });
  it('no spec names an owner, applicant, tenant, description or personal full-name column (an owner-company column only with role owner)', () => {
    const bad = /owner|applicant|tenant|desc|full_name|first_name|last_name|comment|requestor|complainant/i;
    for (const [id, spec] of Object.entries(CONTACT_SPECS)) {
      const cols = [
        ...(spec.site?.addressFields ?? []), spec.site?.cityField, spec.site?.stateField, spec.site?.zipField,
        ...(spec.orgs ?? []).flatMap((o) => [...(o.role === 'owner' ? [] : o.nameFields), ...(o.addressFields ?? []), o.cityField, o.stateField, o.zipField, o.phoneField]),
        ...(spec.typedContractors?.pairs ?? []).flatMap((p) => [p.typeField, p.nameField, p.cityField, p.stateField, p.zipField]),
      ].filter(Boolean) as string[];
      for (const c of cols) expect(bad.test(c), `${id} reads ${c}`).toBe(false);
    }
  });
  it('Chicago type filter: contractor-like accepted, owner-like and others refused', () => {
    const t = CONTACT_SPECS['socrata-chicago-permits'].typedContractors!;
    const ok = (v: string) => t.acceptType.test(v) && !t.rejectType.test(v);
    for (const v of ['ELECTRICAL CONTRACTOR', 'CONTRACTOR-GENERAL CONTRACTOR', 'SELF CERT ARCHITECT', 'ARCHITECT', 'MASONRY CONTRACTOR', 'STRUCTURAL ENGINEER', 'CONTRACTOR-PLUMBER/PLUMBING', 'SIGN CONTRACTOR', 'MASON - BRICK ONLY', 'OTHER SUBCONTRACTOR (VENTILATION)'])
      expect(ok(v), v).toBe(true);
    for (const v of ['OWNER', 'OWNER AS GENERAL CONTRACTOR', 'OWNER OCCUPIED', 'BUILDING OWNER', 'OWNER AS ARCHITECT & CONTRACTR', 'OWNER AS ARCHITECT', 'EXPEDITOR', 'EXPEDITER', 'APPLICANT', 'WEB APPLICANT', 'TENANT', 'PRIMARY', 'RESIDENTAL REAL ESTATE DEV', 'CONSCNT', 'HEAT'])
      expect(ok(v), v).toBe(false);
  });
});
