/**
 * Fixture provenance (checked again on 2026-11-17 with WebFetch/WebSearch; the sandbox shell still cannot reach the internet).
 * Labels: sourced = structure copied from evidence at the URL, values trimmed or invented; assumed = not confirmed.
 *
 * tests/fixtures/nws-alerts.json   SOURCED (structure, two independent sources, no verbatim live capture because api.weather.gov is robots-blocked):
 *   https://apis.io/schemas/weather-gov/weather-gov-alert/ (property list: id, areaDesc, geocode{SAME,UGC}, affectedZones, references, sent, effective,
 *   onset|null, expires, ends|null, status, messageType, category, severity, certainty, urgency, event, sender, senderName, headline|null, description,
 *   instruction|null, note|null, response, parameters, scope, code, language, web, eventCode) and https://fastcrw.com/playground/pergamon/weathergov
 *   (features[].id is the https://api.weather.gov/alerts/urn:oid:... URL, properties also carry "@id" and "@type", geometry null on zone-based alerts).
 *   Query params status=actual and message_type=alert: https://alex-gekas.github.io/nws-api-reference/endpoints/alerts. Values are invented.
 * tests/fixtures/spc-{hail,torn,wind}.csv   PARTLY SOURCED. Header columns Time,Size|F_Scale|Speed,Location,County,State,Lat,Lon,Comments from the
 *   tables on https://spc.noaa.gov/climo/reports/today.html and https://spc.noaa.gov/climo/reports/240508_rpts.html (the HTML prints Lat/Lon as hundredths of a
 *   degree, 3814 = 38.14). Decimal-degree Lat/Lon in the CSV: https://apify.com/bigsky-data-tools/us-hail-wind-tornado-reports (35.96, -94.87) and PyNimbus
 *   (https://github.com/WxBDM/PyNimbus/blob/master/PyNimbus/spcreports.py plots the raw floats). Hail Size in hundredths of an inch:
 *   https://dev.to/wishbone_data/how-to-pull-every-noaa-hail-report-near-an-address-free-data-no-api-key-327f. ASSUMED: the exact F_Scale header spelling and the
 *   existence of today_filtered_hail.csv / today_filtered_wind.csv (today_filtered_torn.csv is named at https://www.clearspot.me/en/blog/spc-tornado-csv-reports).
 *   The raw .csv files are robots-blocked for WebFetch and no committed copy was found. Rows with size 75 / speed 40 are added by us to test filtering.
 * tests/fixtures/spc-filtered-combined.csv   SOURCED for layout: one file, three sections, each opened by its own header row, order torn, wind, hail
 *   (https://github.com/GateHouseMedia/tornado-tools gettornadoes.py breaks on a row whose Time cell is "Time"; PyNimbus splits on the same rows;
 *   file names today_filtered.csv / yesterday_filtered.csv from https://pynimbus.readthedocs.io/en/latest/tutorials/stormreports.html). Values reused from the other SPC fixtures.
 * tests/fixtures/fema-declarations.json   SOURCED. Live WebFetch of https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries on 2026-11-17: wrapper key
 *   DisasterDeclarationsSummaries next to metadata, every field name and the date format "2026-10-27T00:00:00.000Z". $filter with a lowercase-z literal,
 *   $orderby and $top were accepted by the live endpoint; docs https://www.fema.gov/about/openfema/api. Values invented except the FL record shape.
 * tests/fixtures/usgs-2.5_day.json   SOURCED. Live WebFetch of https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson on 2026-11-17 (metadata,
 *   [lon, lat, depth] coordinates, properties mag/place/time(ms)/url/sig/tsunami/alert/status/type, string ids). The Naalehu and Vanuatu rows are copied from it
 *   (a 2.46 row in a 2.5+ feed, and a non-US row); the other rows have invented values.
 * tests/fixtures/faa-status.xml   PARTLY SOURCED. Live WebFetch of https://nasstatus.faa.gov/api/airport-status-information on 2026-11-17 confirmed the root,
 *   Update_Time, Dtd_File and Delay_type/Airport_Closure_List/Airport{ARPT,Reason,Start,Reopen} with NOTAM text in Reason (SNA and LAS rows copied from it,
 *   MSY full closure added by us). Ground_Stop_List/Program{ARPT,Reason,End_Time} and Ground_Delay_List/Ground_Delay{ARPT,Reason,Avg,Max} are confirmed by
 *   https://rubydoc.info/gems/faa/FAA/Delay/GroundStop and .../GroundDelay. ASSUMED: Arrival_Departure_Delay_List/Delay/Arrival_Departure[Type]{Min,Max,Trend}
 *   (no delay was active at fetch time; copied from the earlier sample).
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
import { isFullClosure } from '@/lib/signals/adapters/faa';
import { scanSpc } from '@/lib/signals/adapters/spc';
import type { Adapter } from '@/lib/signals/types';

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

  it('links every alert to its api.weather.gov URL; properties.id stays the urn used for dedupe', () => {
    for (const s of out) {
      expect(s.url).toMatch(/^https:\/\/api\.weather\.gov\/alerts\/urn:oid:/);
      expect(s.externalId).toMatch(/^urn:oid:/);
    }
    const noFeatureId = parseNws({ features: [{ properties: { id: 'urn:oid:x', '@id': 'https://api.weather.gov/alerts/urn:oid:x', event: 'Flash Flood Warning', status: 'Actual', areaDesc: 'Fulton, GA', geocode: { UGC: ['GAC121'] } } }] });
    expect(noFeatureId[0].url).toBe('https://api.weather.gov/alerts/urn:oid:x');
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

// --- Evidence-driven parser checks ------------------------------------------------------------------

describe('parseNws against the documented shape', () => {
  it('handles nullable onset/ends by falling back to effective/expires', () => {
    const out = parseNws({
      features: [
        {
          id: 'https://api.weather.gov/alerts/urn:oid:x.1',
          geometry: null,
          properties: { '@id': 'https://api.weather.gov/alerts/urn:oid:x.1', id: 'urn:oid:x.1', areaDesc: 'Fulton, GA', geocode: { SAME: ['013121'], UGC: ['GAC121'] }, sent: '2026-11-16T15:02:00-05:00', effective: '2026-11-16T15:02:00-05:00', onset: null, expires: '2026-11-16T18:00:00-05:00', ends: null, status: 'Actual', messageType: 'Alert', event: 'Flash Flood Warning', headline: null, description: 'Flooding.', instruction: null },
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].occurredAt).toBe('2026-11-16T20:02:00.000Z');
    expect(out[0].expiresAt).toBe('2026-11-16T23:00:00.000Z');
    expect(out[0].externalId).toBe('urn:oid:x.1');
    expect(out[0].url).toBe('https://api.weather.gov/alerts/urn:oid:x.1');
  });
  it('fixture keeps the "@id" and feature id as https URLs and properties.id as the urn', () => {
    const raw = JSON.parse(fixture('nws-alerts.json')) as { features: { id: string; properties: Record<string, unknown> }[] };
    for (const f of raw.features) {
      expect(f.id).toMatch(/^https:\/\/api\.weather\.gov\/alerts\/urn:oid:/);
      expect(f.properties['@id']).toBe(f.id);
      expect(String(f.properties.id)).toMatch(/^urn:oid:/);
    }
  });
});

describe('parseSpc: combined filtered file', () => {
  const day = '2026-11-16';
  it('splits on repeated header rows and takes each section type from its header', () => {
    const out = parseSpc({ csv: fixture('spc-filtered-combined.csv'), type: 'torn', day });
    expect(out.filter((s) => s.title.startsWith('Tornado'))).toHaveLength(1);
    expect(out.filter((s) => /mph wind gust|Wind damage/.test(s.title)).length).toBeGreaterThanOrEqual(1);
    expect(out.filter((s) => /inch hail/.test(s.title))).toHaveLength(2);
    const scan = scanSpc({ csv: fixture('spc-filtered-combined.csv'), type: 'torn', day });
    expect(scan.rows).toBe(5);
    expect(scan.usable).toBe(5);
    expect(scan.headerOk).toBe(true);
  });
  it('reports a missing header row so callers can tell a broken file from an empty one', () => {
    expect(scanSpc({ csv: '<html><body>Not found</body></html>', type: 'hail', day }).headerOk).toBe(false);
    expect(scanSpc({ csv: 'Time,Size,Location,County,State,Lat,Lon,Comments\n', type: 'hail', day })).toMatchObject({ headerOk: true, rows: 0 });
    expect(scanSpc({ csv: 'Hour,Size,Place\n1,2,3', type: 'hail', day }).headerOk).toBe(false);
  });
});

describe('parseFaa closures', () => {
  it('reports only a full-airport closure; partial, GA-only and nightly NOTAMs are ignored', () => {
    expect(isFullClosure('!MSY 11/044 MSY AD AP CLSD 2611161800-2611170600')).toBe(true);
    expect(isFullClosure('!SNA 11/020 SNA AD AP CLSD DLY 0730-1415 2611150730-2611211415')).toBe(false);
    expect(isFullClosure('!LAS 10/118 LAS AD AP CLSD TO NON SKED TRANSIENT GA ACFT EXC PPR 702-261-4960 2610281926-2701272300')).toBe(false);
    expect(isFullClosure('!ASE 10/251 ASE AD AP CLSD EXC LIFE FLT AND SAR HEL 30 MIN PPR 2610260500-2610261300')).toBe(false);
    expect(isFullClosure('!XYZ 11/001 XYZ RWY 09/27 CLSD')).toBe(false);
    expect(isFullClosure(null)).toBe(false);
    const out = parseFaa(fixture('faa-status.xml'));
    const closures = out.filter((s) => /Airport closure/.test(s.title));
    expect(closures.map((s) => s.data?.airport)).toEqual(['MSY']);
  });
});

describe('parseFema against the live shape', () => {
  it('fixture carries the wrapper key next to metadata and ISO declaration dates', () => {
    const raw = JSON.parse(fixture('fema-declarations.json')) as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(['DisasterDeclarationsSummaries', 'metadata']);
    expect((raw.metadata as { entityname: string }).entityname).toBe('DisasterDeclarationsSummaries');
  });
});

describe('parseUsgs against the live shape', () => {
  it('drops a 2.46 row in a "2.5+" feed and a non-US row, without calling that a failure', () => {
    const out = parseUsgs(JSON.parse(fixture('usgs-2.5_day.json')));
    expect(out.some((s) => s.externalId === 'hv75071182')).toBe(false);
    expect(out.some((s) => s.externalId === 'us7000tyns')).toBe(false);
    expect(out.length).toBeGreaterThan(0);
  });
});

// --- Failure modes: every one must leave an error-like log line, never a quiet empty list ----------------

const ERROR_LIKE = /\b(error|failed|failure|timeout|timed out|http\s?[45]\d\d|status\s?[45]\d\d)\b/i; // same pattern as lib/signals/run.ts

async function runAdapter(a: Adapter, f: (url: string) => Response | Promise<Response>, env: Record<string, string | undefined> = {}) {
  const logs: string[] = [];
  const fetchImpl = (async (input: unknown) => f(String(input))) as unknown as typeof fetch;
  const out = await a.fetch({ since: new Date('2026-11-16T00:00:00Z'), fetch: fetchImpl, env, log: (m) => logs.push(m) });
  return { out, logs };
}
const html = () => new Response('<html><body>Service unavailable</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });

const feeds: { name: string; adapter: Adapter; goodBody: () => string; wrapperChanged: string; rowsNoneParse: string | null }[] = [
  {
    name: 'nws',
    adapter: nwsAdapters[0],
    goodBody: () => fixture('nws-alerts.json'),
    wrapperChanged: JSON.stringify({ alerts: [{ event: 'Flash Flood Warning' }] }),
    rowsNoneParse: JSON.stringify({ features: [{ properties: { headline: 'no event here' } }, { geometry: null }] }),
  },
  {
    name: 'fema',
    adapter: femaAdapters[0],
    goodBody: () => fixture('fema-declarations.json'),
    wrapperChanged: JSON.stringify({ metadata: {}, DisasterDeclarations: [{ disasterNumber: 1 }] }),
    rowsNoneParse: JSON.stringify({ DisasterDeclarationsSummaries: [{ id: 'a' }, { id: 'b', disasterNumber: 'x' }] }),
  },
  {
    name: 'usgs',
    adapter: usgsAdapters[0],
    goodBody: () => fixture('usgs-2.5_day.json'),
    wrapperChanged: JSON.stringify({ type: 'FeatureCollection', events: [{ id: 'a' }] }),
    rowsNoneParse: JSON.stringify({ features: [{ id: 'a' }, { id: 'b', properties: { magnitude: 3 } }] }),
  },
  {
    name: 'faa',
    adapter: faaAdapters[0],
    goodBody: () => fixture('faa-status.xml'),
    wrapperChanged: '<DELAYS><Item>x</Item></DELAYS>',
    rowsNoneParse: '<AIRPORT_STATUS_INFORMATION><Delay_type><Ground_Stop_List><Program><Airport>LGA</Airport></Program></Ground_Stop_List></Delay_type></AIRPORT_STATUS_INFORMATION>',
  },
];

describe.each(feeds)('$name failure modes', ({ adapter, goodBody, wrapperChanged, rowsNoneParse }) => {
  it('parses the good fixture with no error log', async () => {
    const { out, logs } = await runAdapter(adapter, () => new Response(goodBody(), { status: 200 }));
    expect(out.length).toBeGreaterThan(0);
    expect(logs.filter((l) => ERROR_LIKE.test(l))).toEqual([]);
  });
  for (const status of [401, 403, 404, 429, 500, 503]) {
    it(`HTTP ${status} returns [] with an error-like log`, async () => {
      const { out, logs } = await runAdapter(adapter, () => new Response('nope', { status }));
      expect(out).toEqual([]);
      expect(logs.some((l) => ERROR_LIKE.test(l) && l.includes(String(status)))).toBe(true);
    });
  }
  it('an HTML page with status 200 returns [] with an error-like log', async () => {
    const { out, logs } = await runAdapter(adapter, html);
    expect(out).toEqual([]);
    expect(logs.some((l) => ERROR_LIKE.test(l))).toBe(true);
  });
  it('a changed wrapper key returns [] with an error-like log', async () => {
    const { out, logs } = await runAdapter(adapter, () => new Response(wrapperChanged, { status: 200 }));
    expect(out).toEqual([]);
    expect(logs.some((l) => ERROR_LIKE.test(l))).toBe(true);
  });
  it('N raw rows and 0 usable rows logs "parsed 0 of N rows"', async () => {
    const { out, logs } = await runAdapter(adapter, () => new Response(rowsNoneParse, { status: 200 }));
    expect(out).toEqual([]);
    expect(logs.some((l) => /parsed 0 of \d+ rows, shape may have changed/.test(l))).toBe(true);
  });
});

describe('quiet days stay quiet', () => {
  it('nws with an empty features array is not an error', async () => {
    const { out, logs } = await runAdapter(nwsAdapters[0], () => new Response('{"type":"FeatureCollection","features":[]}', { status: 200 }));
    expect(out).toEqual([]);
    expect(logs).toEqual([]);
  });
  it('nws with only marine alerts is not an error', async () => {
    const raw = JSON.parse(fixture('nws-alerts.json')) as { features: unknown[] };
    const marine = raw.features.filter((f) => /Small Craft/.test(JSON.stringify(f)));
    const { out, logs } = await runAdapter(nwsAdapters[0], () => new Response(JSON.stringify({ features: marine }), { status: 200 }));
    expect(out).toEqual([]);
    expect(logs).toEqual([]);
  });
  it('fema and usgs with empty arrays are not errors; usgs with only non-US quakes is not an error', async () => {
    expect((await runAdapter(femaAdapters[0], () => new Response('{"metadata":{},"DisasterDeclarationsSummaries":[]}', { status: 200 }))).logs).toEqual([]);
    expect((await runAdapter(usgsAdapters[0], () => new Response('{"features":[]}', { status: 200 }))).logs).toEqual([]);
    const raw = JSON.parse(fixture('usgs-2.5_day.json')) as { features: { id: string }[] };
    const nonUs = raw.features.filter((f) => f.id === 'us7000tyns');
    const r = await runAdapter(usgsAdapters[0], () => new Response(JSON.stringify({ features: nonUs }), { status: 200 }));
    expect(r.out).toEqual([]);
    expect(r.logs).toEqual([]);
  });
  it('faa with no delays is not an error', async () => {
    const { out, logs } = await runAdapter(faaAdapters[0], () => new Response('<AIRPORT_STATUS_INFORMATION><Update_Time>Tue Nov 17 11:28:12 2026 GMT</Update_Time></AIRPORT_STATUS_INFORMATION>', { status: 200 }));
    expect(out).toEqual([]);
    expect(logs).toEqual([]);
  });
});

describe('request shapes', () => {
  it('nws asks for actual alerts with a User-Agent and geo+json', async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const f = (async (url: unknown, init?: RequestInit) => {
      seen = { url: String(url), init };
      return new Response('{"features":[]}', { status: 200 });
    }) as unknown as typeof fetch;
    await nwsAdapters[0].fetch({ since: new Date(), fetch: f, env: {}, log: () => {} });
    expect(seen!.url).toBe('https://api.weather.gov/alerts/active?status=actual&message_type=alert');
    expect((seen!.init!.headers as Record<string, string>)['User-Agent']).toMatch(/^Holler\/1\.0/);
  });
  it('fema sends $filter with a quoted ISO date, $orderby and $top, URL-encoded', async () => {
    let url = '';
    const f = (async (u: unknown) => {
      url = String(u);
      return new Response('{"DisasterDeclarationsSummaries":[]}', { status: 200 });
    }) as unknown as typeof fetch;
    await femaAdapters[0].fetch({ since: new Date(), fetch: f, env: {}, log: () => {} });
    const q = new URL(url);
    expect(q.origin + q.pathname).toBe('https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries');
    expect(q.searchParams.get('$filter')).toMatch(/^declarationDate ge '\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}z'$/);
    expect(q.searchParams.get('$orderby')).toBe('declarationDate desc');
    expect(q.searchParams.get('$top')).toBe('1000');
  });
  it('spc requests the filtered per-hazard files for today and yesterday, and falls back to the combined file when all six fail', async () => {
    const urls: string[] = [];
    const f = (async (u: unknown) => {
      urls.push(String(u));
      return /_filtered\.csv$/.test(String(u)) ? new Response(fixture('spc-filtered-combined.csv'), { status: 200 }) : new Response('Not found', { status: 404 });
    }) as unknown as typeof fetch;
    const logs: string[] = [];
    const out = await spcAdapters[0].fetch({ since: new Date(), fetch: f, env: {}, log: (m) => logs.push(m) });
    for (const t of ['torn', 'hail', 'wind']) {
      expect(urls).toContain(`https://www.spc.noaa.gov/climo/reports/today_filtered_${t}.csv`);
      expect(urls).toContain(`https://www.spc.noaa.gov/climo/reports/yesterday_filtered_${t}.csv`);
    }
    expect(urls).toContain('https://www.spc.noaa.gov/climo/reports/today_filtered.csv');
    expect(out.length).toBeGreaterThan(0);
    expect(logs.filter((l) => /HTTP 404/.test(l))).toHaveLength(6); // the per-hazard 404s stay visible
  });
  it('spc with an HTML body and a header-less file logs an error per file', async () => {
    const logs: string[] = [];
    const out = await spcAdapters[0].fetch({ since: new Date(), fetch: (async () => html()) as unknown as typeof fetch, env: {}, log: (m) => logs.push(m) });
    expect(out).toEqual([]);
    expect(logs.length).toBeGreaterThanOrEqual(6);
    expect(logs.every((l) => ERROR_LIKE.test(l))).toBe(true);
  });
  it('spc: a header-only file (no reports today) is quiet', async () => {
    const logs: string[] = [];
    const f = (async (u: unknown) => new Response(`Time,${/torn/.test(String(u)) ? 'F_Scale' : /hail/.test(String(u)) ? 'Size' : 'Speed'},Location,County,State,Lat,Lon,Comments\n`, { status: 200 })) as unknown as typeof fetch;
    const out = await spcAdapters[0].fetch({ since: new Date(), fetch: f, env: {}, log: (m) => logs.push(m) });
    expect(out).toEqual([]);
    expect(logs).toEqual([]);
  });
});
