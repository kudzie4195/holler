// track(): never throws, never waits long, exact keys, no IP or user agent anywhere, duplicates quiet.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildEventRow, EVENT_NAMES, EVENT_ROW_KEYS, type EventRow } from '@/lib/analytics/events';

vi.mock('server-only', () => ({}));
const admin = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: admin.create }));

import { track, TRACK_TIMEOUT_MS, type EventsDb } from '@/lib/analytics/server';

const USER = '0b1f4a3e-8d1c-4d0e-9a55-2f6c1d2e3a4b';
const SID = 'AbCdEfGhIjKlMnOpQrStUv';

function db(result: { error: { code?: string; message?: string } | null } | 'throw' | 'hang') {
  const inserted: EventRow[] = [];
  const client: EventsDb = {
    from: () => ({
      insert: (row) => {
        inserted.push(row);
        if (result === 'throw') throw new Error('sync boom');
        if (result === 'hang') return new Promise(() => {});
        return Promise.resolve(result);
      },
    }),
  };
  return { client, inserted };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  admin.create.mockReset();
});

describe('track never throws', () => {
  it('when the table is missing (42P01)', async () => {
    const d = db({ error: { code: '42P01', message: 'relation "public.holler_events" does not exist' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(track('signup', { userId: USER }, d.client)).resolves.toBeUndefined();
    expect(d.inserted).toHaveLength(1);
  });
  it('when the insert throws synchronously or rejects', async () => {
    await expect(track('visit', {}, db('throw').client)).resolves.toBeUndefined();
    const rej: EventsDb = { from: () => ({ insert: () => Promise.reject(new Error('x')) }) };
    await expect(track('visit', {}, rej)).resolves.toBeUndefined();
  });
  it('when the service is not configured (createAdminClient throws)', async () => {
    admin.create.mockImplementation(() => {
      throw new Error('Supabase admin is not configured');
    });
    await expect(track('paid', { userId: USER })).resolves.toBeUndefined();
  });
  it('with garbage input', async () => {
    const d = db({ error: null });
    await expect(track('nope' as never, undefined, d.client)).resolves.toBeUndefined();
    await expect(track('visit', { userId: {} as never, sessionId: 5 as never, source: Symbol('x') as never }, d.client)).resolves.toBeUndefined();
    expect(d.inserted).toHaveLength(1); // the valid name still counts, the junk fields are null
    expect(d.inserted[0]).toMatchObject({ user_id: null, session_id: null, source: null });
  });
  it('a duplicate (23505) is quiet: no log', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await track('paid', { userId: USER }, db({ error: { code: '23505' } }).client);
    expect(spy).not.toHaveBeenCalled();
  });
  it('stops waiting after the timeout when the database hangs', async () => {
    vi.useFakeTimers();
    const d = db('hang');
    let done = false;
    const p = track('first_alert', { userId: USER }, d.client).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(TRACK_TIMEOUT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await p;
    expect(done).toBe(true);
    expect(TRACK_TIMEOUT_MS).toBeLessThanOrEqual(2000);
  });
});

describe('what is inserted', () => {
  it('has exactly the seven allowed keys, for every event name', async () => {
    for (const name of EVENT_NAMES) {
      const d = db({ error: null });
      await track(name, { userId: USER, sessionId: SID, source: 'ig', medium: 'social', campaign: 'c', path: '/x' }, d.client);
      expect(Object.keys(d.inserted[0]).sort(), name).toEqual([...EVENT_ROW_KEYS]);
    }
  });
  it('has no IP, user agent or referrer key, even when the caller smuggles extra props', async () => {
    const d = db({ error: null });
    await track(
      'visit',
      { sessionId: SID, ip: '203.0.113.7', userAgent: 'Mozilla/5.0', ua: 'x', referrer: 'https://t.co/abc', referer: 'x', headers: { a: 1 } } as never,
      d.client,
    );
    expect(Object.keys(d.inserted[0]).sort()).toEqual([...EVENT_ROW_KEYS]);
    const dump = JSON.stringify(d.inserted[0]);
    expect(dump).not.toMatch(/203\.0\.113|Mozilla|t\.co|referr/i);
    for (const k of Object.keys(d.inserted[0])) expect(k).not.toMatch(/ip|agent|ua|referr|header|host/i);
  });
  it('cleans every field again at the door', () => {
    const r = buildEventRow('signup', { userId: 'NOT-A-UUID', sessionId: 'short', source: '<b>X</b>', medium: 'A'.repeat(90), campaign: '夏', path: '/a?b=1' })!;
    expect(r).toEqual({ name: 'signup', session_id: null, user_id: null, source: 'b-x-b', medium: 'a'.repeat(40), campaign: null, path: null });
    expect(buildEventRow('drop table', {})).toBeNull();
    expect(buildEventRow('signup', { userId: USER.toUpperCase() })!.user_id).toBe(USER);
  });
  it('the allowed names are exactly the seven in the migration', () => {
    expect([...EVENT_NAMES]).toEqual(['visit', 'area_check', 'signup', 'first_alert', 'trial_start', 'paid', 'app_open']);
  });
});
