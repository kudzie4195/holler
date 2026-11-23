import { env } from '@/lib/env';
import { isCronAuthorized } from '@/lib/email/cron-auth';
import { runStageProbe, stageProbeSourceIds } from '@/lib/signals/stage-probe';

export const maxDuration = 30;

/**
 * GET /api/admin/stage-probe?source=socrata-sf-permits (Authorization: Bearer CRON_SECRET). Owner only, Bearer ONLY like
 * /api/admin/firecrawl-probe: a ?key= secret would land in browser history and logs, so it is refused (401), and so is every caller
 * without the secret. The dry check to run once before turning HOLLER_STAGE_UPDATES_ENABLED on: it runs the stage query for ONE source,
 * writes nothing (no database client is even created), and returns the row count, a few status texts and whether the portal accepted the
 * date column. One portal request, no paid API. Without ?source it lists the source ids that have a stage query (no call).
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req, env.CRON_SECRET)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
  const source = new URL(req.url).searchParams.get('source');
  if (!source) return Response.json({ error: 'source_required', knownSources: stageProbeSourceIds() }, { status: 400, headers });
  try {
    const result = await runStageProbe(source, fetch, new Date());
    return Response.json(result, { status: result.status === 'unknown_source' ? 400 : 200, headers });
  } catch {
    return Response.json({ error: 'probe_failed' }, { status: 500, headers });
  }
}
