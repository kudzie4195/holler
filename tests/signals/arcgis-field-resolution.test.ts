/**
 * Round 15 Unit G: an ArcGIS layer answers an unknown outField with an error and no rows. Contact and value columns that could not be read
 * from the layer's metadata (assumed) are therefore asked for only when the layer's own field list (<layer>?f=json) has them, so a wrong
 * guess never costs the permits themselves.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { buildArcgisAdapter, buildArcgisQuery, optionalFields, resetArcgisFieldCache, resolveOptionalFields } from '@/lib/signals/adapters/arcgis';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import type { AdapterContext } from '@/lib/signals/types';

const dc = ARCGIS_DATASETS.find((d) => d.id === 'arcgis-dc-permits')!;
const NOW = new Date('2026-11-21T12:00:00Z');

function ctx(layerFields: string[] | 'down', rows: unknown[] = []) {
  const urls: string[] = [];
  const logs: string[] = [];
  const c: AdapterContext = {
    since: NOW,
    now: NOW,
    env: {},
    log: (m) => logs.push(m),
    fetch: (async (url: string) => {
      urls.push(String(url));
      if (String(url).includes('/query?')) return new Response(JSON.stringify({ features: rows }), { status: 200 });
      if (layerFields === 'down') return new Response('nope', { status: 500 });
      return new Response(JSON.stringify({ fields: layerFields.map((name) => ({ name })) }), { status: 200 });
    }) as typeof fetch,
  };
  return { c, urls, logs };
}
const asked = (url: string) => new URL(url).searchParams.get('outFields')!.split(',');

describe('resolveOptionalFields', () => {
  beforeEach(() => resetArcgisFieldCache());

  it('returns only the optional fields the layer really has, and logs the rest once', async () => {
    const { c, logs } = ctx(['PERMIT_ID', 'ISSUE_DATE', 'PERMIT_APPLICANT', 'ESTIMATED_COST', 'FULL_ADDRESS']);
    const got = await resolveOptionalFields(dc, c, NOW);
    expect([...got].sort()).toEqual(['ESTIMATED_COST', 'PERMIT_APPLICANT']);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('COST_OF_CONSTRUCTION');
  });

  it('caches the field list for 6 hours (one metadata request), and reads it again afterwards', async () => {
    const { c, urls } = ctx(['PERMIT_APPLICANT']);
    await resolveOptionalFields(dc, c, NOW);
    await resolveOptionalFields(dc, c, new Date(NOW.getTime() + 5 * 3_600_000));
    expect(urls.filter((u) => u.endsWith('?f=json'))).toHaveLength(1);
    await resolveOptionalFields(dc, c, new Date(NOW.getTime() + 7 * 3_600_000));
    expect(urls.filter((u) => u.endsWith('?f=json'))).toHaveLength(2);
  });

  it('when the field list cannot be read no optional field is asked for, and that is logged', async () => {
    const { c, logs } = ctx('down');
    expect((await resolveOptionalFields(dc, c, NOW)).size).toBe(0);
    expect(logs[0]).toMatch(/could not read the layer's field list/);
  });

  it('a layer with no optional fields makes no metadata request', async () => {
    const meck = { ...dc, contacts: undefined, valueFields: [] as string[], assumedValueFields: undefined };
    const { c, urls } = ctx([]);
    expect((await resolveOptionalFields(meck, c, NOW)).size).toBe(0);
    expect(urls).toHaveLength(0);
  });
});

describe('the adapter asks the data query only for fields the layer has', () => {
  beforeEach(() => resetArcgisFieldCache());

  it('a candidate the layer lacks never reaches outFields; the required fields always do', async () => {
    const { c, urls } = ctx(['PERMIT_APPLICANT', 'ESTIMATED_COST'], [{ attributes: { PERMIT_ID: 'P1', ISSUE_DATE: NOW.getTime() - 86_400_000, DESC_OF_WORK: 'Interior alteration', PERMIT_TYPE_NAME: 'CONSTRUCTION', PERMIT_SUBTYPE_NAME: 'ALTERATION', FULL_ADDRESS: '1600 K ST NW', ZIPCODE: '20006', LATITUDE: 38.9, LONGITUDE: -77.04, PERMIT_APPLICANT: 'PREMIER ROOFING SERVICES LLC', ESTIMATED_COST: 64000 }, geometry: { x: -77.04, y: 38.9 } }]);
    const items = await buildArcgisAdapter(dc).fetch(c);
    const q = urls.find((u) => u.includes('/query?'))!;
    expect(asked(q)).toContain('PERMIT_APPLICANT');
    expect(asked(q)).toContain('ESTIMATED_COST');
    expect(asked(q)).not.toContain('COST_OF_CONSTRUCTION');
    expect(asked(q)).toContain('PERMIT_ID');
    expect(items).toHaveLength(1);
    expect((items[0].data as Record<string, unknown>).jobValue).toBe(64000);
  });

  it('with the metadata down the permits still arrive, without optional columns', async () => {
    const { c, urls } = ctx('down', [{ attributes: { PERMIT_ID: 'P1', ISSUE_DATE: NOW.getTime() - 86_400_000, DESC_OF_WORK: 'Interior alteration', PERMIT_TYPE_NAME: 'CONSTRUCTION', PERMIT_SUBTYPE_NAME: 'ALTERATION', FULL_ADDRESS: '1600 K ST NW', ZIPCODE: '20006', LATITUDE: 38.9, LONGITUDE: -77.04 }, geometry: { x: -77.04, y: 38.9 } }]);
    const items = await buildArcgisAdapter(dc).fetch(c);
    const q = urls.find((u) => u.includes('/query?'))!;
    expect(asked(q)).not.toContain('PERMIT_APPLICANT');
    expect(items).toHaveLength(1);
  });

  it('buildArcgisQuery without an allow-list asks for everything (the old behaviour), with one it asks only for the intersection', () => {
    expect(asked(`https://x.test/q?${buildArcgisQuery(dc, NOW)}`)).toEqual(expect.arrayContaining(optionalFields(dc)));
    expect(asked(`https://x.test/q?${buildArcgisQuery(dc, NOW, new Set())}`)).not.toContain('PERMIT_APPLICANT');
  });
});
