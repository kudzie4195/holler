import { signScopedToken, verifyScopedToken } from '@/lib/email/token';

/**
 * Proof that this browser just opened a password-reset link (security pass r16 SEC-4).
 *
 * POST /api/auth/reset changes the password of whoever is signed in, without the old password. Before SEC-4 any signed-in session
 * could do that, so a stolen or borrowed session (a shared computer, a session cookie read by malware) could lock the owner out for
 * good. Now the route also needs one of:
 *  - the holler_recovery cookie: set by POST /auth/confirm right after Supabase accepts a recovery token, HMAC-signed for that user
 *    (purpose 'recovery', so no other Holler token verifies as one), HttpOnly, SameSite=Strict, scoped to /api/auth/reset, 15 minutes;
 *  - or a session whose own amr claim says it was created by a recovery link in the last 15 minutes (Supabase records the sign-in
 *    method; this keeps resets working if CRON_SECRET, the signing key, is missing).
 * The cookie is cleared after a successful reset.
 */
export const RECOVERY_COOKIE = 'holler_recovery';
export const RECOVERY_PURPOSE = 'recovery';
export const RECOVERY_TTL_SECONDS = 15 * 60;
export const RECOVERY_COOKIE_PATH = '/api/auth/reset';

export function signRecoveryProof(userId: string, secret: string, now: number = Date.now()): string {
  return signScopedToken(RECOVERY_PURPOSE, userId, secret, RECOVERY_TTL_SECONDS, now);
}

/** True when the cookie value is a live recovery proof for exactly this user. */
export function recoveryProofValid(value: string | null | undefined, userId: string, secret: string | undefined, now: number = Date.now()): boolean {
  if (!value || !secret || !userId) return false;
  return verifyScopedToken(value, RECOVERY_PURPOSE, secret, now) === userId;
}

interface AmrEntry {
  method?: unknown;
  timestamp?: unknown;
}

/** True when the session's amr claim has a 'recovery' sign-in from the last RECOVERY_TTL_SECONDS. */
export function amrHasRecentRecovery(amr: unknown, now: number = Date.now()): boolean {
  if (!Array.isArray(amr)) return false;
  return amr.some((e: AmrEntry) => {
    if (!e || e.method !== 'recovery' || typeof e.timestamp !== 'number') return false;
    const ageMs = now - e.timestamp * 1000;
    return ageMs >= -60_000 && ageMs <= RECOVERY_TTL_SECONDS * 1000;
  });
}

/** The value of one cookie from a Cookie request header. */
export function cookieFromHeader(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function recoveryCookieOptions(nodeEnv: string | undefined = process.env.NODE_ENV) {
  return {
    httpOnly: true,
    secure: nodeEnv === 'production',
    sameSite: 'strict' as const,
    path: RECOVERY_COOKIE_PATH,
    maxAge: RECOVERY_TTL_SECONDS,
  };
}
