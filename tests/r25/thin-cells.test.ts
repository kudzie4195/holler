// Round 25 part 3: a limited cell links the free city records page next to the trial offer, and "What Holler reads near you"
// (lib/check/coverage.ts localSourcesNear) shows whenever the page has results, not only when the list is empty.
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));

import { CheckResults } from '@/components/check-results';
import { checkCityLink, checkReads } from '@/lib/check/reads';
import { localSourcesNear } from '@/lib/check/coverage';
import { cityBySlug, lookupZip } from '@/lib/geo';
import type { CheckItem } from '@/lib/check/group';

const NOW = new Date('2026-11-23T12:00:00Z').getTime();
const item: CheckItem = { id: 1, kind: 'permit', source: 'socrata-austin-permits', title: 'New construction permit in Austin', url: 'https://example.com/x', place: 'Austin, TX', lat: 30.27, lon: -97.74, occurredAt: '2026-11-20T12:00:00Z', severity: 1, delivery: 'email' };

function render(coverageState: 'live' | 'limited' | 'waitlist', items: CheckItem[], lang: 'en' | 'es') {
  const place = lookupZip('78701')!;
  return renderToStaticMarkup(
    createElement(CheckResults, {
      items, mode: 'results', checkedAt: '2026-11-23T12:00:00Z', placeLabel: 'Austin, TX', trade: 'siding-gutters', tradeLabel: 'Siding and gutters', citySlug: 'austin-tx', watches: [], now: NOW,
      origin: { lat: place.lat, lon: place.lon }, lang, coverageState,
      cityLink: checkCityLink(cityBySlug('austin-tx')!, lang), reads: checkReads(place, '78701', lang),
    }),
  );
}

describe('limited cell: the free city records page next to the trial offer', () => {
  it('EN and ES, with results and with an empty list', () => {
    for (const items of [[item], []]) {
      const en = render('limited', items, 'en');
      expect(en).toContain('href="/local/texas/austin-tx"');
      expect(en).toContain('See the free public records for Austin');
      // Next to the trial: inside the offer block, after the button.
      expect(en.indexOf('check-city-link')).toBeGreaterThan(en.indexOf('/signup?city=austin-tx'));
      const es = render('limited', items, 'es');
      expect(es).toContain('Vea gratis los registros públicos de Austin (página en inglés)');
      expect(es).toContain('/es/signup?city=austin-tx');
    }
  });
  it('a live cell and a waitlist cell show no such link', () => {
    expect(render('live', [item], 'en')).not.toContain('check-city-link');
    expect(render('waitlist', [item], 'en')).not.toContain('check-city-link');
    expect(render('waitlist', [], 'en')).toBe('');
  });
});

describe('"What Holler reads near you" whenever there are results', () => {
  it('names the local feeds near 78701 once each, EN and ES', () => {
    const r = checkReads(lookupZip('78701')!, '78701', 'en');
    expect(localSourcesNear(lookupZip('78701')!.lat, lookupZip('78701')!.lon).length).toBeGreaterThan(0);
    expect(r.labels).toEqual(['Austin open data: building permits', 'Austin open data: 311 requests', 'Austin open data: food inspections', 'Austin open data: code violations']);
    const en = render('live', [item], 'en');
    expect(en).toContain('What Holler reads near you');
    for (const l of r.labels) expect(en).toContain(l);
    expect(en).toContain('Local public feeds based within 25 miles of 78701.');
    const es = render('limited', [item], 'es');
    expect(es).toContain('Lo que Holler lee cerca de usted');
    expect(es).toContain('Datos abiertos de Austin: permisos de construcción');
    // Also with an empty list (the old watch list stays there too).
    expect(render('live', [], 'en')).toContain('What Holler reads near you');
  });
  it('Atlanta 30318 lists each county feed label once', () => {
    const labels = checkReads(lookupZip('30318')!, '30318', 'en').labels;
    expect(labels).toEqual([...new Set(labels)]);
    expect(labels).toContain('Cobb County open data: building permits');
    expect(labels).toContain('DeKalb County open data: code violations');
    const es = checkReads(lookupZip('30318')!, '30318', 'es').labels;
    expect(es).toContain('Datos abiertos del condado de Cobb: permisos de construcción');
    expect(es).toContain('Datos abiertos de Atlanta: permisos de construcción');
    expect(es.join(' ')).not.toMatch(/County/);
  });
});
