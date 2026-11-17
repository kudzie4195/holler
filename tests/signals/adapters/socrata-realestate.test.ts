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
      'New single family residence with detached garage',
      'New pool for single family residence',
      'New shed in rear of single family residence',
      'New carport',
      'New barn',
      'New greenhouse for single family dwelling',
    ]) {
      const c = cats(d);
      expect(c, d).not.toContain('real-estate');
      expect(c, d).not.toContain('moving');
    }
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
