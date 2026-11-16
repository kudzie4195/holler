import { describe, expect, it } from 'vitest';
import { CITIES, STATES, citiesInState, cityBySlug, haversineMi, lookupZip, nearbyCities, nearestCity, stateBySlug } from '../../lib/geo';
import { INDEX_MIN_SIGNALS, isIndexable } from '../../lib/seo/threshold';
import { selectIndexableCities, FALLBACK_CITY_COUNT } from '../../lib/seo/select';
import { summarize, type SignalRowDb } from '../../lib/seo/summarize';
import { buildIntro, buildHelps } from '../../lib/seo/view';
import { sectionFor } from '../../lib/seo/sections';
import { jsonLdString } from '../../lib/seo/serialize';

describe('cities data', () => {
  it('has roughly 950 US cities sorted by population with unique slugs', () => {
    expect(CITIES.length).toBeGreaterThan(900);
    expect(CITIES.length).toBeLessThan(1000);
    expect(new Set(CITIES.map((c) => c.slug)).size).toBe(CITIES.length);
    for (let i = 1; i < CITIES.length; i++) expect(CITIES[i - 1].population).toBeGreaterThanOrEqual(CITIES[i].population);
    expect(CITIES.every((c) => c.population >= 50000)).toBe(true);
    expect(CITIES.every((c) => /^[a-z0-9]+(-[a-z0-9]+)*-[a-z]{2}$/.test(c.slug))).toBe(true);
  });
  it('looks cities up', () => {
    const atl = cityBySlug('atlanta-ga');
    expect(atl).toMatchObject({ name: 'Atlanta', state: 'GA', stateName: 'Georgia' });
    expect(citiesInState('GA')[0].slug).toBe('atlanta-ga');
    expect(cityBySlug('nowhere-zz')).toBeUndefined();
  });
});

describe('STATES', () => {
  it('has 51 entries (50 states plus DC) with slugs', () => {
    expect(STATES).toHaveLength(51);
    expect(stateBySlug('georgia')).toEqual({ code: 'GA', name: 'Georgia', slug: 'georgia' });
    expect(stateBySlug('new-york')?.code).toBe('NY');
    expect(stateBySlug('district-of-columbia')?.code).toBe('DC');
    expect(new Set(STATES.map((s) => s.slug)).size).toBe(51);
  });
});

describe('nearestCity', () => {
  it('maps Decatur GA to Atlanta within 40 miles', () => {
    const z = lookupZip('30030')!;
    const c = nearestCity(z.lat, z.lon, 40);
    expect(c?.slug).toBe('atlanta-ga');
  });
  it('returns null in the middle of the Nevada desert', () => {
    expect(nearestCity(38.0, -116.5)).toBeNull();
  });
  it('respects maxMi', () => {
    expect(nearestCity(33.7699, -84.295, 1)).toBeNull();
    expect(nearestCity(33.749, -84.388, 1)?.slug).toBe('atlanta-ga');
  });
  it('rejects bad input', () => {
    expect(nearestCity(NaN, 0)).toBeNull();
  });
  it('nearbyCities returns n others, closest first', () => {
    const n = nearbyCities('atlanta-ga', 6);
    expect(n).toHaveLength(6);
    expect(n.some((c) => c.slug === 'atlanta-ga')).toBe(false);
    const atl = cityBySlug('atlanta-ga')!;
    const d = n.map((c) => haversineMi(atl.lat, atl.lon, c.lat, c.lon));
    expect([...d].sort((a, b) => a - b)).toEqual(d);
  });
});

describe('haversineMi', () => {
  it('Atlanta to Decatur is about 6 miles; NYC to LA about 2450', () => {
    expect(haversineMi(33.749, -84.388, 33.7748, -84.2963)).toBeGreaterThan(5);
    expect(haversineMi(33.749, -84.388, 33.7748, -84.2963)).toBeLessThan(7);
    const d = haversineMi(40.7128, -74.006, 34.0522, -118.2437);
    expect(d).toBeGreaterThan(2400);
    expect(d).toBeLessThan(2500);
  });
});

describe('lookupZip', () => {
  it('30030 is Decatur GA', () => {
    expect(lookupZip('30030')).toMatchObject({ zip: '30030', city: 'Decatur', state: 'GA' });
  });
  it('rejects junk', () => {
    expect(lookupZip('abcde')).toBeNull();
    expect(lookupZip('')).toBeNull();
    expect(lookupZip('00000')).toBeNull();
  });
});

