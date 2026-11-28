import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { isBearerAuthorized } from '@/lib/email/cron-auth';
import { loadKeywordVolumeReport } from '@/lib/admin/keyword-volume';
import { LOCATION_METROS, LOCATION_TRADES } from '@/lib/dataforseo/location-volume';

export const maxDuration = 60;

/**
 * GET /api/admin/keyword-volume (Authorization: Bearer CRON_SECRET). Owner only, round 35: for each marketed trade, the cities with the most
 * Google searches a month (suburbs of Atlanta, Austin, Charlotte and Raleigh, plus each core city) and the 12 month trend, for deciding where
 * to market or expand. Bearer only like every admin route: a ?key= query is refused (401). No public page, nothing linked, noindex.
 *   ?trade=landscaping|lawn-care|gutters|pressure-washing   one trade
 *   ?metro=atlanta|austin|charlotte|raleigh                 one metro
 *   ?limit=1..50                                            cities per trade (default 10)
 * Read only: selects holler_keyword_volume through the service-role client. Counts and city names only; no database error text is returned.
 * Empty (every trade with no cities) until HOLLER_KEYWORD_VOLUME_ENABLED has been on for one monthly run.
 */
export async function GET(req: Request) {
  if (!isBearerAuthorized(req, env.CRON_SECRET)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
  const q = new URL(req.url).searchParams;
  const trade = q.get('trade') ?? undefined;
  const metro = q.get('metro') ?? undefined;
  if (trade && !LOCATION_TRADES.some((t) => t.id === trade)) return Response.json({ error: 'unknown_trade', trades: LOCATION_TRADES.map((t) => t.id) }, { status: 400, headers });
  if (metro && !LOCATION_METROS.some((m) => m.id === metro)) return Response.json({ error: 'unknown_metro', metros: LOCATION_METROS.map((m) => m.id) }, { status: 400, headers });
  const rawLimit = q.get('limit');
  const limit = rawLimit === null ? 10 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return Response.json({ error: 'bad_limit', min: 1, max: 50 }, { status: 400, headers });

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return Response.json({ error: 'not_configured' }, { status: 503, headers });
  }
  try {
    return Response.json(await loadKeywordVolumeReport(admin, new Date(), { limit, trade, metro }), { headers });
  } catch {
    return Response.json({ error: 'keyword_volume_read_failed' }, { status: 500, headers });
  }
}
