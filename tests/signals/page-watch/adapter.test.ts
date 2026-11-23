import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAGE_WATCH_DATASETS, pageWatchDataset, type PageWatchDataset } from '@/lib/signals/adapters/page-watch-datasets';
import { adapters, buildPageWatchAdapter, pageWatchLogLines, PW_MARKER_PREFIX, PW_ROW_CAP, PW_UA, runPageWatch } from '@/lib/signals/adapters/page-watch';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { missingEnvFor } from '@/lib/signals/run';
import { BID_SOURCE_IDS, BIDS_FLAG, LOCAL_BIDS_FLAG, isBidSignal } from '@/lib/signals/bid-sources';
import { LABEL_PENDING_INTEGRATION, PROBATION_SOURCE_IDS, probationCheck, probationOverview } from '@/lib/signals/probation';
import { PROPOSED_LABELS } from '@/lib/signals/proposed-labels';
import { SOURCE_META } from '@/lib/signals/source-meta';
import { sourceLabelLang } from '@/lib/signals/source-label-i18n';
import { localizeTitle } from '@/lib/signals/title-i18n';
import { sourcePlaces } from '@/lib/admin/metros';
import { resetRobotsCache } from '@/lib/firecrawl/robots';
import { resetRunSpend } from '@/lib/firecrawl/budget';
import { FakeDb } from '../../firecrawl/fakes';

/** Fixtures are hand-written (fixtures/README.md). */
const fx = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
const NOW = new Date('2026-11-22T17:00:00Z');
const ds = (id: string): PageWatchDataset => pageWatchDataset(id)!;
const PEOPLE = /Buyerson|Smallwood|Ferreira|Brennan|@|555-01/i;

interface Route {
  robots?: string | number | Error;
  page?: { body: string; type?: string; status?: number } | Error;
}

/** A fetch that answers robots.txt and the page, and records every URL asked for. */
function fakeFetch(r: Route) {
  const calls: string[] = [];
  const headers: Record<string, string>[] = [];
  const f = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    headers.push((init?.headers ?? {}) as Record<string, string>);
    if (url.endsWith('/robots.txt')) {
      if (r.robots instanceof Error) throw r.robots;
      if (typeof r.robots === 'number') return new Response('', { status: r.robots });
      return new Response(r.robots ?? 'User-agent: *\nDisallow: /admin\n', { status: 200 });
    }
    if (r.page instanceof Error) throw r.page;
    const p = r.page ?? { body: '' };
    return new Response(p.body, { status: p.status ?? 200, headers: { 'content-type': p.type ?? 'text/html; charset=utf-8' } });
  }) as unknown as typeof fetch;
  return { f, calls, headers };
}

beforeEach(() => {
  resetRobotsCache();
  resetRunSpend();
});
afterEach(() => vi.unstubAllEnvs());

