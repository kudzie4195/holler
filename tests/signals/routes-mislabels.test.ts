/**
 * Round 18 ROUTES, item 5: permit titles whose kind is wrong, found in the repo's real-row fixtures (tests/signals/__data__
 * review-f-sample-156.json and quality-gate-r15-cards.json: read-only selects of holler_signals). Each fixed pattern has at least two real
 * rows below. The stored rows keep their old titles (CAT_V is not raised, so nothing a member holds is re-mapped); the fix applies to new
 * ingests.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyPermit } from '@/lib/signals/mapping/permit';
import { CAT_V } from '@/lib/signals/mapping/version';
import { summaryParts } from '@/lib/signals/permit-routing';
import { parseSocrata } from '@/lib/signals/adapters/socrata';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';

type SampleRow = [number, string, string, string, string, string[]];
const SAMPLE = JSON.parse(readFileSync(join(__dirname, '__data__/review-f-sample-156.json'), 'utf8')) as SampleRow[];
const GRADED = (JSON.parse(readFileSync(join(__dirname, '__data__/quality-gate-r15-cards.json'), 'utf8')) as { cards: Array<{ signal: { id: number; title: string; summary: string } }> }).cards.map((c) => c.signal);
const row = (id: number) => {
  const r = SAMPLE.find((x) => x[0] === id);
  if (r) return { id, source: r[1], title: r[2], summary: r[3] };
  const g = GRADED.find((x) => x.id === id);
  if (!g) throw new Error(`no row ${id}`);
  return g;
};
/** The record's own structured type, class and use, as its public summary stores them. */
const structured = (id: number) => summaryParts(row(id).summary);

describe('pattern A: a bare "New" work class beside a trade permit type read as "New construction" (4 real rows)', () => {
  const cases: Array<[number, string, string]> = [
    [67436, 'New construction and concrete', 'Concrete'], // Austin "Driveway / Sidewalks | New"
    [59461, 'New construction and HVAC', 'HVAC'], // Norfolk "Mechanical | New"
    [3950, 'New construction and electrical', 'Electrical'], // Orlando "Electrical | New"
    [67412, 'New home and electrical', 'Electrical'], // Austin "Electrical Permit | New" (structured fields alone)
  ];
  it.each(cases)('row %i was titled "%s"; its structured fields now give "%s"', (id, before, after) => {
    expect(row(id).title.startsWith(before)).toBe(true);
    const c = classifyPermit({ structured: structured(id) }, 'X');
    expect(c.label).toBe(after);
    expect(c.categories).not.toContain('general-contractor');
  });
  it('at ingest, through the real Norfolk adapter: a "Mechanical | New" permit is an HVAC permit, not new construction', () => {
    const ds = SOCRATA_DATASETS.find((d) => d.id === 'socrata-norfolk-permits')!;
    const out = parseSocrata(
      [{ permit_number: 'M-1', status: 'Issued', type: 'Mechanical', work_type: 'New', use_type: 'Single Family Dwelling', issue_date: '2026-11-18T00:00:00.000', address: '8494 LYNN RIVER ROAD', latitude: '36.9', longitude: '-76.2' }],
      ds,
    );
    expect(out[0].title).toBe('HVAC permit in Norfolk');
    expect(out[0].categories).toEqual(['hvac']);
  });
  it('a real new building keeps New construction: "New", "Building Permit | New", "New Building Permit (R)", "New | Industrial"', () => {
    for (const id of [37543, 107903, 92549, 117072]) expect(classifyPermit({ structured: structured(id) }, 'X').label).toBe('New construction');
    // A description of a new house still makes "New" a new home (round 7 rule, unchanged).
    expect(classifyPermit({ structured: ['Building Permit', 'New'], free: ['new single family residence'] }, 'X').label).toBe('New home');
    expect(classifyPermit({ structured: ['Electrical Permit', 'New'], free: ['new single family residence'] }, 'X').label).toBe('New home and electrical');
  });
});

describe('pattern H: an alteration permit titled "Demolition" because its description mentions demolition (3 real rows)', () => {
  // The stored rows keep only the structured type (an alteration); their title says Demolition, which the structured type alone never
  // gives, so the demolition kind came from the description. The description itself is not stored: "interior demolition" below stands
  // in for it (assumed wording, the shape is what matters).
  const cases: Array<[number, string]> = [
    [1576, 'otc alterations permit'], // San Francisco, $1
    [133169, 'otc alterations permit'], // San Francisco, $600,000
    [134445, 'Alter Commercial'], // Cincinnati
  ];
  it.each(cases)('row %i (%s) was a "Demolition permit"; with a demolition word in its description it is now a remodel', (id) => {
    expect(row(id).title.startsWith('Demolition permit')).toBe(true);
    const c = classifyPermit({ structured: structured(id), free: ['interior demolition of kitchen and bath'] }, 'X');
    expect(c.label).toBe('Remodel');
    expect(c.categories).not.toContain('junk-removal');
  });
  it('a real demolition permit stays a demolition: "Bldg-Demolition", "Commercial Demolition", "Demolition Permit (R)"', () => {
    for (const id of [2577, 72177, 92520, 3192]) expect(classifyPermit({ structured: structured(id), free: ['demolish structure'] }, 'X').label).toBe('Demolition');
  });
  it('named trades in the description still come through ("demo and new plumbing" is a plumbing permit)', () => {
    expect(classifyPermit({ structured: ['otc alterations permit'], free: ['demo and new plumbing'] }, 'X').label).toBe('Plumbing');
  });
});

describe('the two known examples stay fixed (round 15 rules, regression)', () => {
  it('a sidewalk shed or a site-safety plan carries no trade, whatever the description says (real rows 107318, 9618, 775, 9370, 1128)', () => {
    for (const id of [107318, 9618, 775, 9370, 1128]) {
      expect(classifyPermit({ structured: structured(id), free: ['sidewalk shed for roof and window work, new hvac'] }, 'X').categories).toEqual([]);
    }
  });
  it('an alteration, addition or accessory structure is never a new home (real rows 2988, 58842, 60470, 55448)', () => {
    for (const id of [2988, 58842, 60470, 55448]) {
      const c = classifyPermit({ structured: structured(id), free: ['new single family dwelling'] }, 'X');
      expect(c.label).not.toMatch(/new home|new construction/i);
    }
  });
});

describe('stored rows are not re-mapped', () => {
  it('CAT_V stays 3: the fix reaches new ingests only, so no card a member holds is re-labelled or removed', () => {
    expect(CAT_V).toBe(3);
  });
});
