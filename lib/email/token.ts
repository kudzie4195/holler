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
