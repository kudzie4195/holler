/**
 * P0 privacy: permit free text (descriptions typed by applicants) holds homeowner names, phone numbers, emails and links.
 * The first seven descriptions are real rows from the 2026-11-17 live dry-run; type values and ids are hand written (assumed).
 */
import { describe, expect, it } from 'vitest';
import { parseSocrata } from '@/lib/signals/adapters/socrata';
import { parseArcgis } from '@/lib/signals/adapters/arcgis';
import { permitTitle, publicSummary, scrubText, typeLabel } from '@/lib/signals/adapters/permit-privacy';
import { SOCRATA_DATASETS, NEW_HOME_RE, type SocrataDataset } from '@/lib/signals/adapters/socrata-datasets';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import { classifyText } from '@/lib/signals/categories';
import type { SignalInput } from '@/lib/signals/types';

const ds = (id: string): SocrataDataset => SOCRATA_DATASETS.find((d) => d.id === id)!;

const FORBIDDEN = ['Caleb', 'Susan', 'Leger', 'Edgar', 'Young', '813-0256'];

interface Case { id: string; row: Record<string, string>; titleRe: RegExp }
const D = '2026-11-16T00:00:00.000';
const CASES: Case[] = [
  {
    id: 'socrata-batonrouge-permits',
    row: { permitnumber: 'BR1', issueddate: D, projectdescription: 'Residential home for Caleb & Susan Leger', permittype: 'New Residential', designation: 'Residential', lat: '30.45', long: '-91.15' },
    titleRe: /^New home permit in Baton Rouge$/,
  },
  {
    id: 'socrata-nola-permits',
    row: { numstring: 'NO1', issuedate: D, description: 'Install 3-ton HVAC system with electric air handler and condenser unit. Edgar Young 813-0256.', type: 'Mechanical', projectname: 'Edgar Young 813-0256' },
    titleRe: /^HVAC permit in New Orleans$/,
  },
  {
    id: 'socrata-nola-permits',
    row: { numstring: 'NO2', issuedate: D, description: 'Install 100 amp temp pole. Edgar Young 813-0256.', type: 'Electrical Permit' },
    titleRe: /^Electrical permit in New Orleans$/,
  },
  {
    id: 'socrata-montgomery-permits',
    row: { permitno: 'MC1', issueddate: D, description: 'Customer Wants To Use ePlans,Construct new detached single family home HOUSE- 7341 PORCHES- 427RETAINING WALL', worktype: 'Construct', applicationtype: 'RESIDENTIAL' },
    titleRe: /^New home permit in Montgomery County$/,
  },
  {
    id: 'socrata-nyc-permits',
    row: { work_permit: 'NY1', issued_date: D, job_description: 'Filing herewith interior renovation on 12th floor, The Hudson Companies, Inc. No change in use, egress or occupancy.', work_type: 'Plumbing', latitude: '40.7', longitude: '-74.0' },
    titleRe: /^Plumbing permit in New York City$/,
  },
  {
    id: 'socrata-sf-permits',
    row: { permit_number: 'SF1', issued_date: D, description: 'replace three windows front facade house size for size with jeld-wen premium wood clad, 0.28 u-factor. same as existing', permit_type_definition: 'otc alterations permit' },
    titleRe: /^Window and door permit in San Francisco$/,
  },
  {
    id: 'socrata-chicago-permits',
    row: { permit_: 'CH1', issue_date: D, work_description: 'SCOPE: ROOF REPLACEMENT. AREA: 1247 SQ. FT. ROOF COVERING: ASPHALT SHINGLES. LOCATION: HOUSE AND GARAGE.', permit_type: 'PERMIT - RENOVATION/ALTERATION', latitude: '41.9', longitude: '-87.6' },
    titleRe: /^Roof permit in Chicago$/,
  },
];

function parseOne(c: Case, overrides: Record<string, string> = {}): SignalInput[] {
  return parseSocrata([{ ...c.row, ...overrides }], ds(c.id));
}
const stored = (s: SignalInput) => JSON.stringify([s.title, s.summary, s.data]);

