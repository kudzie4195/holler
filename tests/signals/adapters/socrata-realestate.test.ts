/**
 * verify.md P2-8: the real-estate and moving permit rule missed "New 1-story single family residence" and tagged a chicken barn and a
 * detached garage. The three descriptions below are live Austin rows quoted in the review (data.austintexas.gov 3syk-w9eu, 2026-11-17,
 * sourced); the other strings are hand written (assumed) to probe the rule's edges.
 */
import { describe, expect, it } from 'vitest';
import { parseSocrata } from '@/lib/signals/adapters/socrata';
import { NEW_HOME_RE, PERMIT_RULES, SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { TRADE_SIGNALS } from '@/lib/signals/capabilities';

const austin = SOCRATA_DATASETS.find((d) => d.id === 'socrata-austin-permits')!;
const row = (n: number, description: string, over: Record<string, unknown> = {}) => ({
  permit_number: `2026-${n}`, issue_date: '2026-11-14T00:00:00.000', description, permit_type_desc: 'Building Permit', work_class: 'New',
  permit_class_mapped: 'Residential', original_address1: '100 Test St', original_zip: '78701', latitude: '30.27', longitude: '-97.74', ...over,
});
const cats = (description: string, over: Record<string, unknown> = {}) => parseSocrata([row(1, description, over)], austin)[0]?.categories ?? [];

describe('real-estate and moving permit rule', () => {
  it('matches new residential construction (the live miss included)', () => {
    for (const d of [
      'New 1-story single family residence', // live Austin row the old rule missed
      'New single family home Two Apples Properties Lot 2 Custom Sealed Crawl Rear Covered Porch',
      'NEW SINGLE FAMILY DWELLING',
      'New two story townhouse',
      'New 12 unit apartment building',
      'New multi-family residential building',
      'New duplex',
      'Erect 3 story multi family building',
      'New condominium building',
      'New home',
      'New residential',
      // P2-4: a house that merely has a garage or carport is still a new house
      'New single family residence with detached garage',
      'NEW SFR W/ ATTACHED GARAGE',
      'Construct new single-family dwelling with attached 2 car garage',
      'NEW 2 STORY SFD',
      'New two story duplex',
    ]) {
      const c = cats(d);
      expect(c, d).toContain('real-estate');
      expect(c, d).toContain('moving');
    }
  });

  it('excludes agricultural and accessory structures and garages (the two live false positives)', () => {
    for (const d of [
      'New single story Chicken Barn accessory building', // live Austin row the old rule tagged
      'New single story detached 3 car garage', // live Austin row the old rule tagged
      'New accessory dwelling unit',
      'New pool for single family residence',
      'New shed in rear of single family residence',
      'New carport',
      'New barn',
      'New greenhouse for single family dwelling',
      'New residential solar PV system', // P2-4 live false positive
      'NEW DETACHED ACCESSORY DWELLING UNIT (ADU)',
    ]) {
      const c = cats(d);
      expect(c, d).not.toContain('real-estate');
      expect(c, d).not.toContain('moving');
    }
  });

  it('P2-4: live Austin new residential permits (fetched 2026-11-17, street addresses removed): 16 of 19 hit, the houses with a garage or carport included', () => {
    const live = [
      'ePlan: Residential Expedited Review - New construction of a 2-Story Single Family Res. [3bed 3bath] with Office...',
      'BLDG 2: New construction of a 3-Story Single Fam. Res. [3bed 3.5bath] with Carport.',
      'ePlan: Residential Expedited Review - New construction of a THREE UNIT RESIDENTIAL. BLDG 1:...',
      'New construction 2-unit use single-family residential 3-story 3 bedroom 3 bath with covered front porch...',
      'New 3-story single family dwelling unit 3 bedroom/2.5 bathroom with covered porches...',
      'BLDG 3: New construction of a 3-Story Single Family Res. [3bed 3.5bath] with Carport',
      'Bldg 3: New construction 3-unit use single-family residential 2-story 3-bedroom 3.5 bath with attached...',
      '[ETJ] Permanent Service New Construction of a New SFR',
      '[ETJ] Permanent Service for New SFR',
      'New Construction of 2-Story Single Family Res. [5bed 4bath] with attached garage covd porch balcony',
      'New construction of a 2 story Duplex Condo each with 3 beds 2.5 baths and attached garage - Unit A',
      'NEED APPROVED ESPA - New construction of a 2 story single family residence with garage patio & porch. 4/4.5',
      'Bldg 2: New construction 3-unit use single-family residential 2-story 2 bedroom 2.5 bath with covered patio.',
      'BLDG 2:  New 3-story detached residence 3 bedroom 2.5 bathroom Part of 3-unit use.',
      '2 Story Single Family Residence with 5 bedrooms 4 bathrooms attached 2 car garage covered entry porch and patio',
      'New Construction ADU- Adding a new 190 SF ADU to the rear yard that has a full bathroom and an additional sink...',
      '[ETJ] Permanent Service for New Construction of SFR',
      'New construction of single family dwelling with 4 bedrooms and 3.5 baths 2 car garage rear patio and front porch',
      'New construction of 2 story duplex condo each with 3 beds 2.5 baths and attached garage (Unit B)',
    ];
    const text = (l: string) => [l, 'Building Permit', 'New', 'Residential'].join(' | ');
    const hits = live.filter((l) => NEW_HOME_RE.test(text(l)));
    expect(live).toHaveLength(19);
    expect(hits.length).toBe(16);
    // the 3 misses are a three-unit "residential" building, a row with no "new" at all, and an ADU; none is an accessory or farm structure the old rule was written for
    expect(live.filter((l) => !NEW_HOME_RE.test(text(l)))).toEqual([
      live[2], // "New construction of a THREE UNIT RESIDENTIAL": "residential" is an adjective here and "three unit" is not a listed noun
      live[14], // starts with "2 Story Single Family Residence": no "new" at all
      live[15], // an ADU, not a house
    ]);
  });

  it('needs residential wording inside the description: "new" plus a trade job, or a class label alone, is not enough', () => {
    for (const d of [
      'New HVAC unit and ductwork for home', // "home" far from "new": not a new home
      'New roof on commercial building',
      'New deck',
      'Interior remodel',
      'New fence',
    ]) {
      const c = cats(d);
      expect(c, d).not.toContain('real-estate');
    }
    // "New | Residential" in two fields (work class and permit class) must not join into "new residential"
    expect(NEW_HOME_RE.test('Install water heater | Building Permit | New | Residential')).toBe(false);
    // replacing windows on an existing dwelling is not a new home
    expect(NEW_HOME_RE.test('Replace windows and siding on single family dwelling')).toBe(false);
  });

  it('capabilities.ts stays truthful: permit is claimed for real-estate and moving only because this rule exists, and the rule really fires', () => {
    expect(PERMIT_RULES.some((r) => r.re === NEW_HOME_RE && r.add.includes('real-estate') && r.add.includes('moving'))).toBe(true);
    expect(TRADE_SIGNALS['real-estate']).toContain('permit');
    expect(TRADE_SIGNALS.moving).toContain('permit');
    // every real-estate / moving tag the permit rules can produce comes from this single rule
    const taggers = PERMIT_RULES.filter((r) => r.add.includes('real-estate') || r.add.includes('moving'));
    expect(taggers).toHaveLength(1);
  });
});
