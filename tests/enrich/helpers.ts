import { vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';

export const NOW = new Date('2026-11-22T12:00:00Z');
export const MONTH = '2026-11-01';
export const ENV = { DATAFORSEO_LOGIN: 'lookup-login@example.test', DATAFORSEO_PASSWORD: 'Sup3r-S3cret-pa55word' };
export const SECRETS = [ENV.DATAFORSEO_LOGIN, ENV.DATAFORSEO_PASSWORD, Buffer.from(`${ENV.DATAFORSEO_LOGIN}:${ENV.DATAFORSEO_PASSWORD}`).toString('base64')];
export const ATLANTA = { lat: 33.749, lon: -84.388 };

/**
 * One Business Listings item, shaped like the documented sample response (docs.dataforseo.com/v3/business_data/business_listings/search/live:
 * title, phone "+441615322922", url, domain, address_info { borough, address, city, zip, region, country_code }, latitude, longitude).
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
    address_info: { borough: null, address: '100 Example St NW', city: 'Atlanta', zip: '30303', region: 'GA', country_code: 'US', ...addr },
    latitude: 33.7601,
    longitude: -84.3912,
    is_claimed: true,
    ...over,
  };
}

/** A full response body around the items, with the documented envelope (status_code 20000, cost, tasks[0].result[0].items). */
export function listingsBody(items: unknown[], cost = 0.01396) {
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
        result: [{ total_count: items.length, count: items.length, offset: 0, offset_token: 'x', items }],
      },
    ],
  };
}

export function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export function fakeFetch(items: unknown[], cost = 0.01396) {
  return vi.fn(async () => jsonRes(listingsBody(items, cost)));
}

export function newDb(seed: Record<string, Record<string, unknown>[]> = {}) {
  return new FakeDb({ holler_dataforseo_spend: [], holler_business_lookup: [], ...seed });
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
