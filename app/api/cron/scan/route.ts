import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { runScan, SCAN_DEADLINE_MS } from '@/lib/signals/run';

// Cache Components is enabled, so route segment `dynamic` is not available; a handler that reads the request is always dynamic.
export const maxDuration = 60;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function authorized(req: NextRequest, secret: string): boolean {
  const header = req.headers.get('authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const key = req.nextUrl.searchParams.get('key') ?? '';
  return (bearer !== '' && safeEqual(bearer, secret)) || (key !== '' && safeEqual(key, secret));
}

export async function GET(req: NextRequest) {
  const secret = env.CRON_SECRET;
  // Fail closed: with no CRON_SECRET configured nobody can authenticate, so the answer is the same 401 (no config leak).
  if (!secret || !authorized(req, secret)) return Response.json({ error: 'unauthorized' }, { status: 401 });

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

  // Fetching is capped at 40 s per adapter; writes stop at SCAN_DEADLINE_MS so matching, run logs and the response finish inside maxDuration.
  const report = await runScan({ dry, source, deadlineMs: SCAN_DEADLINE_MS }, db);
  const status = report.error && report.sources.length === 0 ? (report.error.startsWith('unknown source') ? 400 : 500) : 200;
  return Response.json(report, { status, headers: { 'Cache-Control': 'no-store' } });
}
