// Round 7 MATCH proof: the owner's own account (roofing, Smyrna GA 30080, 25 miles) against DeKalb-shaped permit rows.
// Feature shape follows tests/fixtures/arcgis-dekalb-permits.json (Hansen layer: applicationNumber, issuedDateTime, WorkTypeDescription,
// OccupancyTypeDescription, statusDescription, location). The category mix mirrors what production held on 2026-11-19 (electrical 54,
// hvac 39, the mislabelled "HVAC permit" water heaters 17, plumbing 16, new construction 10, retaining walls 6, restoration 2, demolition 1).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getProfile: async () => null }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => ({}) }) }));

import { parseArcgis } from '@/lib/signals/adapters/arcgis';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import { matchSignals, type MatchProfile, type MatchSignal } from '@/lib/signals/match';
import { remapRow } from '@/lib/signals/mapping/remap';
import { lookupZip } from '@/lib/geo';
import { loadEmptyFeedData, type EmptyFeedProfile } from '@/lib/preview/empty-feed';
import { EmptyFeedView, NO_LOCAL_FEED, emptyFeedApplies } from '@/components/feed/empty-feed';
import { fakeSignalsDb } from '../fixtures/fake-signals-db';
import type { SignalInput } from '@/lib/signals/types';

const NOW = new Date('2026-11-19T12:00:00Z');
const SMYRNA = { lat: 33.8796, lon: -84.5023 };
const ROOFER: MatchProfile = { user_id: 'owner', categories: ['roofing'], ...SMYRNA, state: 'GA', radius_mi: 25 };
const dekalb = ARCGIS_DATASETS.find((d) => d.id === 'arcgis-dekalb-permits')!;

/** Points inside DeKalb County, 13 to 20 miles from Smyrna; the last one (Lithonia) is just outside 25 miles. */
const POINTS = [
  { x: -84.296, y: 33.7748 }, // Decatur
  { x: -84.335, y: 33.83 }, // Brookhaven edge
  { x: -84.22, y: 33.79 }, // Clarkston
  { x: -84.17, y: 33.805 }, // Stone Mountain
];
const LITHONIA = { x: -84.105, y: 33.712 };

let seq = 0;
function feature(work: string, occ = 'Single Family Dwelling', at = POINTS[seq % POINTS.length], daysAgo = 1 + (seq % 10)) {
  seq++;
  return {
    attributes: {
      applicationNumber: `BP-2026-${String(seq).padStart(5, '0')}`,
      issuedDateTime: NOW.getTime() - daysAgo * 86_400_000,
      WorkTypeDescription: work,
      OccupancyTypeDescription: occ,
      statusDescription: 'Issued',
      location: `${100 + seq} EXAMPLE RD, DECATUR GA 30030`,
      primaryContactName: 'PRIVATE CONTACT',
    },
    geometry: at,
  };
}
const times = (n: number, work: string, occ?: string) => Array.from({ length: n }, () => feature(work, occ));

/** The production mix, without roofing. */
function productionMix() {
  return [
    ...times(54, 'Residential Electrical'),
    ...times(39, 'Residential Air Conditioning'),
    ...times(17, 'Residential Water Heater'), // stored in round 6 as "plumbing,hvac" titled "HVAC permit"
    ...times(16, 'Residential Plumbing'),
    ...times(10, 'New Construction'),
    ...times(6, 'Retaining Wall'),
    ...times(2, 'Fire Damage Repair'),
    ...times(1, 'Demolition'),
    ...times(3, 'Owner Change Only', 'Business'),
  ];
}
const reRoofs = () => [feature('Residential Re-Roof'), feature('Re-Roof', 'Business'), feature('Roof Replacement'), feature('Residential Re-Roof', undefined, LITHONIA)];

function asStored(items: SignalInput[]): (MatchSignal & { source: string; title: string; kind: string; data: any; expires_at: null })[] {
  return items.map((s, i) => ({
    id: i + 1,
    source: s.source,
    kind: s.kind,
    title: s.title,
    categories: s.categories,
    lat: s.lat ?? null,
    lon: s.lon ?? null,
    state: s.state ?? null,
    severity: s.severity,
    occurred_at: s.occurredAt,
    expires_at: null,
    data: s.data,
  }));
}

