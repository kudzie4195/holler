import { signScopedToken, verifyScopedToken } from '@/lib/email/token';

/**
 * Signed, expiring links for the follow-up email. The token binds ONE member, ONE alert and ONE answer, and is a different purpose
 * from the unsubscribe and verify tokens, so none of those can be used here and this one cannot be used for them.
 */
export const OUTCOME_PURPOSE = 'outcome';
export const OUTCOME_TTL_SECONDS = 30 * 24 * 60 * 60;
export type OutcomeAnswer = 'yes' | 'no';

export function signOutcomeToken(userId: string, signalId: number, answer: OutcomeAnswer, secret: string, now: number = Date.now()): string {
  if (!Number.isSafeInteger(signalId) || signalId <= 0) throw new Error('invalid signal');
  if (userId.includes('|')) throw new Error('invalid user');
  return signScopedToken(OUTCOME_PURPOSE, `${userId}|${signalId}|${answer}`, secret, OUTCOME_TTL_SECONDS, now);
}

export function verifyOutcomeToken(
  token: string,
  secret: string,
  now: number = Date.now(),
): { userId: string; signalId: number; answer: OutcomeAnswer } | null {
  const v = verifyScopedToken(token, OUTCOME_PURPOSE, secret, now);
  if (!v) return null;
  const parts = v.split('|');
  if (parts.length !== 3) return null;
  const [userId, sid, answer] = parts;
  const signalId = Number(sid);
  if (!userId || !Number.isSafeInteger(signalId) || signalId <= 0) return null;
  if (answer !== 'yes' && answer !== 'no') return null;
  return { userId, signalId, answer };
}
