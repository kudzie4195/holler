import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { isCronAuthorized } from '@/lib/email/cron-auth';
import { readSourceHealth, summarizeSourceHealth } from '@/lib/signals/health';
import { loadSourceStates } from '@/lib/signals/source-state-load';
import { summarizeSourceStates, type SourceStateResult } from '@/lib/signals/source-state';
import { probationOverview, type ProbationRow, type ProbationRunLite } from '@/lib/signals/probation';

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
    // Round 19 coverage: every source on probation with its last run and check (a schema mismatch is named here). Never fails the table.
    let probation: ProbationRow[] | null = null;
    try {
      const { ALL_ADAPTERS } = await import('@/lib/signals/registry');
      const { sourcePlaces } = await import('@/lib/admin/metros');
      const places = sourcePlaces();
      const ids = ALL_ADAPTERS.filter((a) => a.probation).map((a) => a.id);
      // The latest scan_runs rows of the probation sources (a row-cap note lives there). A failed read just leaves the notes out.
      let runs: ProbationRunLite[] = [];
      if (ids.length) {
        const { data, error } = await admin.from('holler_scan_runs').select('source, started_at, error').in('source', ids).order('started_at', { ascending: false }).limit(ids.length * 8);
        if (!error && Array.isArray(data)) runs = data as ProbationRunLite[];
      }
      probation = probationOverview(ALL_ADAPTERS, summary.sources, (id) => places.get(id) ?? null, runs);
    } catch {
      probation = null;
    }
    return Response.json({ ...summary, states, probation }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'source_health_read_failed' }, { status: 500 });
  }
}
