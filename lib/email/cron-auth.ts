import { timingSafeEqual } from 'node:crypto';

function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Bearer CRON_SECRET header ONLY (security pass r16, review P2-1). False when the secret is unset.
 * A `?key=` query is refused even with the right value: CRON_SECRET is also the HMAC key for every emailed Holler token (verify,
 * unsubscribe, outcome, request confirm/close, the recovery proof), and a secret in a URL lands in request logs and browser history.
 * Every scheduler sends the header: supabase/cron.sql (pg_net, `Authorization: Bearer <vault secret>`), and Vercel Cron, which sends
 * CRON_SECRET as `Authorization: Bearer <value>` (https://vercel.com/docs/schedules/cron-jobs/manage-cron-jobs, "Securing cron jobs").
 */
export function isCronAuthorized(req: Request, secret: string | undefined): boolean {
  return isBearerAuthorized(req, secret);
}

/** Bearer CRON_SECRET header only. */
export function isBearerAuthorized(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const header = req.headers.get('authorization');
  return Boolean(header?.startsWith('Bearer ') && safeEq(header.slice(7), secret));
}
