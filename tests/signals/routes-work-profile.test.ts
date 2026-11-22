/**
 * Round 18 ROUTES, items 1, 2 and 6: the member work profile (migration 0027) and how matching uses it. Every filter is conservative: a
 * record that does not state a class, a kind of work or a job value is never filtered out. Real rows come from
 * tests/signals/__data__/review-f-sample-156.json (read-only selects of holler_signals, round 15).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { matchOne, matchSignals, withoutWorkProfile, MAX_MATCHES_PER_USER, type MatchProfile, type MatchSignal } from '@/lib/signals/match';
import { loadProfiles, loadWorkProfiles, missingWorkProfiles, type Db } from '@/lib/signals/store';
import {
  belowMinimum,
  parseMinValue,
  PROPERTY_BY_SOURCE,
  recordPropertyOf,
  recordWorkTypeOf,
  statedJobValue,
  workFilterDrops,
  workProfileOf,
  workSettingsOf,
} from '@/lib/signals/work-profile';

type SampleRow = [number, string, string, string, string, string[]];
const SAMPLE = JSON.parse(readFileSync(join(__dirname, '__data__/review-f-sample-156.json'), 'utf8')) as SampleRow[];
const real = (id: number) => {
  const r = SAMPLE.find((x) => x[0] === id);
  if (!r) throw new Error(`no row ${id}`);
  return { id: r[0], source: r[1], kind: 'permit', subtype: 'permit', title: r[2], summary: r[3], categories: r[5] };
};

const NOW = new Date('2026-11-20T12:00:00Z');
const LOC = { lat: 33.75, lon: -84.39 };
const member = (over: Partial<MatchProfile> = {}): MatchProfile => ({ user_id: 'm1', categories: ['landscaping'], lat: LOC.lat, lon: LOC.lon, state: 'GA', radius_mi: 25, ...over });
let nextId = 1;
const permit = (over: Partial<MatchSignal> & { jobValue?: number } = {}): MatchSignal => {
  const { jobValue, ...rest } = over;
  return {
    id: nextId++,
    source: 'arcgis-atlanta-permits',
    kind: 'permit',
    subtype: 'permit',
    title: 'New home permit in Atlanta',
    summary: 'New Construction | 100 MAIN ST NE, ATLANTA, GA 30303',
    categories: ['general-contractor', 'real-estate', 'moving'],
    lat: LOC.lat + 0.01,
    lon: LOC.lon,
    state: 'GA',
    severity: 1,
    occurred_at: '2026-11-19T00:00:00Z',
    data: { subtype: 'permit', ...(jobValue !== undefined ? { jobValue } : {}) } as MatchSignal['data'],
    ...rest,
  };
};

describe('work settings of a profile row', () => {
  it('defaults (both / no minimum / both) and a row without the 0027 columns change nothing', () => {
    expect(workProfileOf(null)).toBeNull();
    expect(workProfileOf({})).toBeNull();
    expect(workProfileOf({ work_property: 'both', work_min_value: null, work_type: 'both' })).toBeNull();
    expect(workSettingsOf({})).toEqual({ property: 'both', minValue: null, workType: 'both' });
  });
  it('reads saved values and ignores unknown ones', () => {
    expect(workProfileOf({ work_property: 'residential', work_min_value: 5000, work_type: 'repairs' })).toEqual({ property: 'residential', minValue: 5000, workType: 'repairs' });
    expect(workProfileOf({ work_property: 'mansions', work_min_value: '5000', work_type: 'x' })).toEqual({ property: 'both', minValue: 5000, workType: 'both' });
    expect(parseMinValue(0)).toBeNull();
    expect(parseMinValue(-5)).toBeNull();
    expect(parseMinValue('abc')).toBeNull();
    expect(parseMinValue(100_000_001)).toBeNull();
  });
});

describe('which records state residential or commercial (real rows)', () => {
  it('lists the feeds whose layer is one class: the Cobb residential, multi-unit and commercial layers', () => {
    expect(PROPERTY_BY_SOURCE).toEqual({
      'arcgis-cobb-residential-permits': 'residential',
      'arcgis-cobb-multiunit-permits': 'residential',
      'arcgis-cobb-commercial-permits': 'commercial',
    });
    expect(recordPropertyOf(real(138448))).toBe('residential'); // Cobb residential, New Home
    expect(recordPropertyOf(real(138460))).toBe('residential'); // Cobb multi-unit, Townhome
    expect(recordPropertyOf(real(55576))).toBe('commercial'); // Cobb commercial, New Tenant
  });
  it('reads the class from the structured summary of the other feeds', () => {
    expect(recordPropertyOf(real(55466))).toBe('commercial'); // Atlanta "Commercial Alteration"
    expect(recordPropertyOf(real(55467))).toBe('residential'); // Atlanta "Residential Addition"
    expect(recordPropertyOf(real(36961))).toBe('residential'); // DeKalb "Single Family Detached"
    expect(recordPropertyOf(real(69669))).toBe('commercial'); // DeKalb "Business"
    expect(recordPropertyOf(real(124960))).toBe('commercial'); // Baton Rouge "(C) | Commercial"
    expect(recordPropertyOf(real(92549))).toBe('residential'); // Baton Rouge "(R) | Residential"
    expect(recordPropertyOf(real(134445))).toBe('commercial'); // Cincinnati "Alter Commercial"
    expect(recordPropertyOf(real(134441))).toBe('residential'); // Cincinnati "Alter Residential"
    expect(recordPropertyOf(real(2565))).toBe('residential'); // LA "1 or 2 Family Dwelling"
    expect(recordPropertyOf(real(58582))).toBe('commercial'); // Seattle "Commercial"
    expect(recordPropertyOf(real(2319))).toBe('residential'); // Seattle "Single Family/Duplex"
    expect(recordPropertyOf(real(51800))).toBe('residential'); // NOLA "Residential Re-Roofing"
    expect(recordPropertyOf(real(88943))).toBe('residential'); // Johns Creek "Residential building"
  });
  it('a record that does not say is never classed (and so never filtered)', () => {
    for (const id of [3407, 26796, 41543, 6359, 59428, 34911 /* Multifamily: neither */, 1631]) expect(recordPropertyOf(real(id))).toBeNull();
    // Not a permit: no class is read at all.
    expect(recordPropertyOf({ source: 'socrata-chicago-business', subtype: 'business', summary: 'Commercial' })).toBeNull();
  });
});

