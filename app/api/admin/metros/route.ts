import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { isBearerAuthorized } from '@/lib/email/cron-auth';
import { loadMetroReport } from '@/lib/admin/metros-load';
import { renderMetrosHtml } from '@/lib/admin/metros-html';

export const maxDuration = 60;

/**
 * GET /api/admin/metros (Authorization: Bearer CRON_SECRET). Owner only: the per-metro scorecard (round 19, lib/admin/metros.ts). Bearer
 * only like every cron and admin route: a ?key= query is refused (401), so the secret never lands in a URL. No public page, and no member
 * can reach it. Anyone without the secret gets 401 and nothing else.
 *   (default)       JSON report.
 *   ?format=html    one self-contained page (no script), noindex.
 * Read only: selects through the service-role client on the server. The response carries counts, shares, source ids and states, and no
 * member, email, name, phone, address or record text. A failed section is blank, never zero, and no database error text is returned.
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
    const report = await loadMetroReport(admin, new Date());
    if (new URL(req.url).searchParams.get('format') === 'html') {
      return new Response(renderMetrosHtml(report), { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
    }
    return Response.json(report, { headers });
  } catch {
    return Response.json({ error: 'metros_read_failed' }, { status: 500, headers });
  }
}
