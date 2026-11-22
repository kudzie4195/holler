/**
 * Round 18 integration, Part B item 1: the SPC adapter's wind card (title, severity, label) uses the same damage rule as the address lists
 * (lib/signals/wind-damage.ts remarkNamesWindDamage) instead of the old loose word test /damage|down|blown|uproot|snapped|power|roof|tree/i.
 * Table and helper: tests/lists/wind-remarks.ts (the reviewer's 115 remarks, round 18 LISTS review 2), each remark through the REAL scanSpc.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { scanSpc } from '@/lib/signals/adapters/spc';
import { R, through } from '../lists/wind-remarks';
import { labelFor } from '@/lib/signals/lead-rules';
import { stormFactsOf } from '@/lib/signals/wind-damage';

const MUST_NOT = R.filter(([, want]) => want === 'no').map(([remark]) => remark);
const DAMAGE = R.filter(([, want]) => want === 'yes').map(([remark]) => remark);
// The 9 pinned false negatives of tests/lists/rev2-wind.test.ts: the safe side (no damage claimed), the same for cards and lists.
const PINNED_MISSES = new Set([
  'Siding torn from a house.', 'Fence flattened and a shed overturned.', 'Windows broken at a gas station.', 'Semi overturned on I-40.',
  'Utility poles leaning.', 'Mobile home rolled.', 'Large branch fell on a car.', 'TSTM WND DMG. Multiple trees and powerlines dwn.', 'Gutters ripped off a home.',
]);

describe('SPC wind card: the damage rule of the address lists', () => {
  it('no must-not remark gets a "Wind damage reported" title, damage severity or an act_now label (61 mph, 52 mph and UNK)', () => {
    const bad: string[] = [];
    for (const remark of MUST_NOT) {
      const m61 = through(remark, '61');
      const m52 = through(remark, '52');
      const unk = through(remark, 'UNK');
      const m45 = through(remark, '45');
      if (/^Wind damage reported/.test(m61.title ?? '') || m61.cardLabel === 'act_now') bad.push(`61: ${remark}`);
      // 52 mph is under the 58 mph severity line: severity 2 there can only come from a damage reading.
      if (/^Wind damage reported/.test(m52.title ?? '') || (m52.severity ?? 0) >= 2 || m52.cardLabel === 'act_now') bad.push(`52: ${remark}`);
      // An UNK speed or a gust under 50 mph is kept only for a damage report: a must-not remark is not stored at all.
      if (unk.stored) bad.push(`UNK stored: ${remark} (${unk.title})`);
      if (m45.stored) bad.push(`45 stored: ${remark} (${m45.title})`);
    }
    expect(bad).toEqual([]);
    expect(MUST_NOT.length).toBe(71);
  });

  it('a measured gust keeps a neutral title that never says damage, whatever the remark; it is act_now only when its remark names damage', () => {
    for (const [remark, want] of R) {
      const m = through(remark, '61');
      expect(m.title).toBe('61 mph wind gust reported near 2 N Smyrna, GA');
      expect(m.title).not.toMatch(/damage/i);
      // Step 2: the storm rule reads the damage flag (remarkNamesWindDamage), not the title.
      expect(m.cardLabel, remark).toBe(want === 'yes' && !PINNED_MISSES.has(remark) ? 'act_now' : 'coming_soon');
    }
  });

  it('a remark that names damage to a thing keeps the "Wind damage reported" card (act_now, severity 2) at UNK speed; the pinned misses are dropped', () => {
    const titled: string[] = [];
    for (const remark of DAMAGE) {
      const unk = through(remark, 'UNK');
      const m52 = through(remark, '52');
      if (PINNED_MISSES.has(remark)) {
        expect(unk.stored, remark).toBe(false);
        expect(m52.severity, remark).toBe(1);
        continue;
      }
      expect(unk.title, remark).toBe('Wind damage reported near 2 N Smyrna, GA');
      // Round 19 integration: the rules unit's line 39 makes a wind damage report act now for a trade only when its remark names that
      // trade's work (roof for roofing, trees for tree service), otherwise a heads-up; it stays an alert card either way.
      expect(['act_now', 'coming_soon'], remark).toContain(unk.cardLabel);
      expect(unk.severity, remark).toBe(2);
      expect(m52.severity, remark).toBe(2);
      titled.push(remark);
    }
    expect(titled.length).toBe(DAMAGE.length - PINNED_MISSES.size);
  });

  it('the four SPC fixture files give the same rows, titles and severities as before the change', () => {
    const day = '2026-11-20';
    const got = Object.fromEntries(
      ([['spc-wind.csv', 'wind'], ['spc-filtered-combined.csv', 'torn'], ['spc-hail.csv', 'hail'], ['spc-torn.csv', 'torn']] as const).map(([f, type]) => [
        f,
        scanSpc({ csv: readFileSync(`tests/fixtures/${f}`, 'utf8'), type, day }).signals.map((s) => `${s.title} | ${s.severity}`),
      ]),
    );
    expect(got).toEqual({
      'spc-wind.csv': ['68 mph wind gust reported near 2 SW Celina, TX | 2', 'Wind damage reported near 1 W Grannis, AR | 2', '61 mph wind gust reported near 4 WSW Lamar, CO | 2'],
      'spc-filtered-combined.csv': [
        'Tornado reported near 6 SSW Anton, TX | 3', '68 mph wind gust reported near 2 SW Celina, TX | 2', 'Wind damage reported near 1 W Grannis, AR | 2',
        '1.00 inch hail reported near 8 N Mullin, TX | 2', '2.00 inch hail reported near Aviston, IL | 3',
      ],
      'spc-hail.csv': ['1.00 inch hail reported near 8 N Mullin, TX | 2', '1.50 inch hail reported near 2 ESE Longview, TX | 2', '2.00 inch hail reported near Aviston, IL | 3'],
      'spc-torn.csv': ['Tornado reported near 6 SSW Anton, TX | 3', 'Tornado reported near 4 SW Shallowater, TX | 3', 'Tornado reported near 3 NNE Effingham, IL | 3'],
    });
  });

  it('the storm card title and the storm lists agree: a stored "Wind damage reported" row always makes a wind list, and nothing else does', () => {
    for (const [remark] of R) {
      const unk = through(remark, 'UNK');
      if (unk.stored) expect(unk.kind, remark).toBe('wind');
      const m = through(remark, '61');
      expect(m.kind === 'wind', remark).toBe(unk.stored);
    }
  });
});

describe('the act_now storm rule reads the structured fields, and its title fallback ignores place names (round 18 integration, step 2)', () => {
  const PLACES = ['2 N Hailey, ID', '3 S Haile, LA', '1 E Tornado Rd, TX', '4 W Damascus, GA'];
  // Round 19 integration: roofing, restoration, tree service, insurance and the hail trades now have their own audited storm rules (lead-rules.ts
  // spc-*, lines 38 to 41); the round 18 rule is the one every other trade gets, so it is tested with a trade that has no audited storm rule.
  const label = (title: string, storm?: Parameters<typeof labelFor>[0]['storm']) => labelFor({ source: 'spc', kind: 'report', title, storm }, 'handyman');

  it('title fallback (a row read without its data): a gust near a place named like a storm word stays coming_soon', () => {
    for (const p of PLACES) expect(label(`61 mph wind gust reported near ${p}`), p).toBe('coming_soon');
    // the real event words still count, whole words only
    expect(label('1.50 inch hail reported near 4 W Damascus, GA')).toBe('act_now');
    expect(label('Tornado reported near 2 N Hailey, ID')).toBe('act_now');
    expect(label('Wind damage reported near 1 E Tornado Rd, TX')).toBe('act_now');
    // the short titles other tests use keep their label
    for (const t of ['Hail report', 'Hail', 'hail reported', 'Hail near Marietta', 'Hail report: 1.25 inch hail near Atlanta', 'Hail damage reported near Atlanta']) expect(label(t), t).toBe('act_now');
    expect(label('Hailstorm-free gust')).toBe('coming_soon');
  });

  it('structured fields decide when present: type and size, and the wind damage flag', () => {
    expect(label('61 mph wind gust reported near 2 N Hailey, ID', { type: 'wind', windDamage: false })).toBe('coming_soon');
    expect(label('Wind damage reported near 2 N Smyrna, GA', { type: 'wind', windDamage: false })).toBe('coming_soon'); // an old row from the loose word test
    expect(label('61 mph wind gust reported near 2 N Smyrna, GA', { type: 'wind', windDamage: true })).toBe('act_now');
    expect(label('1.00 inch hail reported near 1 E Tornado Rd, TX', { type: 'hail', hailInches: 1 })).toBe('act_now');
    expect(label('x', { type: 'hail', hailInches: 0.75 })).toBe('coming_soon');
    expect(label('Tornado reported near 3 S Haile, LA', { type: 'torn' })).toBe('act_now');
  });

  it('through the real adapter and stormFactsOf: gusts at those places are coming_soon, a damage report there is act_now', () => {
    for (const p of PLACES) {
      const [loc, st] = p.split(', ');
      const csv = (speed: string, remark: string) => `Time,Speed,Location,County,State,Lat,Lon,Comments\n1906,${speed},${loc},X,${st},33.90,-84.51,${remark}\n`;
      const gust = scanSpc({ csv: csv('61', 'Measured gust.'), type: 'wind', day: '2026-11-20' }).signals[0];
      expect(gust.data?.windDamage, p).toBe(false);
      expect(labelFor({ source: 'spc', kind: gust.kind, title: gust.title, storm: stormFactsOf('spc', gust.data) }, 'handyman'), p).toBe('coming_soon');
      expect(labelFor({ source: 'spc', kind: gust.kind, title: gust.title }, 'handyman'), `${p} (title only)`).toBe('coming_soon');
      // the audited roofing rule: a gust is feed only, near any place name, with or without the report data
      expect(labelFor({ source: 'spc', kind: gust.kind, title: gust.title, storm: stormFactsOf('spc', gust.data) }, 'roofing'), p).toBe('market_insight');
      const dmg = scanSpc({ csv: csv('UNK', 'Trees down on a house.'), type: 'wind', day: '2026-11-20' }).signals[0];
      expect(labelFor({ source: 'spc', kind: dmg.kind, title: dmg.title, storm: stormFactsOf('spc', dmg.data) }, 'handyman'), p).toBe('act_now');
      // the audited roofing rule reads the remark: a house is named, a roof is not, so a heads-up (line 39)
      expect(labelFor({ source: 'spc', kind: dmg.kind, title: dmg.title, summary: dmg.summary, storm: stormFactsOf('spc', dmg.data) }, 'roofing'), p).toBe('coming_soon');
    }
  });
});

describe('round 19 integration: the round 18 storm fix and the rules unit\'s storm rules agree', () => {
  const PLACES = ['2 N Hailey, ID', '3 S Haile, LA', '1 E Tornado Rd, TX', '4 W Damascus, GA', '2 E Hail Creek, CO'];
  const TRADES = ['roofing', 'restoration', 'tree-service', 'auto-body', 'auto-glass', 'siding-gutters', 'insurance', 'public-adjuster', 'handyman'] as const;
  it('a gust near a place named like a storm word is never act now for any trade, with or without the report data', () => {
    for (const p of PLACES) {
      const title = `61 mph wind gust reported near ${p}`;
      for (const t of TRADES) {
        expect(labelFor({ source: 'spc', kind: 'report', title, summary: 'Measured gust.' }, t), `${p} ${t}`).not.toBe('act_now');
        expect(labelFor({ source: 'spc', kind: 'report', title, summary: 'Measured gust.', storm: { type: 'wind', windDamage: false } }, t), `${p} ${t} (data)`).not.toBe('act_now');
      }
    }
  });
  it('the hail rule reads the event, not the place: a gust near "Hail Creek" is no hail report for the hail trades', () => {
    for (const t of ['auto-body', 'auto-glass', 'siding-gutters'] as const) {
      expect(labelFor({ source: 'spc', kind: 'report', title: '61 mph wind gust reported near 2 E Hail Creek, CO' }, t), t).not.toBe('act_now');
      expect(labelFor({ source: 'spc', kind: 'report', title: '2.00 inch hail reported near 2 E Hail Creek, CO' }, t), t).toBe('act_now');
    }
  });
});
