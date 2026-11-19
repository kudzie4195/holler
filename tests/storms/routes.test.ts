import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { StormRow } from '@/lib/storms/report';
import { cobbDay, fema, spc } from './helpers';

const h = vi.hoisted(() => ({ rows: [] as unknown[], error: false, noClient: false, selects: [] as string[], eqs: [] as [string, string][] }));

vi.mock('next/cache', () => ({ cacheLife: vi.fn() }));
vi.mock('@/components/top-nav', () => ({ TopNav: () => null }));
vi.mock('@/components/footer', () => ({ Footer: () => null }));
vi.mock('@/lib/seo/client', () => ({
  publicClient: () => {
    if (h.noClient) return null;
    const q: Record<string, unknown> = {};
    const self = () => q;
    q.select = (cols: string) => (h.selects.push(cols), q);
    q.in = self;
    q.gte = self;
    q.lt = self;
    q.eq = (c: string, v: string) => (h.eqs.push([c, v]), q);
    q.order = self;
    q.range = (from: number, to: number) => ({
      abortSignal: async () => (h.error ? { data: null, error: { message: 'boom' } } : { data: (h.rows as { state?: string }[]).filter((r) => h.eqs.every(([c, v]) => c !== 'state' || r.state === v)).slice(from, to + 1), error: null }),
    });
    return { from: () => q };
  },
}));

import { loadStormIndex, loadStormReport, qualifyingReports } from '@/lib/storms/data';
import StormIndexPage, * as indexModule from '@/app/storms/page';
import StormReportPage, * as reportModule from '@/app/storms/[state]/[slug]/page';
import { FEMA_ONLY_NOTE, HOW_TO_READ } from '@/lib/storms/copy';

const params = (state: string, slug: string) => ({ params: Promise.resolve({ state, slug }) });
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

beforeEach(() => {
  h.rows = [];
  h.error = false;
  h.noClient = false;
  h.selects = [];
  h.eqs = [];
});

describe('loader', () => {
  it('never selects a remark, title, summary, coordinate or id column', () => {
    const src = readFileSync(new URL('../../lib/storms/data.ts', import.meta.url), 'utf8');
    const cols = /const COLUMNS =\s*'([^']+)'/.exec(src)![1];
    for (const bad of ['summary', 'title', 'comments', 'lat', 'lon', 'zip', 'external_id']) expect(cols, bad).not.toMatch(new RegExp(`(^|[,>])${bad}(,|$)`));
    expect(cols).not.toContain('data->>comments');
    expect(cols).not.toContain('data,');
  });
  it('a slug round-trips: the report built for the index loads at its own path parts', async () => {
    h.rows = [...cobbDay(), fema()];
    const index = await loadStormIndex();
    expect(index.ok).toBe(true);
    for (const r of index.reports) {
      const stateSlug = r.state === 'GA' ? 'georgia' : '';
      const res = await loadStormReport(stateSlug, r.slug);
      expect(res.status, r.slug).toBe('ok');
      if (res.status === 'ok') expect(res.report.slug).toBe(r.slug);
    }
    expect(h.eqs.some(([c, v]) => c === 'state' && v === 'GA')).toBe(true);
  });
  it('index is not ok when the database is missing or errors', async () => {
    h.noClient = true;
    expect((await loadStormIndex()).ok).toBe(false);
    h.noClient = false;
    h.error = true;
    expect((await loadStormIndex()).ok).toBe(false);
    expect((await loadStormReport('georgia', 'cobb-county-2026-11-14')).status).toBe('error');
  });
});

describe('404 on a bad slug', () => {
  beforeEach(() => {
    h.rows = cobbDay();
  });
  const bad: [string, string][] = [
    ['georgia', 'nonsense'],
    ['georgia', 'cobb-county'],
    ['georgia', 'cobb-county-2026-13-45'],
    ['georgia', 'fulton-county-2026-11-14'], // valid shape, no records
    ['georgia', 'cobb-county-2026-11-13'], // right place, wrong day
    ['nowhere', 'cobb-county-2026-11-14'], // unknown state
    ['texas', 'cobb-county-2026-11-14'], // state does not match the records
    ['ga', 'cobb-county-2026-11-14'], // code, not the state slug
  ];
  for (const [state, slug] of bad) {
    it(`${state}/${slug}`, async () => {
      expect((await loadStormReport(state, slug)).status).toBe('missing');
      await expect(StormReportPage(params(state, slug))).rejects.toMatchObject({ digest: expect.stringContaining('404') });
    });
  }
  it('a database failure is a server error, not a 404', async () => {
    h.error = true;
    await expect(StormReportPage(params('georgia', 'cobb-county-2026-11-14'))).rejects.not.toMatchObject({ digest: expect.stringContaining('404') });
  });
  it('the good slug renders', async () => {
    const html = renderToStaticMarkup(await StormReportPage(params('georgia', 'cobb-county-2026-11-14')));
    expect(html).toContain('Storm reports in Cobb County, GA on November 14, 2026');
  });
});