describe('registration and switches', () => {
  it('every verified dataset is registered once, on probation, kind contract, a bid source, with source meta in both languages', () => {
    const ids = PAGE_WATCH_DATASETS.filter((d) => d.verified).map((d) => d.id);
    expect(adapters.map((a) => a.id)).toEqual(ids);
    expect(ids.length).toBeGreaterThanOrEqual(15);
    for (const id of ids) {
      const a = ALL_ADAPTERS.find((x) => x.id === id)!;
      expect(a.probation, id).toBe(true);
      expect(a.kind).toBe('contract');
      expect(PROBATION_SOURCE_IDS.has(id), id).toBe(true);
      expect(LABEL_PENDING_INTEGRATION).toContain(id);
      expect(BID_SOURCE_IDS).toContain(id);
      expect(isBidSignal({ source: id })).toBe(true);
      expect(SOURCE_META[id]).toEqual({ id, label: a.label, sourceUrl: a.sourceUrl });
      expect(sourceLabelLang(id, 'es')).not.toBe(a.label);
    }
  });
  it('Dallas and Houston come first and each of the ten metros but New York and Washington has at least one page', () => {
    const metros = new Set(PAGE_WATCH_DATASETS.map((d) => d.metro));
    for (const m of ['dallas-fort-worth', 'houston', 'atlanta', 'philadelphia', 'miami', 'phoenix', 'chicago', 'los-angeles']) expect(metros.has(m as never), m).toBe(true);
    expect(PAGE_WATCH_DATASETS.slice(0, 8).every((d) => d.metro === 'dallas-fort-worth' || d.metro === 'houston')).toBe(true);
    const places = sourcePlaces();
    for (const d of PAGE_WATCH_DATASETS) expect(places.get(d.id), d.id).toBe(d.metro);
  });
  it('a plain-fetch probation source runs with the bids flag OFF (samples only, $0); promoted, it needs the flag', () => {
    vi.stubEnv(BIDS_FLAG, '');
    const a = ALL_ADAPTERS.find((x) => x.id === 'bids-pw-dart')!;
    expect(missingEnvFor(a, {})).toEqual([]);
    const promoted = buildPageWatchAdapter({ ...ds('bids-pw-dart'), probation: false });
    expect(promoted.probation).toBeUndefined();
    expect(missingEnvFor(promoted, {})).toEqual([BIDS_FLAG]);
    vi.stubEnv(BIDS_FLAG, '1');
    expect(missingEnvFor(promoted, {})).toEqual([]);
  });
  it('a promoted source fetches nothing while the bids flag is off, even when called directly', async () => {
    vi.stubEnv(BIDS_FLAG, '');
    const { f, calls } = fakeFetch({});
    const a = buildPageWatchAdapter({ ...ds('bids-pw-dart'), probation: false });
    const logs: string[] = [];
    expect(await a.fetch({ since: NOW, now: NOW, fetch: f, env: {}, log: (m) => logs.push(m) })).toEqual([]);
    expect(calls).toEqual([]);
    expect(logs).toEqual([`bids-pw-dart: skipped, ${BIDS_FLAG} is off`]);
  });
  it('Firecrawl-only pages need HOLLER_LOCAL_BIDS_ENABLED and the key (named by missingEnvFor), not the bids flag', () => {
    vi.stubEnv(BIDS_FLAG, '');
    vi.stubEnv(LOCAL_BIDS_FLAG, '');
    for (const id of ['bids-pw-houston-city', 'bids-pw-phoenix-opengov']) {
      const a = ALL_ADAPTERS.find((x) => x.id === id)!;
      expect(missingEnvFor(a, {})).toEqual(['FIRECRAWL_API_KEY', LOCAL_BIDS_FLAG]);
    }
    vi.stubEnv(LOCAL_BIDS_FLAG, '1');
    expect(missingEnvFor(ALL_ADAPTERS.find((x) => x.id === 'bids-pw-houston-city')!, { FIRECRAWL_API_KEY: 'k' })).toEqual([]);
  });
  it('a Firecrawl-only page makes no call of any kind without the switch and key', async () => {
    vi.stubEnv(LOCAL_BIDS_FLAG, '');
    vi.stubEnv('FIRECRAWL_API_KEY', '');
    const { f, calls } = fakeFetch({});
    const r = await runPageWatch(ds('bids-pw-houston-city'), { fetch: f, now: NOW, env: {} });
    expect(r.check).toBe('skipped');
    expect(r.detail).toMatch(/HOLLER_LOCAL_BIDS_ENABLED and FIRECRAWL_API_KEY/);
    expect(calls).toEqual([]);
  });
  it('every page-watch id has a proposed label entry: public-bid, a call path, metros, act_now or coming_soon per trade', () => {
    for (const d of PAGE_WATCH_DATASETS) {
      const p = PROPOSED_LABELS[d.id];
      expect(p, d.id).toBeDefined();
      expect(p.metros).toEqual([d.metro]);
      expect(p.recordKind).toBe('public-bid');
      expect(p.callPath).toBe(true);
      expect(p.expectedRowsPerWeekPerMetro).toBeGreaterThan(0);
      expect(Object.keys(p.labels).sort()).toEqual([...d.trades].sort());
      for (const v of Object.values(p.labels)) expect(['act_now', 'coming_soon']).toContain(typeof v === 'string' ? v : v!.label);
    }
  });
  it('the Spanish title keeps the agency\'s words and says Licitación', () => {
    expect(localizeTitle('Bid: Roof Replacement at Kashmere (Houston METRO)', 'es', 'bids-pw-houston-metro')).toBe('Licitación: Roof Replacement at Kashmere (Houston METRO)');
    expect(localizeTitle('Bid: Roof Replacement at Kashmere (Houston METRO)', 'en', 'bids-pw-houston-metro')).toBe('Bid: Roof Replacement at Kashmere (Houston METRO)');
  });
});

