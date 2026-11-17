// Integration round 3, item 6: rate-limit keys are an HMAC-SHA256 keyed with CRON_SECRET, so a stored key cannot be reversed by
// hashing every IPv4 address. Without a secret (local tests) the old plain sha256 is kept. One helper for every key.
import { createHash, createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIMITS, rateDigest, rateKey } from '@/lib/auth/limits';
import { emailRateValue } from '@/lib/requests/tokens';
import { checkIpLimit } from '@/lib/check/limit';

afterEach(() => vi.unstubAllEnvs());

const plain = (v: string) => createHash('sha256').update(v.toLowerCase()).digest('hex').slice(0, 32);

describe('rateKey / rateDigest', () => {
  it('with CRON_SECRET: HMAC, not the plain sha256, and different for a different secret', () => {
    vi.stubEnv('CRON_SECRET', 'secret-one');
    const k1 = rateKey('login', 'ip', '203.0.113.9');
    expect(k1).toMatch(/^login:ip:[0-9a-f]{32}$/);
    expect(k1).not.toContain(plain('203.0.113.9'));
    expect(k1).toBe(`login:ip:${createHmac('sha256', 'secret-one').update('holler-rate:v1:203.0.113.9').digest('hex').slice(0, 32)}`);
    vi.stubEnv('CRON_SECRET', 'secret-two');
    expect(rateKey('login', 'ip', '203.0.113.9')).not.toBe(k1);
  });
  it('a brute force over IPs with the plain hash finds nothing', () => {
    vi.stubEnv('CRON_SECRET', 'secret-one');
    const key = rateKey('check', 'ip', '198.51.100.7').split(':')[2];
    const guesses = Array.from({ length: 256 }, (_, i) => plain(`198.51.100.${i}`));
    expect(guesses).not.toContain(key);
  });
  it('still lower-cases, never holds the raw value, and falls back to the plain hash with no secret', () => {
    vi.stubEnv('CRON_SECRET', 'secret-one');
    expect(rateKey('signup', 'email', 'A@B.com')).toBe(rateKey('signup', 'email', 'a@b.com'));
    expect(rateKey('signup', 'email', 'a@b.com')).not.toContain('a@b.com');
    vi.stubEnv('CRON_SECRET', '');
    expect(rateKey('signup', 'email', 'a@b.com')).toBe(`signup:email:${plain('a@b.com')}`);
  });
  it('every limiter goes through the same helper (auth, check, backfill, requests)', () => {
    vi.stubEnv('CRON_SECRET', 'secret-one');
    expect(LIMITS.signupIp('1.1.1.1').key).toBe(`signup:ip:${rateDigest('1.1.1.1')}`);
    expect(checkIpLimit('1.1.1.1').key).toBe(`check:ip:${rateDigest('1.1.1.1')}`);
    expect(emailRateValue(' A@B.com ', 'req-secret')).toBe(rateDigest('holler-request:email:a@b.com', 'req-secret'));
    expect(LIMITS.requestEmail(emailRateValue('a@b.com', 'req-secret')).key).not.toContain('a@b.com');
  });
});
