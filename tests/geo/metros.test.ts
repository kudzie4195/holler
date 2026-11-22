import { describe, expect, it } from 'vitest';
import { CITIES, cityBySlug } from '@/lib/geo';
import { METROS, metroFor, metroForCityState } from '@/lib/geo/metros';

describe('METROS registry', () => {
  it('lists the 10 metros in order', () => {
    expect(METROS.map((m) => m.id)).toEqual([
      'new-york',
      'los-angeles',
      'chicago',
      'dallas-fort-worth',
      'houston',
      'atlanta',
      'washington-dc',
      'philadelphia',
      'miami',
      'phoenix',
    ]);
    expect(METROS.find((m) => m.id === 'dallas-fort-worth')?.label).toBe('Dallas–Fort Worth');
  });

  it('every core city slug resolves in CITIES', () => {
    for (const m of METROS) {
      expect(m.cities.length, m.id).toBeGreaterThan(0);
      for (const slug of m.cities) expect(cityBySlug(slug), `${m.id}: ${slug}`).toBeDefined();
    }
  });

  it('core cities sit in the metro states, and each center is the first core city coordinates', () => {
    for (const m of METROS) {
      for (const slug of m.cities) expect(m.states, `${m.id}: ${slug}`).toContain(cityBySlug(slug)!.state);
      const c = cityBySlug(m.cities[0])!;
      expect(m.center, m.id).toEqual({ lat: c.lat, lon: c.lon });
    }
  });

  it('uses radius 40 miles, except New York 35, Washington DC 30 and Los Angeles 45', () => {
    for (const m of METROS) expect(m.radiusMi, m.id).toBe(m.id === 'new-york' ? 35 : m.id === 'washington-dc' ? 30 : m.id === 'los-angeles' ? 45 : 40);
  });

  it('spans the expected states', () => {
    const by = Object.fromEntries(METROS.map((m) => [m.id, [...m.states]]));
    expect(by['new-york']).toEqual(['NY', 'NJ']);
    expect(by['washington-dc']).toEqual(['DC', 'MD', 'VA']);
    expect(by['philadelphia']).toEqual(['PA', 'NJ', 'DE']);
  });

  it('CITIES still holds the cities (sanity)', () => {
    expect(CITIES.length).toBeGreaterThan(100);
  });
});

describe('metroFor', () => {
  it.each([
    ['Downtown Brooklyn', 40.6928, -73.9903, 'new-york'],
    ['Fort Worth', 32.7555, -97.3308, 'dallas-fort-worth'],
    ['Marietta GA', 33.9526, -84.5499, 'atlanta'],
    ['Arlington VA', 38.8799, -77.1068, 'washington-dc'],
    ['Camden NJ', 39.9259, -75.1196, 'philadelphia'],
    ['Miami Beach', 25.7907, -80.13, 'miami'],
    ['Tempe AZ', 33.4255, -111.94, 'phoenix'],
  ])('%s maps to %s', (_name, lat, lon, id) => {
    expect(metroFor(lat, lon)).toBe(id);
  });

  it('returns null outside every metro', () => {
    expect(metroFor(30.2672, -97.7431)).toBeNull(); // Austin TX
    expect(metroFor(28.5383, -81.3792)).toBeNull(); // Orlando FL
  });

  it('Baltimore MD (36 mi from DC) is outside the DC circle', () => {
    expect(metroFor(39.2904, -76.6122, 'MD')).toBeNull();
    expect(metroFor(39.2904, -76.6122)).toBeNull();
  });

  it('with a state, the metro must span it (the scorecard SQL rule)', () => {
    expect(metroFor(41.0534, -73.5387)).toBe('new-york'); // Stamford CT, inside the circle
    expect(metroFor(41.0534, -73.5387, 'CT')).toBeNull();
    expect(metroFor(41.5934, -87.3464)).toBe('chicago'); // Gary IN
    expect(metroFor(41.5934, -87.3464, 'IN')).toBeNull();
    expect(metroFor(40.7357, -74.1724, 'nj')).toBe('new-york');
    expect(metroFor(40.7357, -74.1724, 'PA')).toBeNull();
    expect(metroFor(40.7357, -74.1724, null)).toBeNull();
  });

  it('returns null for non-finite input', () => {
    expect(metroFor(NaN, -80)).toBeNull();
  });

  it('the nearest center wins where circles overlap', () => {
    // Exactly at a core center, that metro wins.
    for (const m of METROS) expect(metroFor(m.center.lat, m.center.lon)).toBe(m.id);
  });
});

describe('metroForCityState', () => {
  it('maps core cities by name and state', () => {
    expect(metroForCityState('Marietta', 'GA')).toBe('atlanta');
    expect(metroForCityState('Fort Worth', 'tx')).toBe('dallas-fort-worth');
    expect(metroForCityState('Camden', 'NJ')).toBe('philadelphia');
    expect(metroForCityState('Miami Beach', 'FL')).toBe('miami');
    expect(metroForCityState('Tempe', 'AZ')).toBe('phoenix');
    expect(metroForCityState('Arlington', 'VA')).toBe('washington-dc');
    expect(metroForCityState('Queens', 'NY')).toBe('new-york');
    expect(metroForCityState('Queens, NY'.split(',')[0], 'NY')).toBe('new-york');
    for (const n of ['Manhattan', 'Brooklyn', 'Bronx', 'The Bronx', 'Staten Island', 'New York']) expect(metroForCityState(n, 'NY'), n).toBe('new-york');
    expect(metroForCityState('New York', 'TX')).toBeNull();
    expect(metroForCityState('Arlington', 'TX')).toBe('dallas-fort-worth');
  });

  it('returns null for other cities, wrong state or missing parts', () => {
    expect(metroForCityState('Austin', 'TX')).toBeNull();
    expect(metroForCityState('Camden', 'AR')).toBeNull();
    expect(metroForCityState(null, 'TX')).toBeNull();
    expect(metroForCityState('Dallas', null)).toBeNull();
  });
});
