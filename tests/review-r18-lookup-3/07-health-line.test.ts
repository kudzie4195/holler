// Round 18 integration: review 3 probe (logs/REV3-LOOKUP-probe-tests) kept as a permanent regression test. Findings fixed at integration
// (P2-1 health line, P3-1 outage stop, P3-2/P3-3 closed listings, P3-5 address forms, P3-6 address before ambiguity, P3-7 tie order) now assert
// the fixed behaviour; every other assertion is the reviewer's as written.
import { afterEach, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import { ENV } from '../enrich/helpers';
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.doUnmock('@/lib/supabase/admin'); vi.doUnmock('@/lib/signals/registry'); vi.doUnmock('@/lib/email'); });
const row = (i: number, status: string, when: string) => ({ name_key: `seed${i} roofing`, city_key: 'atlanta', state: 'GA', status, phone: null, website: null, listing_name: null, cost_usd: 0.012, checked_at: when });
async function health(db: FakeDb, when: Date) {
  vi.resetModules(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(when);
  const sendEmail = vi.fn(async () => ({ ok: true, id: 'em' }));
  vi.stubEnv('CRON_SECRET', 's3cret'); vi.stubEnv('ADMIN_EMAIL', 'owner@x.test'); vi.stubEnv('DATAFORSEO_LOGIN', ENV.DATAFORSEO_LOGIN); vi.stubEnv('DATAFORSEO_PASSWORD', ENV.DATAFORSEO_PASSWORD);
  vi.doMock('server-only', () => ({})); vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => db })); vi.doMock('@/lib/signals/registry', () => ({ ALL_ADAPTERS: [] }));
  vi.doMock('@/lib/email', async (orig) => ({ ...(await orig<typeof import('@/lib/email')>()), sendEmail }));
  const { GET } = await import('@/app/api/cron/health/route');
  const body = (await (await GET(new Request('http://x.test/api/cron/health', { headers: { authorization: 'Bearer s3cret' } }))).json()) as { watch: string[] };
  vi.useRealTimers();
  return { watch: body.watch, text: (sendEmail.mock.calls[0] as unknown as [{ text: string }])[0].text };
}
it('trial fix: a trip after 13:03 UTC is in the next day\'s email; an outage with no answers is in the email', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => row(i, 'truncated', `2026-11-23T14:${String(i * 10).padStart(2, '0')}:00.000Z`));
  const next = await health(new FakeDb({ holler_scan_runs: [], holler_business_lookup: rows, holler_dataforseo_spend: [] }), new Date('2026-11-24T13:03:00Z'));
  expect(next.watch[0]).toBe('Business lookups returned no usable match yesterday (5 tried). Run the lookup probe.');
  expect(next.text).toContain('Business lookups returned no usable match yesterday (5 tried). Run the lookup probe.');
  // yesterday had 3 misses, today 2: not five in one day, no line
  const mixed = [...rows.slice(0, 3), row(7, 'not_found', '2026-11-24T01:00:00.000Z'), row(8, 'not_found', '2026-11-24T02:00:00.000Z')];
  const none = await health(new FakeDb({ holler_scan_runs: [], holler_business_lookup: mixed, holler_dataforseo_spend: [] }), new Date('2026-11-24T13:03:00Z'));
  expect(none.watch.join('\n')).not.toContain('Business lookups');
  // two days later: no line
  const later = await health(new FakeDb({ holler_scan_runs: [], holler_business_lookup: rows, holler_dataforseo_spend: [] }), new Date('2026-11-25T13:03:00Z'));
  expect(later.watch.join('\n')).not.toContain('Business lookups');
  // outage (adapted at integration: the outage stop counts failed calls IN A ROW per UTC day and stops at 3; the line reports the stop of
  // today or of yesterday): 12 failed calls yesterday, none ok
  const led = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, month: '2026-11-01', endpoint: '/v3/business_data/business_listings/search/live', units: 20, estimated_usd: 0.0192, cost_usd: 0, status: 'error', created_at: `2026-11-23T1${i % 10}:00:00.000Z` }));
  const outage = await health(new FakeDb({ holler_scan_runs: [], holler_business_lookup: [], holler_dataforseo_spend: led }), new Date('2026-11-24T13:03:00Z'));
  expect(outage.watch[0]).toBe('Business lookups got no answer 12 times in a row yesterday, so they stopped for the day. Check the DataForSEO login and balance.');
  expect(outage.text).toContain('Check the DataForSEO login and balance.');
  // an answered call after the failures (the owner fixed the login and probed): no line
  const fine = await health(new FakeDb({ holler_scan_runs: [], holler_business_lookup: [], holler_dataforseo_spend: [...led, { ...led[0], id: 99, status: 'ok' }] }), new Date('2026-11-24T13:03:00Z'));
  expect(fine.watch.join('\n')).not.toContain('Business lookups');
  // two failures only: no line
  const two = await health(new FakeDb({ holler_scan_runs: [], holler_business_lookup: [], holler_dataforseo_spend: led.slice(0, 2) }), new Date('2026-11-24T13:03:00Z'));
  expect(two.watch.join('\n')).not.toContain('Business lookups');
});