describe('report page', () => {
  it('has the plain heading, the summary, a records table, the signup line and sources; no remarks', async () => {
    h.rows = cobbDay().map((r) => ({ ...r, summary: 'Spotter Jane Doe 404-555-0100', title: 'x' })) as StormRow[];
    const html = renderToStaticMarkup(await StormReportPage(params('georgia', 'cobb-county-2026-11-14')));
    const t = text(html);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(t).toContain('Storm reports in Cobb County, GA on November 14, 2026');
    expect(t).toContain('logged 3 storm reports in Cobb County, GA on November 14, 2026: 1 hail, 1 wind, 1 tornado.');
    expect(t).toContain('The largest hail reported was 1.75 inches.');
    expect(t).toContain('The highest wind gust reported was 62 mph.');
    expect(html).toContain('<table');
    expect(html.match(/<tbody>[\s\S]*<\/tbody>/)![0].match(/<tr/g)).toHaveLength(3);
    expect(t).toContain('Holler alerts roofers, tree services and other local trades');
    expect(html).toContain('href="/signup"');
    expect(html).toContain('https://www.spc.noaa.gov/climo/reports/');
    expect(t).toContain(HOW_TO_READ);
    expect(t).not.toMatch(/Jane|Doe|555/);
  });
  it('JSON-LD is a WebPage with dateModified and a breadcrumb, with no Event or Review', async () => {
    h.rows = cobbDay();
    const html = renderToStaticMarkup(await StormReportPage(params('georgia', 'cobb-county-2026-11-14')));
    const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1]) as Record<string, unknown>[];
    const types = ld.map((n) => n['@type']);
    expect(types).toEqual(['BreadcrumbList', 'WebPage']);
    expect(ld[1].dateModified).toBe('2026-11-14T21:00:00.000Z');
    expect(JSON.stringify(ld)).not.toMatch(/"Event"|Review|Rating/);
  });
  it('copy has no em or en dash and none of the banned words', async () => {
    h.rows = [...cobbDay(), fema()];
    for (const slug of ['cobb-county-2026-11-14', 'georgia-fema-2026-10-27']) {
      const t = text(renderToStaticMarkup(await StormReportPage(params('georgia', slug))));
      expect(t).not.toMatch(/[–—]/);
      expect(t).not.toMatch(/\b(delve|robust|seamless|elevate|unlock|empower|journey|landscape|leverage)\b|not only|more than just|it's worth noting/i);
    }
  });
  it('a FEMA page says declaration, not storm report counts', async () => {
    h.rows = [fema()];
    const t = text(renderToStaticMarkup(await StormReportPage(params('georgia', 'georgia-fema-2026-10-27'))));
    expect(t).toContain('FEMA storm disaster declaration for Georgia on October 27, 2026');
    expect(t).toContain('Major disaster declaration DR-4955');
  });
});

describe('FEMA pages (review P1-1, P1-4)', () => {
  it('a FEMA-only page says what it lists and never the SPC explanation', async () => {
    h.rows = [fema()];
    const t = text(renderToStaticMarkup(await StormReportPage(params('georgia', 'georgia-fema-2026-10-27'))));
    expect(t).toContain('This page lists a federal disaster declaration from FEMA for this state.');
    expect(FEMA_ONLY_NOTE).toBe('This page lists a federal disaster declaration from FEMA for this state.');
    expect(t).not.toContain(HOW_TO_READ);
    expect(t).not.toContain('Storm Prediction Center. They come from spotters');
  });
  it('an SPC page still shows the SPC explanation and not the FEMA line', async () => {
    h.rows = cobbDay();
    const t = text(renderToStaticMarkup(await StormReportPage(params('georgia', 'cobb-county-2026-11-14'))));
    expect(t).toContain(HOW_TO_READ);
    expect(t).not.toContain(FEMA_ONLY_NOTE);
  });
  it('the review hostile FEMA row: no page, and nothing of it on the page of a clean row beside it', async () => {
    const hostile = fema({ incident: 'Severe Storm call Jane Doe 404-555-0100 jane@example.com', decl: 'Jane Doe 555', disaster: 4955 });
    h.rows = [hostile];
    expect((await loadStormReport('georgia', 'georgia-fema-2026-10-27')).status).toBe('missing');
    h.rows = [hostile, fema({ decl: 'Jane Doe 555', disaster: 'Jane 555' })];
    const html = renderToStaticMarkup(await StormReportPage(params('georgia', 'georgia-fema-2026-10-27')));
    expect(html).not.toMatch(/Jane|Doe|555|0100|@example/);
    expect(text(html)).toContain('Disaster declaration, severe storm');
  });
});

