// R27 (review FIXR25 P3 notes 2 and 4): the cap sentence only above the cap; a zero count never promises email on the button.
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));

import { checkVerdict } from '@/lib/check/verdict';
import { CheckResults } from '@/components/check-results';

const t = (count: number, atLeast = false) => ({ count, places: count, oldest: null, atLeast });
const ctx = { tradeLabel: 'Lawn care', zip: '28202' };
const CAP_EN = 'Each email lists up to 10; the rest are on your matches page.';
const CAP_ES = 'Cada correo muestra hasta 10; los demás están en su página de coincidencias.';

describe('note 4: the cap sentence only when the count is above 10', () => {
  it('2, 10: no cap sentence (EN and ES)', () => {
    for (const n of [2, 10]) {
      expect(checkVerdict('live', t(n), { ...ctx, lang: 'en' })!.count).not.toContain('Each email');
      expect(checkVerdict('live', t(n), { ...ctx, lang: 'es' })!.count).not.toContain('Cada correo');
    }
  });
  it('11: the cap sentence is printed (EN and ES)', () => {
    expect(checkVerdict('live', t(11), { ...ctx, lang: 'en' })!.count).toContain(CAP_EN);
    expect(checkVerdict('live', t(11), { ...ctx, lang: 'es', tradeLabel: 'Corte de césped' })!.count).toContain(CAP_ES);
  });
});

describe('note 2: a zero count never promises email on the button', () => {
  const render = (items: never[], emailedTotal: number | null, lang: 'en' | 'es') =>
    renderToStaticMarkup(
      createElement(CheckResults, { items, mode: 'results', checkedAt: '2026-11-23T12:00:00Z', placeLabel: 'Covina, CA', trade: 'lawn-care', tradeLabel: 'Lawn care', citySlug: 'covina-ca', watches: [], now: Date.parse('2026-11-24T12:00:00Z'), lang, emailedTotal }),
    );
  it('empty list, count 0: trial-only button (EN and ES)', () => {
    const en = render([], 0, 'en');
    expect(en).toContain('Start your 30-day free trial, no card');
    expect(en).not.toContain('Get alerts by email');
    const es = render([], 0, 'es');
    expect(es).not.toContain('Reciba alertas por correo');
    expect(es).toContain('Empiece su');
  });
  it('empty list, count above 0: still the email button', () => {
    expect(render([], 5, 'en')).toContain('Get alerts by email');
  });
});
