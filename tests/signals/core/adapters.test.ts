/**
 * Fixture provenance (label every fixture; the sandbox cannot reach these APIs):
 *
 * tests/fixtures/nws-alerts.json   ASSUMED. Shape follows the NWS /alerts/active GeoJSON FeatureCollection
 *   (properties: id, areaDesc, geocode.UGC, sent/effective/onset/expires/ends, status, messageType, severity,
 *   certainty, urgency, event, senderName, headline, description). weather.gov/documentation/services-web-api
 *   confirms GeoJSON + CAP content and the User-Agent rule but api.weather.gov blocked automated fetch, so field
 *   names are from the published CAP/NWS schema, values are invented.
 * tests/fixtures/spc-{hail,torn,wind}.csv   PARTLY SOURCED. Column names and sample rows (times, locations,
 *   counties, comments, hail size in 1/100 inch) come from https://www.spc.noaa.gov/climo/reports/today.html.
 *   The CSV serialization (decimal-degree Lat/Lon, F_Scale column name) is ASSUMED because the raw .csv files
 *   could not be fetched. The parser also accepts the hundredths-of-degree form shown on the HTML page.
 *   Rows with size 75 / speed 40 are added by us to test filtering.
 * tests/fixtures/fema-declarations.json   ASSUMED. Field names from the OpenFEMA DisasterDeclarationsSummaries v2
 *   data dictionary (wrapper key DisasterDeclarationsSummaries); fema.gov docs pages could not be fetched. Values invented.
 * tests/fixtures/usgs-2.5_day.json   SOURCED for structure (earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php:
 *   properties mag/place/time/url/sig/tsunami/status/alert, coordinates [lon, lat, depth]); values invented.
 * tests/fixtures/faa-status.xml   SOURCED. Element structure copied from a live fetch of
 *   https://nasstatus.faa.gov/api/airport-status-information (Ground_Stop_List, Ground_Delay_List,
 *   Arrival_Departure_Delay_List, Airport_Closure_List); one ATL delay entry and the LAS closure were added by us.
 */
import { describe, expect, it } from 'vitest';
import { parseNws, geometryCentroid, statesFromUgc } from '@/lib/signals/adapters/nws';
import { parseSpc } from '@/lib/signals/adapters/spc';
import { parseFema } from '@/lib/signals/adapters/fema';
import { parseUsgs, stateFromPlace } from '@/lib/signals/adapters/usgs';
import { parseFaa, durationMinutes, AIRPORTS } from '@/lib/signals/adapters/faa';
import { adapters as nwsAdapters } from '@/lib/signals/adapters/nws';
import { adapters as spcAdapters } from '@/lib/signals/adapters/spc';
import { adapters as femaAdapters } from '@/lib/signals/adapters/fema';
import { adapters as usgsAdapters } from '@/lib/signals/adapters/usgs';
import { adapters as faaAdapters } from '@/lib/signals/adapters/faa';
import { isCategoryId } from '@/lib/signals/categories';
import type { SignalInput } from '@/lib/signals/types';
import { fixture } from './fixtures';

function expectValid(list: SignalInput[]) {
  const ids = new Set<string>();
  for (const s of list) {
    expect(s.externalId).toBeTruthy();
    expect(ids.has(s.externalId), `duplicate ${s.externalId}`).toBe(false);
    ids.add(s.externalId);
    expect(s.title.length).toBeGreaterThan(5);
    expect(Number.isFinite(Date.parse(s.occurredAt))).toBe(true);
    expect([1, 2, 3]).toContain(s.severity);
    for (const c of s.categories) expect(isCategoryId(c), c).toBe(true);
  }
}

