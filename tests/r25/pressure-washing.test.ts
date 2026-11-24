// Round 25 part 2: /check lists and counts "Pressure washing" the way sign-up saves it (cleaning AND siding-gutters,
// lib/plan/composite-trades.ts), and answers it with the measured composite cell (the measurement's "pw" rollup, COMPOSITE_CELL_TABLE).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

vi.mock('server-only', () => ({}));

import { coverageFor, measuredCell, tradeSignupClosed } from '@/lib/check/cells';
import { COMPOSITE_CELL_TABLE } from '@/lib/check/cells-data';
import { isServedZip } from '@/lib/check/coverage';
import { checkAnswer } from '@/lib/check/answer';
import { parseCheckParams } from '@/lib/check/params';
import { tradeLabel } from '@/lib/check/trades';
import { watchTypes } from '@/lib/check/watch';
import { memberTrades } from '@/lib/check/delivery';
import { checkVerdict } from '@/lib/check/verdict';
import { CheckForm, checkTradeGroups } from '@/components/check-form';
import { PRESSURE_WASHING_ID, PRESSURE_WASHING_PARTS } from '@/lib/plan/composite-trades';
import { lookupZip } from '@/lib/geo';
import { EXPORT, EXPORT_NOW, HAVE_EXPORT, checkFromExport, exportRows, unlimitedEmailed } from './export-reads';
import { emailedByNotify, scanMatches } from './notify-run';

const PLACES: Array<[string, string, string, number]> = [
  // name, ZIP, centre, the subscriber count the R26 review got from the notify route (indep-notify-composite.json)
  ['Charlotte', '28202', 'charlotte', 15],
  ['Atlanta', '30318', 'atlanta', 18],
  ['Raleigh', '27601', 'raleigh', 22],
  ['Austin', '78701', 'austin', 6],
];

describe('the composite cell decides the answer', () => {
  it('coverageFor reads the measured pw rollup, not House cleaning', () => {
    for (const [name, zip, centre] of PLACES) {
      const place = lookupZip(zip)!;
      const pw = coverageFor(place, PRESSURE_WASHING_ID, isServedZip(place));
      expect(pw.centre, name).toBe(centre);
      expect(pw.state, name).toBe(measuredCell(centre, PRESSURE_WASHING_ID));
      expect(checkAnswer(zip, PRESSURE_WASHING_ID)).toEqual(pw);
    }
    expect(['charlotte', 'atlanta', 'raleigh', 'austin'].map((c) => COMPOSITE_CELL_TABLE[c][PRESSURE_WASHING_ID])).toEqual(['live', 'live', 'live', 'limited']);
    // What /check said before (cleaning alone): Charlotte waitlist, Atlanta and Austin limited.
    expect(coverageFor(lookupZip('28202')!, 'cleaning', true).state).toBe('waitlist');
    expect(tradeSignupClosed(PRESSURE_WASHING_ID)).toBe(PRESSURE_WASHING_PARTS.some((p) => tradeSignupClosed(p)));
  });
  it('the query accepts the chip id; the label is "Pressure washing" / "Lavado a presión"', () => {
    expect(parseCheckParams({ zip: '28202', trade: PRESSURE_WASHING_ID })).toEqual({ status: 'ok', zip: '28202', trade: PRESSURE_WASHING_ID });
    expect(parseCheckParams({ zip: '28202', trade: 'pressure' }).status).toBe('invalid');
    expect(tradeLabel(PRESSURE_WASHING_ID)).toBe('Pressure washing');
    expect(tradeLabel(PRESSURE_WASHING_ID, 'es')).toBe('Lavado a presión');
    expect(memberTrades(PRESSURE_WASHING_ID)).toEqual(['cleaning', 'siding-gutters']);
    expect(memberTrades('cleaning')).toEqual(['cleaning']);
  });
  it('the form offers Pressure washing just before House cleaning (EN and ES)', () => {
    for (const lang of ['en', 'es'] as const) {
      const ids = checkTradeGroups('', lang).flatMap((g) => g.options.map((o) => o.id));
      expect(ids.indexOf(PRESSURE_WASHING_ID)).toBe(ids.indexOf('cleaning') - 1);
    }
    const html = renderToStaticMarkup(createElement(CheckForm, { trade: PRESSURE_WASHING_ID }));
    expect(html).toMatch(/<option value="pressure-washing" selected="">Pressure washing<\/option>/);
    expect(html).toContain('<option value="cleaning">House cleaning</option>');
  });
  it('what Holler watches for it is what its two trades watch', () => {
    const both = new Set([...watchTypes('cleaning', 'charlotte-nc'), ...watchTypes('siding-gutters', 'charlotte-nc')]);
    expect(new Set(watchTypes(PRESSURE_WASHING_ID, 'charlotte-nc'))).toEqual(both);
  });
});

if (!HAVE_EXPORT) {
  describe('R25 pressure washing on the 14-day export', () => {
    it.skip(`NEEDS the 14-day export at ${EXPORT} (not found, so NOT RUN)`, () => {});
  });
}
describe.skipIf(!HAVE_EXPORT)('R25 pressure washing on the 14-day export', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(EXPORT_NOW);
  });
  afterAll(() => vi.useRealTimers());
  const recs = () =>
    exportRows().filter((r) => {
      const t = Date.parse(r.occurred_at);
      return t <= EXPORT_NOW.getTime() && t >= EXPORT_NOW.getTime() - 14 * 86_400_000 && !(r.expires_at && Date.parse(r.expires_at) <= EXPORT_NOW.getTime());
    });

  for (const [name, zip, , expected] of PLACES) {
    it(`${name} ${zip}: the count is what a pressure-washing subscriber is emailed (${expected}), the same records the notify route emails`, async () => {
      const { member, totals } = checkFromExport(zip, PRESSURE_WASHING_ID);
      expect(totals.count).toBe(expected);
      expect(unlimitedEmailed(zip, PRESSURE_WASHING_ID).count).toBe(expected);
      const emailed = await emailedByNotify(scanMatches(zip, [...PRESSURE_WASHING_PARTS], recs(), EXPORT_NOW), [...PRESSURE_WASHING_PARTS]);
      expect(emailed.size).toBe(expected);
      expect(member.filter((i) => i.delivery === 'email').map((i) => i.id).sort()).toEqual([...emailed].sort());
      const place = lookupZip(zip)!;
      const v = checkVerdict(coverageFor(place, PRESSURE_WASHING_ID, isServedZip(place)).state, totals, { tradeLabel: 'Pressure washing', zip, lang: 'en' })!;
      expect(v.count).toContain(`${totals.atLeast ? 'at least ' : ''}${expected} alerts would have been emailed to a pressure washing business within 25 miles of ${zip}`);
    }, 120_000);
  }
});
