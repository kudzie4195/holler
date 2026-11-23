// Round 19 review fix (defect 1): the 9 sign-up cases of the other branch's tests/waitlist/service.test.ts, brought back and rewritten for
// the merged service (this base's card, honeypot, trade check and served-ZIP refusal in front of their double opt-in into holler_zip_waitlist).
// Case 7 is adapted: this base refuses an unknown trade (field 'trade') where theirs stored null.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { joinWaitlist, WAITLIST_CONSENT_VERSION } from '@/lib/waitlist/service';
import { renderWaitlistConfirm } from '@/lib/email/templates';
import { fakeWaitlist, UNSERVED_ZIP } from './helpers';

vi.mock('server-only', () => ({}));
afterEach(() => vi.restoreAllMocks());

const input = { email: '  Pat@Example.COM ', zip: UNSERVED_ZIP, trade: 'roofing', page: 'check', ip: '203.0.113.9' };

describe('validation (their "normalises email", "5 digit ZIP and a slug trade")', () => {
  it('1. normalises the email (trim, lower case) and rejects junk', async () => {
    const f = fakeWaitlist();
    expect(await joinWaitlist(f.deps, input)).toEqual({ code: 'ok' });
    expect(f.rows[0].email).toBe('pat@example.com');
    for (const bad of ['nope', 'a@b', '', 42]) expect((await joinWaitlist(f.deps, { ...input, email: bad as string })).code).toBe('invalid');
  });
  it('2. accepts only a real 5 digit ZIP and a known trade id', async () => {
    const f = fakeWaitlist();
    for (const zip of ['1234', '123456', 'abcde', '00000']) expect(await joinWaitlist(f.deps, { ...input, zip })).toEqual({ code: 'invalid', field: 'zip' });
    for (const trade of ['Roofing', 'roof ing', 'x'.repeat(41)]) expect(await joinWaitlist(f.deps, { ...input, trade })).toEqual({ code: 'invalid', field: 'trade' });
    expect(f.writes).toHaveLength(0);
  });
});

describe('joinWaitlist (double opt-in)', () => {
  it('3. stores one row with a rounded ZIP centroid and the consent version, and sends one confirm link', async () => {
    const f = fakeWaitlist();
    expect(await joinWaitlist(f.deps, input)).toEqual({ code: 'ok' });
    const row = f.rows[0] as { lat: number; lon: number; state: string; consent_version: string };
    expect(row.consent_version).toBe(WAITLIST_CONSENT_VERSION);
    expect(String(row.lat).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(3);
    expect(String(row.lon).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(3);
    expect(row.state).toMatch(/^[A-Z]{2}$/);
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0].to).toBe('pat@example.com');
    expect(f.sent[0].confirmUrl).toMatch(/^https:\/\/localholler\.com\/waitlist\/confirm\?token=signed\.[0-9a-f-]{36}$/);
    expect(f.sent[0].place).toMatch(/, MT$/);
  });
  it('4. never stores the IP', async () => {
    const f = fakeWaitlist();
    await joinWaitlist(f.deps, input);
    expect(JSON.stringify(f.rows)).not.toContain('203.0.113.9');
    expect(Object.keys(f.rows[0]).sort()).toEqual(['consent_version', 'email', 'lat', 'lon', 'state', 'trade', 'zip']);
  });
  it('5. answers ok but sends nothing for an address already confirmed or unsubscribed (no enumeration, no re-mail)', async () => {
    for (const st of [{ confirmed_at: '2026-11-20T00:00:00Z' }, { unsubscribed_at: '2026-11-20T00:00:00Z' }]) {
      const f = fakeWaitlist();
      await joinWaitlist(f.deps, input);
      f.stamp('pat@example.com', UNSERVED_ZIP, st);
      expect(await joinWaitlist(f.deps, input)).toEqual({ code: 'ok' });
      expect(f.sent).toHaveLength(1); // only the first, unconfirmed sign-up was mailed
      expect(f.rows).toHaveLength(1);
    }
  });
  it('6. rejects a bad email or an unknown ZIP before any rate limit or write', async () => {
    const f = fakeWaitlist();
    expect((await joinWaitlist(f.deps, { ...input, email: 'bad' })).code).toBe('invalid');
    expect((await joinWaitlist(f.deps, { ...input, zip: '00000' })).code).toBe('invalid');
    expect(f.hits).toHaveLength(0);
    expect(f.writes).toHaveLength(0);
    expect(f.sent).toHaveLength(0);
  });
  it('7. (adapted) a malformed trade is refused before any write, never stored as text', async () => {
    const f = fakeWaitlist();
    expect(await joinWaitlist(f.deps, { ...input, trade: 'DROP TABLE' })).toEqual({ code: 'invalid', field: 'trade' });
    expect(f.writes).toHaveLength(0);
  });
  it.each(['PGRST205', '42P01'])('8. is limited, and soft-fails on a missing table (%s) or a failed send', async (code) => {
    const limited = fakeWaitlist();
    limited.setHit('limited');
    expect(await joinWaitlist(limited.deps, input)).toEqual({ code: 'limited' });
    expect(limited.writes).toHaveLength(0);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const missing = fakeWaitlist({ missingTable: true, missingCode: code });
    expect(await joinWaitlist(missing.deps, input)).toEqual({ code: 'unavailable' });
    expect(missing.sent).toHaveLength(0);
    const refused = fakeWaitlist({ sendOk: false });
    expect(await joinWaitlist(refused.deps, input)).toEqual({ code: 'unavailable' });
  });
});

describe('the confirmation email', () => {
  it('9. promises one email, has the link in both parts, and escapes the place', () => {
    const m = renderWaitlistConfirm({ confirmUrl: 'https://localholler.com/waitlist/confirm?token=a.b', place: 'Smyrna, GA <x>' });
    expect(m.text).toContain('https://localholler.com/waitlist/confirm?token=a.b');
    expect(m.html).toContain('https://localholler.com/waitlist/confirm?token=a.b');
    expect(m.html).not.toContain('<x>');
    // Round 24 (review P3-8): the email no longer talks about an area launch; it fits a trade that is not ready yet, too.
    expect(m.text).toMatch(/one email when it does\. Nothing else\./);
    expect(`${m.subject} ${m.text}`).not.toMatch(/launch/i);
    expect(`${m.subject} ${m.text}`).not.toMatch(/\bleads?\b|guaranteed|you will win|official record/i);
  });
});
