import type { NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { isCronAuthorized } from '@/lib/email/cron-auth';
import { runScan, SCAN_DEADLINE_MS } from '@/lib/signals/run';
import { runRequestPurge } from '@/lib/requests/purge-run';

// Cache Components is enabled, so route segment `dynamic` is not available; a handler that reads the request is always dynamic.
export const maxDuration = 60;


export async function GET(req: NextRequest) {
  const secret = env.CRON_SECRET;
  // Fail closed: with no CRON_SECRET configured nobody can authenticate, so the answer is the same 401 (no config leak).
  if (!secret || !isCronAuthorized(req, secret)) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const dry = params.get('dry') === '1' || params.get('dry') === 'true';
  const source = params.get('source') || undefined;

  let db = null;
  if (!dry) {
    if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      return Response.json({ error: 'Supabase env (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) is not configured' }, { status: 500 });
    }
    const { createAdminClient } = await import('@/lib/supabase/admin');
    db = createAdminClient();
  }

  // Resident-request housekeeping BEFORE the scan (never on a dry run): deletes the public record of ended requests, wipes old
  // emails and descriptions, drops stale unconfirmed rows. It is bounded (PURGE_BUDGET_MS), reports its own errors and can never fail
  // or change the scan's answer. Running it first means a slow scan cannot starve it (review P1-5).
  const purgeStart = Date.now();
  const requests = db ? await runRequestPurge(db) : null;
  const purgeMs = Date.now() - purgeStart;

  // Fetching is capped at 40 s per adapter; writes stop at the deadline so matching, run logs and the response finish inside
  // maxDuration. The time the purge used comes off the scan's budget.
  const deadlineMs = Math.max(20_000, SCAN_DEADLINE_MS - purgeMs);
  const report = await runScan({ dry, source, deadlineMs }, db);
  const status = report.error && report.sources.length === 0 ? (report.error.startsWith('unknown source') ? 400 : 500) : 200;
  return Response.json({ ...report, requests }, { status, headers: { 'Cache-Control': 'no-store' } });
}
