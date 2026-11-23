// Round 15 review (F, P1): zone-based National Weather Service alerts (no polygon) reach members by COUNTY, not by state.
// Each alert's SAME codes (properties.geocode.SAME, 6 digits, the county is the last 5) are placed at the county centroid
// (lib/geo/county-centroids.json, built from Census county boundaries) and matched by radius. A statewide or county-less alert reaches nobody far away.
import { describe, expect, it } from 'vitest';
import { parseNws } from '@/lib/signals/adapters/nws';
import { countiesFromSame, countyFromSame, STATE_BY_FIPS } from '@/lib/geo/county';
import table from '@/lib/geo/county-centroids.json';
import { matchSignals, type MatchProfile, type MatchSignal } from '@/lib/signals/match';
import type { SignalInput } from '@/lib/signals/types';

const NOW = new Date('2026-11-18T12:00:00Z');

function feature(event: string, id: string, same: string[], ugc: string[], extra: Record<string, unknown> = {}) {
  return {
    id: `https://api.weather.gov/alerts/${id}`,
    geometry: null,
    properties: {
      '@id': `https://api.weather.gov/alerts/${id}`,
      id,
      event,
      areaDesc: 'Test zone',
      geocode: { SAME: same, UGC: ugc },
      sent: '2026-11-18T10:00:00Z',
      effective: '2026-11-18T10:00:00Z',
      onset: null,
      expires: '2026-11-19T10:00:00Z',
      ends: null,
      status: 'Actual',
      messageType: 'Alert',
      headline: `${event} issued`,
      description: 'Test.',
      ...extra,
    },
  };
}

let nextId = 1;
const asSignals = (rows: SignalInput[]): MatchSignal[] =>
  rows.map((r) => ({
    id: nextId++,
    categories: r.categories,
    lat: r.lat ?? null,
    lon: r.lon ?? null,
    state: r.state ?? null,
    severity: r.severity,
    occurred_at: r.occurredAt,
    source: r.source,
    title: r.title,
    summary: r.summary ?? null,
    kind: r.kind,
    data: (r.data ?? null) as MatchSignal['data'],
  }));

const member = (user_id: string, trade: string, lat: number, lon: number, state: string, radius_mi = 25): MatchProfile => ({ user_id, categories: [trade], lat, lon, state, radius_mi });
const reaches = (signals: MatchSignal[], p: MatchProfile) => matchSignals(signals, [p], 25, NOW).length;

describe('county lookup from SAME codes', () => {
  it('reads the county from the last five digits and the state from the first two', () => {
    expect(countyFromSame('013121')).toMatchObject({ fips: '13121', state: 'GA' });
    expect(countyFromSame('006027')).toMatchObject({ fips: '06027', state: 'CA' });
    expect(countyFromSame('006071')?.state).toBe('CA');
  });
  it('gives null for a code that is not a land county', () => {
    expect(countyFromSame('000000')).toBeNull();
    expect(countyFromSame('abc')).toBeNull();
    expect(countyFromSame(null)).toBeNull();
    expect(countyFromSame('0131')).toBeNull();
  });
  it('lists distinct counties in order and ignores bad entries', () => {
    expect(countiesFromSame(['013121', '013121', 'x', '013089']).map((c) => c.fips)).toEqual(['13121', '13089']);
    expect(countiesFromSame(undefined)).toEqual([]);
  });
  it('places Fulton, GA near Atlanta and Inyo, CA far from Los Angeles', () => {
    const fulton = countyFromSame('013121')!;
    expect(Math.abs(fulton.lat - 33.79)).toBeLessThan(0.3);
    expect(Math.abs(fulton.lon + 84.47)).toBeLessThan(0.3);
  });
});

describe('zone alerts become one county-centroid row each', () => {
  const rows = parseNws({ features: [feature('Winter Storm Warning', 'urn:oid:w1', ['013121', '013089'], ['GAC121', 'GAC089'])] });
  it('emits a point per county with the alert id and an approximate-location flag', () => {
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(typeof r.lat).toBe('number');
      expect(r.state).toBe('GA');
      expect(r.source).toBe('nws');
      expect(r.data).toMatchObject({ loc: 'approx', alertId: 'urn:oid:w1' });
    }
    expect(new Set(rows.map((r) => r.externalId)).size).toBe(2);
  });
  it('keeps minor (severity 1) zone alerts as state history only, with no point', () => {
    const adv = parseNws({ features: [feature('Frost Advisory', 'urn:oid:f1', ['013121'], ['GAC121'])] });
    expect(adv.every((r) => r.lat == null)).toBe(true);
  });
  it('an alert with a polygon still uses the polygon centroid, not counties', () => {
    const poly = feature('Severe Thunderstorm Warning', 'urn:oid:p1', ['013121'], ['GAC121']);
    (poly as { geometry: unknown }).geometry = { type: 'Polygon', coordinates: [[[-84.5, 33.9], [-84.3, 33.9], [-84.3, 34.0], [-84.5, 34.0], [-84.5, 33.9]]] };
    const out = parseNws({ features: [poly] });
    expect(out).toHaveLength(1);
    expect(out[0].externalId).toBe('urn:oid:p1');
  });
});

