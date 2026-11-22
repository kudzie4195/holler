import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { isCronAuthorized } from '@/lib/email/cron-auth';
import { readSourceHealth, summarizeSourceHealth } from '@/lib/signals/health';
import { loadSourceStates } from '@/lib/signals/source-state-load';
import { summarizeSourceStates, type SourceStateResult } from '@/lib/signals/source-state';

/**
 * GET /api/admin/sources (Authorization: Bearer CRON_SECRET; a ?key= query is refused). Internal: the per-source health table as JSON.
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
    const now = new Date();
    const summary = summarizeSourceHealth(await readSourceHealth(admin), now);
    // Source states (lib/signals/source-state.ts), per source and counted. A failure here leaves `states` null and the table intact.
    let states: { counts: ReturnType<typeof summarizeSourceStates>['counts']; behind: number; sources: SourceStateResult[] } | null = null;
    try {
      const all = await loadSourceStates(admin, now);
      const sum = summarizeSourceStates(all);
      states = { counts: sum.counts, behind: sum.behind, sources: all };
    } catch {
      states = null;
    }
    return Response.json({ ...summary, states }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'source_health_read_failed' }, { status: 500 });
  }
}
