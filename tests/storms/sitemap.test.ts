import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildReports, reportPath } from '@/lib/storms/report';
import { buildStormEntries } from '@/lib/storms/entries';
import { cobbDay, fema, spc } from './helpers';

vi.mock('next/cache', () => ({ cacheLife: vi.fn() }));
vi.mock('@/lib/seo/sitemap-entries', () => ({ buildSitemapEntries: async () => [{ url: 'https://x.test/', changeFrequency: 'weekly', priority: 1 }] }));
vi.mock('@/lib/storms/entries', async (orig) => ({
  ...(await orig<typeof import('@/lib/storms/entries')>()),
  loadStormSitemapEntries: async () => buildStormEntries(buildReports([...cobbDay(), spc({ county: 'Hall' })])),
}));

const day = (county: string, d: string) => [0, 1, 2].map((i) => spc({ county, occurred_at: `${d}T2${i}:00:00.000Z` }));

describe('sitemap includes only qualifying pages', () => {
  it('lists qualifying pages and leaves the thin one out', () => {
    const reports = buildReports([...day('Cobb', '2026-11-14'), ...day('Fulton', '2026-11-13'), ...day('Hall', '2026-11-12'), spc({ county: 'Bibb', occurred_at: '2026-11-14T20:00:00.000Z' }), spc({ county: 'Bibb', occurred_at: '2026-11-14T21:00:00.000Z' }), fema()]);
    expect(reports).toHaveLength(5);
    const entries = buildStormEntries(reports);
    const urls = entries.map((e) => e.url.replace(/^https?:\/\/[^/]+/, ''));
    expect(urls).toContain('/storms');
    expect(urls).toContain('/storms/georgia/cobb-county-2026-11-14');
    expect(urls).toContain('/storms/georgia/georgia-fema-2026-10-27');
    expect(urls.some((u) => u.includes('bibb'))).toBe(false);
    expect(urls).toHaveLength(5);
    for (const r of reports.filter((x) => x.qualifies)) expect(urls).toContain(reportPath(r));
  });
  it('/storms is listed only with 3 or more qualifying pages; a lone qualifying page is still listed', () => {
    const two = buildStormEntries(buildReports([...day('Cobb', '2026-11-14'), ...day('Fulton', '2026-11-14')]));
    expect(two.map((e) => e.url.replace(/^https?:\/\/[^/]+/, ''))).not.toContain('/storms');
    expect(two).toHaveLength(2);
    expect(buildStormEntries(buildReports([spc(), spc()]))).toEqual([]);
  });
  it('lastModified is the newest created_at of the records, and is left out when unknown', () => {
    const e = buildStormEntries(buildReports(cobbDay()))[0];
    expect(e.lastModified?.toISOString()).toBe('2026-11-14T21:00:00.000Z');
    const noTime = buildStormEntries(buildReports(cobbDay().map((r) => ({ ...r, created_at: null }))));
    expect(noTime[0].lastModified).toBeUndefined();
  });
  it('app/sitemap.ts adds the storm entries to the existing ones', async () => {
    const mod = await import('@/app/sitemap');
    const out = await mod.default();
    expect(out[0].url).toBe('https://x.test/');
    expect(out.some((e) => e.url.endsWith('/storms/georgia/cobb-county-2026-11-14'))).toBe(true);
    expect(out.some((e) => e.url.includes('hall-county'))).toBe(false);
  });
  it('app/llms.txt names /storms in one line', () => {
    const src = readFileSync(new URL('../../app/llms.txt/route.ts', import.meta.url), 'utf8');
    expect(src.match(/\/storms/g)).toHaveLength(1);
    expect(src).not.toMatch(/[–—]/);
  });
});
