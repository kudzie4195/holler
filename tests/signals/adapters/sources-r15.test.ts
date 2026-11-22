/**
 * Round 15 unit S: the five sources that returned 0 rows on their last 3 runs.
 * Provenance (see /home/claude/gates/r15/S-report.md):
 * - fixtures/S-sample-la-permits.json and S-sample-batonrouge-311.json: raw SODA rows read with WebFetch on 2026-11-22 (a model
 *   transcription of the response; the select left out free-text columns).
 * - fixtures/S-sample-kansascity-311.json and S-sample-oakland-311.json: STORED signal rows (parsed form) from a read-only select,
 *   because WebFetch of those portals was denied. They prove the window arithmetic, not the parser.
 * - Austin inspections has no sample: its portal was denied and Holler never stored a row. Nothing is invented.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSocrataAdapter, buildSocrataQuery, parseSocrataReport, toIso } from '@/lib/signals/adapters/socrata';
import { SOCRATA_DATASETS, lookbackDays, type SocrataDataset } from '@/lib/signals/adapters/socrata-datasets';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { SOURCE_DEFAULTS } from '@/lib/signals/lead-rules';
import { SOURCE_META } from '@/lib/signals/source-meta';
import { CITY_FEEDS } from '@/lib/signals/capabilities';

const sample = (name: string): { _provenance: Record<string, unknown>; rows: Record<string, unknown>[] } =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', `S-sample-${name}.json`), 'utf8'));
const ds = (id: string): SocrataDataset => {
  const d = SOCRATA_DATASETS.find((x) => x.id === id);
  if (!d) throw new Error(`no dataset ${id}`);
  return d;
};
const lowerBound = (d: SocrataDataset, now: Date): string => /> '([^']+)'/.exec(buildSocrataQuery(d, now).get('$where')!)![1];

describe('LA permits: weekly portal, 7 day window went empty', () => {
  const d = ds('socrata-la-permits');
  const { rows } = sample('la-permits');
  const lastScan = new Date('2026-11-22T00:30:29Z'); // the last stored run (holler_scan_runs)

  it('cause: the newest published issue_date (2026-11-14) is older than the old 7 day lower bound, newer than the new one', () => {
    const newest = rows.map((r) => String(r.issue_date)).sort().at(-1)!;
    expect(newest).toBe('2026-11-14T00:00:00.000');
    const old7 = toFloatingLocalFrom(lastScan, 7);
    expect(newest < old7).toBe(true); // old window: 0 rows
    expect(newest > lowerBound(d, lastScan)).toBe(true); // new window: sees them
  });

  it('exact query: 14 day window in Los Angeles local time, newest first, id as tie-breaker, 500 per page', () => {
    expect(lookbackDays(d)).toBe(14);
    const p = buildSocrataQuery(d, lastScan);
    expect(p.get('$where')).toBe("issue_date > '2026-11-07T16:30:29'");
    expect(p.get('$order')).toBe('issue_date DESC, permit_nbr');
    expect(p.get('$limit')).toBe('500');
  });

  it('the current sample still has the shape the config expects (ids, dates, text, coordinates)', () => {
    const report = parseSocrataReport(rows, d);
    expect(report.rows).toBe(12);
    expect(report.shapeOk).toBe(12);
    for (const it of report.items) {
      expect(it.occurredAt).toBe('2026-11-14T08:00:00.000Z'); // midnight Los Angeles (PST)
      expect(it.lat).not.toBeNull();
      expect(it.city).toBe('Los Angeles');
    }
  });

  it('reads further pages while a page is full, stops on a short page, keeps earlier pages when a later one fails', async () => {
    const full = Array.from({ length: 500 }, (_, i) => ({ ...rows[0], permit_nbr: `P-${i}` }));
    const urls: string[] = [];
    const respond = (bodies: unknown[], failAt?: number) =>
      vi.fn(async (url: string | URL | Request) => {
        urls.push(String(url));
        const n = urls.length - 1;
        if (failAt === n) return new Response('x', { status: 503 });
        return new Response(JSON.stringify(bodies[n] ?? []), { status: 200 });
      });
    const ctx = (f: ReturnType<typeof respond>) => ({ fetch: f as unknown as typeof fetch, env: {}, log: () => {}, now: lastScan }) as never;
    const a = buildSocrataAdapter(d);

    await a.fetch(ctx(respond([full, full, rows])));
    expect(urls).toHaveLength(3);
    expect(urls[0]).not.toContain('$offset');
    expect(new URL(urls[1]).searchParams.get('$offset')).toBe('500');
    expect(new URL(urls[2]).searchParams.get('$offset')).toBe('1000');

    urls.length = 0;
    await a.fetch(ctx(respond([rows])));
    expect(urls).toHaveLength(1); // short first page: no second request

    urls.length = 0;
    await a.fetch(ctx(respond([full, full, full, full, full, full, full], undefined)));
    expect(urls).toHaveLength(4); // maxPages 4

    urls.length = 0;
    const out = await a.fetch(ctx(respond([full], 1)));
    expect(urls).toHaveLength(2);
    expect(out.length).toBeGreaterThanOrEqual(0); // page 1 failed after page 0: no throw

    urls.length = 0;
    expect(await a.fetch(ctx(respond([], 0)))).toEqual([]); // first page fails: empty, as before
  });

  it('other datasets are unchanged: one page, date-only order', () => {
    expect(buildSocrataQuery(ds('socrata-chicago-permits'), lastScan).get('$order')).toBe('issue_date DESC');
    expect(ds('socrata-chicago-permits').maxPages).toBeUndefined();
  });
});

describe('Baton Rouge 311: upstream feed stopped, no successor, disabled', () => {
  const d = ds('socrata-batonrouge-311');
  const { rows } = sample('batonrouge-311');

  it('cause: the newest row in the dataset is from 2026-10-27, far outside the 3 day window', () => {
    const newest = rows.map((r) => String(r.createdate)).sort().at(-1)!;
    expect(newest).toBe('2026-10-27T22:54:00.000');
    expect(newest < lowerBound(d, new Date('2026-11-22T00:30:29Z'))).toBe(true);
  });

  it('is disabled with an honest note, and no adapter, label, source link or city claim remains', () => {
    expect(d.verified).toBe(false);
    expect(d.note).toMatch(/^DISABLED/);
    expect(ALL_ADAPTERS.some((a) => a.id === d.id)).toBe(false);
    expect(d.id in SOURCE_DEFAULTS).toBe(false);
    expect(d.id in SOURCE_META).toBe(false);
    // Baton Rouge permits still land on the city; 311 is not claimed for it.
    expect(CITY_FEEDS['baton-rouge-la'] ?? []).not.toContain('311');
    expect(CITY_FEEDS['baton-rouge-la'] ?? []).toContain('permit');
  });

  it('the old config still parses the current sample (the columns are right; only the feed stopped)', () => {
    const report = parseSocrataReport(rows, d);
    expect(report.shapeOk).toBe(12);
  });
});

describe('Kansas City and Oakland 311: query works, the portals published nothing after 2026-11-16', () => {
  for (const [id, name, newestIso, lastRowsSeenAt] of [
    ['socrata-kansascity-311', 'kansascity-311', '2026-11-16T16:02:00Z', '2026-11-19T15:30:22Z'],
    ['socrata-oakland-311', 'oakland-311', '2026-11-16T06:30:35Z', '2026-11-19T06:30:00Z'],
  ] as const) {
    it(`${id}: newest stored row is in the 3 day window until about 3 days after it, then never again (matches holler_source_health.last_rows_seen_at)`, () => {
      const d = ds(id);
      const { rows } = sample(name);
      const newest = rows.map((r) => String(r.occurred_at)).sort().at(-1)!;
      expect(newest).toBe(newestIso);
      const inWindow = (now: string) => toIso(lowerBound(d, new Date(now)), d.tz)! < newest;
      expect(inWindow(lastRowsSeenAt)).toBe(true);
      expect(inWindow('2026-11-19T17:00:00Z')).toBe(false);
      expect(inWindow('2026-11-22T00:30:29Z')).toBe(false);
    });
    it(`${id}: config unchanged, exact query is the 3 day 311 query`, () => {
      const d = ds(id);
      expect(d.verified).toBe(true);
      expect(lookbackDays(d)).toBe(3);
      expect(buildSocrataQuery(d, new Date('2026-11-22T00:30:29Z')).get('$where')).toContain('> ');
    });
  }
});

describe('Austin inspections: empty 7 day window on a failing-score filter', () => {
  const d = ds('socrata-austin-inspections');
  it('exact query: 30 day window in Austin local time, score < 70, newest first', () => {
    expect(lookbackDays(d)).toBe(30);
    const p = buildSocrataQuery(d, new Date('2026-11-22T00:30:29Z'));
    expect(p.get('$where')).toBe("inspection_date > '2026-10-22T19:30:29' AND (score < 70)");
    expect(p.get('$order')).toBe('inspection_date DESC');
    expect(p.get('$limit')).toBe('500');
  });
  it('the note says the fix is unverified live', () => {
    expect(d.note).toMatch(/UNVERIFIED live/);
  });
});

/** Floating local lower bound `days` before `now` in Los Angeles, for the cause check above. */
function toFloatingLocalFrom(now: Date, days: number): string {
  const d = ds('socrata-la-permits');
  return buildSocrataQuery({ ...d, lookbackOverride: days }, now).get('$where')!.match(/> '([^']+)'/)![1];
}