describe('which records make the kind of work clear', () => {
  it('a new-build permit is an install; an alteration, addition or accessory structure is not', () => {
    expect(recordWorkTypeOf(real(138448))).toBe('installs'); // New home
    expect(recordWorkTypeOf(real(92549))).toBe('installs'); // New construction
    expect(recordWorkTypeOf(real(55467))).toBeNull(); // Addition
    expect(recordWorkTypeOf(real(2565))).toBeNull(); // Roof (a re-roof can be either)
  });
  it('a repair-only permit, a code violation, a no-heat complaint and a sewage back-up are repairs', () => {
    expect(recordWorkTypeOf(real(5741))).toBe('repairs'); // Damage repair permit
    expect(recordWorkTypeOf({ source: 'socrata-orlando-permits', kind: 'permit', subtype: 'permit', title: 'Repair permit in Orlando' })).toBe('repairs');
    expect(recordWorkTypeOf({ source: 'socrata-chicago-violations', kind: 'civic', subtype: 'violation', title: 'Code violation in Chicago: REPAIR GUTTER' })).toBe('repairs');
    expect(recordWorkTypeOf({ source: 'socrata-nyc-311', kind: 'civic', subtype: '311', title: '311 request in New York City: HEAT/HOT WATER / ENTIRE BUILDING' })).toBe('repairs');
    expect(recordWorkTypeOf({ source: 'socrata-sf-311', kind: 'civic', subtype: '311', title: '311 request in San Francisco: Sewer / sewage_back-up_discharge' })).toBe('repairs');
  });
  it('anything else is unclear: never filtered', () => {
    expect(recordWorkTypeOf({ source: 'spc', kind: 'report', title: 'Hail damage reported near Smyrna' })).toBeNull();
    expect(recordWorkTypeOf({ source: 'bids-sf', kind: 'contract', subtype: 'bid', title: 'Roof replacement' })).toBeNull();
    expect(recordWorkTypeOf({ source: 'socrata-nyc-311', kind: 'civic', subtype: '311', title: '311 request in X: Dead tree' })).toBeNull();
  });
  it('workFilterDrops only when the record states the other class or kind', () => {
    const res = { property: 'residential' as const, minValue: null, workType: 'both' as const };
    expect(workFilterDrops(real(55466), res)).toBe(true); // commercial alteration, residential-only member
    expect(workFilterDrops(real(55467), res)).toBe(false); // residential addition
    expect(workFilterDrops(real(3407), res)).toBe(false); // Buffalo REPAIR: does not say
    const repairs = { property: 'both' as const, minValue: null, workType: 'repairs' as const };
    expect(workFilterDrops(real(138448), repairs)).toBe(true); // new home, repairs-only member
    expect(workFilterDrops(real(5741), repairs)).toBe(false);
    expect(workFilterDrops(real(2565), repairs)).toBe(false); // roof: unclear
    expect(workFilterDrops(real(55466), null)).toBe(false);
  });
});

