import { signScopedToken, verifyScopedToken } from '../email/token';

/**
 * One-click unsubscribe for the lifecycle emails. Its own token purpose, so the link in an alert email can never switch these off
 * and the link here can never switch alert emails off (and neither can be confused with the verify token). Signed with CRON_SECRET,
 * like the alert unsubscribe. Valid for about 13 months: the emails go out within the first 10 days of a trial, so no link in an
 * inbox needs to outlive that by much.
 */
export const LIFECYCLE_UNSUB_PURPOSE = 'lifecycle-unsub';
export const LIFECYCLE_UNSUB_TTL_SECONDS = 400 * 86_400;
export const LIFECYCLE_UNSUB_PATH = '/api/cron/lifecycle/unsubscribe';

export function signLifecycleUnsub(userId: string, secret: string, now: number = Date.now()): string {
  return signScopedToken(LIFECYCLE_UNSUB_PURPOSE, userId, secret, LIFECYCLE_UNSUB_TTL_SECONDS, now);
}

export function verifyLifecycleUnsub(token: string, secret: string, now: number = Date.now()): string | null {
  return verifyScopedToken(token, LIFECYCLE_UNSUB_PURPOSE, secret, now);
}

export function lifecycleUnsubUrl(siteUrl: string, userId: string, secret: string, now: number = Date.now()): string {
  return `${siteUrl.replace(/\/$/, '')}${LIFECYCLE_UNSUB_PATH}?t=${encodeURIComponent(signLifecycleUnsub(userId, secret, now))}`;
}