describe('index threshold', () => {
  it('requires 5 signals', () => {
    expect(INDEX_MIN_SIGNALS).toBe(5);
    expect(isIndexable(4)).toBe(false);
    expect(isIndexable(5)).toBe(true);
    expect(isIndexable(0)).toBe(false);
    expect(isIndexable(NaN)).toBe(false);
  });
});

describe('sitemap selection', () => {
  it('falls back to the top 200 cities when counts are unavailable', () => {
    const r = selectIndexableCities({ ok: false, counts: {} });
    expect(r.usedFallback).toBe(true);
    expect(r.slugs).toHaveLength(FALLBACK_CITY_COUNT);
    expect(r.slugs[0]).toBe(CITIES[0].slug);
  });
  it('keeps only cities at or above the threshold when counts exist', () => {
    const r = selectIndexableCities({ ok: true, counts: { 'atlanta-ga': 5, 'dallas-tx': 4 } });
    expect(r.slugs).toEqual(['atlanta-ga']);
  });
});

describe('summarize and copy', () => {
  const now = '2026-11-16T12:00:00.000Z';
  const row = (o: Partial<SignalRowDb>): SignalRowDb => ({
    id: 1, source: 'nws', kind: 'alert', title: 'Flood Watch', summary: null, url: 'https://example.gov/a',
    categories: ['restoration'], severity: 2, occurred_at: '2026-11-15T12:00:00.000Z', expires_at: '2026-11-17T00:00:00.000Z', ...o,
  });
  const rows: SignalRowDb[] = [
    row({ id: 1 }),
    row({ id: 2, title: 'Old alert', expires_at: '2026-11-10T00:00:00.000Z', occurred_at: '2026-11-09T00:00:00.000Z' }),
    row({ id: 3, source: 'spc', kind: 'report', title: 'Hail 1.0 in', categories: ['roofing', 'auto-glass'], expires_at: null }),
    row({ id: 4, source: 'socrata:atl', kind: 'permit', title: 'Roof replacement', categories: ['roofing'], expires_at: null, occurred_at: '2026-10-20T00:00:00.000Z' }),
    row({ id: 5, source: 'socrata:atl-311', kind: 'civic', title: 'Pothole', categories: [], expires_at: null }),
    row({ id: 6, source: 'socrata:atl-food', kind: 'civic', title: 'Restaurant inspection failed', categories: [], expires_at: null }),
    row({ id: 7, kind: 'ask', source: 'websearch', title: 'Anyone recommend a roofer?', url: 'javascript:alert(1)', categories: ['roofing'], expires_at: null }),
    row({ id: 8, kind: 'permit', title: 'Too old', occurred_at: '2026-08-01T00:00:00.000Z', expires_at: null }),
  ];
  const data = summarize('atlanta-ga', rows, now);

  it('shows only unexpired alerts but counts expired ones in the total', () => {
    expect(data.sections.alerts?.map((i) => i.id)).toEqual([1]);
    expect(data.counts.alerts).toBe(1);
    expect(data.total).toBe(7); // id 8 is outside the 60-day window
  });
  it('splits civic into 311 and inspections and strips unsafe urls', () => {
    expect(sectionFor('civic', 'x', 'Pothole')).toBe('requests311');
    expect(data.sections.requests311?.[0].id).toBe(5);
    expect(data.sections.inspections?.[0].id).toBe(6);
    expect(data.sections.asks?.[0].url).toBeNull();
  });
  it('tallies trades for the week and the window', () => {
    expect(data.weekTrades.find((t) => t.id === 'roofing')?.count).toBe(2);
    expect(data.windowTrades.find((t) => t.id === 'roofing')?.count).toBe(3);
    const helps = buildHelps(data)!;
    expect(helps.heading).toBe("Who this week's activity helps");
    expect(helps.rows[0].label).toBe('Roofing');
  });
  it('writes an intro from the data with no em dashes', () => {
    const intro = buildIntro({ name: 'Atlanta', state: 'GA', slug: 'atlanta-ga' }, data);
    expect(intro).toContain('7 public records');
    expect(intro).toContain('1 weather alert is active');
    expect(intro).not.toContain('\u2014');
  });
  it('escapes < in JSON-LD', () => {
    expect(jsonLdString({ a: '</script>' })).not.toContain('</script>');
  });
});
