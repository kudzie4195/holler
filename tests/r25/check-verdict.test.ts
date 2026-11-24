// Round 25 part 1: the verdict and the counted sentence above the /check results (lib/check/verdict.ts, lib/check/delivery.ts alertTotals).
// The number is computed over EVERY member item (not the 20 listed), counting only rows marked 'email'. Proved on the 14-day export
// (gates/r19/data/signals-14d.json, read only) against the REAL notify route for Austin 78701 lawn care, the case the R26 review flagged.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));

import { alertTotals } from '@/lib/check/delivery';
import { checkVerdict } from '@/lib/check/verdict';
import { coverageFor } from '@/lib/check/cells';
import { isServedZip } from '@/lib/check/coverage';
import { lookupZip } from '@/lib/geo';
import { CheckResults } from '@/components/check-results';
import type { CheckItem } from '@/lib/check/group';
import { EXPORT, EXPORT_NOW, HAVE_EXPORT, checkFromExport, exportRows, unlimitedEmailed } from './export-reads';
import { emailedByNotify, scanMatches } from './notify-run';

const BANNED = /\bleads?\b|guaranteed|you will win|they need you|knock doors|14 days|\bdays?\b|días|—|\bsince\b|\bdesde\b/i;

describe('alertTotals: counts only rows marked emailed, over every item given', () => {
  const it0 = { id: 1, occurredAt: '2026-11-20T12:00:00Z', lat: 35.2, lon: -80.8, place: 'Charlotte, NC' };
  it('feed rows are never counted; places are distinct points; the oldest counted row gives the date', () => {
    const items = [
      { ...it0, id: 1, delivery: 'email' as const },
      { ...it0, id: 2, delivery: 'email' as const, occurredAt: '2026-11-12T05:00:00Z' },
      { ...it0, id: 3, delivery: 'email' as const, lat: 35.3 },
      { ...it0, id: 4, delivery: 'feed' as const, occurredAt: '2026-11-01T00:00:00Z' },
      { ...it0, id: 5, delivery: 'email' as const, lat: null, lon: null, place: 'NC' },
    ];
    expect(alertTotals(items, false)).toEqual({ count: 4, places: 3, oldest: '2026-11-12T05:00:00Z', atLeast: false });
    expect(alertTotals(items, true).atLeast).toBe(true);
    expect(alertTotals([], false)).toEqual({ count: 0, places: 0, oldest: null, atLeast: false });
  });
});

