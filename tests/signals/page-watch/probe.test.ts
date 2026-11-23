import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coverageProbeSourceIds, probePageWatch, runCoverageProbe } from '@/lib/signals/coverage-probe';
import { cleared } from './helpers';
import { PAGE_WATCH_DATASETS } from '@/lib/signals/adapters/page-watch-datasets';
import { resetRobotsCache } from '@/lib/firecrawl/robots';
import { runProbe } from '@/lib/firecrawl/probe';

/** Fixtures are hand-written (fixtures/README.md). */
const fx = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
const NOW = new Date('2026-11-22T17:00:00Z');
const PEOPLE = /Buyerson|Smallwood|Ferreira|Brennan|@|555-01/i;

function fetchWith(body: string, type = 'text/html') {
  const calls: string[] = [];
  const f = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /\n', { status: 200 });
    return new Response(body, { status: 200, headers: { 'content-type': type } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

beforeEach(() => {
  resetRobotsCache();
  vi.stubEnv('HOLLER_PAGE_WATCH_ENABLED', '1');
});
afterEach(() => vi.unstubAllEnvs());

describe('GET /api/admin/coverage-probe for page-watch ids', () => {
  it('lists every registered page-watch id', () => {
    const ids = coverageProbeSourceIds();
    for (const d of PAGE_WATCH_DATASETS.filter((x) => x.verified)) expect(ids).toContain(d.id);
  });
  it('shows the parsed rows (titles, due dates, trades, links), no person names, writes nothing', async () => {
    const { f, calls } = fetchWith(fx('philasd-capital.html'));
    const r = await probePageWatch(cleared('bids-pw-philasd-capital'), f, NOW);
    expect(r).toMatchObject({ status: 'ok', platform: 'page-watch', endpoint: 'https://philasd.org/procurement/', httpStatus: 200, rowCount: 4, parsedRows: 3, schema: 'ok', wroteNothing: true });
    expect(r.pageWatch?.check).toBe('ok');
    expect(r.pageWatch?.rows).toEqual([
      { title: 'Bid: Kitchen Ventilation Upgrade at Thomas Alva Edison High School MC (Capital Programs)', dueDate: '2026-12-17', trades: ['hvac'], url: 'https://philasd.org/procurement/wp-content/uploads/sites/93/2026/11/NG10901.pdf', proposedLabel: 'coming_soon' },
      { title: 'Bid: Bathroom Renovations at George W. Childs School EC (Capital Programs)', dueDate: '2026-12-22', trades: ['general-contractor'], url: 'https://philasd.org/procurement/NG10902.pdf', proposedLabel: 'coming_soon' },
      { title: 'Bid: Roof Replacement at Lincoln HS (Capital Programs)', dueDate: '2026-12-30', trades: ['roofing'], url: 'https://philasd.org/procurement/?p=4721', proposedLabel: 'context' },
    ]);
    expect(r.mapped).toHaveLength(3);
    expect(r.mapped[0].contacts).toEqual([]);
    expect(JSON.stringify(r)).not.toMatch(PEOPLE);
    expect(calls).toHaveLength(2);
  });
  it('reports a parser mismatch as a schema mismatch with the reason', async () => {
    const r = await probePageWatch(cleared('bids-pw-houston-isd'), fetchWith(fx('mismatch-table.html')).f, NOW);
    expect(r.schema).toBe('mismatch');
    expect(r.schemaProblem).toMatch(/^parser_mismatch: no table has a title column/);
  });
  it('a header-only grid is a mismatch, a server message an empty list', async () => {
    const r = await probePageWatch(cleared('bids-pw-miamidade-construction'), fetchWith(fx('miamidade-empty.html')).f, NOW);
    expect(r.schema).toBe('mismatch');
    resetRobotsCache();
    const e = await probePageWatch(cleared('bids-pw-houston-isd'), fetchWith('<table><tr><th>Bid #</th><th>Title</th><th>Due Date</th></tr><tr><td colspan="3">No open solicitations at this time</td></tr></table>').f, NOW);
    expect(e.schema).toBe('no_rows');
    expect(e.pageWatch?.check).toBe('empty');
  });
  it('a header-less table with names: the probe JSON carries only its shape', async () => {
    const html = '<table><tr><td>RFP 123</td><td>John Smith</td><td>713-555-0100</td><td>jsmith@agency.gov</td></tr><tr><td>RFP 124</td><td>Mary Jones</td><td>713-555-0101</td><td>mjones@agency.gov</td></tr></table>';
    const r = await probePageWatch(cleared('bids-pw-houston-isd'), fetchWith(html).f, NOW);
    expect(r.schemaProblem).toBe('parser_mismatch: no table has a title column (4 columns, 1 rows, no header row)');
    expect(JSON.stringify(r)).not.toMatch(/john|smith|mary|jones|713|agency\.gov/i);
  });
  it('an unchecked source (every shipped one) answers terms_not_checked with zero requests, registered or not', async () => {
    for (const id of ['bids-pw-chicago', 'bids-pw-dart', 'bids-pw-phoenix-opengov']) {
      const { f, calls } = fetchWith(fx('chicago.html'));
      const r = await runCoverageProbe(id, f, NOW);
      expect(r.status, id).toBe('ok');
      expect(r.pageWatch?.check, id).toBe('terms_not_checked');
      expect(r.pageWatch?.requests).toBe(0);
      expect(calls, id).toEqual([]);
    }
  });
  it('a cleared source with the master switch off: page_watch_off, zero requests', async () => {
    vi.stubEnv('HOLLER_PAGE_WATCH_ENABLED', '');
    const { f, calls } = fetchWith(fx('chicago.html'));
    const r = await probePageWatch(cleared('bids-pw-chicago'), f, NOW);
    expect(r.pageWatch?.check).toBe('page_watch_off');
    expect(calls).toEqual([]);
  });
  it('a Bonfire source shows its JSON rows', async () => {
    const r = await probePageWatch(cleared('bids-pw-dart'), fetchWith(fx('bonfire-open.json'), 'application/json').f, NOW);
    expect(r.pageWatch?.rows.map((x) => [x.title, x.proposedLabel])).toEqual([
      ['Bid: Roof Replacement at Kashmere Bus Operating Facility (Facilities Maintenance)', 'act_now'],
      ['Bid: Janitorial Services for Administrative Buildings (Dallas Area Rapid Transit (DART))', 'coming_soon'],
      ['Bid: Landscape Maintenance of Transit Centers (Dallas Area Rapid Transit (DART))', 'context'],
    ]);
  });
  it('a Firecrawl-only source spends nothing here and points to the Firecrawl probe, which knows the id', async () => {
    const { f, calls } = fetchWith('');
    const r = await probePageWatch(cleared('bids-pw-phoenix-opengov'), f, NOW);
    expect(calls).toEqual([]);
    expect(r.pageWatch?.check).toBe('skipped');
    expect(r.message).toMatch(/firecrawl-probe\?source=bids-pw-phoenix-opengov/);
    // The Firecrawl probe refuses the shipped (unchecked, unregistered) entry outright: no key read, no call.
    const fc = await runProbe({ source: 'bids-pw-phoenix-opengov', env: { HOLLER_PAGE_WATCH_ENABLED: '1' }, now: NOW, fetch: f, db: null });
    expect(fc.status).toBe('unknown_source');
    expect(fc.knownSources).not.toContain('bids-pw-phoenix-opengov');
  });
});