describe('runPageWatch: check states', () => {
  it('robots.txt disallows the path: the page is never fetched, the source shows robots_disallowed', async () => {
    const { f, calls } = fakeFetch({ robots: 'User-agent: *\nDisallow: /about/business-to-business/\n', page: { body: fx('metro-table.html') } });
    const d = ds('bids-pw-houston-metro');
    const r = await runPageWatch(d, { fetch: f, now: NOW });
    expect(r.check).toBe('robots_disallowed');
    expect(calls).toEqual(['https://www.ridemetro.org/robots.txt']);
    const lines = pageWatchLogLines(d, r);
    expect(lines[0]).toBe('error: bids-pw-houston-metro: robots_disallowed (robots.txt disallows /about/business-to-business/procurement-opportunities)');
    expect(probationCheck({ source: d.id, last_run_at: 'x', last_success_at: null, last_error: lines[0] })).toBe('robots_disallowed');
  });
  it('a "Holler" group in robots.txt is obeyed over the * group', async () => {
    const { f, calls } = fakeFetch({ robots: 'User-agent: *\nAllow: /\n\nUser-agent: Holler\nDisallow: /procurement/\n', page: { body: fx('septa.html') } });
    const r = await runPageWatch(ds('bids-pw-septa'), { fetch: f, now: NOW });
    expect(r.check).toBe('robots_disallowed');
    expect(calls).toHaveLength(1);
  });
  it('robots.txt unreachable (5xx): not fetched this run', async () => {
    const { f, calls } = fakeFetch({ robots: 503 });
    const r = await runPageWatch(ds('bids-pw-septa'), { fetch: f, now: NOW });
    expect(r.check).toBe('robots_unreachable');
    expect(calls).toHaveLength(1);
  });
  it('sends a clear user agent and reads the page', async () => {
    const { f, calls, headers } = fakeFetch({ page: { body: fx('metro-table.html') } });
    const r = await runPageWatch(ds('bids-pw-houston-metro'), { fetch: f, now: NOW });
    expect(calls).toEqual(['https://www.ridemetro.org/robots.txt', 'https://www.ridemetro.org/about/business-to-business/procurement-opportunities']);
    expect(headers[1]['User-Agent']).toBe(PW_UA);
    expect(r.check).toBe('ok');
    expect(r.counts).toMatchObject({ read: 5, kept: 4, closed: 1 });
    expect(JSON.stringify(r.kept)).not.toMatch(PEOPLE);
  });
  it('timeout: the page does not answer', async () => {
    const err = new Error('The operation was aborted due to timeout');
    err.name = 'TimeoutError';
    const { f } = fakeFetch({ page: err });
    const d = ds('bids-pw-houston-metro');
    const r = await runPageWatch(d, { fetch: f, now: NOW });
    expect(r.check).toBe('timeout');
    expect(pageWatchLogLines(d, r)[0]).toMatch(/^error: bids-pw-houston-metro: timeout/);
  });
  it('not_html: an HTML parser given JSON or a PDF', async () => {
    const { f } = fakeFetch({ page: { body: '{"a":1}', type: 'application/json' } });
    expect((await runPageWatch(ds('bids-pw-chicago'), { fetch: f, now: NOW })).check).toBe('not_html');
    resetRobotsCache();
    const pdf = fakeFetch({ page: { body: '%PDF-1.7', type: 'application/pdf' } });
    const r = await runPageWatch(ds('bids-pw-chicago'), { fetch: pdf.f, now: NOW });
    expect(r.check).toBe('not_html');
    expect(probationCheck({ source: 'bids-pw-chicago', last_run_at: 'x', last_success_at: null, last_error: pageWatchLogLines(ds('bids-pw-chicago'), r)[0] })).toBe('not_html');
  });
  it('not_json: Bonfire answers with an HTML page', async () => {
    const { f } = fakeFetch({ page: { body: '<html><body>Sign in</body></html>' } });
    const r = await runPageWatch(ds('bids-pw-dart'), { fetch: f, now: NOW });
    expect(r.check).toBe('not_json');
  });
  it('http_error: HTTP 404', async () => {
    const { f } = fakeFetch({ page: { body: 'nope', status: 404 } });
    const r = await runPageWatch(ds('bids-pw-chicago'), { fetch: f, now: NOW });
    expect(r).toMatchObject({ check: 'http_error', httpStatus: 404, detail: 'HTTP 404' });
  });
  it('parser_mismatch: zero rows from a page that has a table (the headers are named)', async () => {
    const { f } = fakeFetch({ page: { body: fx('mismatch-table.html') } });
    const d = ds('bids-pw-houston-isd');
    const r = await runPageWatch(d, { fetch: f, now: NOW });
    expect(r.check).toBe('parser_mismatch');
    expect(r.detail).toMatch(/foo\/bar/);
    const line = pageWatchLogLines(d, r)[0];
    expect(line).toMatch(/^error: bids-pw-houston-isd: parser_mismatch/);
    expect(probationCheck({ source: d.id, last_run_at: 'x', last_success_at: null, last_error: line })).toBe('parser_mismatch');
  });
  it('empty: the page says nothing is open (not a mismatch, not an error)', async () => {
    const { f } = fakeFetch({ page: { body: fx('miamidade-empty.html') } });
    const d = ds('bids-pw-miamidade-construction');
    const r = await runPageWatch(d, { fetch: f, now: NOW });
    expect(r.check).toBe('empty');
    expect(pageWatchLogLines(d, r)).toEqual(['bids-pw-miamidade-construction: the page lists no open solicitations']);
  });
  it('row_cap: more rows than the cap reads the first ones and leaves a probation note', async () => {
    const links = Array.from({ length: PW_ROW_CAP + 20 }, (_, i) => `<li><a href="/x/${i}">IFB 2027-${String(1000 + i)} Landscape Maintenance Area ${i}</a></li>`).join('');
    const { f } = fakeFetch({ page: { body: `<html><body><ul>${links}</ul></body></html>` } });
    const d = ds('bids-pw-atlanta-housing');
    const r = await runPageWatch(d, { fetch: f, now: NOW });
    expect(r.check).toBe('row_cap');
    expect(r.counts.read).toBe(PW_ROW_CAP);
    const lines = pageWatchLogLines(d, r);
    expect(lines).toContain(`probation note: row cap reached: ${PW_ROW_CAP + 20} rows on the page, the first ${PW_ROW_CAP} read`);
    expect(probationCheck({ source: d.id, last_run_at: 'x', last_success_at: 'x', last_error: null, last_record_at: 'x' }, { source: d.id, started_at: 'x', error: lines[1] })).toBe('row_cap');
  });
});

