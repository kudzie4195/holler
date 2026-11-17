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
    // Guides carry their own reviewed date; every other entry here has no known change time.
    expect(es.filter((e) => !e.url.includes('/guides/')).every((e) => !e.lastModified)).toBe(true);
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

describe('sitemap weekly pages', () => {
  const NOW = Date.parse('2026-11-17T12:00:00Z'); // Monday of the week is 2026-11-16
  const weekUrls = (es: SitemapEntry[]) => es.filter((e) => e.url.includes('/week/'));
  const places = ok(
    { 'atlanta-ga': 40, 'raleigh-nc': 12, 'dallas-tx': 9, 'chicago-il': 30, 'austin-tx': 25 },
    {
      'atlanta-ga': '2026-11-17T08:00:00.000Z', // this week, 40 records: listed
      'raleigh-nc': '2026-11-16T01:00:00.000Z', // this week, 12 records: listed
      'dallas-tx': '2026-11-17T08:00:00.000Z', // this week but only 9 in 60 days: cannot reach 10 this week, not listed
      'chicago-il': '2026-11-13T08:00:00.000Z', // no record since Monday: not listed
      // austin-tx has no latest_at: cannot tell, not listed
    },
  );
  it('lists the current week only for listed cities that can reach 10 records, with the real lastmod', () => {
    const es = buildEntries({ places, trades: [], now: NOW });
    expect(weekUrls(es).map((e) => e.url.replace(/^https?:\/\/[^/]+/, '')).sort()).toEqual([
      '/local/georgia/atlanta-ga/week/2026-11-16',
      '/local/north-carolina/raleigh-nc/week/2026-11-16',
    ]);
    expect(find(es, '/atlanta-ga/week/2026-11-16')?.lastModified?.toISOString()).toBe('2026-11-17T08:00:00.000Z');
  });
  it('adds none without a clock, so existing callers are unchanged', () => {
    expect(weekUrls(buildEntries({ places, trades: [] }))).toEqual([]);
  });
  it('adds none when the database is down, and never lists a city that is not in the sitemap', () => {
    expect(weekUrls(buildEntries({ places: { ok: false, counts: {}, latest: {}, partial: false }, trades: [], now: NOW }))).toEqual([]);
    const thin = ok({ 'atlanta-ga': 4 }, { 'atlanta-ga': '2026-11-17T08:00:00.000Z' });
    expect(weekUrls(buildEntries({ places: thin, trades: [], now: NOW }))).toEqual([]);
  });
});
