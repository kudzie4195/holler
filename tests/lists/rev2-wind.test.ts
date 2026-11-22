/**
 * Round 18 unit LISTS, review 2 (redo 2): the reviewer's 115-remark wind table (logs/REV2-LISTS-probe-tests/rev2-wind.probe.test.ts), kept as a
 * permanent regression test. The bar: ZERO false positives in either form; false negatives are allowed and pinned below.
 * Every remark goes through the REAL SPC adapter (scanSpc) twice: as a measured 61 mph gust and as an "UNK" speed report, and the stored row is
 * then given to stormKindOf exactly as lib/lists/load.ts selects it (title, data.type, data.windMph, data.comments).
 * A row marked `no` (must make no list) that comes back 'wind' in EITHER form is a defect: weather must never claim damage.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { scanSpc } from '@/lib/signals/adapters/spc';
import { stormKindOf } from '@/lib/lists/core';
import { R, through } from './wind-remarks';

describe('REV2 wind-damage rule', () => {
  const out: string[] = ['# | remark | want | 61 mph: list? | UNK: stored? | UNK: list? | verdict | from'];
  const fp: string[] = [];
  const fn: string[] = [];
  R.forEach(([remark, want, from], i) => {
    const m = through(remark, '61');
    const u = through(remark, 'UNK');
    const mList = m.kind === 'wind' && m.label !== null;
    const uList = u.stored && u.kind === 'wind' && u.label !== null;
    let verdict = 'ok';
    if (want === 'no' && (mList || uList)) { verdict = `FALSE POSITIVE (${[mList ? 'measured' : '', uList ? 'UNK' : ''].filter(Boolean).join('+')})`; fp.push(remark); }
    if (want === 'yes' && !(mList && (uList || !u.stored))) {
      if (!mList) { verdict = 'false negative (measured)'; fn.push(remark); }
    }
    if (want === 'yes' && !u.stored) verdict = verdict === 'ok' ? 'ok (UNK form not stored by adapter)' : `${verdict}; UNK form not stored by adapter`;
    out.push(`${i + 1} | ${remark} | ${want} | ${mList ? 'LIST' : '-'} | ${u.stored ? 'stored' : 'dropped'} | ${uList ? 'LIST' : '-'} | ${verdict} | ${from}`);
  });
  const summary = [
    `remarks: ${R.length} (must-not ${R.filter((x) => x[1] === 'no').length}, should ${R.filter((x) => x[1] === 'yes').length})`,
    `CURRENT RULE false positives: ${fp.length}`, ...fp.map((x) => `  FP: ${x}`),
    `CURRENT RULE false negatives (measured form): ${fn.length}`, ...fn.map((x) => `  FN: ${x}`),
  ];
  console.log(out.join('\n'));
  console.log(summary.join('\n'));
  if (process.env.REV2_OUT) writeFileSync(process.env.REV2_OUT, out.join('\n') + '\n\n' + summary.join('\n') + '\n');

  it('every SPC wind fixture row in the repo: only the damage report is flagged', () => {
    for (const [f, type] of [['tests/fixtures/spc-wind.csv', 'wind'], ['tests/fixtures/spc-filtered-combined.csv', 'torn']] as const) {
      const wind = scanSpc({ csv: readFileSync(f, 'utf8'), type, day: '2026-11-20' }).signals.filter((x) => (x.data as { type?: string }).type === 'wind');
      const flagged = wind.filter((x) => {
        const d = x.data as { windMph?: number; comments?: string };
        return stormKindOf({ source: 'spc', title: x.title, stormType: 'wind', hailInches: null, windMph: d.windMph ?? null, comments: d.comments }) === 'wind';
      });
      console.log(f, wind.map((x) => x.title), '=> flagged', flagged.map((x) => x.title));
      expect(flagged.map((x) => x.title)).toEqual(['Wind damage reported near 1 W Grannis, AR']);
    }
  });
  it('no must-not remark makes a wind list in either form, measured gust or UNK speed (zero false positives)', () => {
    expect(fp).toEqual([]);
  });
  it('the table is the reviewer table: 115 remarks, 71 must-not', () => {
    expect(R.length).toBe(115);
    expect(R.filter((x) => x[1] === 'no').length).toBe(71);
  });
  it('false negatives are allowed but pinned: a real report with no list is the safe side; any new one is a deliberate change', () => {
    expect(fn).toEqual([
      'Siding torn from a house.',
      'Fence flattened and a shed overturned.',
      'Windows broken at a gas station.',
      'Semi overturned on I-40.',
      'Utility poles leaning.',
      'Mobile home rolled.',
      'Large branch fell on a car.',
      'TSTM WND DMG. Multiple trees and powerlines dwn.',
      'Gutters ripped off a home.',
    ]);
  });
});