describe('Smyrna roofer vs DeKalb permits', () => {
  it('after the round 7 mapping the roofer gets the re-roof rows inside 25 miles and nothing mislabelled', () => {
    const items = parseArcgis({ features: [...productionMix(), ...reRoofs()] }, dekalb);
    // owner-change rows carry no trade and are dropped
    expect(items.some((s) => /owner/i.test(s.title))).toBe(false);
    const stored = asStored(items);
    const rows = matchSignals(stored, [ROOFER], undefined, NOW);
    const got = rows.map((r) => stored.find((s) => s.id === r.signal_id)!);
    expect(got).toHaveLength(3); // the Lithonia re-roof is 25.6 miles out
    for (const s of got) {
      expect(s.categories).toEqual(['roofing']);
      expect(s.title).toBe('Roof permit in DeKalb County');
    }
    // the mislabelled shape is gone: no row titled "HVAC permit" carries plumbing, water heaters are plumbing only
    for (const s of stored) {
      if (s.title.startsWith('HVAC permit')) expect(s.categories).toEqual(['hvac']);
      if (s.title.startsWith('Water heater permit')) expect(s.categories).toEqual(['plumbing']);
      expect(s.categories).not.toContain('cleaning');
    }
    expect(stored.filter((s) => s.title.startsWith('Water heater permit'))).toHaveLength(17);
    expect(stored.filter((s) => s.title.startsWith('New construction permit')).every((s) => s.categories.join() === 'general-contractor')).toBe(true);
  });

  it('round 6 rows already in the database (the mislabelled shape) are fixed by the scan-time re-map', () => {
    const old = { id: 9, source: 'arcgis-dekalb-permits', title: 'HVAC permit in DeKalb County', summary: 'Residential Water Heater | Single Family Dwelling | Issued | 100 block of Example Rd', city: 'DeKalb County', categories: ['plumbing', 'hvac'], data: { layer: dekalb.layerUrl, subtype: 'permit' } };
    const r = remapRow(old)!;
    expect(r).toMatchObject({ categories: ['plumbing'], title: 'Water heater permit in DeKalb County', changed: true });
    const fanOut = remapRow({ ...old, id: 10, title: 'Building permit in DeKalb County', summary: 'New Construction | Single Family Dwelling | Issued', categories: ['general-contractor', 'landscaping', 'cleaning'] })!;
    expect(fanOut.categories).toEqual(['general-contractor']);
  });
});

