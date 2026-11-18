import { describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import { buildKeywordPlan } from '../../lib/dataforseo/volume';
import { FALLBACK_PRIORITY, buildPriorityIndex, citySlugFromPath, computePriorityIndex, pagePriority, setPriorityIndex, withVolumePriority } from '../../lib/seo/priority';

vi.mock('next/cache', () => ({ cacheLife: vi.fn() }));
vi.mock('server-only', () => ({}));

const city = (slug: string, name: string, state: string, population: number) => ({ slug, name, state, stateName: state, lat: 0, lon: 0, population });
const CITIES = [city('a-ga', 'Aville', 'GA', 900), city('b-ga', 'Bville', 'GA', 800), city('c-ga', 'Cville', 'GA', 700), city('d-ga', 'Dville', 'GA', 600), city('e-ga', 'Eville', 'GA', 500)];
const plan = buildKeywordPlan(CITIES, ['roofing', 'plumbing']); // 10 keywords
const MONTH = '2026-11-01';

function rows(month: string, vols: Record<string, number | null>) {
  return Object.entries(vols).map(([keyword, volume]) => ({ keyword, location_code: 2840, month, volume }));
}
function fill(db: FakeDb, month: string, positive: Record<string, number>) {
  for (const c of plan) for (const k of c.keywords) db.tables.holler_keyword_volume.push(...rows(month, { [k.keyword]: positive[k.keyword] ?? 0 }));
}

describe('pagePriority', () => {
  it('no index loaded: the fixed value comes back, for any path', () => {
    setPriorityIndex(null);
    expect(pagePriority('/local/georgia/atlanta-ga')).toBe(FALLBACK_PRIORITY);
    expect(pagePriority('/local/georgia/atlanta-ga', 0.55)).toBe(0.55);
    expect(pagePriority('/pricing')).toBe(FALLBACK_PRIORITY);
  });

  it('city with no volume in the index, and non-city paths, keep the fallback', () => {
    const idx = { month: MONTH, complete: true, byCity: { 'a-ga': 0.9 } };
    expect(pagePriority('/local/georgia/zzz-ga', 0.6, idx)).toBe(0.6);
    expect(pagePriority('/local/georgia', 0.7, idx)).toBe(0.7);
    expect(pagePriority('/local/georgia/a-ga/week/2026-11-16', 0.5, idx)).toBe(0.5);
    expect(pagePriority('/for/roofing', 0.6, idx)).toBe(0.6);
    expect(pagePriority('/local/georgia/a-ga', 0.6, idx)).toBe(0.9);
    expect(pagePriority('/local/georgia/a-ga/', 0.6, idx)).toBe(0.9);
  });

  it('values are always clamped to 0.3..0.9', () => {
    const idx = { month: MONTH, complete: true, byCity: { hi: 7, lo: -3, nan: Number.NaN } };
    expect(pagePriority('/local/x/hi', 0.6, idx)).toBe(0.9);
    expect(pagePriority('/local/x/lo', 0.6, idx)).toBe(0.3);
    expect(pagePriority('/local/x/nan', 0.6, idx)).toBe(0.6);
  });

  it('extracts the city slug only from /local/<state>/<city>', () => {
    expect(citySlugFromPath('/local/georgia/atlanta-ga')).toBe('atlanta-ga');
    expect(citySlugFromPath('/local/georgia/atlanta-ga?x=1')).toBe('atlanta-ga');
    expect(citySlugFromPath('/local/georgia')).toBeNull();
    expect(citySlugFromPath('/local')).toBeNull();
    expect(citySlugFromPath('/local/georgia/atlanta-ga/week/2026-11-16')).toBeNull();
  });
});

describe('buildPriorityIndex', () => {
  it('ranks cities by total volume across trades: biggest 0.9, others lower, equal volume equal priority', () => {
    const vols = new Map<string, number>([
      ['roofing aville', 1000], ['plumber aville', 500], // 1500
      ['roofing bville', 300], // 300
      ['roofing cville', 300], // 300 (tie)
      ['plumber dville', 10], // 10
    ]);
    const idx = buildPriorityIndex({ month: MONTH, complete: true, volumes: vols, plan });
    expect(idx.byCity['a-ga']).toBe(0.9);
    expect(idx.byCity['b-ga']).toBe(idx.byCity['c-ga']);
    expect(idx.byCity['b-ga']).toBeLessThan(0.9);
    expect(idx.byCity['d-ga']).toBeLessThan(idx.byCity['b-ga']);
    expect(idx.byCity['d-ga']).toBeGreaterThan(0.3);
    expect(idx.byCity['e-ga']).toBe(0.3); // complete month, all zero: the floor
    for (const p of Object.values(idx.byCity)) expect(p >= 0.3 && p <= 0.9).toBe(true);
  });

  it('a partial month ranks only cities with volume; the rest are absent so the fallback applies', () => {
    const idx = buildPriorityIndex({ month: MONTH, complete: false, volumes: new Map([['roofing aville', 50]]), plan });
    expect(Object.keys(idx.byCity)).toEqual(['a-ga']);
    expect(pagePriority('/local/georgia/b-ga', FALLBACK_PRIORITY, idx)).toBe(FALLBACK_PRIORITY);
  });
});

describe('computePriorityIndex (reads the table)', () => {
  it('nothing stored: null, so every caller keeps the fixed value', async () => {
    expect(await computePriorityIndex(new FakeDb({ holler_keyword_volume: [] }) as never, plan)).toBeNull();
  });

  it('read error: null, no throw', async () => {
    const db = new FakeDb({ holler_keyword_volume: [] });
    db.failOn['holler_keyword_volume.select'] = 'boom';
    expect(await computePriorityIndex(db as never, plan)).toBeNull();
  });

  it('uses the newest month when it is complete', async () => {
    const db = new FakeDb({ holler_keyword_volume: [] });
    fill(db, '2026-10-01', { 'roofing eville': 999 });
    fill(db, MONTH, { 'roofing aville': 100 });
    const idx = await computePriorityIndex(db as never, plan);
    expect(idx).toMatchObject({ month: MONTH, complete: true });
    expect(idx!.byCity['a-ga']).toBe(0.9);
    expect(idx!.byCity['e-ga']).toBe(0.3);
  });

  it('a thin new month does not replace a complete previous month', async () => {
    const db = new FakeDb({ holler_keyword_volume: [] });
    fill(db, '2026-10-01', { 'roofing eville': 999 });
    db.tables.holler_keyword_volume.push(...rows(MONTH, { 'roofing aville': 100 }));
    const idx = await computePriorityIndex(db as never, plan);
    expect(idx).toMatchObject({ month: '2026-10-01', complete: true });
    expect(idx!.byCity['e-ga']).toBe(0.9);
  });

  it('only a thin month exists: partial, so unseen cities fall back', async () => {
    const db = new FakeDb({ holler_keyword_volume: [] });
    db.tables.holler_keyword_volume.push(...rows(MONTH, { 'roofing aville': 100 }));
    const idx = await computePriorityIndex(db as never, plan);
    expect(idx).toMatchObject({ month: MONTH, complete: false });
    expect(idx!.byCity).toEqual({ 'a-ga': 0.9 });
  });
});

describe('withVolumePriority (the sitemap helper)', () => {
  it('leaves entries alone when no admin client is configured (fallback values survive)', async () => {
    const entries = [
      { url: 'https://localholler.com/local/georgia/a-ga', priority: 0.6 },
      { url: 'https://localholler.com/pricing', priority: 0.7 },
    ];
    const out = await withVolumePriority(entries);
    expect(out).toEqual(entries);
  });
});