describe('checkVerdict wording (EN and ES)', () => {
  const ctx = { tradeLabel: 'Landscaping', zip: '28202' };
  const totals = { count: 91, places: 91, oldest: '2026-11-12T05:00:00Z', atLeast: false };
  // R25 check fix (review R25CHECK P1-3): the sentence says the records would have reached the member as alerts, that each email lists up
  // to 10, and names no date (the heading under it says the window).
  it('live: "Worth a trial here." and one counted sentence with "recently", no date and no window length', () => {
    const en = checkVerdict('live', totals, { ...ctx, lang: 'en' })!;
    expect(en.head).toBe('Worth a trial here.');
    expect(en.count).toBe('Recently, 91 records near 28202 would have reached a landscaping business as alerts, at 91 different places. Each email lists up to 10; the rest are on your matches page.');
    const es = checkVerdict('live', totals, { ...ctx, tradeLabel: 'Jardinería', lang: 'es' })!;
    expect(es.head).toBe('Vale la pena probarlo aquí.');
    expect(es.count).toBe('Recientemente, 91 registros cerca de 28202 habrían llegado como alertas a un negocio de jardinería, en 91 lugares distintos. Cada correo muestra hasta 10; los demás están en su página de coincidencias.');
    for (const v of [en, es]) expect(`${v.head} ${v.count}`).not.toMatch(BANNED);
  });
  it('limited: "Too early to say here." with the count, or a plain line when there were none', () => {
    expect(checkVerdict('limited', { count: 5, places: 5, oldest: '2026-11-10T21:07:42Z', atLeast: false }, { ...ctx, tradeLabel: 'Siding and gutters', zip: '27601', lang: 'en' })).toEqual({
      state: 'limited',
      head: 'Too early to say here.',
      count: 'Recently, 5 records near 27601 would have reached a siding and gutters business as alerts, at 5 different places. Each email lists up to 10; the rest are on your matches page.',
    });
    const none = checkVerdict('limited', { count: 0, places: 0, oldest: null, atLeast: false }, { ...ctx, tradeLabel: 'Lawn care', lang: 'en' })!;
    expect(none.count).toBe('Recently, no alerts would have been emailed to a lawn care business within 25 miles of 28202.');
    const noneEs = checkVerdict('limited', { count: 0, places: 0, oldest: null, atLeast: false }, { ...ctx, tradeLabel: 'Corte de césped', lang: 'es' })!;
    expect(noneEs.head).toBe('Todavía es pronto para saberlo aquí.');
    expect(noneEs.count).toBe('Recientemente no se habría enviado ninguna alerta por correo a un negocio de corte de césped a menos de 25 millas de 28202.');
  });
  it('a read that stopped at its limit says "at least"; one record is singular', () => {
    expect(checkVerdict('live', { count: 158, places: 146, oldest: '2026-11-09T12:00:00Z', atLeast: true }, { ...ctx, tradeLabel: 'Lawn care', zip: '78701', lang: 'en' })!.count).toBe(
      'Recently, at least 158 records near 78701 would have reached a lawn care business as alerts, at 146 different places. Each email lists up to 10; the rest are on your matches page.',
    );
    expect(checkVerdict('live', { count: 158, places: 146, oldest: '2026-11-09T12:00:00Z', atLeast: true }, { ...ctx, tradeLabel: 'Corte de césped', zip: '78701', lang: 'es' })!.count).toContain('al menos 158 registros');
    expect(checkVerdict('limited', { count: 1, places: 1, oldest: '2026-11-17T00:00:00Z', atLeast: false }, { ...ctx, tradeLabel: 'Siding and gutters', zip: '30318', lang: 'en' })!.count).toBe(
      'Recently, 1 record near 30318 would have reached a siding and gutters business as an alert.',
    );
  });
  it('waitlist: no block at all', () => {
    expect(checkVerdict('waitlist', totals, { ...ctx, lang: 'en' })).toBeNull();
    expect(checkVerdict('waitlist', totals, { ...ctx, lang: 'es' })).toBeNull();
  });
  it('no date in the sentence, whatever the oldest counted record (R25 check fix, review R25CHECK P1-3 and P3-3)', () => {
    for (const oldest of ['2026-11-12T05:00:00Z', '2026-12-03T00:00:00Z', 'garbage']) {
      for (const lang of ['en', 'es'] as const) {
        const v = checkVerdict('live', { ...totals, oldest }, { ...ctx, lang })!;
        expect(v.count).not.toMatch(/\b(since|desde|Nov|nov|Dec|dic)\b|undefined|NaN/);
      }
    }
  });
});

