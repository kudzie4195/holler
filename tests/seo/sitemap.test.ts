import { describe, expect, it } from 'vitest';
import { buildEntries, type SitemapEntry } from '../../lib/seo/sitemap-entries';
import type { PlaceCounts } from '../../lib/seo/data';

const ok = (counts: Record<string, number>, latest: Record<string, string> = {}): PlaceCounts => ({ ok: true, counts, latest, partial: false });
const find = (es: SitemapEntry[], suffix: string) => es.find((e) => e.url.endsWith(suffix));

describe('sitemap entries', () => {
  it('uses latest_at as lastModified for a city', () => {
    const es = buildEntries({ places: ok({ 'atlanta-ga': 12 }, { 'atlanta-ga': '2026-11-15T10:00:00.000Z' }), trades: [] });
    expect(find(es, '/local/georgia/atlanta-ga')?.lastModified?.toISOString()).toBe('2026-11-15T10:00:00.000Z');
    expect(find(es, '/local/georgia')?.lastModified?.toISOString()).toBe('2026-11-15T10:00:00.000Z');
  });
  it('omits lastModified when latest_at is missing, never the build time', () => {
    const es = buildEntries({ places: ok({ 'atlanta-ga': 12 }), trades: [] });
    const atl = find(es, '/local/georgia/atlanta-ga');
    expect(atl).toBeDefined();
    expect(atl && 'lastModified' in atl).toBe(false);
    expect(es.every((e) => !e.lastModified)).toBe(true);
  });
  it('ignores a malformed latest_at', () => {
    const es = buildEntries({ places: ok({ 'atlanta-ga': 12 }, { 'atlanta-ga': 'garbage' }), trades: [] });
    expect(find(es, '/local/georgia/atlanta-ga')?.lastModified).toBeUndefined();
  });
  it('lists only thin-free cities, and none when the DB is down', () => {
    const es = buildEntries({ places: ok({ 'atlanta-ga': 5, 'dallas-tx': 4 }), trades: [] });
    expect(find(es, '/local/georgia/atlanta-ga')).toBeDefined();
    expect(find(es, '/local/texas/dallas-tx')).toBeUndefined();
    const down = buildEntries({ places: { ok: false, counts: {}, latest: {}, partial: false }, trades: [] });
    expect(down.some((e) => /\/local\/[^/]+\/[^/]+$/.test(e.url))).toBe(false);
    expect(find(down, '/local/georgia')).toBeDefined();
  });
  it('adds /check, /for and only indexable trade pages', () => {
    const es = buildEntries({
      places: ok({}),
      trades: [
        { id: 'roofing', count: 10, latestAt: '2026-11-14T00:00:00.000Z' },
        { id: 'hvac', count: 4, latestAt: '2026-11-14T00:00:00.000Z' },
      ],
    });
    expect(find(es, '/check')).toBeDefined();
    expect(find(es, '/for')).toBeDefined();
    expect(find(es, '/for/roofing')?.lastModified?.toISOString()).toBe('2026-11-14T00:00:00.000Z');
    expect(find(es, '/for/hvac')).toBeUndefined();
  });
});
