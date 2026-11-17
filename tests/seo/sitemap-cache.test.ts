import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ cacheLife: vi.fn(), placesOk: true, tradesOk: true }));
vi.mock('next/cache', () => ({ cacheLife: h.cacheLife }));
vi.mock('@/lib/seo/data', () => ({
  loadPlaceCounts: async () => ({ ok: h.placesOk, counts: h.placesOk ? { 'atlanta-ga': 9 } : {}, latest: {}, partial: false }),
}));
vi.mock('@/lib/seo/trade-data', () => ({
  isTradeIndexable: (n: number) => n >= 5,
  loadTradeSignals: async (trade: string) => ({ ok: h.tradesOk, trade, asOf: '', items: [] }),
}));
import { buildSitemapEntries } from '@/lib/seo/sitemap-entries';

describe('sitemap cache lifetime follows the reads', () => {
  beforeEach(() => {
    h.cacheLife.mockClear();
    h.placesOk = true;
    h.tradesOk = true;
  });
  it('healthy reads are cached for 6 hours', async () => {
    await buildSitemapEntries();
    expect(h.cacheLife).toHaveBeenCalledWith({ stale: 300, revalidate: 21600, expire: 86400 });
  });
  it('a failed place read is cached for a minute, not 6 hours', async () => {
    h.placesOk = false;
    const es = await buildSitemapEntries();
    expect(h.cacheLife).toHaveBeenCalledTimes(1);
    expect(h.cacheLife).toHaveBeenCalledWith({ stale: 60, revalidate: 60, expire: 300 });
    expect(es.some((e) => /\/local\/[^/]+\/[^/]+$/.test(e.url))).toBe(false);
  });
  it('a failed trade read is cached for a minute too', async () => {
    h.tradesOk = false;
    await buildSitemapEntries();
    expect(h.cacheLife).toHaveBeenCalledWith({ stale: 60, revalidate: 60, expire: 300 });
  });
});
