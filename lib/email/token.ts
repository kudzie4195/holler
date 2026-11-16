import { createHmac, timingSafeEqual } from 'node:crypto';

const PURPOSE = 'unsub';

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(payload: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(payload).digest());
}

/** Token format: base64url(`${userId}.unsub`) + '.' + base64url(HMAC-SHA256). Does not expire (unsubscribe links must keep working). */
export function signUnsubscribeToken(userId: string, secret: string): string {
  if (!secret) throw new Error('missing secret');
  const payload = b64url(Buffer.from(`${userId}.${PURPOSE}`, 'utf8'));
  return `${payload}.${sign(payload, secret)}`;
}

/** Returns the user id when the token is authentic, otherwise null. */
export function verifyUnsubscribeToken(token: string, secret: string): string | null {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = sign(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    return null;
  }
  const suffix = `.${PURPOSE}`;
  if (!decoded.endsWith(suffix)) return null;
  const userId = decoded.slice(0, -suffix.length);
  return userId.length > 0 ? userId : null;
}

// ---------------------------------------------------------------------------
// Purpose-scoped, expiring tokens (email verification). Payload is `${purpose}:${userId}:${expiresAtMs}`,
// signed with HMAC-SHA256 under the same secret. A token for one purpose never verifies for another,
// and none of them can be confused with the unsubscribe token (whose payload is `${userId}.unsub`).
// ---------------------------------------------------------------------------

export const VERIFY_PURPOSE = 'verify';
export const VERIFY_TTL_SECONDS = 7 * 24 * 60 * 60;

export function signScopedToken(
  purpose: string,
  userId: string,
  secret: string,
  ttlSeconds: number,
  now: number = Date.now(),
): string {
  if (!secret) throw new Error('missing secret');
  if (purpose.includes(':') || userId.includes(':')) throw new Error('invalid token parts');
  const payload = b64url(Buffer.from(`${purpose}:${userId}:${now + ttlSeconds * 1000}`, 'utf8'));
  return `${payload}.${sign(payload, secret)}`;
}

/** Returns the user id when the token is authentic, unexpired and issued for `purpose`; otherwise null. */
export function verifyScopedToken(token: string, purpose: string, secret: string, now: number = Date.now()): string | null {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload, secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    return null;
  }
  const pieces = decoded.split(':');
  if (pieces.length !== 3) return null;
  const [p, userId, exp] = pieces;
  if (p !== purpose || !userId) return null;
  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
  return userId;
}

export function signVerifyToken(userId: string, secret: string, now: number = Date.now()): string {
  return signScopedToken(VERIFY_PURPOSE, userId, secret, VERIFY_TTL_SECONDS, now);
}

export function verifyVerifyToken(token: string, secret: string, now: number = Date.now()): string | null {
  return verifyScopedToken(token, VERIFY_PURPOSE, secret, now);
}
