// R25 check fix, review R25CHECK P1-1: the verdict counts emailed records, so the list under it must show them and the offer must follow
// the count. Across every marketed cell (Atlanta 30318, Austin 78701, Charlotte 28202, Raleigh 27601 x landscaping, lawn-care,
// siding-gutters, pressure-washing) on the 14-day export: counted > 0 implies at least one listed row is marked emailed, the offer is the
// email variant, and the per-list line speaks only of the rows shown ("Of the N shown here, ...").
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));

import { CheckResults, deliveryCountLine } from '@/components/check-results';
import { groupItems, type CheckItem } from '@/lib/check/group';
import { coverageFor } from '@/lib/check/cells';
import { isServedZip } from '@/lib/check/coverage';
import { checkVerdict } from '@/lib/check/verdict';
import { tradeLabel } from '@/lib/check/trades';
import { lookupZip } from '@/lib/geo';
import { EXPORT, EXPORT_NOW, HAVE_EXPORT, checkFromExport } from '../r25/export-reads';

const ZIPS = ['30318', '78701', '28202', '27601'];
const TRADES = ['landscaping', 'lawn-care', 'siding-gutters', 'pressure-washing'];
const NOW = EXPORT_NOW.getTime();

describe('group order: inside the local and the rest ranks, emailed rows come before matches-page rows', () => {
  const base = { kind: 'permit', source: 'x', title: 't', url: null, place: 'Charlotte, NC', occurredAt: '2026-11-20T12:00:00Z', severity: 1 };
  it('nine feed rows closer and newer than one emailed row: the emailed row is kept under the cap of 8 and listed first', () => {
    const origin = { lat: 35.227, lon: -80.843 };
    const feed: CheckItem[] = Array.from({ length: 9 }, (_, i) => ({ ...base, id: i + 1, lat: origin.lat + 0.001 * i, lon: origin.lon, occurredAt: '2026-11-22T12:00:00Z', delivery: 'feed' as const }));
    const email: CheckItem = { ...base, id: 99, lat: origin.lat + 0.1, lon: origin.lon, occurredAt: '2026-11-10T12:00:00Z', delivery: 'email' };
    const far: CheckItem = { ...base, id: 98, lat: origin.lat + 0.6, lon: origin.lon, occurredAt: '2026-11-01T12:00:00Z', delivery: 'email' };
    const listed = groupItems([...feed, email, far], NOW, origin).flatMap((g) => g.items);
    expect(listed).toHaveLength(8);
    expect(listed[0].id).toBe(99);
    // a row beyond 25 miles is still after every local row
    expect(listed.map((i) => i.id)).not.toContain(98);
  });
});

describe('the per-list line speaks only of the rows shown (EN and ES)', () => {
  const row = (id: number, delivery: 'email' | 'feed'): CheckItem => ({ id, kind: 'permit', source: 'x', title: 't', url: null, place: 'A', occurredAt: '2026-11-20T12:00:00Z', severity: 1, delivery });
  it('none, some, all, one', () => {
    expect(deliveryCountLine([row(1, 'feed'), row(2, 'feed')], 'en')).toBe('Of the 2 shown here, none would have been emailed to you. They would be on your matches page.');
    expect(deliveryCountLine([row(1, 'email'), row(2, 'feed')], 'en')).toBe('Of the 2 shown here, 1 would have been emailed to you as an alert. The rest would be on your matches page.');
    expect(deliveryCountLine([row(1, 'email'), row(2, 'email'), row(3, 'feed')], 'en')).toBe('Of the 3 shown here, 2 would have been emailed to you as alerts. The rest would be on your matches page.');
    expect(deliveryCountLine([row(1, 'email'), row(2, 'email')], 'en')).toBe('Of the 2 shown here, all would have been emailed to you as alerts.');
    expect(deliveryCountLine([row(1, 'email')], 'en')).toBe('The one record shown here would have been emailed to you as an alert.');
    expect(deliveryCountLine([row(1, 'feed')], 'en')).toBe('The one record shown here would not have been emailed to you. It would be on your matches page.');
    expect(deliveryCountLine([row(1, 'feed'), row(2, 'feed')], 'es')).toBe('De los 2 que se muestran aquí, ninguno se le habría enviado por correo. Estarían en su página de coincidencias.');
    expect(deliveryCountLine([row(1, 'email'), row(2, 'email'), row(3, 'feed')], 'es')).toBe('De los 3 que se muestran aquí, 2 se le habrían enviado por correo como alertas. Los demás estarían en su página de coincidencias.');
    expect(deliveryCountLine([row(1, 'email'), row(2, 'feed')], 'es')).toBe('De los 2 que se muestran aquí, 1 se le habría enviado por correo como alerta. Los demás estarían en su página de coincidencias.');
    expect(deliveryCountLine([row(1, 'email'), row(2, 'email')], 'es')).toBe('De los 2 que se muestran aquí, todos se le habrían enviado por correo como alertas.');
    expect(deliveryCountLine([row(1, 'email')], 'es')).toBe('El registro que se muestra aquí se le habría enviado por correo como alerta.');
    expect(deliveryCountLine([row(1, 'feed')], 'es')).toBe('El registro que se muestra aquí no se le habría enviado por correo. Estaría en su página de coincidencias.');
  });
  it('the offer follows the verdict count, not the listed rows: a feed-only list under a count of 15 still offers alerts by email', () => {
    const items = [row(1, 'feed'), row(2, 'feed')];
    const render = (emailedTotal: number | null) =>
      renderToStaticMarkup(
        createElement(CheckResults, { items, mode: 'results', checkedAt: '2026-11-23T12:00:00Z', placeLabel: 'Charlotte, NC', trade: 'pressure-washing', tradeLabel: 'Pressure washing', citySlug: 'charlotte-nc', watches: [], now: NOW, lang: 'en', emailedTotal }),
      );
    expect(render(15)).toContain('Get alerts by email. 30-day free trial, no card');
    expect(render(0)).toContain('Start your 30-day free trial, no card');
    expect(render(null)).toContain('Start your 30-day free trial, no card');
  });
});

