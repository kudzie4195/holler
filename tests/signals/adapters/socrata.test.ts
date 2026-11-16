/**
 * Fixture provenance (tests/fixtures/socrata-*.json)
 * - Column NAMES: sourced. Read from each portal's metadata endpoint https://<domain>/api/views/<id>.json on 2026-11-16
 *   (URLs are in lib/signals/adapters/socrata-datasets.ts as `verifiedUrl`).
 * - Row VALUES (permit text, complaint types, scores, coordinates): assumed. Written by hand to resemble real rows; Socrata returns
 *   numbers and timestamps as strings, which the fixtures mimic. The sandbox cannot reach the live APIs.
 * - socrata-dallas-311 lat_location "(lat, lon)" format: assumed.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adapters, buildSocrataAdapter, buildSocrataQuery, categorize, extractLatLon, parseSocrata, toFloatingLocal, toIso } from '@/lib/signals/adapters/socrata';
import { SOCRATA_DATASETS, lookbackDays, type SocrataDataset } from '@/lib/signals/adapters/socrata-datasets';

const fx = (name: string): unknown => JSON.parse(readFileSync(join(__dirname, '../../fixtures', name), 'utf8'));
const ds = (id: string): SocrataDataset => {
  const d = SOCRATA_DATASETS.find((x) => x.id === id);
  if (!d) throw new Error(`no dataset ${id}`);
  return d;
};

describe('socrata parsers on fixtures', () => {
  it('Chicago permits: roof, electrical and new construction map to trades; sign permit is dropped', () => {
    const out = parseSocrata(fx('socrata-chicago-permits.json'), ds('socrata-chicago-permits'));
    expect(out).toHaveLength(3);
    const roof = out.find((s) => s.externalId === '101234567')!;
    expect(roof.kind).toBe('permit');
    expect(roof.categories).toContain('roofing');
    expect(roof.lat).toBeCloseTo(41.9195, 3);
    expect(roof.lon).toBeCloseTo(-87.6779, 3);
    expect(roof.city).toBe('Chicago');
    expect(roof.state).toBe('IL');
    expect(roof.occurredAt).toBe('2026-11-12T06:00:00.000Z'); // midnight Chicago (CST) is 06:00Z
    expect(roof.title).toMatch(/^New permit in Chicago: TEAR OFF/);
    expect(out.find((s) => s.externalId === '101234568')!.categories).toContain('electrical');
    const nc = out.find((s) => s.externalId === '101234569')!;
    expect(nc.categories).toEqual(expect.arrayContaining(['general-contractor', 'landscaping', 'cleaning']));
    expect(out.find((s) => s.externalId === '101234570')).toBeUndefined();
  });

  it('Chicago 311: rodent -> pest-control, graffiti -> painting+cleaning, tree -> tree-service, pothole dropped', () => {
    const out = parseSocrata(fx('socrata-chicago-311.json'), ds('socrata-chicago-311'));
    expect(out).toHaveLength(3);
    expect(out.every((s) => s.kind === 'civic')).toBe(true);
    expect(out.find((s) => s.externalId === 'SR26-00811111')!.categories).toContain('pest-control');
    expect(out.find((s) => s.externalId === 'SR26-00811112')!.categories).toEqual(expect.arrayContaining(['painting', 'cleaning']));
    expect(out.find((s) => s.externalId === 'SR26-00811113')!.categories).toContain('tree-service');
    // 311 summaries never carry the street address
    expect(out.every((s) => !/DIVISION/.test(s.summary ?? ''))).toBe(true);
  });

  it('Chicago inspections: only Fail rows, mapped to pest-control + cleaning + janitorial-commercial, severity 2', () => {
    const out = parseSocrata(fx('socrata-chicago-inspections.json'), ds('socrata-chicago-inspections'));
    expect(out).toHaveLength(1);
    expect(out[0].categories).toEqual(expect.arrayContaining(['pest-control', 'cleaning', 'janitorial-commercial']));
    expect(out[0].severity).toBe(2);
    expect(out[0].externalId).toBe('2612345:2026-11-10');
    expect(out[0].title).toBe('Failed inspection in Chicago: JOES TACO SHACK');
  });

  it('NYC 311: no heat -> hvac+plumbing (severity 2), rodent -> pest-control, noise dropped', () => {
    const out = parseSocrata(fx('socrata-nyc-311.json'), ds('socrata-nyc-311'));
    expect(out).toHaveLength(2);
    const heat = out.find((s) => s.externalId === '65432101')!;
    expect(heat.categories).toEqual(expect.arrayContaining(['hvac', 'plumbing']));
    expect(heat.severity).toBe(2);
    expect(out.find((s) => s.externalId === '65432102')!.categories).toContain('pest-control');
  });

  it('NYC inspections: per-violation rows dedupe to one critical, score >= 28 signal', () => {
    const out = parseSocrata(fx('socrata-nyc-inspections.json'), ds('socrata-nyc-inspections'));
    expect(out).toHaveLength(1);
    expect(out[0].externalId).toBe('50012345:2026-11-09');
    expect(out[0].categories).toContain('pest-control');
    expect(out[0].state).toBe('NY');
  });

  it('SF permits: GeoJSON Point and {latitude,longitude} location columns both resolve', () => {
    const out = parseSocrata(fx('socrata-sf-permits.json'), ds('socrata-sf-permits'));
    expect(out).toHaveLength(2);
    const roof = out.find((s) => s.externalId === '202611123456')!;
    expect(roof.categories).toContain('roofing');
    expect(roof.lat).toBeCloseTo(37.8003, 3);
    expect(roof.lon).toBeCloseTo(-122.429, 3);
    const ev = out.find((s) => s.externalId === '202611123457')!;
    expect(ev.categories).toContain('electrical');
    expect(ev.lat).toBeCloseTo(37.769, 3);
  });

  it('Austin inspections: score < 70 only', () => {
    const out = parseSocrata(fx('socrata-austin-inspections.json'), ds('socrata-austin-inspections'));
    expect(out).toHaveLength(1);
    expect(out[0].title).toContain('Barton Creek Grill');
    expect(out[0].lat).toBeCloseTo(30.245, 3);
  });

  it('Cincinnati permits: no coordinates -> city centre flagged approx; duplicate number_key rows dedupe', () => {
    const out = parseSocrata(fx('socrata-cincinnati-permits.json'), ds('socrata-cincinnati-permits'));
    expect(out).toHaveLength(1);
    expect(out[0].categories).toContain('roofing');
    expect(out[0].lat).toBeCloseTo(39.1031, 3);
    expect(out[0].data?.approxLocation).toBe(true);
  });

  it('Dallas 311: parses "(lat, lon)" text; illegal dumping -> junk-removal; loose animal dropped', () => {
    const out = parseSocrata(fx('socrata-dallas-311.json'), ds('socrata-dallas-311'));
    expect(out).toHaveLength(1);
    expect(out[0].categories).toContain('junk-removal');
    expect(out[0].lat).toBeCloseTo(32.771, 3);
    expect(out[0].lon).toBeCloseTo(-96.797, 3);
    expect(out[0].data?.approxLocation).toBeUndefined();
  });

  it('New Orleans permits: location_1 object resolves, roof replacement maps to roofing', () => {
    const out = parseSocrata(fx('socrata-nola-permits.json'), ds('socrata-nola-permits'));
    expect(out).toHaveLength(1);
    expect(out[0].categories).toContain('roofing');
    expect(out[0].lat).toBeCloseTo(29.934, 3);
  });
});

describe('socrata category rules', () => {
  const permit = ds('socrata-chicago-permits');
  const civic = ds('socrata-chicago-311');
  const cases: [SocrataDataset, string, string[]][] = [
    [permit, 'Install new swimming pool and spa', ['pool-spa']],
    [permit, 'Install rooftop solar photovoltaic array', ['solar']],
    [permit, 'Replace furnace and ductwork HVAC', ['hvac']],
    [permit, 'Replace water heater and sewer lateral plumbing', ['plumbing']],
    [permit, 'PERMIT - WRECKING/DEMOLITION', ['junk-removal']],
    [permit, 'Re-roof residential', ['roofing']],
    [civic, 'Illegal Dumping Complaint', ['junk-removal']],
    [civic, 'No Heat Complaint', ['hvac', 'plumbing']],
    [civic, 'Tree Debris Clean-Up Request', ['tree-service']],
    [civic, 'Rodent Baiting/Rat Complaint', ['pest-control']],
  ];
  for (const [d, text, expected] of cases) {
    it(`"${text}" -> ${expected.join('+')}`, () => {
      expect(categorize(d, text).categories).toEqual(expect.arrayContaining(expected as never[]));
    });
  }
  it('"sign" permit text gets no category', () => {
    expect(categorize(permit, 'PERMIT - SIGNS install illuminated wall sign').categories).toEqual([]);
  });
});

describe('socrata query + config', () => {
  it('builds $where on the date field, $order desc, $limit 500', () => {
    const p = buildSocrataQuery(ds('socrata-chicago-permits'), new Date('2026-11-10T12:30:45.123Z'));
    // fixed 7 day lookback in Chicago local time (CST, UTC-6)
    expect(p.get('$where')).toBe("issue_date > '2026-11-03T06:30:45'");
    expect(p.get('$order')).toBe('issue_date DESC');
    expect(p.get('$limit')).toBe('500');
  });
  it('Chicago 311 run at 15:00Z: the window reaches back 3 days in local time and includes rows filed in the last 3 hours', () => {
    const now = new Date('2026-11-16T15:00:00Z');
    const where = buildSocrataQuery(ds('socrata-chicago-311'), now).get('$where')!;
    // Review's recomputed failing case: the old query was created_date > '2026-11-16T11:50:00' (UTC digits vs local stamps).
    expect(where).toContain("created_date > '2026-11-13T09:00:00'");
    const lower = /created_date > '([^']+)'/.exec(where)![1];
    const recentLocal = '2026-11-16T07:30:00'; // filed 13:30Z, i.e. 90 minutes before the run
    expect(recentLocal > lower).toBe(true);
    expect('2026-11-16T05:50:00' > lower).toBe(true); // the row the old window excluded
    expect('2026-11-13T08:59:59' > lower).toBe(false);
    // a run two scans later still sees the same row: no dependence on the previous run time
    const later = buildSocrataQuery(ds('socrata-chicago-311'), new Date('2026-11-16T21:00:00Z')).get('$where')!;
    expect(recentLocal > /created_date > '([^']+)'/.exec(later)![1]).toBe(true);
  });
  it('lookbacks: 3 days for 311, 7 days for permits and inspections; DST and zones are applied per dataset', () => {
    expect(lookbackDays(ds('socrata-chicago-311'))).toBe(3);
    expect(lookbackDays(ds('socrata-chicago-permits'))).toBe(7);
    expect(lookbackDays(ds('socrata-chicago-inspections'))).toBe(7);
    // LA in summer is PDT (UTC-7); NYC in winter is EST (UTC-5)
    expect(toFloatingLocal(new Date('2026-07-01T12:00:00Z'), 'America/Los_Angeles')).toBe('2026-07-01T05:00:00');
    expect(toFloatingLocal(new Date('2026-11-16T15:00:00Z'), 'America/New_York')).toBe('2026-11-16T10:00:00');
    expect(toIso('2026-07-01T05:00:00', 'America/Los_Angeles')).toBe('2026-07-01T12:00:00.000Z');
    expect(toIso('2026-11-16T09:00:00.000', 'America/Chicago')).toBe('2026-11-16T15:00:00.000Z');
    expect(toIso('2026-11-16T09:00:00Z', 'America/Chicago')).toBe('2026-11-16T09:00:00.000Z');
    for (const d of SOCRATA_DATASETS) expect(() => new Intl.DateTimeFormat('en-US', { timeZone: d.tz })).not.toThrow();
  });
  it('311 queries narrow server-side on the type column; inspections add their extraWhere', () => {
    expect(buildSocrataQuery(ds('socrata-nyc-311'), new Date()).get('$where')).toContain("upper(complaint_type) like '%RODENT%'");
    expect(buildSocrataQuery(ds('socrata-chicago-inspections'), new Date()).get('$where')).toContain("results = 'Fail'");
  });
  it('only verified datasets become adapters; every dataset records the URL checked', () => {
    const verified = SOCRATA_DATASETS.filter((d) => d.verified);
    expect(adapters.map((a) => a.id)).toEqual(verified.map((d) => d.id));
    expect(SOCRATA_DATASETS.filter((d) => !d.verified).length).toBeGreaterThan(0);
    for (const d of SOCRATA_DATASETS) expect(d.verifiedUrl).toMatch(/^https:\/\/.+\/api\/views\/[a-z0-9]{4}-[a-z0-9]{4}\.json$/);
    expect(new Set(SOCRATA_DATASETS.map((d) => d.id)).size).toBe(SOCRATA_DATASETS.length);
  });
  it('extractLatLon rejects 0,0 and out-of-range', () => {
    const d = ds('socrata-chicago-permits');
    expect(extractLatLon({ latitude: '0', longitude: '0' }, d)).toBeNull();
    expect(extractLatLon({ latitude: '999', longitude: '1' }, d)).toBeNull();
  });
});

describe('socrata adapter fetch', () => {
  const d = ds('socrata-chicago-311');
  const ctx = (f: typeof fetch, env: Record<string, string | undefined> = {}) => ({ since: new Date('2026-11-10T00:00:00Z'), fetch: f, env, log: () => {} });

  it('sends X-App-Token when set and hits /resource/<id>.json', async () => {
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};
    const f = (async (u: string, init?: RequestInit) => {
      seenUrl = u;
      seenHeaders = init?.headers as Record<string, string>;
      return new Response(JSON.stringify(fx('socrata-chicago-311.json')), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await buildSocrataAdapter(d).fetch(ctx(f, { SOCRATA_APP_TOKEN: 'tok' }));
    expect(out.length).toBe(3);
    expect(seenUrl).toContain('https://data.cityofchicago.org/resource/v6vf-nfxy.json?');
    expect(seenHeaders['X-App-Token']).toBe('tok');
  });
  it('returns [] on HTTP error, network error and invalid JSON', async () => {
    const a = buildSocrataAdapter(d);
    expect(await a.fetch(ctx((async () => new Response('x', { status: 500 })) as unknown as typeof fetch))).toEqual([]);
    expect(await a.fetch(ctx((async () => { throw new Error('boom'); }) as unknown as typeof fetch))).toEqual([]);
    expect(await a.fetch(ctx((async () => new Response('not json', { status: 200 })) as unknown as typeof fetch))).toEqual([]);
  });
});
