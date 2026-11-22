import { vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';

export const NOW = new Date('2026-11-22T12:00:00Z');
export const MONTH = '2026-11-01';
export const ENV = { DATAFORSEO_LOGIN: 'lookup-login@example.test', DATAFORSEO_PASSWORD: 'Sup3r-S3cret-pa55word' };
export const SECRETS = [ENV.DATAFORSEO_LOGIN, ENV.DATAFORSEO_PASSWORD, Buffer.from(`${ENV.DATAFORSEO_LOGIN}:${ENV.DATAFORSEO_PASSWORD}`).toString('base64')];
export const ATLANTA = { lat: 33.749, lon: -84.388 };
export const LOOKUP_URL = 'https://api.dataforseo.com/v3/business_data/business_listings/search/live';

/**
 * One Business Listings item, shaped like the documented sample response (docs.dataforseo.com/v3/business_data/business_listings/search/live:
 * title, phone "+441615322922", url, domain, address "30 Portland St, Manchester M1 4GS", address_info { borough, address, city, zip,
 * region, country_code }, latitude, longitude). `region` is null as in all three documented sample items (a "DMA region", never a state).
 * The US address ending ", GA 30303" is assumed (the samples are British).
 */
export function item(over: Record<string, unknown> = {}, addr: Record<string, unknown> = {}) {
  return {
    type: 'business_listing',
    title: 'Peachtree Roofing',
    description: null,
    category: 'Roofing contractor',
    phone: '+14045550123',
    url: 'https://www.peachtreeroofing.example/',
    domain: 'www.peachtreeroofing.example',
    address: '100 Example St NW, Atlanta, GA 30303',
    address_info: { borough: null, address: '100 Example St NW', city: 'Atlanta', zip: '30303', region: null, country_code: 'US', ...addr },
    latitude: 33.7601,
    longitude: -84.3912,
    is_claimed: true,
    work_time: { work_hours: { timetable: null, current_status: 'open' } },
    ...over,
  };
}

/** A full response body around the items, with the documented envelope (status_code 20000, cost, tasks[0].result[0] total_count, items). */
export function listingsBody(items: unknown[], cost = 0.01596, totalCount: number = items.length) {
  return {
    version: '0.1.20240422',
    status_code: 20000,
    status_message: 'Ok.',
    time: '0.3 sec.',
    cost,
    tasks_count: 1,
    tasks_error: 0,
    tasks: [
      {
        id: '11221122-0000-0000-0000-000000000000',
        status_code: 20000,
        status_message: 'Ok.',
        time: '0.25 sec.',
        cost,
        result_count: 1,
        path: ['v3', 'business_data', 'business_listings', 'search', 'live'],
        data: {},
        result: [{ total_count: totalCount, count: items.length, offset: 0, offset_token: 'x', items }],
      },
    ],
  };
}

export function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export function fakeFetch(items: unknown[], cost = 0.01596) {
  return vi.fn<(url?: unknown, init?: unknown) => Promise<Response>>(async () => jsonRes(listingsBody(items, cost)));
}

/** A DataForSEO that accepts the request and never answers: only an abort ends it (or nothing, with `ignoreAbort`). */
export function hangingFetch(opts: { ignoreAbort?: boolean } = {}) {
  return vi.fn((url: unknown, init?: { signal?: AbortSignal }) =>
    String(url) === LOOKUP_URL
      ? new Promise<Response>((_res, rej) => {
          if (!opts.ignoreAbort) init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('timeout'), { name: 'TimeoutError' })));
        })
      : Promise.resolve(new Response('{}', { status: 200 })),
  );
}

/**
 * The shared FakeDb with the two behaviours of the real database the lookup depends on (review P3-11): an upsert on holler_business_lookup
 * MERGES (postgrest-js sends resolution=merge-duplicates by default), and a ledger insert gets created_at = now (0011 column default).
 */
export class LookupDb extends FakeDb {
  clock: () => Date = () => NOW;
  from(table: string) {
    const b = super.from(table) as unknown as { upsert: (rows: unknown, o?: { onConflict?: string }) => unknown; insert: (r: unknown) => unknown };
    if (table === 'holler_business_lookup') {
      const up = b.upsert.bind(b);
      b.upsert = (rows: unknown, o?: { onConflict?: string }) => {
        const keys = String(o?.onConflict ?? 'id').split(',');
        for (const r of (Array.isArray(rows) ? rows : [rows]) as Record<string, unknown>[]) {
          this.tables[table] = this.tables[table].filter((x) => !keys.every((k) => x[k] === r[k]));
        }
        return up(rows, o);
      };
    }
    if (table === 'holler_dataforseo_spend') {
      const ins = b.insert.bind(b);
      b.insert = (r: unknown) => ins((Array.isArray(r) ? r : [r]).map((x) => ({ created_at: this.clock().toISOString(), ...(x as object) })));
    }
    return b as unknown as ReturnType<FakeDb['from']>;
  }
}

export function newDb(seed: Record<string, Record<string, unknown>[]> = {}, clock?: () => Date) {
  const db = new LookupDb({ holler_dataforseo_spend: [], holler_business_lookup: [], ...seed });
  if (clock) db.clock = clock;
  return db;
}

/** A database where holler_business_lookup does not exist (migration 0026 not applied), with the real PostgREST / Postgres error. */
export function dbWithoutCache(code: 'PGRST205' | '42P01', seed: Record<string, Record<string, unknown>[]> = {}) {
  const inner = newDb(seed);
  const missing = {
    code,
    message: code === 'PGRST205' ? "Could not find the table 'public.holler_business_lookup' in the schema cache" : 'relation "public.holler_business_lookup" does not exist',
  };
  const touched: string[] = [];
  const db = {
    calls: inner.calls,
    tables: inner.tables,
    touched,
    from(table: string) {
      if (table !== 'holler_business_lookup') return inner.from(table);
      touched.push(table);
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'limit', 'upsert', 'order']) q[m] = () => q;
      q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: null, error: missing }).then(res, rej);
      return q;
    },
  };
  return db;
}

/** Ledger rows already booked today for the lookup endpoint. */
export function todayRows(n: number, status = 'ok', startId = 1) {
  return Array.from({ length: n }, (_, i) => ({
    id: startId + i,
    month: MONTH,
    endpoint: '/v3/business_data/business_listings/search/live',
    units: 20,
    estimated_usd: 0.0192,
    cost_usd: 0.0192,
    status,
    created_at: '2026-11-22T01:00:00Z',
  }));
}

/** The JSON body a fetch mock was called with (the one task). */
export function sentTask(f: { mock: { calls: unknown[][] } }, i = 0): Record<string, unknown> {
  const init = f.mock.calls[i][1] as { body: string };
  return JSON.parse(init.body)[0];
}