describe('the listing hash: an unchanged page costs one fetch', () => {
  const d = () => ds('bids-pw-chicago');
  it('first run parses and writes a parsed marker; once the scan stored the rows, the same listing is unchanged and returns nothing', async () => {
    const db = new FakeDb();
    const page = fx('chicago.html');
    const r1 = await runPageWatch(d(), { fetch: fakeFetch({ page: { body: page } }).f, now: NOW, db: db as never });
    expect(r1.check).toBe('ok');
    expect(r1.kept).toHaveLength(2);
    const marker = db.rows.find((x) => x.source === `${PW_MARKER_PREFIX}bids-pw-chicago`)!;
    expect(marker).toMatchObject({ fetched: 4, inserted: 2, error: `parsed:${r1.hash}` });

    // The scan has not logged the source yet: the rows may be lost, so the same page is parsed again.
    resetRobotsCache();
    const r2 = await runPageWatch(d(), { fetch: fakeFetch({ page: { body: page } }).f, now: new Date(NOW.getTime() + 60_000), db: db as never });
    expect(r2.check).toBe('ok');

    // The scan logs the source after it stored the rows (fetched = rows handed over, no error).
    db.rows.push({ id: 99, source: 'bids-pw-chicago', started_at: '2026-11-22T17:02:00.000Z', finished_at: '2026-11-22T17:02:00.000Z', fetched: 2, error: null });
    resetRobotsCache();
    const later = new Date(NOW.getTime() + 3_600_000);
    // Markup and a clock outside the listing change; the listing text does not.
    const r3 = await runPageWatch(d(), { fetch: fakeFetch({ page: { body: page.replace('<form>', '<form data-token="zz9">') } }).f, now: later, db: db as never });
    expect(r3.check).toBe('unchanged');
    expect(r3.kept).toEqual([]);
    const lines = pageWatchLogLines(d(), r3);
    expect(lines[1]).toBe('probation note: unchanged: the listing is the same as on the last stored run');
    expect(probationCheck({ source: 'bids-pw-chicago', last_run_at: 'x', last_success_at: 'x', last_error: null, last_record_at: 'x' }, { source: 'bids-pw-chicago', started_at: 'x', error: lines[1] })).toBe('unchanged');
    // Once unchanged is confirmed, it stays unchanged without re-checking the scan log.
    resetRobotsCache();
    const r4 = await runPageWatch(d(), { fetch: fakeFetch({ page: { body: page } }).f, now: new Date(later.getTime() + 60_000), db: db as never });
    expect(r4.check).toBe('unchanged');

    // A new row in the listing changes the hash: parsed again.
    resetRobotsCache();
    const changed = page.replace('</table>', '<tr><td>CITY</td><td>BID</td><td>1340001</td><td>Roof Replacement at Fire Station 12</td><td>ACTIVE</td><td>Construction</td><td>01/15/2027</td><td></td></tr></table>');
    const r5 = await runPageWatch(d(), { fetch: fakeFetch({ page: { body: changed } }).f, now: new Date(later.getTime() + 120_000), db: db as never });
    expect(r5.check).toBe('ok');
    expect(r5.kept.map((s) => s.title)).toContain('Bid: Roof Replacement at Fire Station 12 (City of Chicago)');
  });
  it('a dry scan and the probe never read or write markers', async () => {
    const db = new FakeDb();
    await runPageWatch(d(), { fetch: fakeFetch({ page: { body: fx('chicago.html') } }).f, now: NOW, db: db as never, dry: true });
    resetRobotsCache();
    await runPageWatch(d(), { fetch: fakeFetch({ page: { body: fx('chicago.html') } }).f, now: NOW, db: db as never, probe: true });
    expect(db.touched).toBe(0);
  });
});

