/**
 * Round 18 integration, Part B item 1: the SPC adapter's wind card (title, severity, label) uses the same damage rule as the address lists
 * (lib/signals/wind-damage.ts remarkNamesWindDamage) instead of the old loose word test /damage|down|blown|uproot|snapped|power|roof|tree/i.
 * Table and helper: tests/lists/wind-remarks.ts (the reviewer's 115 remarks, round 18 LISTS review 2), each remark through the REAL scanSpc.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { scanSpc } from '@/lib/signals/adapters/spc';
import { R, through } from '../lists/wind-remarks';

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

  it('a measured gust keeps a neutral title that never says damage, whatever the remark', () => {
    for (const [remark] of R) {
      const m = through(remark, '61');
      expect(m.title).toBe('61 mph wind gust reported near 2 N Smyrna, GA');
      expect(m.title).not.toMatch(/damage/i);
      expect(m.cardLabel).toBe('coming_soon');
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
      expect(unk.cardLabel, remark).toBe('act_now');
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
