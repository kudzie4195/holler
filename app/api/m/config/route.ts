import { siteUrl, env } from '@/lib/env';
import { configBody } from '@/lib/mobile/config';
import { ok, preflight } from '@/lib/mobile/http';

const METHODS = 'GET';

export function OPTIONS(req: Request) {
  return preflight(req, METHODS);
}

/** GET /api/m/config (public): prices, trial days, entitlements, trades, links and the minimum app version. */
export async function GET(req: Request) {
  return ok(req, METHODS, configBody(siteUrl, env.SUPPORT_EMAIL ?? null), { cache: 'public, max-age=300' });
}