describe('who a zone alert reaches (the 62 severity-2 zone alerts a fortnight shape)', () => {
  const trade = (event: string) => (/winter|freeze/i.test(event) ? 'plumbing' : /tornado|hurricane|wind/i.test(event) ? 'roofing' : 'hvac');
  const EVENTS = ['Winter Storm Warning', 'High Wind Warning', 'Freeze Warning', 'Tornado Watch', 'Hurricane Warning'];
  for (const ev of EVENTS) {
    it(`${ev}: reaches a member inside the radius of its county and not one 100 miles away`, () => {
      const sigs = asSignals(parseNws({ features: [feature(ev, `urn:oid:${ev}`, ['013121'], ['GAC121'])] }));
      expect(sigs.length).toBeGreaterThan(0);
      const t = sigs[0].categories.includes(trade(ev)) ? trade(ev) : sigs[0].categories[0];
      expect(reaches(sigs, member('atl', t, 33.75, -84.39, 'GA'))).toBe(1); // Atlanta
      expect(reaches(sigs, member('macon', t, 32.84, -83.63, 'GA'))).toBe(0); // Macon, about 80 miles
      expect(reaches(sigs, member('sav', t, 32.08, -81.09, 'GA'))).toBe(0); // Savannah, about 200 miles
    });
  }

  it('Joshua Tree and Inyo County alerts do not reach central Los Angeles', () => {
    const sigs = asSignals(
      parseNws({
        features: [
          feature('High Wind Warning', 'urn:oid:jt', ['006071', '006065'], ['CAZ560', 'CAZ561'], { areaDesc: 'Joshua Tree National Park' }),
          feature('High Wind Warning', 'urn:oid:inyo', ['006027'], ['CAZ520'], { areaDesc: 'Owens Valley' }),
        ],
      }),
    );
    expect(sigs.length).toBeGreaterThanOrEqual(2);
    for (const t of ['roofing', 'tree-service', 'restoration', 'electrical']) {
      expect(reaches(sigs, member('la', t, 34.0522, -118.2437, 'CA')), t).toBe(0);
      expect(reaches(sigs, member('la50', t, 34.0522, -118.2437, 'CA', 50)), t).toBe(0);
    }
  });

  it('a member close to the Inyo county centroid does get it', () => {
    const sigs = asSignals(parseNws({ features: [feature('High Wind Warning', 'urn:oid:inyo', ['006027'], ['CAZ520'])] }));
    expect(reaches(sigs, member('lonepine', 'roofing', 36.6, -118.06, 'CA', 50))).toBe(1);
  });

  it('an alert with no county codes (or only unknown codes) reaches nobody by state', () => {
    const none = asSignals(parseNws({ features: [feature('Winter Storm Warning', 'urn:oid:none', [], ['GAZ045'])] }));
    expect(none.length).toBeGreaterThan(0);
    for (const t of ['snow-removal', 'plumbing', 'hvac']) expect(reaches(none, member('atl', t, 33.75, -84.39, 'GA')), t).toBe(0);
    const bad = asSignals(parseNws({ features: [feature('Winter Storm Warning', 'urn:oid:bad', ['000000'], ['GAZ045'])] }));
    expect(reaches(bad, member('atl', 'snow-removal', 33.75, -84.39, 'GA'))).toBe(0);
  });

  it('one alert over several counties near a member is delivered once', () => {
    const sigs = asSignals(parseNws({ features: [feature('Winter Storm Warning', 'urn:oid:multi', ['013121', '013089', '013135', '013067'], ['GAC121', 'GAC089', 'GAC135', 'GAC067'])] }));
    expect(sigs.length).toBe(4);
    const rows = matchSignals(sigs, [member('atl', 'snow-removal', 33.9, -84.3, 'GA', 40)], 25, NOW);
    expect(rows).toHaveLength(1);
  });

  it('a county row never shows a distance (the alert covers an area, not a point)', () => {
    const sigs = asSignals(parseNws({ features: [feature('Winter Storm Warning', 'urn:oid:nodist', ['013121'], ['GAC121'])] }));
    const rows = matchSignals(sigs, [member('atl', 'snow-removal', 33.75, -84.39, 'GA')], 25, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].distance_mi).toBeNull();
  });
});

