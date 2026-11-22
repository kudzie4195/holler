import { timingSafeEqual } from 'node:crypto';

function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Bearer CRON_SECRET header or ?key= query. False when the secret is unset. */
export function isCronAuthorized(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const header = req.headers.get('authorization');
  if (header?.startsWith('Bearer ') && safeEq(header.slice(7), secret)) return true;
  const key = new URL(req.url).searchParams.get('key');
  return key !== null && safeEq(key, secret);
}

/** Bearer CRON_SECRET header only. For owner screens a browser can open: a secret in a ?key= query lands in history and logs. */
export function isBearerAuthorized(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const header = req.headers.get('authorization');
  return Boolean(header?.startsWith('Bearer ') && safeEq(header.slice(7), secret));
}
