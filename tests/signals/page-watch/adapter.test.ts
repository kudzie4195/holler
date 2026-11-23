import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accessCleared, PAGE_WATCH_DATASETS, pageWatchDataset } from '@/lib/signals/adapters/page-watch-datasets';
import { adapters, buildPageWatchAdapter, firecrawlAllowed, PAGE_WATCH_FLAG, pageWatchLogLines, PW_MARKER_PREFIX, PW_ROW_CAP, PW_UA, runPageWatch } from '@/lib/signals/adapters/page-watch';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { missingEnvFor } from '@/lib/signals/run';
import { BID_SOURCE_IDS, BIDS_FLAG, isBidSignal } from '@/lib/signals/bid-sources';
import { LABEL_PENDING_INTEGRATION, PROBATION_SOURCE_IDS, probationCheck, probationOverview } from '@/lib/signals/probation';
import { PROPOSED_LABELS, proposedLabelOf } from '@/lib/signals/proposed-labels';
import { TRADE_NEEDS } from '@/lib/signals/trade-needs';
import { runProbe } from '@/lib/firecrawl/probe';
import { SOURCE_META } from '@/lib/signals/source-meta';
import { sourceLabelLang } from '@/lib/signals/source-label-i18n';
import { localizeTitle } from '@/lib/signals/title-i18n';
import { sourcePlaces } from '@/lib/admin/metros';
import { resetRobotsCache } from '@/lib/firecrawl/robots';
import { resetRunSpend } from '@/lib/firecrawl/budget';
import { FakeDb, mockClient } from '../../firecrawl/fakes';
import { cleared, SWITCH_ON } from './helpers';

/** Fixtures are hand-written (fixtures/README.md). */
const fx = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
const NOW = new Date('2026-11-22T17:00:00Z');
const ds = (id: string) => pageWatchDataset(id)!;
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
    expect(ids).toHaveLength(12);
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
  it('the four Bonfire endpoints and the two Firecrawl-only pages stay unregistered until their vendors\' terms are read', () => {
    const off = PAGE_WATCH_DATASETS.filter((d) => !d.verified).map((d) => d.id).sort();
    expect(off).toEqual(['bids-pw-dallas-city', 'bids-pw-dart', 'bids-pw-harris-county', 'bids-pw-houston-city', 'bids-pw-pha', 'bids-pw-phoenix-opengov']);
    for (const id of off) {
      expect(ALL_ADAPTERS.some((a) => a.id === id), id).toBe(false);
      expect(SOURCE_META[id], id).toBeUndefined();
      expect(PROBATION_SOURCE_IDS.has(id), id).toBe(false);
    }
  });
  it('Dallas and Houston come first; every page sits under its metro', () => {
    expect(PAGE_WATCH_DATASETS.slice(0, 8).every((d) => d.metro === 'dallas-fort-worth' || d.metro === 'houston')).toBe(true);
    const places = sourcePlaces();
    for (const d of PAGE_WATCH_DATASETS) expect(places.get(d.id), d.id).toBe(d.metro);
  });
  it('every proposed-label entry is a registered page: public-bid, a call path, only trades that act on public bids, shares summing to 0.4 at most, volume assumed', () => {
    const bidTrades = new Set(Object.entries(TRADE_NEEDS).filter(([, v]) => v.acts.includes('public-bid')).map(([k]) => k));
    const registered = PAGE_WATCH_DATASETS.filter((d) => d.verified);
    for (const d of registered) {
      const p = PROPOSED_LABELS[d.id];
      expect(p, d.id).toBeDefined();
      expect(p.metros).toEqual([d.metro]);
      expect(p.recordKind).toBe('public-bid');
      expect(p.callPath).toBe(true);
      expect(p.volumeEvidence.tag).toBe('A');
      expect(p.volumeEvidence.note).toMatch(/ASSUMED/);
      let sum = 0;
      for (const [trade, v] of Object.entries(p.labels)) {
        expect(bidTrades.has(trade), `${d.id} ${trade}`).toBe(true);
        const e = proposedLabelOf(v)!;
        expect(['act_now', 'coming_soon']).toContain(e.label);
        sum += e.share;
      }
      expect(sum, d.id).toBeLessThanOrEqual(0.4 + 1e-9);
    }
    for (const id of Object.keys(PROPOSED_LABELS).filter((k) => k.startsWith('bids-pw-'))) expect(registered.some((d) => d.id === id), id).toBe(true);
    for (const id of ['bids-pw-houston-metro', 'bids-pw-septa', 'bids-pw-dallas-isd', 'bids-pw-houston-isd', 'bids-pw-aps', 'bids-pw-philasd-capital', 'bids-pw-atlanta-housing']) {
      for (const v of Object.values(PROPOSED_LABELS[id].labels)) expect(proposedLabelOf(v)!.label, id).toBe('coming_soon');
    }
  });
  it('the Spanish title keeps the agency\'s words (brackets included) and says Licitación', () => {
    expect(localizeTitle('Bid: Roof Replacement at Kashmere (Houston METRO)', 'es', 'bids-pw-houston-metro')).toBe('Licitación: Roof Replacement at Kashmere (Houston METRO)');
    expect(localizeTitle('Bid: Roof Replacement (Phase 2) (Dallas Area Rapid Transit (DART))', 'es', 'bids-pw-dart')).toBe('Licitación: Roof Replacement (Phase 2) (Dallas Area Rapid Transit (DART))');
    expect(localizeTitle('Bid: Roof Replacement at Kashmere (Houston METRO)', 'en', 'bids-pw-houston-metro')).toBe('Bid: Roof Replacement at Kashmere (Houston METRO)');
  });
});

