import { describe, expect, it } from 'vitest';
import { signOutcomeToken, verifyOutcomeToken, OUTCOME_TTL_SECONDS } from '@/lib/moat/token';
import { signUnsubscribeToken, signVerifyToken, verifyUnsubscribeToken, verifyVerifyToken } from '@/lib/email/token';

const S = 'secret-one';
const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
const NOW = 1_800_000_000_000;

function tamper(token: string, from: string, to: string): string {
  const [payload, sig] = token.split('.');
  const dec = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8').replace(from, to);
  return `${Buffer.from(dec).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.${sig}`;
}

describe('outcome tokens', () => {
  it('round trip', () => {
    expect(verifyOutcomeToken(signOutcomeToken(U1, 42, 'yes', S, NOW), S, NOW + 1000)).toEqual({ userId: U1, signalId: 42, answer: 'yes' });
  });
  it('cannot be replayed for another member, another signal or the other answer', () => {
    const t = signOutcomeToken(U1, 42, 'yes', S, NOW);
    expect(verifyOutcomeToken(tamper(t, U1, U2), S, NOW)).toBeNull();
    expect(verifyOutcomeToken(tamper(t, '|42|', '|43|'), S, NOW)).toBeNull();
    expect(verifyOutcomeToken(tamper(t, '|yes', '|no'), S, NOW)).toBeNull();
    // Each token only ever names its own member, signal and answer.
    expect(verifyOutcomeToken(signOutcomeToken(U2, 42, 'yes', S, NOW), S, NOW)?.userId).toBe(U2);
  });
  it('expires and needs the right secret', () => {
    const t = signOutcomeToken(U1, 42, 'no', S, NOW);
    expect(verifyOutcomeToken(t, S, NOW + OUTCOME_TTL_SECONDS * 1000 + 1)).toBeNull();
    expect(verifyOutcomeToken(t, 'other', NOW)).toBeNull();
    expect(verifyOutcomeToken('', S)).toBeNull();
    expect(verifyOutcomeToken('a.b.c', S)).toBeNull();
  });
  it('is not interchangeable with the unsubscribe or verify tokens', () => {
    expect(verifyOutcomeToken(signUnsubscribeToken(U1, S), S, NOW)).toBeNull();
    expect(verifyOutcomeToken(signVerifyToken(U1, S, NOW), S, NOW)).toBeNull();
    const o = signOutcomeToken(U1, 42, 'yes', S, NOW);
    expect(verifyUnsubscribeToken(o, S)).toBeNull();
    expect(verifyVerifyToken(o, S, NOW)).toBeNull();
  });
  it('refuses to sign a bad signal id', () => {
    expect(() => signOutcomeToken(U1, 0, 'yes', S)).toThrow();
    expect(() => signOutcomeToken(U1, 1.5, 'yes', S)).toThrow();
  });
});
