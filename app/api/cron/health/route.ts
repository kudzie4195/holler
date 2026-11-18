import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { HEALTH_LOOKBACK_HOURS, planHealth, renderHealthEmail, sendEmail, type HealthCounts, type HealthRun } from '@/lib/email';
import { isCronAuthorized } from '@/lib/email/cron-auth';
import { missingEnvFor } from '@/lib/signals/run';
import { readAllPages } from '@/lib/signals/store';
import { readSourceHealth, summarizeSourceHealth } from '@/lib/signals/health';

export const maxDuration = 60;

type Admin = ReturnType<typeof createAdminClient>;

async function count(q: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number | null> {
  const { count: c, error } = await q;
  return error ? null : (c ?? 0);
}

async function loadCounts(admin: Admin, now: Date): Promise<HealthCounts> {
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  const head = { count: 'exact' as const, head: true };
  const [newSignups24h, activeSubscribers, trialing, usersEmailed24h] = await Promise.all([
    count(admin.from('holler_profiles').select('user_id', head).gte('created_at', dayAgo)),
    count(admin.from('holler_profiles').select('user_id', head).eq('subscription_status', 'active')),
    count(admin.from('holler_profiles').select('user_id', head).eq('subscription_status', 'trialing').gt('trial_ends_at', now.toISOString())),
    count(admin.from('holler_profiles').select('user_id', head).gte('last_notified_at', dayAgo)),
  ]);
  return { newSignups24h, activeSubscribers, trialing, usersEmailed24h };
}

/**
 * GET /api/cron/health (Authorization: Bearer CRON_SECRET, or ?key=). Builds the daily health report from
 * holler_scan_runs, returns it as JSON, and emails it to ADMIN_EMAIL (falling back to SUPPORT_EMAIL).
 * ?dry=1 builds and returns the report without sending anything.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req, env.CRON_SECRET)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const dry = ['1', 'true'].includes(new URL(req.url).searchParams.get('dry') ?? '');
  const now = new Date();

  let admin: Admin;
  try {
    admin = createAdminClient();
  } catch {
    return Response.json({ error: 'not_configured' }, { status: 503 });
  }

  let runs: HealthRun[];
  try {
    const since = new Date(now.getTime() - HEALTH_LOOKBACK_HOURS * 3_600_000).toISOString();
    runs = await readAllPages<HealthRun>(
      (from, to) =>
        admin
          .from('holler_scan_runs')
          .select('source, started_at, fetched, inserted, error')
          .gte('started_at', since)
          .order('started_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to),
      10,
    );
  } catch (e) {
    return Response.json({ error: 'scan_runs_read_failed', detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  const { ALL_ADAPTERS } = await import('@/lib/signals/registry');
  const adapters = ALL_ADAPTERS.map((a) => ({ id: a.id, label: a.label, kind: a.kind, cadenceMinutes: a.cadenceMinutes, missingEnv: missingEnvFor(a) }));
  const counts = await loadCounts(admin, now);
  const report = planHealth({ adapters, runs, counts, now });

  const to = env.ADMIN_EMAIL?.trim() || env.SUPPORT_EMAIL?.trim() || null;
  let email: { status: 'not_sent_dry' | 'no_recipient' | 'sent' | 'skipped' | 'failed'; to?: string; detail?: string };
  if (dry) email = { status: 'not_sent_dry' };
  else if (!to) email = { status: 'no_recipient', detail: 'Set ADMIN_EMAIL or SUPPORT_EMAIL to receive the health email.' };
  else {
    const mail = renderHealthEmail(report);
    const res = await sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text });
    if ('skipped' in res && res.skipped) email = { status: 'skipped', to, detail: res.reason };
    else if ('ok' in res && res.ok) email = { status: 'sent', to };
    else email = { status: 'failed', to, detail: 'error' in res ? res.error : 'send failed' };
  }

  // Per-source delivery health (holler_source_health). A read failure leaves this null and never changes the rest of the report.
  let sourceHealth: ReturnType<typeof summarizeSourceHealth> | null = null;
  try {
    sourceHealth = summarizeSourceHealth(await readSourceHealth(admin), now);
  } catch {
    sourceHealth = null;
  }

  return Response.json({ ...report, email, sourceHealth }, { headers: { 'Cache-Control': 'no-store' } });
}