describe('route meta', () => {
  const meta = async (state: string, slug: string) => reportModule.generateMetadata(params(state, slug));
  it('title and description are unique per page', async () => {
    const day = (county: string, d: string) => [0, 1, 2].map((i) => spc({ county, occurred_at: `${d}T2${i}:00:00.000Z` }));
    h.rows = [...day('Cobb', '2026-11-14'), ...day('Fulton', '2026-11-14'), ...day('Cobb', '2026-11-12'), fema()];
    const slugs = ['cobb-county-2026-11-14', 'fulton-county-2026-11-14', 'cobb-county-2026-11-12', 'georgia-fema-2026-10-27'];
    const metas = await Promise.all(slugs.map((s) => meta('georgia', s)));
    const titles = metas.map((m) => (m.title as { absolute: string }).absolute);
    const descs = metas.map((m) => m.description);
    expect(new Set(titles).size).toBe(4);
    expect(new Set(descs).size).toBe(4);
    expect(titles[0]).toBe('Storm reports in Cobb County, GA on November 14, 2026 | Holler');
    expect(descs[0]).toBe('3 storm reports (3 hail) in Cobb County, GA on November 14, 2026, from the NOAA Storm Prediction Center, with a link to each source.');
    for (const m of metas) {
      expect(m.robots).toEqual({ index: true, follow: true });
      expect(m.alternates?.canonical).toMatch(/^https?:\/\/[^/]+\/storms\/georgia\//);
    }
  });
  it('a page that falls below the threshold after data changes is noindex and says so', async () => {
    h.rows = cobbDay();
    expect((await meta('georgia', 'cobb-county-2026-11-14')).robots).toEqual({ index: true, follow: true });
    h.rows = cobbDay().slice(0, 2);
    // new rows are read: the cache is mocked away, so this is the same call a fresh cache entry would make
    const m = await meta('georgia', 'cobb-county-2026-11-14');
    expect(m.robots).toEqual({ index: false, follow: true });
    const t = text(renderToStaticMarkup(await StormReportPage(params('georgia', 'cobb-county-2026-11-14'))));
    expect(t).toContain('fewer than the 3 reports Holler needs');
  });
  it('an unknown slug gets a noindex Not found title', async () => {
    h.rows = cobbDay();
    const m = await meta('georgia', 'nonsense');
    expect(m.robots).toEqual({ index: false });
  });
});

describe('/storms index', () => {
  const recent = (county: string, d: string) => [0, 1, 2].map((i) => spc({ county, occurred_at: `${d}T2${i}:00:00.000Z` }));
  it('with fewer than 3 qualifying reports: honest empty state and noindex', async () => {
    h.rows = [...cobbDay().slice(0, 2)];
    const m = await indexModule.generateMetadata();
    expect(m.robots).toEqual({ index: false, follow: true });
    const t = text(renderToStaticMarkup(await StormIndexPage()));
    expect(t).toContain('No county has enough reports right now');
    expect(t).not.toMatch(/storm reports \(/);
  });
  it('with 3 or more: indexable, newest first, one link per report', async () => {
    const now = Date.now();
    const d = (n: number) => new Date(now - n * 86_400_000).toISOString().slice(0, 10);
    h.rows = [...recent('Cobb', d(5)), ...recent('Fulton', d(2)), ...recent('Hall', d(9))];
    const m = await indexModule.generateMetadata();
    expect(m.robots).toEqual({ index: true, follow: true });
    const html = renderToStaticMarkup(await StormIndexPage());
    const links = [...html.matchAll(/href="(\/storms\/georgia\/[^"]+)"/g)].map((x) => x[1]);
    expect(links).toHaveLength(3);
    expect(links[0]).toContain('fulton-county');
    expect(links[2]).toContain('hall-county');
    expect(html).toContain('CollectionPage');
  });
  it('a database failure shows the not loading state with noindex', async () => {
    h.error = true;
    const m = await indexModule.generateMetadata();
    expect(m.robots).toEqual({ index: false, follow: true });
    expect(text(renderToStaticMarkup(await StormIndexPage()))).toContain('Storm reports are not loading');
  });
  it('lists only qualifying reports', async () => {
    h.rows = [...recent('Cobb', new Date().toISOString().slice(0, 10)), spc({ county: 'Hall' })];
    const data = await loadStormIndex();
    expect(data.reports.length).toBe(2);
    expect(qualifyingReports(data).map((r) => r.name)).toEqual(['Cobb County']);
  });
});
