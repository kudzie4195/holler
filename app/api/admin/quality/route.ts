import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { isBearerAuthorized } from '@/lib/email/cron-auth';
import { loadQualityReport } from '@/lib/admin/quality-load';
import { renderQualityHtml } from '@/lib/admin/quality-html';

export const maxDuration = 60;

/**
 * GET /api/admin/quality (Authorization: Bearer CRON_SECRET). Owner only: the alert-quality dashboard (PLAN-2.0 item 3.4).
 * The same secret as /api/admin/sources and /api/cron/health, Bearer only like every cron and admin route: a secret in a ?key= query
 * would land in browser history and server logs, so ?key= is refused (401). There is no public
 * page and no member can reach it. Anyone without the secret gets 401 and nothing else.
 *   (default)       JSON report.
 *   ?format=html    one self-contained page (no script), noindex.
 * Read only: selects through the service-role client on the server. The response carries counts, shares and hours per trade and no
 * member, email or record text. A failed section is blank, never zero, and no database error text is returned.
 */
export async function GET(req: Request) {
  if (!isBearerAuthorized(req, env.CRON_SECRET)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return Response.json({ error: 'not_configured' }, { status: 503 });
  }
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
  try {
    const report = await loadQualityReport(admin, new Date());
    if (new URL(req.url).searchParams.get('format') === 'html') {
      return new Response(renderQualityHtml(report), { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
    }
    return Response.json(report, { headers });
  } catch {
    return Response.json({ error: 'quality_read_failed' }, { status: 500, headers });
  }
}
