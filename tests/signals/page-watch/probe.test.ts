import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coverageProbeSourceIds, runCoverageProbe } from '@/lib/signals/coverage-probe';
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

beforeEach(() => resetRobotsCache());

describe('GET /api/admin/coverage-probe for page-watch ids', () => {
  it('lists every verified page-watch id', () => {
    const ids = coverageProbeSourceIds();
    for (const d of PAGE_WATCH_DATASETS.filter((x) => x.verified)) expect(ids).toContain(d.id);
  });
  it('shows the parsed rows (titles, due dates, trades, links), no person names, writes nothing', async () => {
    const { f, calls } = fetchWith(fx('philasd-capital.html'));
    const r = await runCoverageProbe('bids-pw-philasd-capital', f, NOW);
    expect(r).toMatchObject({ status: 'ok', platform: 'page-watch', endpoint: 'https://philasd.org/procurement/', httpStatus: 200, rowCount: 4, parsedRows: 2, schema: 'ok', wroteNothing: true });
    expect(r.pageWatch?.check).toBe('ok');
    expect(r.pageWatch?.rows).toEqual([
      { title: 'Bid: Kitchen Ventilation Upgrade at Thomas Alva Edison High School MC (Capital Programs)', dueDate: '2026-12-17', trades: ['hvac'], url: 'https://philasd.org/procurement/wp-content/uploads/sites/93/2026/11/NG10901.pdf', proposedLabel: 'act_now' },
      { title: 'Bid: Bathroom Renovations at George W. Childs School EC (Capital Programs)', dueDate: '2026-12-22', trades: ['general-contractor'], url: 'https://philasd.org/procurement/NG10902.pdf', proposedLabel: 'act_now' },
    ]);
    expect(r.mapped).toHaveLength(2);
    expect(r.mapped[0].contacts).toEqual([]);
    expect(JSON.stringify(r)).not.toMatch(PEOPLE);
    expect(calls).toHaveLength(2);
  });
  it('reports a parser mismatch as a schema mismatch with the reason', async () => {
    const r = await runCoverageProbe('bids-pw-houston-isd', fetchWith(fx('mismatch-table.html')).f, NOW);
    expect(r.schema).toBe('mismatch');
    expect(r.schemaProblem).toMatch(/^parser_mismatch: no table has a title column/);
  });
  it('an empty listing is no_rows, not a mismatch', async () => {
    const r = await runCoverageProbe('bids-pw-miamidade-construction', fetchWith(fx('miamidade-empty.html')).f, NOW);
    expect(r.schema).toBe('no_rows');
    expect(r.pageWatch?.check).toBe('empty');
  });
  it('a Bonfire source shows its JSON rows', async () => {
    const r = await runCoverageProbe('bids-pw-dart', fetchWith(fx('bonfire-open.json'), 'application/json').f, NOW);
    expect(r.pageWatch?.rows.map((x) => x.title)).toEqual(['Bid: Roof Replacement at Kashmere Bus Operating Facility (Facilities Maintenance)', 'Bid: Janitorial Services for Administrative Buildings (Dallas Area Rapid Transit (DART))']);
  });
  it('a Firecrawl-only source spends nothing here and points to the Firecrawl probe, which knows the id', async () => {
    const { f, calls } = fetchWith('');
    const r = await runCoverageProbe('bids-pw-phoenix-opengov', f, NOW);
    expect(calls).toEqual([]);
    expect(r.pageWatch?.check).toBe('skipped');
    expect(r.message).toMatch(/firecrawl-probe\?source=bids-pw-phoenix-opengov/);
    const fc = await runProbe({ source: 'bids-pw-phoenix-opengov', env: {}, now: NOW, fetch: f, db: null });
    expect(fc.status).toBe('no_key');
    expect(fc.page).toBe('https://procurement.opengov.com/portal/phoenix');
    expect(fc.knownSources).toEqual(expect.arrayContaining(['bids-pw-houston-city', 'bids-pw-phoenix-opengov']));
  });
});
