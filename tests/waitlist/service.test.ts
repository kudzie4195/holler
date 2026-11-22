// POST /api/waitlist logic: validation, honeypot, duplicates, rate limit, soft failure, no PII in logs.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { joinWaitlist, WAITLIST_CONSENT_VERSION } from '@/lib/waitlist/service';
import { lookupZip } from '@/lib/geo';
import { fakeWaitlist, SERVED_ZIP, UNSERVED_ZIP } from './helpers';

vi.mock('server-only', () => ({}));

const base = { email: 'Pat@Example.com', zip: UNSERVED_ZIP, trade: 'roofing', page: 'check', ip: '203.0.113.9' };

afterEach(() => vi.restoreAllMocks());

describe('joinWaitlist: a good signup', () => {
  it('saves one row with the agreed shape (round 19: holler_zip_waitlist, double opt-in), and nothing about the visitor', async () => {
    const f = fakeWaitlist();
    const r = await joinWaitlist(f.deps, base);
    expect(r).toEqual({ code: 'ok' });
    expect(f.writes).toHaveLength(1);
    const z = lookupZip(UNSERVED_ZIP)!;
    expect(f.writes[0].row).toEqual({
      email: 'pat@example.com', zip: UNSERVED_ZIP, state: z.state, lat: Math.round(z.lat * 1000) / 1000, lon: Math.round(z.lon * 1000) / 1000,
      trade: 'roofing', consent_version: WAITLIST_CONSENT_VERSION,
    });
    expect(f.writes[0].opts).toEqual({ onConflict: 'email,zip', ignoreDuplicates: true });
    expect(JSON.stringify(f.rows)).not.toContain('203.0.113.9');
  });
  it('trims the email and accepts a plus address', async () => {
    const f = fakeWaitlist();
    expect((await joinWaitlist(f.deps, { ...base, email: '  pat+roof@example.com ' })).code).toBe('ok');
    expect(f.rows[0].email).toBe('pat+roof@example.com');
  });
});

describe('invalid input is rejected before anything is counted or written', () => {
  const cases: [string, Partial<typeof base>, string][] = [
    ['empty email', { email: '' }, 'email'],
    ['no at sign', { email: 'pat.example.com' }, 'email'],
    ['no domain dot', { email: 'pat@example' }, 'email'],
    ['spaces inside', { email: 'pat smith@example.com' }, 'email'],
    ['two addresses', { email: 'a@example.com, b@example.com' }, 'email'],
    ['too long', { email: `${'a'.repeat(250)}@example.com` }, 'email'],
    ['not a string', { email: 42 as unknown as string }, 'email'],
    ['short zip', { zip: '5900' }, 'zip'],
    ['letters in zip', { zip: '5900a' }, 'zip'],
    ['unknown zip', { zip: '00000' }, 'zip'],
    ['unknown trade', { trade: 'wizard' }, 'trade'],
    ['empty trade', { trade: '' }, 'trade'],
  ];
  for (const [name, patch, field] of cases) {
    it(name, async () => {
      const f = fakeWaitlist();
      const r = await joinWaitlist(f.deps, { ...base, ...patch });
      expect(r).toEqual({ code: 'invalid', field });
      expect(f.writes).toHaveLength(0);
      expect(f.hits).toHaveLength(0);
    });
  }
  it('an unknown page tag is rejected (only "check" is ever stored)', async () => {
    const f = fakeWaitlist();
    expect((await joinWaitlist(f.deps, { ...base, page: 'pricing' })).code).toBe('invalid');
    expect(f.writes).toHaveLength(0);
  });
  it('a ZIP Holler already serves is refused (60614): the list is for places with no alerts', async () => {
    const f = fakeWaitlist();
    expect(await joinWaitlist(f.deps, { ...base, zip: SERVED_ZIP })).toEqual({ code: 'invalid', field: 'zip' });
    expect(f.writes).toHaveLength(0);
  });
});

