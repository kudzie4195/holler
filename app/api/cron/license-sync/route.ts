import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { isCronAuthorized } from '@/lib/email/cron-auth';
import { licenseSyncEnabled } from '@/lib/licenses/switch';
import { LICENSE_SOURCES } from '@/lib/licenses/sources';
import { runLicenseSync } from '@/lib/licenses/sync';

export const maxDuration = 60;

/**
 * GET /api/cron/license-sync?state=FL[&offset=N] (Authorization: Bearer CRON_SECRET only). Round 20 (LIC): loads one state's contractor
 * license file into holler_contractor_licenses (migration 0036), company licensees only. It runs only when HOLLER_LICENSE_SYNC_ENABLED is
 * set AND the state's source is promoted in lib/licenses/sources.ts (review LIC P2-4); otherwise { status: "disabled" } or
 * { status: "not_promoted" } and nothing is fetched or written. Each call reads at most 20,000 rows from `offset` (25 s read limit, 45 s in
 * all); the answer gives `done` and `nextOffset` (only written rows count), or `no_progress`. A person-licensee row is dropped before
 * anything is written.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req, env.CRON_SECRET)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const headers = { 'Cache-Control': 'no-store' };
  const url = new URL(req.url);
  const state = url.searchParams.get('state');
  if (!state) return Response.json({ error: 'state_required', knownStates: LICENSE_SOURCES.map((s) => s.state) }, { status: 400, headers });
  if (!licenseSyncEnabled()) return Response.json({ state: state.toUpperCase(), status: 'disabled' }, { headers });
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return Response.json({ error: 'not_configured' }, { status: 503, headers });
  }
  const offset = Number(url.searchParams.get('offset') ?? '0');
  try {
    const result = await runLicenseSync({
      db: admin,
      state,
      fetch,
      enabled: true,
      offset: Number.isFinite(offset) ? offset : 0,
      deadline: Date.now() + 45_000,
      socrataToken: env.SOCRATA_APP_TOKEN,
    });
    return Response.json(result, { status: result.status === 'unknown_state' ? 400 : 200, headers });
  } catch {
    return Response.json({ error: 'license_sync_failed' }, { status: 500, headers });
  }
}