describe('real live-run examples never leak names or phones', () => {
  CASES.forEach((c, i) => {
    it(`case ${i + 1}: ${c.id}`, () => {
      const out = parseOne(c);
      expect(out).toHaveLength(1);
      const s = out[0];
      expect(s.title).toMatch(c.titleRe);
      expect(s.title.length).toBeLessThanOrEqual(60);
      for (const w of FORBIDDEN) expect(stored(s)).not.toContain(w);
      expect(s.title).not.toMatch(/New permit in/);
      expect(Object.keys(s.data ?? {}).sort()).toEqual(['dataset', 'domain', 'subtype']);
      if (s.summary) expect(s.summary.length).toBeLessThanOrEqual(140);
    });
  });

  it('without a usable type column the title comes from the matched trade, from the original text', () => {
    const roof = parseOne(CASES[6], { permit_type: 'SCOPE: ROOF REPLACEMENT AREA 1247 SQ FT' });
    expect(roof[0].title).toBe('Roof permit in Chicago');
    expect(roof[0].categories).toContain('roofing');
    const hvac = parseOne(CASES[1], { type: 'see description of work for the hvac install' });
    expect(hvac[0].title).toBe('HVAC permit in New Orleans');
    expect(hvac[0].categories).toContain('hvac');
    const home = parseOne(CASES[0], { permittype: '', designation: '', projectdescription: 'New single family home for Caleb & Susan Leger' });
    expect(home[0].title).toBe('New home permit in Baton Rouge');
    expect(home[0].categories).toEqual(expect.arrayContaining(['real-estate', 'moving']));
    const none = parseOne(CASES[0], { permittype: '', designation: '', projectdescription: 'new house for Caleb' });
    expect(none[0].title).toBe('New home permit in Baton Rouge');
  });

  it('Hudson Companies is a business and may stay in text', () => {
    expect(scrubText('interior renovation, The Hudson Companies, Inc. No change in use')).toContain('Hudson Companies');
  });
});

describe('scrubText on adversarial strings', () => {
  const cases: [string, string[]][] = [
    ['Re-roof for John Smith (504) 813-0256', ['John', 'Smith', '813', '0256']],
    ['CALL MARY ANN JONES 504.813.0256 TO SCHEDULE', ['MARY', 'JONES', '0256']],
    ['Owner: Robert Lee Davis, ph 813 0256, install water heater', ['Robert', 'Davis', '0256']],
    ['water heater replacement. contact Linda Park at linda.park@gmail.com or 5048130256', ['Linda', 'Park', '@', '5048130256']],
    ['Deck repair c/o Tom & Jenny Alvarez see www.alvarezbuilds.com', ['Tom', 'Jenny', 'Alvarez', 'www.']],
    ['Customer Maria Gonzalez-Ruiz +1 504-813-0256 new fence', ['Maria', 'Gonzalez', '0256']],
    ['Attn: Dr. Priya Natarajan; panel upgrade 200 amp', ['Priya', 'Natarajan']],
    ['new furnace Edgar Young 813-0256', ['Edgar', 'Young', '0256']],
    ['813-0256 Edgar Young replace roof', ['Edgar', 'Young', '0256']],
    ['Homeowner Caleb Leger, applicant Susan Leger - see https://permits.example.org/x?id=5 for plans', ['Caleb', 'Susan', 'Leger', 'https', 'example']],
    ['Mrs. Alvarez requests solar panels, text 504 813 0256', ['Alvarez', '0256']],
  ];
  cases.forEach(([input, bad], i) => {
    it(`adversarial ${i + 1}`, () => {
      const out = scrubText(input);
      for (const b of bad) expect(out, `"${input}" -> "${out}"`).not.toContain(b);
      const sum = publicSummary([input]);
      for (const b of bad) expect(sum ?? '').not.toContain(b);
    });
  });

  it('keeps ordinary work text and business names', () => {
    expect(scrubText('Install 100 amp temp pole at rear of building')).toBe('Install 100 amp temp pole at rear of building');
    expect(scrubText('Roof replacement for ABC Roofing LLC')).toContain('ABC Roofing LLC');
  });
});