describe('minimum job value', () => {
  const w = { property: 'both' as const, minValue: 5000, workType: 'both' as const };
  it('reads data.jobValue, else the "$N job value" part of the summary', () => {
    expect(statedJobValue({ kind: 'permit', data: { jobValue: 1200 } })).toBe(1200);
    expect(statedJobValue(real(55516))).toBe(40000);
    expect(statedJobValue(real(36961))).toBeNull();
  });
  it('a $1,200 permit is below a $5,000 minimum; a permit with no stated value never is', () => {
    expect(belowMinimum({ kind: 'permit', data: { jobValue: 1200 } }, w)).toBe(true);
    expect(belowMinimum({ kind: 'permit', data: { jobValue: 5000 } }, w)).toBe(false);
    expect(belowMinimum({ kind: 'permit', data: {} }, w)).toBe(false);
    expect(belowMinimum({ kind: 'permit', data: { jobValue: 1200 } }, null)).toBe(false);
    // Not a permit: never judged on value.
    expect(belowMinimum({ kind: 'contract', subtype: 'bid', data: { jobValue: 10 } }, w)).toBe(false);
  });
});

describe('matching uses the work profile', () => {
  const min5k = member({ work_property: 'both', work_min_value: 5000, work_type: 'both' });
  it('a member with a $5,000 minimum does not get a $1,200 permit alert (feed only, below_min) but does get one with no stated value', () => {
    const cheap = permit({ jobValue: 1200 });
    const none = permit();
    const big = permit({ jobValue: 600_000 });
    const a = matchOne(cheap, min5k, false, NOW.getTime());
    expect(a?.label).toBe('coming_soon'); // landscaping is downstream of a new home
    expect(a?.hold).toBe('below_min');
    expect(matchOne(none, min5k, false, NOW.getTime())?.hold).toBeUndefined();
    expect(matchOne(big, min5k, false, NOW.getTime())?.hold).toBeUndefined();
    const rows = matchSignals([cheap, none, big], [min5k], undefined, NOW, false);
    expect(rows.find((r) => r.signal_id === cheap.id)).toMatchObject({ alert_hold: 'below_min' });
    expect(rows.find((r) => r.signal_id === none.id)).not.toHaveProperty('alert_hold');
    expect(rows.find((r) => r.signal_id === big.id)).not.toHaveProperty('alert_hold');
    // The same member without a minimum: every card alerts as before.
    expect(matchSignals([cheap, none, big], [member()], undefined, NOW, false).every((r) => !('alert_hold' in r))).toBe(true);
  });
  it('property focus removes only records that state the other class', () => {
    const resOnly = member({ categories: ['janitorial-commercial', 'cleaning'], work_property: 'residential' });
    const commercial = permit({ title: 'Tenant fit-out permit in Atlanta', summary: 'Commercial Alteration | 9 PEACHTREE ST NE', categories: ['general-contractor'] });
    const unsaid = permit({ title: 'Remodel permit in Atlanta', summary: 'Alteration | 9 PEACHTREE ST NE', categories: ['general-contractor'] });
    expect(matchOne(commercial, resOnly, false, NOW.getTime())).toBeNull();
    expect(matchOne(commercial, member({ categories: ['janitorial-commercial'] }), false, NOW.getTime())).not.toBeNull();
    expect(matchOne(unsaid, resOnly, false, NOW.getTime())).not.toBeNull();
  });
  it('work type removes only records whose kind is clear, and only for the trade that does the permitted work', () => {
    // The general contractor does the new home: "repairs and service only" removes it.
    const gcRepairs = member({ categories: ['general-contractor'], work_type: 'repairs' });
    expect(matchOne(permit(), gcRepairs, false, NOW.getTime())).toBeNull();
    expect(matchOne(permit(), member({ categories: ['general-contractor'] }), false, NOW.getTime())?.label).toBe('market_insight');
    const installsOnly = member({ categories: ['hvac'], work_type: 'installs' });
    // Round 19 integration: a whole-building heat complaint is urgent only at the third complaint at one building (owner call 1), so the
    // repair record here is a non-residential no-heat complaint, which stays act now for HVAC (rule act-no-heat).
    const noHeat: MatchSignal = { id: nextId++, source: 'socrata-nyc-311', kind: 'civic', subtype: '311', title: '311 request in New York City: NONCONST / NO HEAT', categories: ['hvac'], lat: LOC.lat, lon: LOC.lon, state: 'GA', severity: 1, occurred_at: '2026-11-19T00:00:00Z' };
    expect(matchOne(noHeat, installsOnly, false, NOW.getTime())).toBeNull();
    expect(matchOne(noHeat, member({ categories: ['hvac'] }), false, NOW.getTime())?.label).toBe('act_now');
  });
  it('review P2-3: downstream trades are never filtered by the builder\'s kind of work', () => {
    // A house cleaner on "repairs and service only" still gets the post-construction card of a new-build permit.
    const cleanerRepairs = member({ categories: ['cleaning'], work_type: 'repairs' });
    // Round 19 integration: an unclassed "new construction" permit is feed only for cleaners under the round 19 rules
    // (mi-new-construction-unclassed); a new home is still the cleaner's heads-up, so the record here is a new home.
    const newBuild = permit({ title: 'New home permit in Atlanta', summary: 'New | 1 or 2 Family Dwelling | 100 MAIN ST NE, ATLANTA, GA 30303', categories: ['general-contractor'] });
    expect(matchOne(newBuild, cleanerRepairs, false, NOW.getTime())).toMatchObject({ label: 'coming_soon', trade: 'cleaning' });
    expect(matchSignals([newBuild], [cleanerRepairs], undefined, NOW, false)).toHaveLength(1);
    // Landscapers and movers on a new home, the same.
    for (const t of ['landscaping', 'moving']) expect(matchOne(permit(), member({ categories: [t], work_type: 'repairs' }), false, NOW.getTime())?.label).toBe('coming_soon');
    // An "installs only" cleaner is not filtered by a repair-only permit either.
    const repairPermit = permit({ title: 'Remodel permit in Atlanta', summary: 'Alteration | 9 PEACHTREE ST NE', categories: ['general-contractor'] });
    expect(matchOne(repairPermit, member({ categories: ['cleaning'], work_type: 'installs' }), false, NOW.getTime())).not.toBeNull();
  });
  it('the stale-match prune reads the profile without its work settings, so nothing a member holds is removed by a new setting', () => {
    const p = member({ categories: ['general-contractor'], work_type: 'repairs', work_min_value: 5000, work_property: 'commercial' });
    const bare = withoutWorkProfile(p);
    expect(bare).not.toHaveProperty('work_type');
    expect(bare).not.toHaveProperty('work_property');
    expect(bare).not.toHaveProperty('work_min_value');
    expect(matchSignals([permit()], [p], MAX_MATCHES_PER_USER, NOW, false)).toHaveLength(0);
    expect(matchSignals([permit()], [bare], MAX_MATCHES_PER_USER, NOW, false)).toHaveLength(1);
    const plain = member();
    expect(withoutWorkProfile(plain)).toBe(plain);
  });
});