describe('P0 gates: no request of any kind before the terms record AND the master switch', () => {
  it('every shipped entry has termsChecked false, so nothing is cleared; a cleared entry carries all three evidence fields', () => {
    for (const d of PAGE_WATCH_DATASETS) {
      expect(d.termsChecked, d.id).toBe(false);
      expect(accessCleared(d), d.id).toBe(false);
      if (d.termsChecked) expect(accessCleared(d), d.id).toBe(true);
    }
    const c = cleared('bids-pw-chicago');
    expect(accessCleared(c)).toBe(true);
    expect(accessCleared({ ...c, evidence: { ...c.evidence, robotsUrl: undefined } })).toBe(false);
    expect(accessCleared({ ...c, evidence: { ...c.evidence, termsUrl: 'not a url' } })).toBe(false);
    expect(accessCleared({ ...c, evidence: { ...c.evidence, checkedOn: 'yesterday' } })).toBe(false);
    // A Bonfire endpoint also needs the vendor's permission recorded.
    const b = cleared('bids-pw-dart');
    expect(accessCleared(b)).toBe(true);
    expect(accessCleared({ ...b, evidence: { ...b.evidence, endpointAllowed: undefined } })).toBe(false);
  });
  it('the scan skips every registered page (missingEnvFor names termsChecked) and a direct fetch makes no request, switch on or off', async () => {
    vi.stubEnv(PAGE_WATCH_FLAG, '1');
    for (const a of adapters) {
      expect(a.enabled!()).toBe(false);
      expect(missingEnvFor(a, { FIRECRAWL_API_KEY: 'k' })).toContain('termsChecked (page-watch-datasets.ts)');
      const { f, calls } = fakeFetch({ page: { body: fx('chicago.html') } });
      const logs: string[] = [];
      expect(await a.fetch({ since: NOW, now: NOW, fetch: f, env: { [PAGE_WATCH_FLAG]: '1' }, log: (m) => logs.push(m) })).toEqual([]);
      expect(calls, a.id).toEqual([]);
      expect(logs).toEqual([`${a.id}: skipped, terms not checked`]);
    }
  });
  it('runPageWatch (the scan path and the coverage probe) answers terms_not_checked with zero requests, Bonfire and Firecrawl-only included', async () => {
    for (const d of PAGE_WATCH_DATASETS) {
      const { f, calls } = fakeFetch({ page: { body: '' } });
      const r = await runPageWatch(d, { fetch: f, now: NOW, env: { ...SWITCH_ON, HOLLER_LOCAL_BIDS_ENABLED: '1', FIRECRAWL_API_KEY: 'k' } });
      expect(r.check, d.id).toBe('terms_not_checked');
      expect(calls, d.id).toEqual([]);
      expect(r.requests).toBe(0);
    }
  });
  it('terms recorded but the master switch off (the default): page_watch_off, zero requests; enabled() false naming the switch', async () => {
    vi.stubEnv(PAGE_WATCH_FLAG, '');
    const d = cleared('bids-pw-chicago');
    const { f, calls } = fakeFetch({ page: { body: fx('chicago.html') } });
    expect((await runPageWatch(d, { fetch: f, now: NOW, env: {} })).check).toBe('page_watch_off');
    expect(calls).toEqual([]);
    const a = buildPageWatchAdapter(d);
    expect(a.enabled!()).toBe(false);
    expect(missingEnvFor(a, {})).toEqual([PAGE_WATCH_FLAG]);
    vi.stubEnv(PAGE_WATCH_FLAG, '1');
    expect(a.enabled!()).toBe(true);
    expect(missingEnvFor(a, {})).toEqual([]);
  });
  it('cleared and switched on: a probation page runs with the bids flag OFF; promoted, it needs the bids flag and fetches nothing without it', async () => {
    vi.stubEnv(PAGE_WATCH_FLAG, '1');
    vi.stubEnv(BIDS_FLAG, '');
    const d = cleared('bids-pw-chicago');
    expect(missingEnvFor(buildPageWatchAdapter(d), {})).toEqual([]);
    const promoted = buildPageWatchAdapter({ ...d, probation: false });
    expect(promoted.probation).toBeUndefined();
    expect(missingEnvFor(promoted, {})).toEqual([BIDS_FLAG]);
    const { f, calls } = fakeFetch({});
    const logs: string[] = [];
    expect(await promoted.fetch({ since: NOW, now: NOW, fetch: f, env: { [PAGE_WATCH_FLAG]: '1' }, log: (m) => logs.push(m) })).toEqual([]);
    expect(calls).toEqual([]);
    expect(logs).toEqual([`bids-pw-chicago: skipped, ${BIDS_FLAG} is off`]);
    vi.stubEnv(BIDS_FLAG, '1');
    expect(missingEnvFor(promoted, {})).toEqual([]);
  });
  it('a Bonfire request never sends X-Requested-With, even once the vendor permission is recorded', async () => {
    const { f, headers } = fakeFetch({ page: { body: fx('bonfire-open.json'), type: 'application/json' } });
    const r = await runPageWatch(cleared('bids-pw-dart'), { env: SWITCH_ON, fetch: f, now: NOW });
    expect(r.check).toBe('ok');
    for (const h of headers) expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain('x-requested-with');
    expect(headers[1]).toEqual({ 'User-Agent': PW_UA, Accept: 'application/json' });
  });
  it('Firecrawl-only pages spend nothing without the page-watch switch, the terms record, the Firecrawl switch and the key; the Firecrawl probe does not list them before', async () => {
    const d = cleared('bids-pw-houston-city');
    const made = vi.fn();
    const { f, calls } = fakeFetch({});
    const off = await runPageWatch(d, { fetch: f, now: NOW, env: { ...SWITCH_ON, HOLLER_LOCAL_BIDS_ENABLED: '', FIRECRAWL_API_KEY: '' }, makeClient: made as never });
    expect(off.check).toBe('skipped');
    expect(off.detail).toMatch(/HOLLER_LOCAL_BIDS_ENABLED and FIRECRAWL_API_KEY/);
    expect(calls).toEqual([]);
    expect(made).not.toHaveBeenCalled();
    expect(firecrawlAllowed(pageWatchDataset('bids-pw-houston-city')!, { ...SWITCH_ON, HOLLER_LOCAL_BIDS_ENABLED: '1', FIRECRAWL_API_KEY: 'k' })).toBe(false);
    expect(firecrawlAllowed(d, { HOLLER_PAGE_WATCH_ENABLED: '', HOLLER_LOCAL_BIDS_ENABLED: '1', FIRECRAWL_API_KEY: 'k' })).toBe(false);
    expect(firecrawlAllowed(d, { ...SWITCH_ON, HOLLER_LOCAL_BIDS_ENABLED: '1', FIRECRAWL_API_KEY: 'k' })).toBe(true);
    const probe = await runProbe({ source: 'bids-pw-houston-city', env: { ...SWITCH_ON, HOLLER_LOCAL_BIDS_ENABLED: '1', FIRECRAWL_API_KEY: 'k' }, now: NOW, fetch: f, db: null, makeClient: made as never });
    expect(probe.status).toBe('unknown_source');
    expect(probe.knownSources).not.toContain('bids-pw-houston-city');
    expect(made).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
  it('after two zero-row Firecrawl runs at the same page hash, Firecrawl is not called again until the page changes', async () => {
    const db = new FakeDb();
    const d = cleared('bids-pw-phoenix-opengov');
    const envOn = { ...SWITCH_ON, HOLLER_LOCAL_BIDS_ENABLED: '1', FIRECRAWL_API_KEY: 'fc-test-key-0000000000' };
    const page = '<html><body><div id="app">loading</div></body></html>';
    const scrapes: number[] = [];
    const client = mockClient({ remaining: 900, scrape: (req, n) => (scrapes.push(n), req.formats.some((x) => typeof x === 'object' && x.type === 'json') ? { markdown: 'nothing', json: { solicitations: [] } } : { markdown: 'nothing', changeStatus: 'changed' }) });
    const run = async (body: string, at: number) => {
      resetRobotsCache();
      resetRunSpend();
      return runPageWatch(d, { fetch: fakeFetch({ page: { body } }).f, now: new Date(NOW.getTime() + at), env: envOn, db: db as never, makeClient: () => client.client });
    };
    expect((await run(page, 0)).via).toBe('firecrawl');
    expect((await run(page, 86_400_000 * 2)).via).toBe('firecrawl');
    const spent = scrapes.length;
    const third = await run(page, 86_400_000 * 4);
    expect(third.check).toBe('unchanged');
    expect(scrapes.length).toBe(spent);
    expect((await run(page.replace('loading', 'loading v2'), 86_400_000 * 6)).via).toBe('firecrawl');
    expect(scrapes.length).toBeGreaterThan(spent);
  });
});

describe('runPageWatch: check states', () => {
  it('robots.txt disallows the path: the page is never fetched, the source shows robots_disallowed', async () => {
    const { f, calls } = fakeFetch({ robots: 'User-agent: *\nDisallow: /about/business-to-business/\n', page: { body: fx('metro-table.html') } });
    const d = cleared('bids-pw-houston-metro');
    const r = await runPageWatch(d, { env: SWITCH_ON,  fetch: f, now: NOW });
    expect(r.check).toBe('robots_disallowed');
    expect(calls).toEqual(['https://www.ridemetro.org/robots.txt']);
    const lines = pageWatchLogLines(d, r);
    expect(lines[0]).toBe('error: bids-pw-houston-metro: robots_disallowed (robots.txt disallows /about/business-to-business/procurement-opportunities)');
    expect(probationCheck({ source: d.id, last_run_at: 'x', last_success_at: null, last_error: lines[0] })).toBe('robots_disallowed');
  });
  it('a "Holler" group in robots.txt is obeyed over the * group', async () => {
    const { f, calls } = fakeFetch({ robots: 'User-agent: *\nAllow: /\n\nUser-agent: Holler\nDisallow: /procurement/\n', page: { body: fx('septa.html') } });
    const r = await runPageWatch(cleared('bids-pw-septa'), { env: SWITCH_ON,  fetch: f, now: NOW });
    expect(r.check).toBe('robots_disallowed');
    expect(calls).toHaveLength(1);
  });
  it('robots.txt unreachable (5xx): not fetched this run', async () => {
    const { f, calls } = fakeFetch({ robots: 503 });
    const r = await runPageWatch(cleared('bids-pw-septa'), { env: SWITCH_ON,  fetch: f, now: NOW });
    expect(r.check).toBe('robots_unreachable');
    expect(calls).toHaveLength(1);
  });
  it('sends a clear user agent and reads the page', async () => {
    const { f, calls, headers } = fakeFetch({ page: { body: fx('metro-table.html') } });
    const r = await runPageWatch(cleared('bids-pw-houston-metro'), { env: SWITCH_ON,  fetch: f, now: NOW });
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
    const d = cleared('bids-pw-houston-metro');
    const r = await runPageWatch(d, { env: SWITCH_ON,  fetch: f, now: NOW });
    expect(r.check).toBe('timeout');
    expect(pageWatchLogLines(d, r)[0]).toMatch(/^error: bids-pw-houston-metro: timeout/);
  });
  it('not_html: an HTML parser given JSON or a PDF', async () => {
    const { f } = fakeFetch({ page: { body: '{"a":1}', type: 'application/json' } });
    expect((await runPageWatch(cleared('bids-pw-chicago'), { env: SWITCH_ON,  fetch: f, now: NOW })).check).toBe('not_html');
    resetRobotsCache();
    const pdf = fakeFetch({ page: { body: '%PDF-1.7', type: 'application/pdf' } });
    const r = await runPageWatch(cleared('bids-pw-chicago'), { env: SWITCH_ON,  fetch: pdf.f, now: NOW });
    expect(r.check).toBe('not_html');
    expect(probationCheck({ source: 'bids-pw-chicago', last_run_at: 'x', last_success_at: null, last_error: pageWatchLogLines(ds('bids-pw-chicago'), r)[0] })).toBe('not_html');
  });
  it('not_json: Bonfire answers with an HTML page', async () => {
    const { f } = fakeFetch({ page: { body: '<html><body>Sign in</body></html>' } });
    const r = await runPageWatch(cleared('bids-pw-dart'), { env: SWITCH_ON,  fetch: f, now: NOW });
    expect(r.check).toBe('not_json');
  });
  it('http_error: HTTP 404', async () => {
    const { f } = fakeFetch({ page: { body: 'nope', status: 404 } });
    const r = await runPageWatch(cleared('bids-pw-chicago'), { env: SWITCH_ON,  fetch: f, now: NOW });
    expect(r).toMatchObject({ check: 'http_error', httpStatus: 404, detail: 'HTTP 404' });
  });
  it('parser_mismatch: zero rows from a page that has a table (the headers are named)', async () => {
    const { f } = fakeFetch({ page: { body: fx('mismatch-table.html') } });
    const d = cleared('bids-pw-houston-isd');
    const r = await runPageWatch(d, { env: SWITCH_ON,  fetch: f, now: NOW });
    expect(r.check).toBe('parser_mismatch');
    expect(r.detail).toMatch(/foo\/bar/);
    const line = pageWatchLogLines(d, r)[0];
    expect(line).toMatch(/^error: bids-pw-houston-isd: parser_mismatch/);
    expect(probationCheck({ source: d.id, last_run_at: 'x', last_success_at: null, last_error: line })).toBe('parser_mismatch');
  });
  it('empty: a server-rendered "no open solicitations" message (not a mismatch, not an error)', async () => {
    const html = '<html><body><table><tr><th>Bid #</th><th>Title</th><th>Due Date</th></tr><tr><td colspan="3">There are currently no open solicitations.</td></tr></table></body></html>';
    const { f } = fakeFetch({ page: { body: html } });
    const d = cleared('bids-pw-houston-isd');
    const r = await runPageWatch(d, { env: SWITCH_ON, fetch: f, now: NOW });
    expect(r.check).toBe('empty');
    expect(pageWatchLogLines(d, r)).toEqual(['bids-pw-houston-isd: the page lists no open solicitations']);
  });
  it('a grid with headers and no rows (Miami-Dade, possibly filled by a script) is parser_mismatch, not empty', async () => {
    const { f } = fakeFetch({ page: { body: fx('miamidade-empty.html') } });
    const r = await runPageWatch(cleared('bids-pw-miamidade-construction'), { env: SWITCH_ON, fetch: f, now: NOW });
    expect(r.check).toBe('parser_mismatch');
    expect(r.detail).toMatch(/filled by a script/);
  });
  it('row_cap: more rows than the cap reads the first ones and leaves a probation note', async () => {
    const links = Array.from({ length: PW_ROW_CAP + 20 }, (_, i) => `<li><a href="/x/${i}">IFB 2027-${String(1000 + i)} Landscape Maintenance Area ${i}</a></li>`).join('');
    const { f } = fakeFetch({ page: { body: `<html><body><ul>${links}</ul></body></html>` } });
    const d = cleared('bids-pw-atlanta-housing');
    const r = await runPageWatch(d, { env: SWITCH_ON,  fetch: f, now: NOW });
    expect(r.check).toBe('row_cap');
    expect(r.counts.read).toBe(PW_ROW_CAP);
    const lines = pageWatchLogLines(d, r);
    expect(lines).toContain(`probation note: row cap reached: ${PW_ROW_CAP + 20} rows on the page, the first ${PW_ROW_CAP} read`);
    expect(probationCheck({ source: d.id, last_run_at: 'x', last_success_at: 'x', last_error: null, last_record_at: 'x' }, { source: d.id, started_at: 'x', error: lines[1] })).toBe('row_cap');
  });
});

describe('the listing hash: an unchanged page costs one fetch', () => {
  const d = () => cleared('bids-pw-chicago');
  it('first run parses and writes a parsed marker; once the scan stored the rows, the same listing is unchanged and returns nothing', async () => {
    const db = new FakeDb();
    const page = fx('chicago.html');
    const r1 = await runPageWatch(d(), { env: SWITCH_ON,  fetch: fakeFetch({ page: { body: page } }).f, now: NOW, db: db as never });
    expect(r1.check).toBe('ok');
    expect(r1.kept).toHaveLength(1);
    const marker = db.rows.find((x) => x.source === `${PW_MARKER_PREFIX}bids-pw-chicago`)!;
    expect(marker).toMatchObject({ fetched: 4, inserted: 1, error: `parsed:${r1.hash}` });

    // The scan has not logged the source yet: the rows may be lost, so the same page is parsed again.
    resetRobotsCache();
    const r2 = await runPageWatch(d(), { env: SWITCH_ON,  fetch: fakeFetch({ page: { body: page } }).f, now: new Date(NOW.getTime() + 60_000), db: db as never });
    expect(r2.check).toBe('ok');

    // The scan logs the source after it stored the rows (fetched = rows handed over, no error).
    db.rows.push({ id: 99, source: 'bids-pw-chicago', started_at: '2026-11-22T17:02:00.000Z', finished_at: '2026-11-22T17:02:00.000Z', fetched: 1, error: null });
    resetRobotsCache();
    const later = new Date(NOW.getTime() + 3_600_000);
    // Markup and a clock outside the listing change; the listing text does not.
    const r3 = await runPageWatch(d(), { env: SWITCH_ON,  fetch: fakeFetch({ page: { body: page.replace('<form>', '<form data-token="zz9">') } }).f, now: later, db: db as never });
    expect(r3.check).toBe('unchanged');
    expect(r3.kept).toEqual([]);
    const lines = pageWatchLogLines(d(), r3);
    expect(lines[1]).toBe('probation note: unchanged: the listing is the same as on the last stored run');
    expect(probationCheck({ source: 'bids-pw-chicago', last_run_at: 'x', last_success_at: 'x', last_error: null, last_record_at: 'x' }, { source: 'bids-pw-chicago', started_at: 'x', error: lines[1] })).toBe('unchanged');
    // Once unchanged is confirmed, it stays unchanged without re-checking the scan log.
    resetRobotsCache();
    const r4 = await runPageWatch(d(), { env: SWITCH_ON,  fetch: fakeFetch({ page: { body: page } }).f, now: new Date(later.getTime() + 60_000), db: db as never });
    expect(r4.check).toBe('unchanged');

    // A new row in the listing changes the hash: parsed again.
    resetRobotsCache();
    const changed = page.replace('</table>', '<tr><td>CITY</td><td>BID</td><td>1340001</td><td>Roof Replacement at Fire Station 12</td><td>ACTIVE</td><td>Construction</td><td>01/15/2027</td><td></td></tr></table>');
    const r5 = await runPageWatch(d(), { env: SWITCH_ON,  fetch: fakeFetch({ page: { body: changed } }).f, now: new Date(later.getTime() + 120_000), db: db as never });
    expect(r5.check).toBe('ok');
    expect(r5.kept.map((s) => s.title)).toContain('Bid: Roof Replacement at Fire Station 12 (City of Chicago)');
  });
  it('a dry scan and the probe never read or write markers', async () => {
    const db = new FakeDb();
    await runPageWatch(d(), { env: SWITCH_ON,  fetch: fakeFetch({ page: { body: fx('chicago.html') } }).f, now: NOW, db: db as never, dry: true });
    resetRobotsCache();
    await runPageWatch(d(), { env: SWITCH_ON,  fetch: fakeFetch({ page: { body: fx('chicago.html') } }).f, now: NOW, db: db as never, probe: true });
    expect(db.touched).toBe(0);
  });
});

describe('the adapter in a scan', () => {
  it('cleared and switched on: logs the tally, returns the kept rows, no person anywhere', async () => {
    vi.stubEnv(PAGE_WATCH_FLAG, '1');
    const a = buildPageWatchAdapter(cleared('bids-pw-philasd-capital'));
    const logs: string[] = [];
    const rows = await a.fetch({ since: NOW, now: NOW, fetch: fakeFetch({ page: { body: fx('philasd-capital.html') } }).f, env: { [PAGE_WATCH_FLAG]: '1' }, log: (m) => logs.push(m) });
    expect(rows).toHaveLength(3);
    expect(logs).toEqual(['bids-pw-philasd-capital: 4 rows read, 3 kept (1 feed-only, 0 status not open, 0 without a due date); dropped 1 past due, 0 unreadable due date, 0 no trade, 0 naming a person, 0 duplicates']);
    expect(JSON.stringify(rows)).not.toMatch(PEOPLE);
  });
  it('the owner list shows the probe path and the promotion step for a page-watch source', () => {
    const rows = probationOverview([{ id: 'bids-pw-chicago', probation: true }], [], () => 'chicago');
    expect(rows[0]).toMatchObject({ id: 'bids-pw-chicago', check: 'not_run', probe: '/api/admin/coverage-probe?source=bids-pw-chicago' });
    expect(rows[0].promote).toMatch(/page-watch-datasets\.ts/);
    expect(rows[0].promote).toMatch(/HOLLER_BIDS_ENABLED/);
  });
});

describe('check states stay as they were for the round-19 probation sources', () => {
  it('a robots word on a coverage source reads "error", as before; a timeout reads "timeout" for every probation source since round 20 SALES', () => {
    // Round 21 integration: r20-ship (SALES) made "timeout" a check state for every probation source (a run cut off by its time limit);
    // the page-watch states (robots_disallowed, not_html, parser_mismatch ...) stay page-watch only.
    expect(probationCheck({ source: 'arcgis-houston-311', last_run_at: 'x', last_success_at: null, last_error: 'timeout' })).toBe('timeout');
    expect(probationCheck({ source: 'arcgis-houston-311', last_run_at: 'x', last_success_at: null, last_error: 'error: arcgis-houston-311: robots_disallowed' })).toBe('error');
    expect(probationCheck({ source: 'bids-pw-chicago', last_run_at: 'x', last_success_at: null, last_error: 'timeout' })).toBe('timeout');
  });
});