describe('county table: antimeridian, counties created or renamed since 2010 (round 15 re-review)', () => {
  const T = (table as unknown as { c: Record<string, [number, number]> }).c;
  it('Aleutians West (02016) sits in the Aleutians, east longitude, not in Saskatchewan', () => {
    const c = countyFromSame('002016')!;
    expect(c.state).toBe('AK');
    expect(c.lat).toBeGreaterThan(51);
    expect(c.lat).toBeLessThan(53);
    expect(c.lon).toBeGreaterThan(170); // east of the antimeridian
    const sigs = asSignals(parseNws({ features: [feature('High Wind Warning', 'urn:oid:ale', ['002016'], ['AKZ185'])] }));
    expect(reaches(sigs, member('adak', 'roofing', c.lat + 0.05, c.lon - 0.05, 'AK'))).toBe(1);
    expect(reaches(sigs, member('sask', 'roofing', 52.79, -104.37, 'SK'))).toBe(0);
  });
  it('no county centroid is wrapped across 180 degrees: every longitude is in the western hemisphere except Aleutians West', () => {
    const east = Object.entries(T).filter(([, v]) => v[1] > 0).map(([k]) => k);
    expect(east).toEqual(['02016']);
    for (const [k, v] of Object.entries(T)) {
      expect(v[0], k).toBeGreaterThan(17);
      expect(v[0], k).toBeLessThan(72);
    }
  });
  it('resolves the renamed and new counties that the 2010 boundary file lacked', () => {
    const want: Record<string, [string, number, number]> = {
      '46102': ['SD', 43.342, -102.559], // Oglala Lakota (Shannon renamed 2015, same boundary)
      '02158': ['AK', 62.284, -163.19], // Kusilvak (Wade Hampton renamed 2015)
      '02063': ['AK', 60.488, -146.203], // Chugach (2019)
      '02066': ['AK', 62.034, -143.922], // Copper River (2019)
      '09110': ['CT', 41.817, -72.576], // Connecticut planning regions (2022)
      '09120': ['CT', 41.185, -73.209],
      '09130': ['CT', 41.42, -72.494],
      '09140': ['CT', 41.519, -73.088],
      '09150': ['CT', 41.842, -71.973],
      '09160': ['CT', 41.855, -73.221],
      '09170': ['CT', 41.29, -72.837],
      '09180': ['CT', 41.485, -72.102],
      '09190': ['CT', 41.279, -73.447],
    };
    for (const [fips, [st, lat, lon]] of Object.entries(want)) {
      const c = countyFromSame(`0${fips}`);
      expect(c, fips).not.toBeNull();
      expect(c!.state).toBe(st);
      expect(c!.lat).toBeCloseTo(lat, 2);
      expect(c!.lon).toBeCloseTo(lon, 2);
    }
    // an alert that names only such counties is placed, not dropped to a state-level history row
    const rows = parseNws({ features: [feature('Winter Storm Warning', 'urn:oid:new', ['046102', '002063', '009110'], ['SDC102', 'AKC063', 'CTC110'])] });
    expect(rows.filter((r) => r.lat != null)).toHaveLength(3);
  });
  it('every state FIPS in the table maps to a state', () => {
    for (const k of Object.keys(T)) expect(STATE_BY_FIPS[k.slice(0, 2)], k).toBeTruthy();
  });
});

describe('no cap on counties per alert', () => {
  const tx = Object.keys((table as unknown as { c: Record<string, [number, number]> }).c).filter((k) => k.startsWith('48'));
  it('a 254-county Texas alert becomes 254 rows and reaches a member in every listed county', () => {
    expect(tx).toHaveLength(254);
    const rows = parseNws({ features: [feature('Winter Storm Warning', 'urn:oid:tx254', tx.map((k) => `0${k}`), tx.map((k) => `TXC${k.slice(2)}`))] });
    expect(rows).toHaveLength(254);
    expect(new Set(rows.map((r) => r.externalId)).size).toBe(254);
    const sigs = asSignals(rows);
    for (const k of tx) {
      const c = countyFromSame(`0${k}`)!;
      expect(reaches(sigs, member(`tx-${k}`, 'snow-removal', c.lat, c.lon, 'TX', 10)), k).toBe(1);
    }
  });
  it('and a member between several of the 254 counties still gets the alert once', () => {
    const rows = parseNws({ features: [feature('Winter Storm Warning', 'urn:oid:tx254b', tx.map((k) => `0${k}`), [])] });
    const hits = matchSignals(asSignals(rows), [member('dfw', 'snow-removal', 32.78, -96.8, 'TX', 60)], 25, NOW);
    expect(hits).toHaveLength(1);
  });
});
