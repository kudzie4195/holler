// Round 18 ROUTES review probe (logs/REV-ROUTES-probe-tests), kept as a permanent regression test (redo 1). With REV_OUT set it also
// writes its table to that path; without it it writes nothing.
/* eslint-disable @typescript-eslint/no-explicit-any */
/** REV-ROUTES probe 05: the work profile and the contact gate against edge inputs. Prints tables; asserts only the conservative rules. */
import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { matchSignals, type MatchProfile, type MatchSignal } from '@/lib/signals/match';
import { recordPropertyOf, recordWorkTypeOf, statedJobValue, workProfileOf } from '@/lib/signals/work-profile';
import { alertHoldFor } from '@/lib/signals/alert-gate';
import { parseWorkProfileForm } from '@/lib/auth/work-profile';

const NOW = new Date('2026-11-20T12:00:00Z');
const LOC = { lat: 33.75, lon: -84.39 };
const member = (over: Partial<MatchProfile> = {}): MatchProfile => ({ user_id: 'm1', categories: ['landscaping'], lat: LOC.lat, lon: LOC.lon, state: 'GA', radius_mi: 25, ...over });
let nextId = 1;
const permit = (over: any = {}): MatchSignal => ({
  id: nextId++, source: 'arcgis-atlanta-permits', kind: 'permit', subtype: 'permit', title: 'New home permit in Atlanta', summary: 'New Construction | 100 MAIN ST NE, ATLANTA, GA 30303',
  categories: ['general-contractor', 'real-estate', 'moving'], lat: LOC.lat + 0.01, lon: LOC.lon, state: 'GA', severity: 1, occurred_at: '2026-11-19T00:00:00Z', data: { subtype: 'permit' }, ...over,
});
const out: string[] = [];
const say = (s: string) => out.push(s);

