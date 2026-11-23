import { env } from '@/lib/env';
import { isCronAuthorized } from '@/lib/email/cron-auth';
import { LICENSE_SOURCES } from '@/lib/licenses/sources';
import { runLicenseProbe } from '@/lib/licenses/sync';

export const maxDuration = 60;

/**
 * GET /api/admin/license-probe?state=FL (Authorization: Bearer CRON_SECRET). Owner only, Bearer ONLY (a ?key= secret is refused, 401).
 * Round 20 (LIC): the schema check of ONE state's contractor license file before its sync is trusted. It reads a sample of at most 500
 * rows (one file or up to one Socrata page request, no paid API, no database client, writes nothing) and returns the HTTP status, the
 * column names present, the expected columns that are missing, the sample's row count, and how many rows would be KEPT as companies (with
 * the drop reasons as counts). No name, number, phone or address from the file is returned. Without ?state it lists the states.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req, env.CRON_SECRET)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
  const state = new URL(req.url).searchParams.get('state');
  if (!state) return Response.json({ error: 'state_required', knownStates: LICENSE_SOURCES.map((s) => s.state) }, { status: 400, headers });
  try {
    const result = await runLicenseProbe(state, fetch, env.SOCRATA_APP_TOKEN);
    return Response.json(result, { status: result.status === 'unknown_state' ? 400 : 200, headers });
  } catch {
    return Response.json({ error: 'probe_failed' }, { status: 500, headers });
  }
}
