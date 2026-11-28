// R25 check fix, review R25CHECK P1-2 and P3-1 (and the verdict half of P2-4).
//   P1-2: a live cell whose ZIP has a zero count (from complete reads) shows the limited head, never "Worth a trial here." over "no alerts".
//   P3-1 / P2-4: a zero count from reads that were clipped or partly failed (atLeast) prints the head only, never the flat "no alerts" claim.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { checkVerdict } from '@/lib/check/verdict';
import { coverageFor } from '@/lib/check/cells';
import { isServedZip } from '@/lib/check/coverage';
import { tradeLabel } from '@/lib/check/trades';
import { lookupZip } from '@/lib/geo';
import { EXPORT, EXPORT_NOW, HAVE_EXPORT, checkFromExport } from '../r25/export-reads';

const zero = { count: 0, places: 0, oldest: null, atLeast: false };
const zeroClipped = { count: 0, places: 0, oldest: null, atLeast: true };

describe('checkVerdict at zero', () => {
  it('live + zero (complete reads): limited head with the zero sentence, EN and ES', () => {
    expect(checkVerdict('live', zero, { tradeLabel: 'Lawn care', zip: '91724', lang: 'en' })).toEqual({
      state: 'limited',
      head: 'Too early to say here.',
      count: 'Recently, no alerts would have been emailed to a lawn care business within 25 miles of 91724.',
    });
    expect(checkVerdict('live', zero, { tradeLabel: 'Corte de césped', zip: '91724', lang: 'es' })).toEqual({
      state: 'limited',
      head: 'Todavía es pronto para saberlo aquí.',
      count: 'Recientemente no se habría enviado ninguna alerta por correo a un negocio de corte de césped a menos de 25 millas de 91724.',
    });
  });
  it('zero from clipped or partial reads: the limited head only, live or limited (R27: a live cell with a zero count never says "Worth a trial here.")', () => {
    expect(checkVerdict('limited', zeroClipped, { tradeLabel: 'Tree service', zip: '60290', lang: 'en' })).toEqual({ state: 'limited', head: 'Too early to say here.', count: null });
    expect(checkVerdict('live', zeroClipped, { tradeLabel: 'Landscaping', zip: '27601', lang: 'en' })).toEqual({ state: 'limited', head: 'Too early to say here.', count: null });
    expect(checkVerdict('limited', zeroClipped, { tradeLabel: 'Servicio de árboles', zip: '60290', lang: 'es' })!.count).toBeNull();
  });
  it('a live cell with a count keeps its head', () => {
    expect(checkVerdict('live', { count: 3, places: 3, oldest: null, atLeast: false }, { tradeLabel: 'Lawn care', zip: '91724', lang: 'en' })!.head).toBe('Worth a trial here.');
  });
});

if (!HAVE_EXPORT) {
  describe('P1-2 on the 14-day export', () => {
    it.skip(`NEEDS the 14-day export at ${EXPORT} (not found, so NOT RUN)`, () => {});
  });
}
describe.skipIf(!HAVE_EXPORT)('P1-2 and P3-1 on the 14-day export (the review cases)', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(EXPORT_NOW);
  });
  afterAll(() => vi.useRealTimers());

  // Round 35: LA lawn care (91724) and New York landscaping (07927) were re-measured to limited, so the two review cases moved to a cell that is
  // still live (Austin landscaping). No live cell in the 14-day export counts zero from complete reads any more, so the totals are the ones those
  // cases produced (count 0 from reads that did not stop at their limit; count 0 from a read that did).
  it('78701 landscaping: a live cell, zero records counted from complete reads, says "Too early to say here." (EN and ES)', () => {
    const zip = '78701';
    const trade = 'landscaping';
    const place = lookupZip(zip)!;
    const cov = coverageFor(place, trade, isServedZip(place));
    expect(cov.state).toBe('live');
    const totals = { count: 0, places: 0, oldest: null, atLeast: false };
    const en = checkVerdict(cov.state, totals, { tradeLabel: tradeLabel(trade), zip, lang: 'en' })!;
    expect(en).toEqual({ state: 'limited', head: 'Too early to say here.', count: 'Recently, no alerts would have been emailed to a landscaping business within 25 miles of 78701.' });
    const es = checkVerdict(cov.state, totals, { tradeLabel: tradeLabel(trade, 'es'), zip, lang: 'es' })!;
    expect(es.head).toBe('Todavía es pronto para saberlo aquí.');
  });

  it('a live cell whose zero comes from a clipped read (a lower bound): never "Worth a trial here." over "no alerts"', () => {
    const zip = '78701';
    const trade = 'landscaping';
    const place = lookupZip(zip)!;
    const cov = coverageFor(place, trade, isServedZip(place));
    expect(cov.state).toBe('live');
    const totals = { count: 0, places: 0, oldest: null, atLeast: true };
    for (const lang of ['en', 'es'] as const) {
      const v = checkVerdict(cov.state, totals, { tradeLabel: tradeLabel(trade, lang), zip, lang })!;
      // The zero is a lower bound, so the page makes no zero claim at all (P2-4, P3-1): the head alone.
      expect(v.count).toBeNull();
      expect(v.state).toBe('limited');
      expect(v.head).toBe(lang === 'en' ? 'Too early to say here.' : 'Todavía es pronto para saberlo aquí.');
    }
  });

  it('60290 tree service (reads clipped, zero counted): head only, no "no alerts" claim', () => {
    const place = lookupZip('60290')!;
    const cov = coverageFor(place, 'tree-service', isServedZip(place));
    const { totals } = checkFromExport('60290', 'tree-service');
    expect(totals).toMatchObject({ count: 0, atLeast: true });
    const v = checkVerdict(cov.state, totals, { tradeLabel: tradeLabel('tree-service'), zip: '60290', lang: 'en' })!;
    expect(v.count).toBeNull();
  });
});