describe('REV-ROUTES 05', () => {
  it('no work profile, a default profile and an all-default row give byte-identical rows', () => {
    const sigs = [permit({ contactPath: 'site' }), permit({ data: { subtype: 'permit', jobValue: 1200 } }), permit({ summary: 'Commercial Alteration | $900 job value | 9 PEACHTREE ST NE', title: 'Tenant fit-out permit in Atlanta' }), permit({ title: 'Repair permit in Atlanta' })];
    const a = matchSignals(sigs, [member()], undefined, NOW, false);
    const b = matchSignals(sigs, [member({ work_property: 'both', work_min_value: null, work_type: 'both' })], undefined, NOW, false);
    const c = matchSignals(sigs, [member({ work_property: undefined, work_min_value: 0 as any, work_type: 'nonsense' as any })], undefined, NOW, false);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(JSON.stringify(c)).toBe(JSON.stringify(a));
    expect(a.some((r) => 'alert_hold' in r)).toBe(false);
    expect(workProfileOf({ work_property: 'both', work_min_value: null, work_type: 'both' })).toBeNull();
    say(`default / no profile: ${a.length} rows, identical in all three cases, none held`);
  });

  it('job values: only a plausible stated value below the minimum holds the card', () => {
    const min5k = member({ work_min_value: 5000 });
    say('\n| Stated job value (member minimum $5,000) | Read as | Result |\n|---|---|---|');
    const cases: Array<[string, any, string | undefined, boolean]> = [
      ['data.jobValue 0', 0, undefined, false], ['data.jobValue -100', -100, undefined, false], ['data.jobValue "abc"', 'abc', undefined, false], ['data.jobValue 9 (placeholder)', 9, undefined, false],
      ['data.jobValue 10', 10, undefined, true], ['data.jobValue 1', 1, undefined, false], ['data.jobValue 501', 501, undefined, true], ['data.jobValue 4999', 4999, undefined, true], ['data.jobValue "4,999.99"', '4,999.99', undefined, false],
      ['data.jobValue 5000', 5000, undefined, false], ['data.jobValue 600000000 (over the $500M ceiling)', 600_000_000, undefined, false], ['data.jobValue 4045551212 (a phone number)', 4_045_551_212, undefined, false],
      ['data.jobValue NaN', NaN, undefined, false], ['data.jobValue Infinity', Infinity, undefined, false], ['data.jobValue null', null, undefined, false], ['data.jobValue {}', {}, undefined, false], ['data.jobValue "1e3"', '1e3', undefined, false],
      ['no data value, summary "$1,200 job value"', undefined, 'New Construction | $1,200 job value | 100 MAIN ST NE', true], ['data 600000 and summary "$1,200 job value"', 600000, 'New Construction | $1,200 job value | 100 MAIN ST NE', false],
      ['data 0 and summary "$1,200 job value" (0 is not a value, the summary is read)', 0, 'New Construction | $1,200 job value | 100 MAIN ST NE', true], ['summary "$0 job value"', undefined, 'New Construction | $0 job value | 100 MAIN ST NE', false],
    ];
    for (const [name, v, summary, below] of cases) {
      const s = permit({ data: { subtype: 'permit', ...(v !== undefined ? { jobValue: v } : {}) }, ...(summary ? { summary } : {}), contactPath: 'site' });
      const rows = matchSignals([s], [min5k], undefined, NOW, false);
      const hold = (rows[0] as any)?.alert_hold ?? null;
      say(`| ${name} | ${statedJobValue({ kind: 'permit', data: s.data as any, summary: s.summary })} | ${rows.length === 0 ? 'NOT MATCHED' : hold ? `feed only (${hold})` : 'alert'} |`);
      expect(rows.length, name).toBe(1);
      expect(hold === 'below_min', name).toBe(below);
    }
    // a record that is not a permit is never below the minimum
    const bid = permit({ source: 'bids-sf', kind: 'contract', subtype: 'bid', title: 'Landscape maintenance', categories: ['landscaping'], data: { subtype: 'bid', jobValue: 100 }, summary: '$100 job value' });
    expect(matchSignals([bid], [min5k], undefined, NOW, true).every((r) => !('alert_hold' in r))).toBe(true);
  });

  it('property focus: what each summary wording is read as', () => {
    say('\n| Permit summary (type / class / use) | Read as | Residential-only member | Commercial-only member |\n|---|---|---|---|');
    const res = member({ categories: ['general-contractor'], work_property: 'residential' });
    const com = member({ categories: ['general-contractor'], work_property: 'commercial' });
    const any = member({ categories: ['general-contractor'] });
    for (const summary of [
      'Residential Alteration', 'Commercial Alteration', 'Multi-Family', 'Multifamily', 'Multi-Family Residential', 'Residential - Multi Family', 'Residential Multi-Family New', 'Apartment', 'Apartments | Residential',
      'Mixed Use', 'Mixed Use | Commercial', 'Mixed-Use Residential/Commercial', 'Non-Residential', 'Non-Residential Alteration', 'Nonresidential', 'Residential/Commercial', 'Commercial | Residential Care Facility',
      'Condominium', 'Townhouse', 'Duplex', 'Hotel', 'Institutional', 'Single Family Detached', 'Business', 'Business Occupancy', 'Office Building', 'Retail', 'Industrial', 'New Building Permit (R)', 'New Building Permit (C)',
      'Com Garage/Shed<800', 'Residential Commercial Kitchen', '1 or 2 Family Dwelling', '3 or More Family Dwelling', 'SFR', 'Alteration',
    ]) {
      const s = permit({ summary: `${summary} | 100 MAIN ST NE`, title: 'Remodel permit in Atlanta', categories: ['general-contractor'], contactPath: 'site' });
      expect(matchSignals([s], [any], undefined, NOW, false).length, summary).toBe(1);
      const r = matchSignals([s], [res], undefined, NOW, false).length ? 'gets it' : 'LOSES it';
      const c = matchSignals([s], [com], undefined, NOW, false).length ? 'gets it' : 'LOSES it';
      say(`| ${summary} | ${recordPropertyOf({ source: s.source, kind: 'permit', summary: s.summary }) ?? 'not stated'} | ${r} | ${c} |`);
    }
    // Redo 1 (review P3-1): "Non-Residential" is a business property; multi-family and apartments are never classed.
    const cls = (x: string) => recordPropertyOf({ source: 'arcgis-atlanta-permits', kind: 'permit', summary: `${x} | 100 MAIN ST NE` });
    for (const x of ['Non-Residential', 'Non-Residential Alteration', 'Nonresidential']) expect(cls(x), x).toBe('commercial');
    for (const x of ['Multi-Family', 'Multifamily', 'Multi-Family Residential', 'Residential - Multi Family', 'Residential Multi-Family New', 'Apartment', 'Apartments | Residential', 'Mixed Use', 'Condominium', 'Institutional']) expect(cls(x), x).toBeNull();
    for (const x of ['Residential Alteration', 'Single Family Detached', 'Townhouse', 'Duplex', 'SFR', 'New Building Permit (R)']) expect(cls(x), x).toBe('residential');
    for (const x of ['Commercial Alteration', 'Business', 'Retail', 'Industrial', 'New Building Permit (C)']) expect(cls(x), x).toBe('commercial');
  });

  it('work type: which records each choice removes, per trade', () => {
    say('\n| Record | Read as | "Repairs and service only" | "New installs and builds only" |\n|---|---|---|---|');
    const recs: Array<[string, any, string[]]> = [
      ['New home permit (member: house cleaner, downstream trade)', permit({ contactPath: 'site' }), ['cleaning']],
      ['New home permit (member: landscaper, downstream trade)', permit({ contactPath: 'site' }), ['landscaping']],
      ['New home permit (member: mover, tagged trade)', permit({ contactPath: 'site' }), ['moving']],
      ['Roof permit (member: roofer)', permit({ title: 'Roof permit in Atlanta', categories: ['roofing'], contactPath: 'site' }), ['roofing']],
      ['Repair permit (member: general contractor)', permit({ title: 'Repair permit in Atlanta', summary: 'Residential Repair | 100 MAIN ST NE', categories: ['general-contractor'], contactPath: 'site' }), ['general-contractor']],
      ['Code violation: ROOF (member: roofer)', permit({ source: 'socrata-chicago-violations', kind: 'civic', subtype: 'violation', title: 'Code violation in Chicago: ROOF', summary: null, categories: ['roofing'], data: { subtype: 'violation' } }), ['roofing']],
      ['311 no heat (member: HVAC)', permit({ source: 'socrata-nyc-311', kind: 'civic', subtype: '311', title: '311 request in New York City: HEAT/HOT WATER / ENTIRE BUILDING', summary: null, categories: ['hvac'], data: { subtype: '311' } }), ['hvac']],
      ['Hail report (member: roofer)', permit({ source: 'spc', kind: 'report', subtype: null, title: 'Hail damage reported near Decatur', summary: null, categories: ['roofing'], data: {} }), ['roofing']],
      ['City bid (member: roofer)', permit({ source: 'bids-sf', kind: 'contract', subtype: 'bid', title: 'Roof replacement at a city library', summary: null, categories: ['roofing'], data: { subtype: 'bid' } }), ['roofing']],
      ['Business licence (member: HVAC)', permit({ source: 'socrata-chicago-business', kind: 'civic', subtype: 'business', title: 'New business license in Chicago: Retail Food Establishment', summary: null, categories: ['hvac'], data: { subtype: 'business' } }), ['hvac']],
      ['Failed inspection (member: pest control)', permit({ source: 'socrata-chicago-inspections', kind: 'civic', subtype: 'inspection', title: 'Failed inspection', summary: null, categories: ['pest-control'], data: { subtype: 'inspection' } }), ['pest-control']],
    ];
    for (const [name, s, cats] of recs) {
      const base = matchSignals([s], [member({ categories: cats })], undefined, NOW, true).length;
      const rep = matchSignals([s], [member({ categories: cats, work_type: 'repairs' })], undefined, NOW, true).length;
      const ins = matchSignals([s], [member({ categories: cats, work_type: 'installs' })], undefined, NOW, true).length;
      say(`| ${name} | ${recordWorkTypeOf({ source: s.source, kind: s.kind, subtype: s.subtype, title: s.title, summary: s.summary }) ?? 'unclear'} | ${!base ? 'n/a (not matched at all)' : rep ? 'gets it' : 'LOSES it (not even in the feed)'} | ${!base ? 'n/a' : ins ? 'gets it' : 'LOSES it (not even in the feed)'} |`);
      // Redo 1 (decision 4): downstream trades and records whose kind is unclear are never removed by the work type.
      if (!/Repair permit|Code violation|no heat/.test(name) && base) {
        expect(rep, `${name} / repairs`).toBe(base);
        expect(ins, `${name} / installs`).toBe(base);
      }
      // The doing trade on a clear kind is removed by the other choice: a repair permit for a general contractor on "installs only",
      // a violation for a roofer and a no-heat request for HVAC on "installs only".
      if (/Repair permit|Code violation|no heat/.test(name)) {
        expect(rep, name).toBe(1);
        expect(ins, name).toBe(0);
      }
    }
  });

  it('the contact gate: only permits, by kind OR subtype; never any other record', () => {
    say('\n| kind | data.subtype | contact state | label | hold |\n|---|---|---|---|---|');
    for (const [kind, subtype] of [['permit', 'permit'], ['permit', null], ['permit', 'violation'], ['permit', 'business'], ['civic', 'permit'], ['civic', 'violation'], ['civic', '311'], ['civic', 'inspection'], ['civic', 'business'], ['contract', 'bid'], ['report', null], ['event', 'event-permit'], ['alert', null]] as const) {
      for (const cp of [null, undefined, 'site'] as const) {
        const h = alertHoldFor({ source: 'x', kind, subtype, title: 't', contactPath: cp } as any, 'coming_soon', 'roofing', null);
        if (cp !== 'site') say(`| ${kind} | ${subtype ?? '(none)'} | ${cp === null ? 'known: none' : 'unknown'} | coming_soon | ${h ?? 'none (alerts)'} |`);
        if ((kind as string) !== 'permit' && (subtype as string | null) !== 'permit') expect(h).toBeNull();
        if (cp !== null) expect(h).toBeNull();
      }
    }
    expect(alertHoldFor({ source: 'x', kind: 'permit', subtype: 'permit', contactPath: null } as any, 'market_insight', 'roofing', null)).toBeNull();
    expect(alertHoldFor({ source: 'x', kind: 'permit', subtype: 'permit', contactPath: null } as any, 'act_now', 'roofing', null)).toBe('background');
  });

  it('the Settings form input', () => {
    say('\n| Minimum typed | Saved as |\n|---|---|');
    const f = (min: any, p = 'both', t = 'both') => parseWorkProfileForm({ get: (k: string) => (({ work_property: p, work_type: t, work_min_value: min }) as any)[k] ?? null });
    for (const v of ['', ' ', '0', '5000', '$5,000', '$ 5,000', '5,000.00', '5000.5', '-5', '+5', '1e5', '5k', '100000000', '100000001', '999999999', '9999999999', '５０００', '0x10', '5 000', 'abc', '$', ',']) {
      const r = f(v);
      say(`| "${v}" | ${r === null ? 'REJECTED (error shown)' : r.work_min_value === null ? 'no minimum' : r.work_min_value} |`);
    }
    expect(f('5000', 'mansions')).toBeNull();
    expect(f('5000', 'both', 'x')).toBeNull();
    expect(f(undefined)).toEqual({ work_property: 'both', work_min_value: null, work_type: 'both' });
    expect(f({ name: 'file' })).toBeNull();
    expect(f('-5')).toBeNull();
    expect(f('999999999')).toBeNull();
    // Redo 1 (review P3-7): a trailing ".00" is accepted, other cents are not.
    expect(f('5,000.00')).toMatchObject({ work_min_value: 5000 });
    expect(f('$5,000.0')).toMatchObject({ work_min_value: 5000 });
    expect(f('5000.5')).toBeNull();
    if (process.env.REV_OUT) writeFileSync(process.env.REV_OUT as string, out.join('\n') + '\n');
  });
});