describe('adapter exports', () => {
  it('each file exports non-empty adapters with sane config', () => {
    for (const list of [nwsAdapters, spcAdapters, femaAdapters, usgsAdapters, faaAdapters]) {
      expect(list.length).toBeGreaterThan(0);
      for (const a of list) {
        expect(a.id).toBeTruthy();
        expect(a.cadenceMinutes).toBeGreaterThan(0);
        expect(a.sourceUrl).toMatch(/^https:\/\//);
      }
    }
  });

  it('adapters never throw and return [] on a failing fetch, logging an error', async () => {
    const logs: string[] = [];
    const failing = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    for (const a of [...nwsAdapters, ...spcAdapters, ...femaAdapters, ...usgsAdapters, ...faaAdapters]) {
      const out = await a.fetch({ since: new Date(), fetch: failing, env: {}, log: (m) => logs.push(m) });
      expect(out).toEqual([]);
    }
    expect(logs.length).toBeGreaterThanOrEqual(5);
    expect(logs.every((l) => /error/i.test(l))).toBe(true);
  });
});

describe('parseNws', () => {
  const out = parseNws(JSON.parse(fixture('nws-alerts.json')));

  it('is non-zero on the fixture and skips non-actionable events', () => {
    expect(out.length).toBeGreaterThan(0);
    expectValid(out);
    expect(out.some((s) => /Small Craft/.test(s.title))).toBe(false);
  });

  it('uses the polygon centroid for severe thunderstorm and adds hail trades', () => {
    const s = out.find((x) => /Severe Thunderstorm/.test(x.title))!;
    expect(s.lat).toBeCloseTo(33.95, 2);
    expect(s.lon).toBeCloseTo(-84.4, 2);
    expect(s.state).toBe('GA');
    expect(s.categories).toEqual(expect.arrayContaining(['roofing', 'tree-service', 'auto-body', 'auto-glass']));
    expect(s.kind).toBe('alert');
    expect(s.severity).toBe(2);
  });

  it('emits one state-level signal per state for geometry-less multi-state alerts', () => {
    const w = out.filter((x) => /Winter Storm Warning/.test(x.title));
    expect(w.map((x) => x.state).sort()).toEqual(['NC', 'TN']);
    for (const s of w) {
      expect(s.lat ?? null).toBeNull();
      expect(s.categories).toContain('snow-removal');
      expect(s.severity).toBeGreaterThanOrEqual(2);
    }
    expect(new Set(w.map((x) => x.externalId)).size).toBe(2);
  });

  it('maps flash flood and heat', () => {
    const f = out.find((x) => /Flash Flood/.test(x.title))!;
    expect(f.categories).toEqual(expect.arrayContaining(['restoration', 'plumbing']));
    expect(f.lat).toBeGreaterThan(29.6);
    const h = out.find((x) => /Heat/.test(x.title))!;
    expect(h.categories).toContain('hvac');
    expect(h.state).toBe('AZ');
  });

  it('centroid helpers', () => {
    expect(geometryCentroid(null)).toBeNull();
    expect(geometryCentroid({ type: 'Point', coordinates: [1, 2] })).toBeNull();
    expect(statesFromUgc(['GAC067', 'GAZ045', 'ALZ010'])).toEqual(['GA', 'AL']);
  });

  it('returns [] for garbage', () => {
    expect(parseNws(null)).toEqual([]);
    expect(parseNws({ features: 'x' })).toEqual([]);
  });
});

describe('parseSpc', () => {
  const day = '2026-11-15';
  const hail = parseSpc({ csv: fixture('spc-hail.csv'), type: 'hail', day });
  const torn = parseSpc({ csv: fixture('spc-torn.csv'), type: 'torn', day });
  const wind = parseSpc({ csv: fixture('spc-wind.csv'), type: 'wind', day });

  it('is non-zero on every fixture', () => {
    expect(hail.length).toBeGreaterThan(0);
    expect(torn.length).toBeGreaterThan(0);
    expect(wind.length).toBeGreaterThan(0);
    expectValid([...hail, ...torn, ...wind]);
  });

  it('hail >= 1.00 in maps to roof/glass/body/restoration/insurance; smaller is dropped', () => {
    expect(hail).toHaveLength(3);
    expect(hail.some((s) => /0\.75/.test(s.title))).toBe(false);
    for (const s of hail) expect(s.categories).toEqual(['roofing', 'auto-glass', 'auto-body', 'restoration', 'insurance']);
    const big = hail.find((s) => /2\.00 inch/.test(s.title))!;
    expect(big.severity).toBe(3);
    expect(big.state).toBe('IL');
    expect(big.lat).toBeCloseTo(38.61, 2);
    expect(big.lon).toBeCloseTo(-89.61, 2);
  });

  it('wind maps to tree/roof/restoration and drops weak routine gusts', () => {
    expect(wind).toHaveLength(3);
    for (const s of wind) expect(s.categories).toEqual(['tree-service', 'roofing', 'restoration']);
    expect(wind.some((s) => /40 mph/.test(s.title))).toBe(false);
    const damage = wind.find((s) => /Wind damage/.test(s.title))!;
    expect(damage.summary).toContain('trees down'); // comma in quoted comment is preserved
  });

  it('tornado is severity 3 with all rebuild trades', () => {
    for (const s of torn) {
      expect(s.severity).toBe(3);
      expect(s.categories).toEqual(expect.arrayContaining(['roofing', 'restoration', 'tree-service', 'general-contractor', 'insurance']));
    }
  });

  it('assigns times after 1200Z to the start day and before 1200Z to the next day', () => {
    expect(torn.find((s) => /Effingham/.test(s.title))!.occurredAt).toBe('2026-11-16T01:14:00.000Z');
    expect(torn.find((s) => /Anton/.test(s.title))!.occurredAt).toBe('2026-11-15T20:33:00.000Z');
  });

  it('accepts hundredths-of-degree coordinates as printed on the HTML page', () => {
    const r = parseSpc({ csv: 'Time,Size,Location,County,State,Lat,Lon,Comments\n1850,100,8 N Mullin,Mills,TX,3167,9867,x\n', type: 'hail', day });
    expect(r[0].lat).toBeCloseTo(31.67, 2);
    expect(r[0].lon).toBeCloseTo(-98.67, 2);
  });

  it('returns [] for empty or malformed input', () => {
    expect(parseSpc({ csv: '', type: 'hail', day })).toEqual([]);
    expect(parseSpc(null)).toEqual([]);
  });
});

describe('parseFema', () => {
  const out = parseFema(JSON.parse(fixture('fema-declarations.json')));
  it('is non-zero and aggregates counties into one state-level signal per disaster', () => {
    expect(out).toHaveLength(4);
    expectValid(out);
    const fl = out.find((s) => s.externalId === '4955-FL')!;
    expect(fl.kind).toBe('disaster');
    expect(fl.lat ?? null).toBeNull();
    expect(fl.state).toBe('FL');
    expect((fl.data as { counties: string[] }).counties).toEqual(['Bay', 'Franklin']);
    expect(fl.severity).toBe(3);
    expect(fl.categories).toEqual(expect.arrayContaining(['restoration', 'roofing', 'tree-service']));
    expect(fl.url).toBe('https://www.fema.gov/disaster/4955');
  });
  it('maps incident types and declaration types', () => {
    const mt = out.find((s) => s.state === 'MT')!;
    expect(mt.severity).toBe(2);
    expect(mt.categories).toContain('snow-removal');
    const ok = out.find((s) => s.state === 'OK')!;
    expect(ok.categories).toContain('restoration');
  });
  it('returns [] for garbage', () => {
    expect(parseFema({})).toEqual([]);
    expect(parseFema(null)).toEqual([]);
  });
});

describe('parseUsgs', () => {
  const out = parseUsgs(JSON.parse(fixture('usgs-2.5_day.json')));
  it('is non-zero, US only, mag >= 2.5', () => {
    expect(out.map((s) => s.externalId).sort()).toEqual(['ak00000002', 'ci00000001', 'us00000005']);
    expectValid(out);
    expect(out.some((s) => /Mexico/.test(s.title))).toBe(false);
  });
  it('maps coordinates (lon, lat order), severity and trades', () => {
    const q = out.find((s) => s.externalId === 'ci00000001')!;
    expect(q.lat).toBeCloseTo(35.55, 2);
    expect(q.lon).toBeCloseTo(-117.7, 2);
    expect(q.state).toBe('CA');
    expect(q.severity).toBe(2);
    expect(q.categories).toContain('general-contractor');
    expect(q.kind).toBe('quake');
    const small = out.find((s) => s.externalId === 'ak00000002')!;
    expect(small.severity).toBe(1);
    expect(small.state).toBe('AK');
    expect(small.categories).toEqual([]);
    expect(out.find((s) => s.externalId === 'us00000005')!.severity).toBe(3);
  });
  it('stateFromPlace', () => {
    expect(stateFromPlace('10 km SW of Ridgecrest, CA')).toBe('CA');
    expect(stateFromPlace('Hawaii')).toBe('HI');
    expect(stateFromPlace('45 km SE of Sand Point, Alaska')).toBe('AK');
    expect(stateFromPlace('off the coast of Oregon')).toBe('OR');
    expect(stateFromPlace('Tokyo, Japan')).toBeNull();
  });
});

describe('parseFaa', () => {
  const out = parseFaa(fixture('faa-status.xml'));
  it('is non-zero and only covers major airports', () => {
    expect(out.length).toBeGreaterThan(0);
    expectValid(out);
    expect(out.some((s) => /SNA/.test(s.title))).toBe(false); // not in the top-40 table
  });
  it('ground stops are severity 3, GDPs 2+, with coordinates and rideshare category', () => {
    const lga = out.find((s) => /Ground stop at .*LGA/.test(s.title))!;
    expect(lga.severity).toBe(3);
    expect(lga.categories).toEqual(['rideshare-delivery']);
    expect(lga.lat).toBeCloseTo(40.7769, 3);
    expect(lga.kind).toBe('travel');
    const sfo = out.find((s) => /Ground delay program at .*SFO/.test(s.title))!;
    expect(sfo.severity).toBe(3); // average >= 60 min
    const san = out.find((s) => /Ground delay program at .*SAN/.test(s.title))!;
    expect(san.severity).toBe(2);
  });
  it('drops short arrival/departure delays but keeps 45+ minute ones', () => {
    expect(out.some((s) => /Flight delays at .*LGA/.test(s.title))).toBe(false);
    expect(out.some((s) => /Flight delays at .*ATL/.test(s.title))).toBe(true);
  });
  it('has 40 airports and parses durations', () => {
    expect(Object.keys(AIRPORTS)).toHaveLength(40);
    expect(durationMinutes('1 hour and 12 minutes')).toBe(72);
    expect(durationMinutes('36 minutes')).toBe(36);
    expect(durationMinutes(null)).toBeNull();
  });
  it('returns [] for non-FAA text', () => {
    expect(parseFaa('<html></html>')).toEqual([]);
    expect(parseFaa(null)).toEqual([]);
  });
});
