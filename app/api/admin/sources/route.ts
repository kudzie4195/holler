import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { isCronAuthorized } from '@/lib/email/cron-auth';
import { readSourceHealth, summarizeSourceHealth } from '@/lib/signals/health';

/**
 * GET /api/admin/sources (Authorization: Bearer CRON_SECRET, or ?key=). Internal: the per-source health table as JSON.
 * Same secret check as /api/cron/health. There is no public page for this.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req, env.CRON_SECRET)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return Response.json({ error: 'not_configured' }, { status: 503 });
  }
  try {
    const summary = summarizeSourceHealth(await readSourceHealth(admin), new Date());
    return Response.json(summary, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'source_health_read_failed' }, { status: 500 });
  }
}