describe('the adapter in a scan', () => {
  it('logs the tally, returns the kept rows, and an error line only on failure', async () => {
    const a = ALL_ADAPTERS.find((x) => x.id === 'bids-pw-philasd-capital')!;
    const logs: string[] = [];
    const rows = await a.fetch({ since: NOW, now: NOW, fetch: fakeFetch({ page: { body: fx('philasd-capital.html') } }).f, env: {}, log: (m) => logs.push(m) });
    expect(rows).toHaveLength(2);
    expect(logs).toEqual(['bids-pw-philasd-capital: 4 rows read, 2 kept (0 past due, 2 not open, 0 no trade, 0 duplicates; 0 kept without a due date)']);
    expect(JSON.stringify(rows)).not.toMatch(PEOPLE);
  });
  it('the owner list shows the probe path and the promotion step for a page-watch source', () => {
    const rows = probationOverview([{ id: 'bids-pw-dart', probation: true }], [], () => 'dallas-fort-worth');
    expect(rows[0]).toMatchObject({ id: 'bids-pw-dart', check: 'not_run', probe: '/api/admin/coverage-probe?source=bids-pw-dart' });
    expect(rows[0].promote).toMatch(/page-watch-datasets\.ts/);
    expect(rows[0].promote).toMatch(/HOLLER_BIDS_ENABLED/);
  });
});

describe('check states stay as they were for the round-19 probation sources', () => {
  it('a timeout or a robots word on a coverage source reads "error", as before', () => {
    expect(probationCheck({ source: 'arcgis-houston-311', last_run_at: 'x', last_success_at: null, last_error: 'timeout' })).toBe('error');
    expect(probationCheck({ source: 'bids-pw-chicago', last_run_at: 'x', last_success_at: null, last_error: 'timeout' })).toBe('timeout');
  });
});
