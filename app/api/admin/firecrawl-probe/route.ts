import { env } from '@/lib/env';
import { isCronAuthorized } from '@/lib/email/cron-auth';
import { runProbe } from '@/lib/firecrawl/probe';

export const maxDuration = 60;

/**
 * GET /api/admin/firecrawl-probe?source=bids-gwinnett (Authorization: Bearer CRON_SECRET). Owner only, Bearer ONLY like /api/admin/quality:
 * a ?key= secret would land in browser history and logs, so it is refused (401), and so is every caller without the secret.
 * A dry run of ONE agency source (lib/firecrawl/probe.ts): reads the page with Firecrawl (about 5 credits), returns the validated rows,
 * the dropped rows with the reason for each, and the credits used. Writes no signal; books its credits as one `_fc:probe:<id>` ledger row in holler_scan_runs. Without ?source it lists the known source ids (no call).
 * The response carries row titles and public links only: never the key, never a Firecrawl response body.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req, env.CRON_SECRET)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
  const source = new URL(req.url).searchParams.get('source');
  if (!source) {
    const { LOCAL_BID_SOURCE_IDS } = await import('@/lib/firecrawl/local-sources');
    const { PAGE_WATCH_DATASETS } = await import('@/lib/signals/adapters/page-watch-datasets');
    const pageWatch = PAGE_WATCH_DATASETS.filter((d) => d.verified && d.firecrawl !== 'off').map((d) => d.id);
    return Response.json({ error: 'source_required', knownSources: [...LOCAL_BID_SOURCE_IDS, ...pageWatch] }, { status: 400, headers });
  }
  let db = null;
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    db = createAdminClient(); // read only: the credit ledger, so the caps apply to a probe too
  } catch {
    db = null;
  }
  try {
    const result = await runProbe({ source, env: { ...process.env, ...env }, now: new Date(), fetch, db });
    const status = result.status === 'unknown_source' ? 400 : result.status === 'no_key' ? 503 : 200;
    return Response.json(result, { status, headers });
  } catch {
    return Response.json({ error: 'probe_failed' }, { status: 500, headers });
  }
}