describe('with no roofing rows at all, the page renders the empty feed with real counts for other trades', () => {
  const profile: EmptyFeedProfile = { ...ROOFER, zip: '30080', radius_mi: 25, plan: 'starter', subscription_status: 'trialing', extra_areas: [], keywords: [] };

  function db(items: SignalInput[], extra: any[] = []) {
    const base = fakeSignalsDb([...asStored(items), ...extra], { now: NOW });
    return {
      rpc: base.rpc,
      log: base.log,
      from(table: string) {
        if (table === 'holler_source_health') {
          const q: any = { select: () => q, in: () => Promise.resolve({ data: [{ source: 'nws', last_record_at: '2026-11-19T10:00:00Z' }], error: null }) };
          return q;
        }
        return base.from(table);
      },
    };
  }
  const noCheck = async () => ({ ok: true, items: [], checkedAt: NOW.toISOString() });

  it('the zero-match feed uses the empty-feed component', () => {
    expect(emptyFeedApplies({ items: 0, locked: false, failed: false })).toBe(true);
    expect(emptyFeedApplies({ items: 0, locked: true, failed: false })).toBe(false); // the locked card stays
    expect(emptyFeedApplies({ items: 0, locked: false, failed: true })).toBe(false); // a failed read is not "nothing"
    expect(emptyFeedApplies({ items: 3, locked: false, failed: false })).toBe(false);
    expect(lookupZip('30080')).toMatchObject({ city: 'Smyrna', state: 'GA' });
  });

  it('counts real rows per other trade inside 25 miles and 14 days, names DeKalb with its newest date, and shows the area check result', async () => {
    seq = 0;
    const items = parseArcgis({ features: productionMix() }, dekalb);
    const fake = db(items);
    const data = await loadEmptyFeedData(profile, { db: fake as any, now: NOW, loadCheck: noCheck });
    const by = Object.fromEntries(data.otherTrades.map((t) => [t.trade, t.byType]));
    expect(by.electrical).toEqual([{ key: 'permit', count: 54 }]);
    expect(by.hvac).toEqual([{ key: 'permit', count: 39 }]);
    expect(by.plumbing).toEqual([{ key: 'permit', count: 33 }]); // 16 plumbing + 17 water heaters, each counted once
    expect(by['general-contractor']).toEqual([{ key: 'permit', count: 10 }]);
    expect(by.landscaping).toEqual([{ key: 'permit', count: 6 }]);
    expect(by.restoration).toEqual([{ key: 'permit', count: 2 }]);
    expect(by['junk-removal']).toEqual([{ key: 'permit', count: 1 }]);
    expect(by.roofing).toBeUndefined(); // a picked trade is never listed as "other"
    expect(by.cleaning).toBeUndefined();
    expect(data.capped).toBe(false);
    expect(data.countsOk).toBe(true);
    expect(data.local.map((s) => s.id)).toContain('arcgis-dekalb-permits');
    expect(data.local.find((s) => s.id === 'arcgis-dekalb-permits')!.newest).toBe(items.map((s) => s.occurredAt).sort().at(-1));
    expect(data.national.find((s) => s.id === 'nws')!.newest).toBe('2026-11-19T10:00:00Z');
    // the near read is the radius read the backfill uses: 25 miles, 14 days, every trade
    const rpc = fake.log.filter((l) => l.kind === 'rpc')[0].args!;
    expect(rpc).toMatchObject({ p_radius_mi: 25, p_lat: SMYRNA.lat, p_lon: SMYRNA.lon, p_since: new Date(NOW.getTime() - 14 * 86_400_000).toISOString() });

    const html = renderToStaticMarkup(createElement(EmptyFeedView, { data, now: NOW.getTime(), recent: createElement('p', null, 'RECENT-90') }));
    expect(html).toContain('Nothing has matched yet');
    expect(html).toContain('Nothing in the public record within about 25 to 50 miles of Smyrna, GA matched roofing in the last 30 days.');
    expect(html).toContain('What Holler is watching near you');
    expect(html).toContain('DeKalb County open data: building permits.');
    expect(html).toMatch(/Newest record Nov 1\d\./);
    expect(html).toContain('<span class="font-semibold">Electrical:</span> 54 building permits');
    expect(html).toContain('<span class="font-semibold">Heating and air (HVAC):</span> 39 building permits');
    expect(html).toContain('href="/app/settings"');
    expect(html).toContain('Add a trade in Settings');
    expect(html).toContain('RECENT-90'); // the 90-day block is kept
    expect(html).not.toContain(NO_LOCAL_FEED);
    expect(html).not.toMatch(/[–—]/); // no en or em dashes
    expect(html).not.toMatch(/At least/);
    expect(html).toContain('href="/check?zip=30080&amp;trade=roofing"');
  });

  it('the area check result is the same one /check gives, item for item', async () => {
    const item = { id: 77, kind: 'report', source: 'spc', title: '1.75 inch hail reported near 2 N Marietta, GA', url: 'https://www.spc.noaa.gov/climo/reports/', place: 'Marietta, GA', lat: 33.97, lon: -84.55, occurredAt: '2026-11-17T20:00:00Z', severity: 2 };
    const calls: unknown[][] = [];
    const data = await loadEmptyFeedData(profile, {
      db: db([]) as any,
      now: NOW,
      loadCheck: async (...a) => (calls.push(a), { ok: true, items: [item], checkedAt: NOW.toISOString() }),
    });
    expect(calls).toEqual([[34, -84.5, 'GA', 'roofing']]); // the cached /check read for the ZIP's grid cell and the trade
    const html = renderToStaticMarkup(createElement(EmptyFeedView, { data, now: NOW.getTime() }));
    expect(html).toContain('1.75 inch hail reported near 2 N Marietta, GA');
    expect(html).toContain('Roofing within about 25 to 50 miles, last 30 days.');
    expect(html).toContain('No records for other trades landed within 25 miles in the last 14 days.');
  });

  it('an area no city or county feed covers says so plainly and invents nothing', async () => {
    const rural: EmptyFeedProfile = { ...profile, zip: '59330', lat: 47.1, lon: -104.7, state: 'MT' };
    const data = await loadEmptyFeedData(rural, { db: db([]) as any, now: NOW, loadCheck: noCheck });
    expect(data.local).toEqual([]);
    const html = renderToStaticMarkup(createElement(EmptyFeedView, { data, now: NOW.getTime() }));
    expect(html).toContain(NO_LOCAL_FEED);
    expect(html).toContain('National Weather Service alerts');
    expect(html).not.toMatch(/\d+ building permits/);
  });

  it('counts capped by the row limit say "At least"', async () => {
    const many = Array.from({ length: 1600 }, (_, i) => ({ id: 5000 + i, source: 'arcgis-dekalb-permits', kind: 'permit', title: 'Electrical permit in DeKalb County', categories: ['electrical'], lat: 33.7748, lon: -84.296, state: 'GA', severity: 1, occurred_at: new Date(NOW.getTime() - (i + 1) * 600_000).toISOString(), expires_at: null, data: { subtype: 'permit' } }));
    const data = await loadEmptyFeedData(profile, { db: db([], many) as any, now: NOW, loadCheck: noCheck });
    expect(data.capped).toBe(true);
    expect(data.otherTrades[0]).toMatchObject({ trade: 'electrical', total: 1500 });
    const html = renderToStaticMarkup(createElement(EmptyFeedView, { data, now: NOW.getTime() }));
    expect(html).toContain('At least 1,500 building permits');
  });

  it('a failed read says it could not count, never "0"', async () => {
    const broken = { rpc: () => { throw new Error('down'); }, from: () => ({ select: () => ({ in: async () => ({ data: null, error: { message: 'x' } }) }) }) };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const data = await loadEmptyFeedData(profile, { db: broken as any, now: NOW, loadCheck: noCheck });
    spy.mockRestore();
    expect(data.countsOk).toBe(false);
    const html = renderToStaticMarkup(createElement(EmptyFeedView, { data, now: NOW.getTime() }));
    expect(html).toContain('We could not count nearby records just now.');
  });
});
