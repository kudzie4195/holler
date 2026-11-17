/**
 * Fixture provenance: tests/fixtures/ticketmaster-events.json (re-checked 2026-11-17)
 * - Structure SOURCED from https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/ (fetched): _embedded.events[] with id, name, url,
 *   dates.start{localDate,dateTime,...}, classifications[]{segment,genre}, _embedded.venues[]{name,postalCode,city.name,state{name,stateCode},location{longitude,latitude}},
 *   page{size,totalElements,totalPages,number}. The docs' own sample shows latitude/longitude as STRINGS (e.g. "-80.33854298"), which the fixture copies.
 * - Request: startDateTime/endDateTime example "2017-01-01T00:00:00Z" from https://developer.ticketmaster.com/products-and-docs/apis/discovery-manual/v2 (the prose
 *   gives no format). segmentName is an Array whose comma-separated use is NOT documented, so the adapter sends one request per segment.
 *   401 body {fault:{faultstring:"Invalid ApiKey"}} and 429 QuotaViolation from the same docs. Values are hand-written.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adapters, buildTicketmasterUrl, parseTicketmaster } from '@/lib/signals/adapters/ticketmaster';

const fx = (name: string): unknown => JSON.parse(readFileSync(join(__dirname, '../../fixtures', name), 'utf8'));

describe('parseTicketmaster', () => {
  const out = parseTicketmaster(fx('ticketmaster-events.json'));
  it('returns 2 events and drops the one with no start date', () => {
    expect(out).toHaveLength(2);
    expect(out.every((s) => s.kind === 'event' && s.source === 'ticketmaster')).toBe(true);
  });
  it('maps venue coordinates, city/state and the event trades', () => {
    const e = out.find((s) => s.externalId === 'vvG1HZ4aBcDeFg')!;
    expect(e.lat).toBeCloseTo(33.755, 3);
    expect(e.lon).toBeCloseTo(-84.4, 3);
    expect(e.city).toBe('Atlanta');
    expect(e.state).toBe('GA');
    expect(e.zip).toBe('30313');
    expect(e.categories).toEqual(['food-truck', 'catering', 'event-services', 'rideshare-delivery', 'cleaning']);
    expect(e.severity).toBe(2);
    expect(e.occurredAt).toBe('2026-11-22T18:00:00.000Z');
    expect(e.title).toBe('Atlanta Falcons vs. Tampa Bay Buccaneers at Mercedes-Benz Stadium, Atlanta GA');
    expect(new Date(e.expiresAt!).getTime()).toBeGreaterThan(new Date(e.occurredAt).getTime());
  });
  it('falls back to localDate when dateTime is missing', () => {
    expect(out.find((s) => s.externalId === 'vvG1ZZ9aXyWvUt')!.occurredAt).toBe('2026-11-20T00:00:00.000Z');
  });
  it('URL asks for US, a 7 day window and the key', () => {
    const u = new URL(buildTicketmasterUrl('KEY', new Date('2026-11-16T12:00:00.500Z'), 0));
    expect(u.searchParams.get('countryCode')).toBe('US');
    expect(u.searchParams.get('apikey')).toBe('KEY');
    expect(u.searchParams.get('startDateTime')).toBe('2026-11-16T12:00:00Z');
    expect(u.searchParams.get('endDateTime')).toBe('2026-11-23T12:00:00Z');
  });
  it('requires TICKETMASTER_API_KEY', () => expect(adapters[0].requiresEnv).toEqual(['TICKETMASTER_API_KEY']));
});

const ERROR_LIKE = /\b(error|failed|failure|timeout|timed out|http\s?[45]\d\d|status\s?[45]\d\d)\b/i; // same pattern as lib/signals/run.ts
async function run(f: (url: string) => Response | Promise<Response>) {
  const logs: string[] = [];
  const urls: string[] = [];
  const fetchImpl = (async (u: unknown) => {
    urls.push(String(u));
    return f(String(u));
  }) as unknown as typeof fetch;
  const out = await adapters[0].fetch({ since: new Date(), fetch: fetchImpl, env: { TICKETMASTER_API_KEY: 'k' }, log: (m) => logs.push(m) });
  return { out, logs, urls };
}

describe('ticketmaster requests and failure modes', () => {
  it('asks one segment per request (Sports, Music) with the documented date example format and relevance sort', async () => {
    const r = await run(() => new Response(JSON.stringify(fx('ticketmaster-events.json')), { status: 200 }));
    const q = r.urls.map((u) => new URL(u));
    expect(q.map((u) => u.searchParams.get('segmentName'))).toEqual(['Sports', 'Music']);
    for (const u of q) {
      expect(u.origin + u.pathname).toBe('https://app.ticketmaster.com/discovery/v2/events.json');
      expect(u.searchParams.get('startDateTime')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(u.searchParams.get('endDateTime')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(u.searchParams.get('size')).toBe('200');
      expect(u.searchParams.get('sort')).toBe('relevance,desc');
    }
    expect(r.out).toHaveLength(2); // same two events from both segment calls, de-duplicated
    expect(r.logs).toEqual([]);
  });
  for (const status of [400, 401, 403, 429, 500]) {
    it(`HTTP ${status} logs an error-like line, returns []`, async () => {
      const r = await run(() => new Response('{}', { status }));
      expect(r.out).toEqual([]);
      expect(r.logs.some((l) => ERROR_LIKE.test(l) && l.includes(String(status)))).toBe(true);
    });
  }
  it('a 200 with a fault object logs an error', async () => {
    const r = await run(() => new Response(JSON.stringify({ fault: { faultstring: 'Invalid ApiKey', detail: { errorcode: 'oauth.v2.InvalidApiKey' } } }), { status: 200 }));
    expect(r.out).toEqual([]);
    expect(r.logs.some((l) => /fault Invalid ApiKey/.test(l) && ERROR_LIKE.test(l))).toBe(true);
  });
  it('an HTML page with 200 logs an error', async () => {
    const r = await run(() => new Response('<html>blocked</html>', { status: 200 }));
    expect(r.logs.some((l) => ERROR_LIKE.test(l))).toBe(true);
  });
  it('events counted by the page object but no _embedded key is a changed wrapper', async () => {
    const r = await run(() => new Response(JSON.stringify({ page: { totalElements: 50 }, items: [{ id: 'x' }] }), { status: 200 }));
    expect(r.out).toEqual([]);
    expect(r.logs.some((l) => /no _embedded.events array/.test(l) && ERROR_LIKE.test(l))).toBe(true);
  });
  it('zero matches (page.totalElements 0, no _embedded) is a quiet day', async () => {
    const r = await run(() => new Response(JSON.stringify({ page: { size: 200, totalElements: 0, totalPages: 0, number: 0 } }), { status: 200 }));
    expect(r.out).toEqual([]);
    expect(r.logs).toEqual([]);
  });
  it('events present but none parseable logs the silent-empty error', async () => {
    const r = await run(() => new Response(JSON.stringify({ _embedded: { events: [{ id: 'a', name: 'x' }, { id: 'b', name: 'y', dates: { start: {} } }] }, page: { totalElements: 2, totalPages: 1 } }), { status: 200 }));
    expect(r.out).toEqual([]);
    expect(r.logs).toContain('error: parsed 0 of 2 rows, shape may have changed');
  });
});