describe('duplicates', () => {
  it('the same email and ZIP twice is accepted both times and stored once', async () => {
    const f = fakeWaitlist();
    expect((await joinWaitlist(f.deps, base)).code).toBe('ok');
    expect((await joinWaitlist(f.deps, base)).code).toBe('ok');
    expect(f.rows).toHaveLength(1);
  });
  it('differing only by case or surrounding space is the same address', async () => {
    const f = fakeWaitlist();
    await joinWaitlist(f.deps, base);
    expect((await joinWaitlist(f.deps, { ...base, email: ' PAT@EXAMPLE.COM' })).code).toBe('ok');
    expect(f.rows).toHaveLength(1);
  });
  it('the same email for a different ZIP is a second row', async () => {
    const f = fakeWaitlist();
    await joinWaitlist(f.deps, base);
    await joinWaitlist(f.deps, { ...base, zip: '82001' });
    expect(f.rows).toHaveLength(2);
  });
});

describe('honeypot', () => {
  it('a filled hidden field looks like success but stores and counts nothing', async () => {
    const f = fakeWaitlist();
    const r = await joinWaitlist(f.deps, { ...base, leave_blank: 'http://spam.example' });
    expect(r).toEqual({ code: 'ok' });
    expect(f.writes).toHaveLength(0);
    expect(f.hits).toHaveLength(0);
  });
  it('an empty or whitespace field is a real person', async () => {
    const f = fakeWaitlist();
    expect((await joinWaitlist(f.deps, { ...base, leave_blank: '  ' })).code).toBe('ok');
    expect(f.writes).toHaveLength(1);
  });
});

describe('rate limit', () => {
  it('counts the IP and the email together, with keyed hashes and no raw values', async () => {
    const f = fakeWaitlist();
    await joinWaitlist(f.deps, base);
    expect(f.hits).toHaveLength(1);
    const keys = f.hits[0].map((l) => l.key);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^waitlist:ip:[0-9a-f]{32}$/);
    expect(keys[1]).toMatch(/^waitlist:email:[0-9a-f]{32}$/);
    expect(keys.join(' ')).not.toMatch(/203\.0\.113|example\.com/);
    expect(f.hits[0].map((l) => [l.max, l.windowSeconds])).toEqual([[10, 3600], [3, 86_400]]); // 3 a day: each sign-up sends mail
  });
  it('over the limit: "limited", nothing written', async () => {
    const f = fakeWaitlist();
    f.setHit('limited');
    expect(await joinWaitlist(f.deps, base)).toEqual({ code: 'limited' });
    expect(f.writes).toHaveLength(0);
  });
  it('a limiter that cannot run is "unavailable", nothing written', async () => {
    const f = fakeWaitlist();
    f.setHit('error');
    expect((await joinWaitlist(f.deps, base)).code).toBe('unavailable');
    expect(f.writes).toHaveLength(0);
  });
  it('one address uses one counter key whatever its case or spacing', async () => {
    const f = fakeWaitlist();
    await joinWaitlist(f.deps, base);
    await joinWaitlist(f.deps, { ...base, email: ' PAT@example.com' });
    expect(f.hits[0][1].key).toBe(f.hits[1][1].key);
  });
});

describe('soft failure and logs', () => {
  it('a missing table (migration 0031 not applied) is "unavailable", not a throw, and logs only the error code', async () => {
    const f = fakeWaitlist({ missingTable: true });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await joinWaitlist(f.deps, base)).toEqual({ code: 'unavailable' });
    const logged = JSON.stringify([err.mock.calls, log.mock.calls, warn.mock.calls]);
    expect(logged).toContain('42P01');
    expect(logged).not.toMatch(/pat@example|example\.com|59001|roofing|203\.0\.113/i);
  });
  it('writes no log line at all on success or on invalid input', async () => {
    const f = fakeWaitlist();
    const spies = (['error', 'log', 'warn', 'info'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    await joinWaitlist(f.deps, base);
    await joinWaitlist(f.deps, { ...base, email: 'bad' });
    expect(spies.flatMap((s) => s.mock.calls)).toEqual([]);
  });
});
