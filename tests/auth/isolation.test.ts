// Fixtures: hand-written (assumed). Covers the pure pieces of the shared-project isolation work (P1-3, P1-4, P1-6).
import { describe, expect, it } from 'vitest';
import { hasHollerTag, hasLeftHoller, leaveHollerPatch, productsOf, rejoinHollerPatch, withHoller, withoutHoller } from '../../lib/auth/membership';
import { clientIp, LIMITS, rateKey } from '../../lib/auth/limits';
import { signScopedToken, signUnsubscribeToken, signVerifyToken, verifyScopedToken, verifyUnsubscribeToken, verifyVerifyToken } from '../../lib/email/token';
import { alreadySubscribed, hollerMetadata, isHollerMetadata, trialParams } from '../../lib/stripe/scope';

describe('membership (app_metadata.products)', () => {
  it('detects the holler tag', () => {
    expect(hasHollerTag({ products: ['holler'] })).toBe(true);
    expect(hasHollerTag({ products: ['clovermap', 'holler'] })).toBe(true);
    expect(hasHollerTag({ products: ['clovermap'] })).toBe(false);
    expect(hasHollerTag({})).toBe(false);
    expect(hasHollerTag(undefined)).toBe(false);
    expect(hasHollerTag({ products: 'holler' })).toBe(false);
  });
  it('leaving Holler never deletes the shared user: it only strips the tag and stamps holler_left_at', () => {
    const now = new Date('2026-11-16T12:00:00Z');
    expect(leaveHollerPatch({ products: ['holler'] }, now)).toEqual({
      products: [],
      holler_email_verified_at: null,
      holler_left_at: '2026-11-16T12:00:00.000Z',
    });
    expect(leaveHollerPatch({ products: ['clovermap', 'holler'] }, now).products).toEqual(['clovermap']);
    expect(leaveHollerPatch({}, now).products).toEqual([]);
  });
  it('lets a former member back in and re-tags them', () => {
    expect(hasLeftHoller({ products: [], holler_left_at: '2026-11-16T12:00:00.000Z' })).toBe(true);
    expect(hasLeftHoller({ products: ['clovermap'] })).toBe(false);
    expect(hasLeftHoller({ holler_left_at: null })).toBe(false);
    expect(hasLeftHoller(undefined)).toBe(false);
    expect(rejoinHollerPatch({ products: ['clovermap'], holler_left_at: 'x' })).toEqual({ products: ['clovermap', 'holler'], holler_left_at: null });
    expect(withHoller({ products: ['holler'] })).toEqual(['holler']);
  });
  it('removes only holler', () => {
    expect(withoutHoller({ products: ['holler', 'clovermap'] })).toEqual(['clovermap']);
    expect(withoutHoller({})).toEqual([]);
    expect(productsOf({ products: ['a', 1, null] })).toEqual(['a']);
  });
});

describe('rate limit keys and ip', () => {
  it('reads the first x-forwarded-for entry, then x-real-ip', () => {
    expect(clientIp(new Request('https://x', { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } }))).toBe('203.0.113.9');
    expect(clientIp(new Request('https://x', { headers: { 'x-real-ip': '198.51.100.2' } }))).toBe('198.51.100.2');
    expect(clientIp(new Request('https://x'))).toBe('unknown');
  });
  it('hashes and normalizes keys, and uses the specified budgets', () => {
    expect(rateKey('signup', 'email', 'A@B.com')).toBe(rateKey('signup', 'email', 'a@b.com'));
    expect(rateKey('signup', 'email', 'a@b.com')).not.toContain('a@b.com');
    expect(LIMITS.signupIp('1.1.1.1')).toMatchObject({ max: 5, windowSeconds: 3600 });
    expect(LIMITS.signupEmail('a@b.com')).toMatchObject({ max: 3, windowSeconds: 86400 });
    expect(LIMITS.forgotEmail('a@b.com')).toMatchObject({ max: 3, windowSeconds: 3600 });
    expect(LIMITS.forgotIp('1.1.1.1')).toMatchObject({ max: 10, windowSeconds: 3600 });
    expect(LIMITS.loginIp('1.1.1.1')).toMatchObject({ max: 20, windowSeconds: 900 });
    expect(LIMITS.draftUser('u1')).toMatchObject({ max: 20, windowSeconds: 3600 });
    expect(LIMITS.draftUser('u1').key).not.toContain('u1');
  });
});

