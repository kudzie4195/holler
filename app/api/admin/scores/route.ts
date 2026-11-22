import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { isCronAuthorized } from '@/lib/email/cron-auth';
import { buildScoreReport } from '@/lib/signals/score-admin';

/**
 * GET /api/admin/scores?days=14&limit=200 (Authorization: Bearer CRON_SECRET; a ?key= query is refused). Internal: the deterministic score v1
 * (PLAN-2.0 item 2.7, lib/signals/score.ts) of recent matches, label first then score, with its five parts. The score is shown here
 * and nowhere a member can see. Same secret check as /api/admin/sources; anonymous callers get 401. No user id or contact is returned.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req, env.CRON_SECRET)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return Response.json({ error: 'not_configured' }, { status: 503 });
  }
  const q = new URL(req.url).searchParams;
  try {
    const report = await buildScoreReport(admin, new Date(), { days: Number(q.get('days') ?? 14), limit: Number(q.get('limit') ?? 200) });
    return Response.json(report, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'score_report_failed' }, { status: 500 });
  }
}