describe('the block renders above the results; waitlist pages are unchanged', () => {
  const base = { id: 1, kind: 'permit', source: 'socrata-austin-permits', title: 'New construction permit in Austin', url: 'https://example.com/x', place: 'Austin, TX', lat: 30.27, lon: -97.74, occurredAt: '2026-11-20T12:00:00Z', severity: 1, delivery: 'email' as const };
  const render = (coverageState: 'live' | 'limited' | 'waitlist', lang: 'en' | 'es') => {
    const verdict = checkVerdict(coverageState, alertTotals([base], false), { tradeLabel: 'Landscaping', zip: '78701', lang });
    return renderToStaticMarkup(
      createElement(CheckResults, { items: [base] as CheckItem[], mode: 'results', checkedAt: '2026-11-23T12:00:00Z', placeLabel: 'Austin, TX', trade: 'landscaping', tradeLabel: 'Landscaping', citySlug: 'austin-tx', watches: [], now: EXPORT_NOW.getTime(), origin: { lat: 30.27, lon: -97.74 }, lang, coverageState, verdict }),
    );
  };
  it('live and limited: the verdict comes before the list heading', () => {
    for (const st of ['live', 'limited'] as const) {
      const html = render(st, 'en');
      expect(html).toContain(`data-verdict="${st}"`);
      expect(html.indexOf('check-verdict')).toBeLessThan(html.indexOf('id="check-heading"'));
    }
    expect(render('live', 'es')).toContain('Vale la pena probarlo aquí.');
  });
  it('waitlist: no verdict, no price, no trial, no sign-up link', () => {
    const html = render('waitlist', 'en');
    expect(html).not.toContain('check-verdict');
    expect(html).not.toMatch(/\/signup|\$\d|free trial/i);
  });
});

if (!HAVE_EXPORT) {
  describe('R25 count on the 14-day export', () => {
    it.skip(`NEEDS the 14-day export at ${EXPORT} (not found, so NOT RUN)`, () => {});
  });
}
describe.skipIf(!HAVE_EXPORT)('R25 count on the 14-day export', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(EXPORT_NOW);
  });
  afterAll(() => vi.useRealTimers());

  it('Austin 78701 lawn care: the headline is the emailed count (158), never the 181 rows a member would see, and equals what the notify route emails', async () => {
    const { member, totals } = checkFromExport('78701', 'lawn-care');
    const feed = member.filter((i) => i.delivery === 'feed');
    expect(member.length).toBe(181);
    expect(feed.length).toBe(23);
    expect(totals.count).toBe(158);
    expect(totals.count).toBe(member.length - feed.length);
    // The reads behind it stopped at their limit (the routed permit reads), so the page says "at least".
    expect(totals.atLeast).toBe(true);
    expect(unlimitedEmailed('78701', 'lawn-care').count).toBe(158);
    // The real notify route, over every export row in the window, emails exactly the records the page counts.
    const now = EXPORT_NOW;
    const recs = exportRows().filter((r) => {
      const t = Date.parse(r.occurred_at);
      return t <= now.getTime() && t >= now.getTime() - 14 * 86_400_000 && !(r.expires_at && Date.parse(r.expires_at) <= now.getTime());
    });
    const emailed = await emailedByNotify(scanMatches('78701', ['lawn-care'], recs, now), ['lawn-care']);
    expect(emailed.size).toBe(158);
    const counted = new Set(member.filter((i) => i.delivery === 'email').map((i) => i.id));
    expect([...counted].sort()).toEqual([...emailed].sort());
    // What the 158 are (for the report): Austin code-violation cards the route really emails, plus new-home permits.
    const bySource: Record<string, number> = {};
    for (const i of member.filter((x) => x.delivery === 'email')) bySource[i.source] = (bySource[i.source] ?? 0) + 1;
    expect(bySource['socrata-austin-violations']).toBe(155);
    const verdict = checkVerdict(coverageFor(lookupZip('78701')!, 'lawn-care', isServedZip(lookupZip('78701')!)).state, totals, { tradeLabel: 'Lawn care', zip: '78701', lang: 'en' })!;
    expect(verdict.head).toBe('Worth a trial here.');
    expect(verdict.count).toBe('Recently, at least 158 records near 78701 would have reached a lawn care business as alerts, at 146 different places. Each email lists up to 10; the rest are on your matches page.');
  }, 120_000);

  it('Charlotte 28202 landscaping: 91, the full emailed set (with 100-row reads it read 22)', () => {
    const { totals } = checkFromExport('28202', 'landscaping');
    expect(totals).toMatchObject({ count: 91, atLeast: false });
    expect(unlimitedEmailed('28202', 'landscaping').count).toBe(91);
  });
});