describe('summary rules', () => {
  it('cuts at a word boundary within 140 characters and drops fragments under 15', () => {
    const long = 'Replace roof covering and decking on main house and detached garage with architectural shingles and new underlayment across all slopes '.repeat(3);
    const s = publicSummary([long])!;
    expect(s.length).toBeLessThanOrEqual(140);
    expect(s.endsWith('...')).toBe(true);
    expect(publicSummary(['Roof for Bob Jones 813-0256'], { minChars: 15 })).toBeNull();
  });
});

describe('titles', () => {
  it('stay short and never carry free text', () => {
    expect(permitTitle('Norfolk', [], [], 'something unrelated')).toBe('Permit in Norfolk');
    expect(permitTitle('Austin', [], ['electrical'], 'panel')).toBe('Electrical permit in Austin');
    expect(permitTitle('Chicago', ['Customer Wants To Use ePlans, construct home'], ['roofing'], 'roof')).toBe('Roof permit in Chicago');
    expect(typeLabel('Commercial Air Conditioning')).toBe('Commercial Air Conditioning');
    expect(typeLabel('EDGAR YOUNG 813-0256')).toBeNull();
    const longCity = 'A Very Long County Name Region';
    expect(permitTitle(longCity, ['Additions to Existing Structures'], [], '').length).toBeLessThanOrEqual(60);
  });

  it('every permit fixture row across all datasets yields a short title', () => {
    for (const d of ARCGIS_DATASETS.filter((x) => x.subtype === 'permit')) {
      const row: Record<string, string> = { [d.idField]: 'x', [d.dateField]: String(Date.UTC(2026, 10, 16)) };
      for (const f of d.textFields) row[f] = 'Re-roof for Caleb Leger 813-0256';
      const out = parseArcgis({ features: [{ attributes: row }] }, d);
      for (const s of out) {
        expect(s.title.length).toBeLessThanOrEqual(60);
        expect(stored(s)).not.toMatch(/Caleb|Leger|813-0256/);
      }
    }
  });
});

describe('classification still reads the original text', () => {
  it('roof, HVAC and single family home', () => {
    expect(classifyText('SCOPE: ROOF REPLACEMENT. ASPHALT SHINGLES')).toContain('roofing');
    expect(classifyText('Install 3-ton HVAC system')).toContain('hvac');
    expect(NEW_HOME_RE.test('Construct new detached single family home')).toBe(true);
  });
});

describe('plainType', () => {
  it('drops city process jargon and keeps real work types', async () => {
    const { plainType } = await import('../../../lib/signals/adapters/permit-privacy');
    expect(plainType('Express Program')).toBeNull();
    expect(plainType('Post Card')).toBeNull();
    expect(plainType('Supplemental')).toBeNull();
    expect(plainType('Building Combo')).toBeNull();
    expect(plainType('Otc Alterations')).toBe('Alterations');
    expect(plainType('New')).toBe('New construction');
    expect(plainType('Construct')).toBe('New construction');
    expect(plainType('Demolition')).toBe('Demolition');
    expect(plainType('Residential Heating System')).toBe('Residential Heating System');
  });
});

describe('summaryPart', () => {
  it('formats money columns and rounds float noise', async () => {
    const { summaryPart } = await import('../../../lib/signals/adapters/permit-privacy');
    expect(summaryPart('estprojectcost', '3148.8000000000002')).toBe('$3,149 job value');
    expect(summaryPart('total_job_valuation', '450000')).toBe('$450,000 job value');
    expect(summaryPart('valuation', '0.0')).toBe('');
    expect(summaryPart('reported_cost', 'n/a')).toBe('');
    expect(summaryPart('total_square_feet', '1200.50000001')).toBe('1200.5');
    expect(summaryPart('score', '88')).toBe('88');
    expect(summaryPart('status', 'Issued')).toBe('Issued');
  });
});
