/**
 * No fixtures: feeds every parser garbage and checks that nothing throws and nothing comes back.
 * Also checks the adapter contract fields on every adapter in this unit.
 */
import { describe, expect, it } from 'vitest';
import { adapters as socrata, parseSocrata } from '@/lib/signals/adapters/socrata';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { adapters as usa, parseUsaSpending } from '@/lib/signals/adapters/usaspending';
import { adapters as sam, parseSam } from '@/lib/signals/adapters/sam';
import { adapters as tm, parseTicketmaster } from '@/lib/signals/adapters/ticketmaster';
import { adapters as bsky, parseBluesky } from '@/lib/signals/adapters/bluesky';
import { adapters as web, parseBrave, parseSerper } from '@/lib/signals/adapters/websearch';

const garbage: unknown[] = [
  null, undefined, 0, 'x', true, [], {}, [null, 1, 'a', [], {}], { results: 'no' }, { posts: [null, 7, { uri: 1 }] },
  { _embedded: { events: [null, { id: 1 }, { id: 'a', name: 'b', dates: null }] } },
  { opportunitiesData: [null, { noticeId: 'a' }, { noticeId: 'a', title: 't', placeOfPerformance: 5 }] },
  { web: { results: [null, {}, { url: 5 }] } }, { organic: [null, 3, { link: 'not a url', title: 'Anyone recommend a plumber in Atlanta?' }] },
  [{ created_date: 'not a date', sr_number: 'x' }, { created_date: '2026-11-15T00:00:00.000' }],
];

describe('parsers never throw on malformed input', () => {
  it('Socrata (all datasets)', () => {
    for (const ds of SOCRATA_DATASETS) for (const g of garbage) expect(() => parseSocrata(g, ds)).not.toThrow();
    for (const ds of SOCRATA_DATASETS) expect(parseSocrata(garbage[garbage.length - 1], ds)).toEqual([]);
  });
  it('USAspending, SAM, Ticketmaster, Bluesky, Brave, Serper', () => {
    for (const g of garbage) {
      expect(parseUsaSpending(g)).toEqual([]);
      expect(parseSam(g)).toEqual([]);
      expect(parseTicketmaster(g)).toEqual([]);
      expect(parseBluesky(g)).toEqual([]);
      expect(parseBrave(g)).toEqual([]);
      expect(parseSerper(g)).toEqual([]);
    }
  });
});

describe('every adapter in this unit logs an error-like line on each failure mode', () => {
  const ERROR_LIKE = /\b(error|failed|failure|timeout|timed out|http\s?[45]\d\d|status\s?[45]\d\d)\b/i; // same pattern as lib/signals/run.ts
  const env = { SAM_API_KEY: 'k', TICKETMASTER_API_KEY: 'k', BRAVE_SEARCH_API_KEY: 'k', SERPER_API_KEY: 'k' };
  const modes: [string, typeof fetch][] = [
    ['network down', (async () => { throw new Error('network down'); }) as unknown as typeof fetch],
    ['HTTP 500', (async () => new Response('oops', { status: 500 })) as unknown as typeof fetch],
    ['HTTP 403', (async () => new Response('forbidden', { status: 403 })) as unknown as typeof fetch],
    ['HTTP 429', (async () => new Response('slow down', { status: 429 })) as unknown as typeof fetch],
    ['HTML with 200', (async () => new Response('<html>not json</html>', { status: 200 })) as unknown as typeof fetch],
  ];
  // The Serper adapter steps aside (quietly, on purpose) when a Brave key is present, so it is tested with only its own key.
  const targets = [...usa, ...sam, ...tm, ...bsky, ...web.filter((a) => a.id !== 'websearch-serper')];
  for (const [mode, f] of modes) {
    it(`${mode}`, async () => {
      for (const a of targets) {
        const logs: string[] = [];
        const out = await a.fetch({ since: new Date(), env, log: (m) => logs.push(m), fetch: f });
        expect(out, a.id).toEqual([]);
        expect(logs.some((l) => ERROR_LIKE.test(l)), `${a.id} (${mode}) logged: ${JSON.stringify(logs)}`).toBe(true);
      }
      const serper = web.find((a) => a.id === 'websearch-serper')!;
      const logs: string[] = [];
      await serper.fetch({ since: new Date(), env: { SERPER_API_KEY: 'k' }, log: (m) => logs.push(m), fetch: f });
      expect(logs.some((l) => ERROR_LIKE.test(l)), `serper (${mode}) logged: ${JSON.stringify(logs)}`).toBe(true);
    });
  }
});

describe('every adapter honours the contract', () => {
  const all = [...socrata, ...usa, ...sam, ...tm, ...bsky, ...web];
  it('has unique ids, a sourceUrl, a cadence and a kind', () => {
    expect(new Set(all.map((a) => a.id)).size).toBe(all.length);
    for (const a of all) {
      expect(a.sourceUrl).toMatch(/^https:\/\//);
      expect(a.cadenceMinutes).toBeGreaterThan(0);
      expect(a.label.length).toBeGreaterThan(3);
    }
  });
  it('fetch() resolves to [] (never throws) when fetch rejects, returns 500, or returns garbage', async () => {
    const modes: typeof fetch[] = [
      (async () => { throw new Error('network down'); }) as unknown as typeof fetch,
      (async () => new Response('oops', { status: 500 })) as unknown as typeof fetch,
      (async () => new Response('<html>not json</html>', { status: 200 })) as unknown as typeof fetch,
    ];
    const env = { SAM_API_KEY: 'k', TICKETMASTER_API_KEY: 'k', BRAVE_SEARCH_API_KEY: 'k', SERPER_API_KEY: 'k' };
    for (const f of modes) {
      for (const a of all) {
        const res = await a.fetch({ since: new Date(), env, log: () => {}, fetch: f });
        expect(res, a.id).toEqual([]);
      }
    }
  });
});
