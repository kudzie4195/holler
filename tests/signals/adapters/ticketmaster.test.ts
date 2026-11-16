/**
 * Fixture provenance: tests/fixtures/ticketmaster-events.json
 * - Structure (_embedded.events[].id/name/url/dates.start{dateTime,localDate}/classifications[], _embedded.venues[] with
 *   name/city.name/state.stateCode/postalCode/location{latitude,longitude}, page{size,totalElements,totalPages,number}) is SOURCED from
 *   https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/ (Event Search section).
 * - All values and the string typing of latitude/longitude are ASSUMED (hand-written).
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