describe('verify token', () => {
  const S = 'secret';
  const UID = '3f2c9d1e-0000-4000-8000-123456789abc';
  const now = 1_800_000_000_000;
  it('round-trips and expires after 7 days', () => {
    const t = signVerifyToken(UID, S, now);
    expect(verifyVerifyToken(t, S, now + 1000)).toBe(UID);
    expect(verifyVerifyToken(t, S, now + 7 * 86_400_000 - 1)).toBe(UID);
    expect(verifyVerifyToken(t, S, now + 7 * 86_400_000 + 1)).toBeNull();
  });
  it('rejects wrong secret, tampering and garbage', () => {
    const t = signVerifyToken(UID, S, now);
    const [p, sig] = t.split('.');
    expect(verifyVerifyToken(t, 'other', now)).toBeNull();
    expect(verifyVerifyToken(`${p}.${sig.slice(0, -2)}AA`, S, now)).toBeNull();
    expect(verifyVerifyToken(`${signVerifyToken('someone-else', S, now).split('.')[0]}.${sig}`, S, now)).toBeNull();
    expect(verifyVerifyToken('nope', S, now)).toBeNull();
    expect(verifyVerifyToken('', S, now)).toBeNull();
  });
  it('is purpose-scoped and cannot cross with the unsubscribe token', () => {
    const verify = signVerifyToken(UID, S, now);
    const unsub = signUnsubscribeToken(UID, S);
    const other = signScopedToken('reset', UID, S, 3600, now);
    expect(verifyUnsubscribeToken(verify, S)).toBeNull();
    expect(verifyVerifyToken(unsub, S, now)).toBeNull();
    expect(verifyVerifyToken(other, S, now)).toBeNull();
    expect(verifyScopedToken(other, 'reset', S, now)).toBe(UID);
  });
});

describe('stripe scoping', () => {
  it('tags and recognizes holler objects', () => {
    expect(hollerMetadata('u1')).toEqual({ app: 'holler', user_id: 'u1' });
    expect(isHollerMetadata({ app: 'holler', user_id: 'u1' })).toBe(true);
    expect(isHollerMetadata({ app: 'clovermap', user_id: 'u1' })).toBe(false);
    expect(isHollerMetadata({ user_id: 'u1' })).toBe(false);
    expect(isHollerMetadata(null)).toBe(false);
    expect(isHollerMetadata(undefined)).toBe(false);
  });
  it('blocks a second checkout for people who already pay', () => {
    expect(alreadySubscribed('active')).toBe(true);
    expect(alreadySubscribed('past_due')).toBe(true);
    expect(alreadySubscribed('trialing')).toBe(false);
    expect(alreadySubscribed('canceled')).toBe(false);
  });
  it('never charges inside the free trial', () => {
    const now = Date.parse('2026-06-01T12:00:00Z');
    const day = 86_400_000;
    // 5 days left: exact timestamp
    expect(trialParams(new Date(now + 5 * day).toISOString(), now)).toEqual({ trial_end: Math.ceil((now + 5 * day) / 1000) });
    // exactly 48h left: below the 48h + 5 min safety margin, so whole days are used
    expect(trialParams(new Date(now + 2 * day).toISOString(), now)).toEqual({ trial_period_days: 2 });
    // 30h left: Checkout rejects trial_end, use 2 whole days (rounded up)
    expect(trialParams(new Date(now + 30 * 3_600_000).toISOString(), now)).toEqual({ trial_period_days: 2 });
    // 3h left: minimum 1 day
    expect(trialParams(new Date(now + 3 * 3_600_000).toISOString(), now)).toEqual({ trial_period_days: 1 });
    // over, missing or garbage: charge now
    expect(trialParams(new Date(now - 1000).toISOString(), now)).toEqual({});
    expect(trialParams(null, now)).toEqual({});
    expect(trialParams('garbage', now)).toEqual({});
  });
  it('trial_end is always at least 48h out when used', () => {
    const now = Date.parse('2026-06-01T12:00:00Z');
    for (const hours of [48.1, 49, 72, 200, 24 * 14]) {
      const p = trialParams(new Date(now + hours * 3_600_000).toISOString(), now) as { trial_end?: number };
      expect(p.trial_end).toBeDefined();
      expect(p.trial_end! * 1000 - now).toBeGreaterThanOrEqual(48 * 3_600_000);
    }
  });
});
