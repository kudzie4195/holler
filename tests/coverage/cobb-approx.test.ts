/**
 * Fixture provenance (tests/coverage/fixtures/arcgis-cobb-*-live-2026-11-19.json)
 * Rows copied from the live Cobb County Accela_PermitsDashboard layers (4 Residential, 1 Commercial, 3 MultiUnit) on 2026-11-19 through each
 * layer's /query endpoint, reduced to the attributes the config reads. The live response has no geometry on any row, and so do the fixtures.
 * Edits made on purpose: every house number was replaced with a round fake number (parcel numbers were dropped). Permit numbers, dates, streets,
 * permit types and values are as served. The layers have no person, phone or email column.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARCGIS_DATASETS, COBB_CENTER, type ArcgisDataset } from '@/lib/signals/adapters/arcgis-datasets';
import { COBB_SOURCE_IDS, COBB_SYNTH_FIELD, COBB_WORK_TYPES, addCobbWorkType, adapters as cobbAdapters, markApprox, parseCobb } from '@/lib/signals/adapters/arcgis-cobb';
import { parseArcgis } from '@/lib/signals/adapters/arcgis';
import { APPROX_LOCATION_SOURCES, hasApproxLocation } from '@/lib/signals/approx-location';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { SOURCE_META } from '@/lib/signals/source-meta';
import { matchOne, type MatchSignal } from '@/lib/signals/match';
import { distanceFrom } from '@/lib/check/group';
import type { AdapterContext } from '@/lib/signals/types';

const fx = (n: string): unknown => JSON.parse(readFileSync(join(__dirname, 'fixtures', n), 'utf8'));
const ds = (id: string): ArcgisDataset => {
  const d = ARCGIS_DATASETS.find((x) => x.id === id);
  if (!d) throw new Error(id);
  return d;
};
const FILES: Record<string, string> = {
  'arcgis-cobb-residential-permits': 'arcgis-cobb-residential-live-2026-11-19.json',
  'arcgis-cobb-commercial-permits': 'arcgis-cobb-commercial-live-2026-11-19.json',
  'arcgis-cobb-multiunit-permits': 'arcgis-cobb-multiunit-live-2026-11-19.json',
};

describe('Cobb County permits (no geometry, approximate location)', () => {
  it('fixtures have no geometry, like the live layers', () => {
    for (const f of Object.values(FILES)) {
      const body = fx(f) as { features: { geometry?: unknown }[] };
      expect(body.features.length).toBeGreaterThanOrEqual(3);
      for (const x of body.features) expect(x.geometry ?? null).toBeNull();
    }
  });

  for (const id of COBB_SOURCE_IDS) {
    describe(id, () => {
      const d = ds(id);
      const out = parseCobb(fx(FILES[id]), d);

      it('keeps every row and places it at the rounded county centre, flagged approximate', () => {
        expect(out.length).toBe((fx(FILES[id]) as { features: unknown[] }).features.length);
        for (const s of out) {
          expect(s.source).toBe(id);
          expect(s.kind).toBe('permit');
          expect(s.state).toBe('GA');
          expect(s.city).toBe('Cobb County');
          expect(s.lat).toBe(COBB_CENTER.lat);
          expect(s.lon).toBe(COBB_CENTER.lon);
          expect(String(s.lat).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
          expect(String(s.lon).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
          expect(s.data?.loc).toBe('approx');
          expect(s.data?.approxLocation).toBe(true);
          expect(s.contacts).toBeUndefined();
        }
      });

      it('public title and summary name the county, never a point, and carry no person or contact data', () => {
        for (const s of out) {
          expect(s.title).toMatch(/ permit in Cobb County$/);
          expect(s.summary ?? '').toMatch(/Cobb County/);
          const text = `${s.title} ${s.summary ?? ''}`;
          expect(text).not.toMatch(/[—–]/);
          expect(text).not.toMatch(/@|\bphone\b|\(\d{3}\)|\d{3}-\d{3}-\d{4}/);
          expect(text).not.toMatch(/parcel|latitude|longitude|map|pin\b/i);
          expect(text).not.toMatch(/\b\d+(\.\d+)? mi(les)?\b/i);
        }
      });

      it('prints the street address as the other permit feeds do (exact), nothing else from the row', () => {
        const withAddr = out.filter((s) => /\b\d{3,4} [A-Z0-9 ]+ (RD|PKWY|WAY|DR|CIRCLE)\b/.test(s.summary ?? ''));
        expect(withAddr.length).toBeGreaterThan(0);
      });

      it('shared parser alone also flags it approximate (approxLocation), so store dedupe skips the row', () => {
        for (const s of parseArcgis(fx(FILES[id]), d)) expect(s.data?.approxLocation).toBe(true);
      });
    });
  }

  it('maps permit types to fixed trade vocabulary (commercial new tenant, remodel; new home)', () => {
    const com = parseCobb(fx(FILES['arcgis-cobb-commercial-permits']), ds('arcgis-cobb-commercial-permits'));
    const res = parseCobb(fx(FILES['arcgis-cobb-residential-permits']), ds('arcgis-cobb-residential-permits'));
    const mu = parseCobb(fx(FILES['arcgis-cobb-multiunit-permits']), ds('arcgis-cobb-multiunit-permits'));
    for (const s of [...com, ...res, ...mu]) expect(s.categories.length).toBeGreaterThan(0);
    for (const s of res) expect(s.categories).toContain('general-contractor');
    // None of the Cobb permit types names a roof.
    for (const s of [...com, ...res, ...mu]) expect(s.categories).not.toContain('roofing');
  });

  it('turns only New Tenant and Townhome into fixed words; Vacant Tenant and unknown subtypes get none', () => {
    expect(Object.keys(COBB_WORK_TYPES).sort()).toEqual(['new tenant', 'townhome']);
    const feat = (sub: string) => ({ attributes: { PermitSubType: sub } });
    const out = addCobbWorkType({ features: [feat('New Tenant'), feat('Vacant Tenant'), feat('Remodel'), feat(' TOWNHOME ')] }) as { features: { attributes: Record<string, unknown> }[] };
    expect(out.features.map((f) => f.attributes[COBB_SYNTH_FIELD])).toEqual(['Tenant fit-out', undefined, undefined, 'New multi-family']);
    const com = parseCobb(fx(FILES['arcgis-cobb-commercial-permits']), ds('arcgis-cobb-commercial-permits'));
    expect(com.filter((s) => s.title === 'Tenant fit-out permit in Cobb County').length).toBe(4);
    expect(com.filter((s) => s.title === 'Remodel permit in Cobb County').length).toBe(1);
    const mu = parseCobb(fx(FILES['arcgis-cobb-multiunit-permits']), ds('arcgis-cobb-multiunit-permits'));
    expect(mu.map((s) => s.title)).toEqual(Array(4).fill('New home permit in Cobb County'));
    const vacant = parseCobb({ features: [{ attributes: { PermitNo: '2026-000001', PermitType: 'Commercial', PermitSubType: 'Vacant Tenant', DateIssued: 1794441600000, StreetNo: 1000, StreetName: 'EXAMPLE', StreetType: 'RD', VALUE: 1000 } }] }, ds('arcgis-cobb-commercial-permits'));
    expect(vacant.length).toBe(0);
  });

  it('the synthetic field is never requested from the server', async () => {
    const d = ds('arcgis-cobb-commercial-permits');
    const a = cobbAdapters.find((x) => x.id === d.id)!;
    const urls: string[] = [];
    const ctx = {
      now: new Date('2026-11-19T12:00:00Z'),
      fetch: async (u: string): Promise<Response> => {
        urls.push(String(u));
        return new Response(JSON.stringify({ features: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    } as unknown as AdapterContext;
    await a.fetch(ctx);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(new URL(u).searchParams.get('outFields')).not.toContain(COBB_SYNTH_FIELD);
      expect(u.startsWith(d.layerUrl + '/query')).toBe(true);
    }
  });

  it('markApprox does not change its input and rounds a stray coordinate', () => {
    const d = ds('arcgis-cobb-commercial-permits');
    const item = { source: d.id, externalId: 'x', kind: 'permit', title: 't', summary: 'Remodel', url: null, lat: 33.95123, lon: -84.55987, city: 'Cobb County', state: 'GA', zip: null, categories: ['general-contractor'], severity: 1, occurredAt: '2026-11-13T00:00:00.000Z', data: { subtype: 'permit' } } as never;
    const out = markApprox([item], d);
    expect(out[0].lat).toBe(33.95);
    expect(out[0].lon).toBe(-84.56);
    expect(out[0].summary).toBe('Remodel | Cobb County');
    expect((item as { data: { loc?: string } }).data.loc).toBeUndefined();
  });

  it('adapter fetch returns marked rows (live shape, no geometry)', async () => {
    const d = ds('arcgis-cobb-commercial-permits');
    const a = cobbAdapters.find((x) => x.id === d.id)!;
    const ctx = {
      now: new Date('2026-11-19T12:00:00Z'),
      fetch: async (): Promise<Response> => new Response(JSON.stringify(fx(FILES[d.id])), { status: 200, headers: { 'content-type': 'application/json' } }),
    } as unknown as AdapterContext;
    const rows = await a.fetch(ctx);
    expect(rows.length).toBe(5);
    for (const s of rows) expect(s.data?.loc).toBe('approx');
  });

  it('is registered once per source, with source metadata equal to the adapter', () => {
    for (const id of COBB_SOURCE_IDS) {
      const matches = ALL_ADAPTERS.filter((a) => a.id === id);
      expect(matches.length).toBe(1);
      expect(SOURCE_META[id]?.label).toBe(matches[0].label);
      expect(SOURCE_META[id]?.sourceUrl).toBe(matches[0].sourceUrl);
    }
  });

  it('every approximate source is listed for display suppression, and the helper reads both source and data', () => {
    for (const id of COBB_SOURCE_IDS) expect(APPROX_LOCATION_SOURCES.has(id)).toBe(true);
    expect(hasApproxLocation({ source: 'arcgis-cobb-commercial-permits' })).toBe(true);
    expect(hasApproxLocation({ source: 'x', data: { loc: 'approx' } })).toBe(true);
    expect(hasApproxLocation({ source: 'arcgis-atlanta-permits', data: {} })).toBe(false);
    expect(hasApproxLocation(null)).toBe(false);
  });

  it('matcher: a Smyrna profile (ZIP 30080, 25 mi) matches a Cobb row; a Lawrenceville profile (30046, 25 mi) does not', () => {
    // A new-home permit read by a real-estate member is Coming soon (a permit in the member's OWN trade is Market insight and is not matched).
    const sig: MatchSignal = { id: 1, categories: ['real-estate'], lat: COBB_CENTER.lat, lon: COBB_CENTER.lon, state: 'GA', severity: 1, occurred_at: '2026-11-13T00:00:00.000Z', subtype: 'permit', kind: 'permit', title: 'New home permit in Cobb County' };
    const smyrna = { user_id: 'u', categories: ['real-estate'], lat: 33.8826, lon: -84.5144, state: 'GA', radius_mi: 25 };
    const lawrenceville = { user_id: 'u2', categories: ['real-estate'], lat: 33.9562, lon: -83.9879, state: 'GA', radius_mi: 25 };
    expect(matchOne(sig, smyrna)).not.toBeNull();
    expect(matchOne(sig, lawrenceville)).toBeNull();
  });

  it('display: the check page distance helper prints no distance for approximate rows', () => {
    // The stand-in point is the county seat, not the permit site, so no distance is shown (check page, empty feed, app check API).
    const d = distanceFrom({ lat: 33.8826, lon: -84.5144 }, { id: 1, kind: 'permit', source: 'arcgis-cobb-commercial-permits', title: 't', url: null, place: null, lat: COBB_CENTER.lat, lon: COBB_CENTER.lon, occurredAt: '2026-11-13T00:00:00.000Z', severity: 1 });
    expect(d).toBeNull();
    // A normal row at the same point still gets its distance.
    expect(distanceFrom({ lat: 33.8826, lon: -84.5144 }, { id: 2, kind: 'permit', source: 'arcgis-atlanta-permits', title: 't', url: null, place: null, lat: COBB_CENTER.lat, lon: COBB_CENTER.lon, occurredAt: '2026-11-13T00:00:00.000Z', severity: 1 })).not.toBeNull();
  });
});