if (!HAVE_EXPORT) {
  describe('P1-1 on the 14-day export', () => {
    it.skip(`NEEDS the 14-day export at ${EXPORT} (not found, so NOT RUN)`, () => {});
  });
}
describe.skipIf(!HAVE_EXPORT)('P1-1 on the 14-day export: every marketed cell', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(EXPORT_NOW);
  });
  afterAll(() => vi.useRealTimers());

  for (const zip of ZIPS) {
    for (const trade of TRADES) {
      it(`${zip} ${trade}: counted > 0 implies a listed row marked emailed and the email offer (EN and ES)`, () => {
        const place = lookupZip(zip)!;
        const cov = coverageFor(place, trade, isServedZip(place));
        const { member, totals } = checkFromExport(zip, trade);
        const listed = groupItems(member as CheckItem[], NOW, place, 'en').flatMap((g) => g.items);
        const listedEmailed = listed.filter((i) => i.delivery === 'email').length;
        if (totals.count > 0) expect(listedEmailed, `${zip} ${trade} counted ${totals.count}`).toBeGreaterThan(0);
        // Every listed emailed row is before every listed feed row inside its group's local rank, so the list shows the emailed ones first.
        for (const lang of ['en', 'es'] as const) {
          const verdict = checkVerdict(cov.state, totals, { tradeLabel: tradeLabel(trade, lang), zip, lang });
          const html = renderToStaticMarkup(
            createElement(CheckResults, {
              items: member as CheckItem[], mode: 'results', checkedAt: '2026-11-23T12:00:00Z', placeLabel: `${place.city}, ${place.state}`, trade, tradeLabel: tradeLabel(trade, lang),
              citySlug: null, watches: [], now: NOW, origin: { lat: place.lat, lon: place.lon }, lang, coverageState: cov.state, verdict, emailedTotal: totals.count,
            }),
          );
          if (cov.state === 'waitlist') continue;
          if (totals.count > 0) {
            expect(html).toContain(lang === 'en' ? 'Get alerts by email' : 'Reciba alertas por correo');
            expect(html).not.toContain(lang === 'en' ? 'Start your 30-day free trial' : 'Empiece su prueba gratis');
          }
          expect(html).toContain(lang === 'en' ? (listed.length === 1 ? 'The one record shown here' : `Of the ${listed.length} shown here, `) : listed.length === 1 ? 'El registro que se muestra aquí' : `De los ${listed.length} que se muestran aquí, `);
          expect(html).not.toMatch(/None of these|Ninguno de estos/);
        }
      });
    }
  }

  it('Charlotte 28202 pressure washing (the review case): 15 counted, and emailed rows are now listed', () => {
    const place = lookupZip('28202')!;
    const { member, totals } = checkFromExport('28202', 'pressure-washing');
    expect(totals.count).toBe(15);
    const listed = groupItems(member as CheckItem[], NOW, place, 'en').flatMap((g) => g.items);
    expect(listed.filter((i) => i.delivery === 'email').length).toBe(8);
  });
});
