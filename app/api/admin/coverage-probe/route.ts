import { env } from '@/lib/env';
import { isCronAuthorized } from '@/lib/email/cron-auth';
import { coverageProbeSourceIds, runCoverageProbe } from '@/lib/signals/coverage-probe';

export const maxDuration = 60;

/**
 * GET /api/admin/coverage-probe?source=arcgis-tempe-permits (Authorization: Bearer CRON_SECRET). Owner only, Bearer ONLY like
 * /api/admin/stage-probe: a ?key= secret would land in browser history and logs, so it is refused (401), and so is every caller without
 * the secret. Round 19 coverage: the schema check of ONE source on probation before it is promoted. It reads the source's column list,
 * the row count of the scan's window and its 5 newest rows (at most four portal requests of 10 s, no paid API, no database client) and
 * returns the HTTP status, the row count, the column names present, the expected columns that are missing, the newest date and whether it
 * is inside the window, whether the window holds more rows than the scan's row cap, and the mapped result of up to 3 rows with person-like
 * names removed (lib/signals/coverage-probe.ts). Without ?source it lists the probation source ids (no call).
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req, env.CRON_SECRET)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
  const source = new URL(req.url).searchParams.get('source');
  if (!source) return Response.json({ error: 'source_required', knownSources: coverageProbeSourceIds() }, { status: 400, headers });
  try {
    const result = await runCoverageProbe(source, fetch);
    return Response.json(result, { status: result.status === 'unknown_source' ? 400 : 200, headers });
  } catch {
    return Response.json({ error: 'probe_failed' }, { status: 500, headers });
  }
}
