/**
 * Fixture provenance (tests/fixtures/arcgis-*.json)
 * - Esri query syntax and response shape: https://developers.arcgis.com/rest/services-reference/enterprise/query-feature-service-layer/ (read 2026-11-17).
 * - Fixture rows: sourced. Real attribute subsets captured on 2026-11-17 from the live layers listed in arcgis-datasets.ts (outSR=4326),
 *   with a few extra rows and owner/contact attributes added by hand to prove they are never read.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adapters, arcgisDateToIso, buildArcgisAdapter, buildArcgisQuery, parseArcgis, toTimestampLiteral } from '@/lib/signals/adapters/arcgis';
import { ARCGIS_DATASETS, type ArcgisDataset } from '@/lib/signals/adapters/arcgis-datasets';
import { ALL_ADAPTERS } from '@/lib/signals/registry';

const fx = (n: string): unknown => JSON.parse(readFileSync(join(__dirname, '../../fixtures', n), 'utf8'));
const ds = (id: string): ArcgisDataset => {
  const d = ARCGIS_DATASETS.find((x) => x.id === id);
  if (!d) throw new Error(id);
  return d;
};

describe('arcgis parser', () => {
  it('Raleigh: epoch ms dates, lon/lat geometry, trades; zoning review dropped', () => {
    const out = parseArcgis(fx('arcgis-raleigh-permits.json'), ds('arcgis-raleigh-permits'));
    expect(out.length).toBe(3);
    const cafe = out.find((s) => s.externalId === 'BLDNR-009646-2026')!;
    expect(cafe.occurredAt).toBe('2026-11-12T20:29:12.237Z');
    expect(cafe.categories).toContain('hvac');
    expect(cafe.lat).toBeCloseTo(35.7587, 3);
    expect(cafe.lon).toBeCloseTo(-78.6475, 3);
    expect(cafe.state).toBe('NC');
    expect(out.find((s) => s.externalId === 'BLDR-020627-2026')!.categories).toEqual(expect.arrayContaining(['general-contractor']));
    expect(out.find((s) => s.externalId === 'ELCR-000001-2026')).toBeUndefined();
  });
  it('DC: porch and fence, sump pump; owner name never output', () => {
    const out = parseArcgis(fx('arcgis-dc-permits.json'), ds('arcgis-dc-permits'));
    expect(out.length).toBe(3);
    expect(out.find((s) => s.externalId === 'B2603377')!.categories).toContain('fencing');
    expect(out.find((s) => s.externalId === 'B2700462')!.categories).toContain('plumbing');
    expect(out[0].lat).toBeCloseTo(38.885, 2);
    expect(JSON.stringify(out)).not.toMatch(/PRIVATE OWNER/);
  });
  it('Mecklenburg and DeKalb parse; contact names never output', () => {
    const m = parseArcgis(fx('arcgis-mecklenburg-permits.json'), ds('arcgis-mecklenburg-permits'));
    expect(m.length).toBe(2);
    expect(m[0].categories).toEqual(expect.arrayContaining(['hvac', 'electrical']));
    const d = parseArcgis(fx('arcgis-dekalb-permits.json'), ds('arcgis-dekalb-permits'));
    expect(d.map((s) => s.externalId).sort()).toEqual(['BC-2026-3003', 'MC-2026-2002']);
    expect(d.find((s) => s.externalId === 'MC-2026-2002')!.categories).toContain('hvac');
    expect(d[0].lon).toBeLessThan(-84);
    expect(JSON.stringify([...m, ...d])).not.toMatch(/PRIVATE/);
  });
  it('falls back to attribute coordinates, rejects mercator metres, tolerates garbage', () => {
    const r = ds('arcgis-raleigh-permits');
    const feat = (geometry: unknown) => ({ features: [{ attributes: { permitnum: 'P1', issueddate: 1794515352237, description: 'Re-roof', latitude_perm: 35.7, longitude_perm: -78.6 }, geometry }] });
    expect(parseArcgis(feat({ x: -9392179, y: 3998803 }), r)[0].lat).toBeCloseTo(35.7, 1);
    expect(parseArcgis(feat(undefined), r)[0].lon).toBeCloseTo(-78.6, 1);
    expect(parseArcgis(null, r)).toEqual([]);
    expect(parseArcgis({ features: 'x' }, r)).toEqual([]);
    expect(parseArcgis({ error: { code: 400, message: 'bad' } }, r)).toEqual([]);
  });
  it('date helpers', () => {
    expect(arcgisDateToIso(1794286800000)).toBe('2026-11-10T05:00:00.000Z');
    expect(arcgisDateToIso('2026-06-12')).toBe('2026-06-12T00:00:00.000Z');
    expect(arcgisDateToIso(null)).toBeNull();
    expect(toTimestampLiteral(new Date('2026-11-17T06:05:09Z'))).toBe('2026-11-17 06:05:09');
  });
});

describe('arcgis query builder', () => {
  it('builds date window, DESC order, limit, outSR and json', () => {
    const p = buildArcgisQuery(ds('arcgis-raleigh-permits'), new Date('2026-11-17T12:00:00Z'));
    expect(p.get('where')).toBe("issueddate >= timestamp '2026-11-10 12:00:00' AND issueddate <= timestamp '2026-11-17 12:00:00'");
    expect(p.get('orderByFields')).toBe('issueddate DESC');
    expect(p.get('resultRecordCount')).toBe('500');
    expect(p.get('outSR')).toBe('4326');
    expect(p.get('f')).toBe('json');
    expect(p.get('outFields')).toContain('permitnum');
    // Round 10: Raleigh's contact spec reads the parcel owner as an organisation name only; no owner phone or e-mail column is requested.
    expect(p.get('outFields')).not.toMatch(/owner(phone|email|tel)|e-?mail/i);
  });
  it('dateOnly fields use date literals', () => {
    const d: ArcgisDataset = { ...ds('arcgis-raleigh-permits'), dateType: 'dateOnly' };
    expect(buildArcgisQuery(d, new Date('2026-11-17T12:00:00Z')).get('where')).toContain("issueddate >= date '2026-11-10'");
  });
});

describe('arcgis adapter', () => {
  const d = ds('arcgis-raleigh-permits');
  const ctx = (f: typeof fetch, logs: string[] = []) => ({ since: new Date(), now: new Date('2026-11-17T12:00:00Z'), fetch: f, env: {}, log: (m: string) => logs.push(m) });
  const respond = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it('hits <layer>/query and parses', async () => {
    let url = '';
    const f = (async (u: string) => { url = u; return new Response(JSON.stringify(fx('arcgis-raleigh-permits.json')), { status: 200 }); }) as unknown as typeof fetch;
    const out = await buildArcgisAdapter(d).fetch(ctx(f));
    expect(out.length).toBe(3);
    expect(url.startsWith(`${d.layerUrl}/query?`)).toBe(true);
  });
  it('silent-empty: wrong shape and API errors log error, quiet window does not, failures return []', async () => {
    const a = buildArcgisAdapter(d);
    const l1: string[] = [];
    expect(await a.fetch(ctx(respond({ features: [{ attributes: { x: 1 } }, { attributes: { x: 2 } }] }), l1))).toEqual([]);
    expect(l1.join('|')).toMatch(/error: parsed 0 of 2 rows, shape may have changed/);
    const l2: string[] = [];
    await a.fetch(ctx(respond({ error: { code: 400, message: 'Invalid query' } }), l2));
    expect(l2.join('|')).toMatch(/error: .*Invalid query/);
    const l3: string[] = [];
    await a.fetch(ctx(respond({ features: [] }), l3));
    expect(l3).toEqual([]);
    const l4: string[] = [];
    await a.fetch(ctx(respond({ features: [{ attributes: { permitnum: 'Z', issueddate: 1794515352237, description: 'Zoning variance review' } }] }), l4));
    expect(l4.join('|')).not.toMatch(/error/i);
    const l5: string[] = [];
    expect(await a.fetch(ctx(respond({}, 500), l5))).toEqual([]);
    expect(l5.join('|')).toMatch(/HTTP 500/);
    expect(await a.fetch(ctx((async () => { throw new Error('boom'); }) as unknown as typeof fetch))).toEqual([]);
  });
});

describe('arcgis config', () => {
  it('only verified layers are adapters and are registered; Atlanta ships disabled with a reason', () => {
    expect(adapters.map((a) => a.id)).toEqual(ARCGIS_DATASETS.filter((x) => x.verified).map((x) => x.id));
    for (const a of adapters) expect(ALL_ADAPTERS.some((x) => x.id === a.id)).toBe(true);
    const atl = ARCGIS_DATASETS.filter((x) => x.city === 'Atlanta');
    expect(atl.length).toBeGreaterThan(0);
    for (const x of atl.filter((y) => !y.verified)) expect(x.note).toMatch(/DISABLED/);
    expect(ARCGIS_DATASETS.some((x) => x.state === 'GA' && x.verified)).toBe(true);
  });
  it('valid tz, verifiedUrl and checkedOn on every layer', () => {
    for (const x of ARCGIS_DATASETS) {
      expect(() => new Intl.DateTimeFormat('en-US', { timeZone: x.tz })).not.toThrow();
      expect(x.verifiedUrl).toBe(`${x.layerUrl}?f=json`);
      expect(x.checkedOn).toMatch(/^2026-11-(17|19)$/);
    }
    expect(new Set(ARCGIS_DATASETS.map((x) => x.id)).size).toBe(ARCGIS_DATASETS.length);
  });
});