describe('loadProfiles with migration 0027 missing', () => {
  const PROFILE = { user_id: 'u1', categories: ['landscaping'], lat: 33.7, lon: -84.4, state: 'GA', radius_mi: 25, subscription_status: 'active', trial_ends_at: null, plan: null, extra_areas: [], keywords: [] };
  /** holler_profiles answers with the member; holler_work_profiles answers with `work` (rows or an error). */
  function client(work: { data?: unknown[]; error?: { code: string; message: string } }) {
    const reads: string[] = [];
    const db = {
      from: (table: string) => {
        const q: Record<string, unknown> = {};
        q.select = (c: string) => (reads.push(`${table}: ${c}`), q);
        for (const m of ['neq', 'order']) q[m] = () => q;
        q.range = async (from: number) => ({ data: from === 0 ? [PROFILE] : [], error: null });
        q.in = async () => (work.error ? { data: null, error: work.error } : { data: work.data ?? [], error: null });
        return q;
      },
    };
    return { db: db as unknown as Db, reads };
  }
  const ERRORS = [
    { code: '42P01', message: 'relation "public.holler_work_profiles" does not exist' },
    { code: 'PGRST205', message: "Could not find the table 'public.holler_work_profiles' in the schema cache" },
    { code: '42703', message: 'column holler_work_profiles.work_property does not exist' },
    { code: 'PGRST204', message: "Could not find the 'work_property' column of 'holler_work_profiles' in the schema cache" },
  ];
  for (const err of ERRORS) {
    it(`${err.code}: no work profile is attached, nothing is logged, and matching is as today`, async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const c = client({ error: err });
      const got = await loadProfiles(c.db, NOW);
      expect(got).toEqual([PROFILE]);
      expect(c.reads.some((r) => r.startsWith('holler_work_profiles'))).toBe(true);
      expect(missingWorkProfiles(err)).toBe(true);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
      const sigs = [permit({ jobValue: 1200 }), permit()];
      expect(matchSignals(sigs, got, undefined, NOW, false)).toEqual(matchSignals(sigs, [{ ...PROFILE } as MatchProfile], undefined, NOW, false));
    });
  }
  it('another error is logged and also leaves matching as today (never fails the scan)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const got = await loadProfiles(client({ error: { code: '42501', message: 'permission denied' } }).db, NOW);
    expect(got).toEqual([PROFILE]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    expect(missingWorkProfiles({ code: '42501', message: 'permission denied' })).toBe(false);
  });
  it('with 0027 applied, the saved settings reach the matcher; an all-default row changes nothing', async () => {
    const got = await loadProfiles(client({ data: [{ user_id: 'u1', work_property: 'both', work_min_value: 5000, work_type: 'both' }] }).db, NOW);
    expect(got[0]).toMatchObject({ work_min_value: 5000 });
    const rows = matchSignals([permit({ jobValue: 1200 })], got, undefined, NOW, false);
    expect(rows[0]).toMatchObject({ alert_hold: 'below_min' });
    const plain = await loadProfiles(client({ data: [{ user_id: 'u1', work_property: 'both', work_min_value: null, work_type: 'both' }] }).db, NOW);
    expect(plain).toEqual([PROFILE]);
    expect((await loadWorkProfiles(client({ data: [] }).db, ['u1'])).size).toBe(0);
  });
});
