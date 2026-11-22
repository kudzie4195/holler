import { createAdminClient } from '@/lib/supabase/admin';
import { env, siteUrl } from '@/lib/env';
import { HEALTH_LOOKBACK_HOURS, planHealth, renderHealthEmail, sendEmail, type HealthCounts, type HealthRun } from '@/lib/email';
import { isCronAuthorized } from '@/lib/email/cron-auth';
import { missingEnvFor } from '@/lib/signals/run';
import { readAllPages } from '@/lib/signals/store';
import { readSourceHealth, summarizeSourceHealth, type SourceHealthRow } from '@/lib/signals/health';
import { computeSourceStates, summarizeSourceStates, type SourceStateSummary } from '@/lib/signals/source-state';
import { readStateRuns, withProbationSetup } from '@/lib/signals/source-state-load';
import { runMonitor, type MonitorResult } from '@/lib/monitor/run';

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
 * Ingest monitor: scan error or stall, whole-feed silence, silent or failing sources, with one deduped email. It never throws:
 * a failure comes back as { status: 'error' } and the health report is unaffected.
 */
/**
 * Sources that are on right now: in the registry, with every env key they need. The monitor judges only these. A probation source
 * with the samples table missing is skipped by the scan, so it is not on (review defect 7).
 */
async function enabledSources(admin: Admin): Promise<Set<string>> {
  const { ALL_ADAPTERS } = await import('@/lib/signals/registry');
  const list = await withProbationSetup(admin, ALL_ADAPTERS.map((a) => ({ id: a.id, probation: !!a.probation, missingEnv: missingEnvFor(a) })));
  return new Set(list.filter((a) => a.missingEnv.length === 0).map((a) => a.id));
}

async function monitor(admin: Admin, now: Date, dry: boolean, to: string | null): Promise<MonitorResult> {
  try {
    return await runMonitor({
      db: admin,
      now,
      dry,
      to,
      enabledSources: await enabledSources(admin),
      sourcesUrl: `${siteUrl}/api/admin/sources`,
      send: async (mail) => {
        const res = await sendEmail(mail);
        if ('skipped' in res && res.skipped) return { ok: false, skipped: true, error: res.reason };
        if ('ok' in res && res.ok) return { ok: true };
        return { ok: false, error: 'error' in res ? res.error : 'send failed' };
      },
    });
  } catch {
    return { status: 'error', note: 'monitor failed', checkedAt: now.toISOString(), conditions: [], recovered: [], email: { status: 'not_checked' }, unread: [] };
  }
}

/**
 * GET /api/cron/health (Authorization: Bearer CRON_SECRET only). Builds the daily health report from
 * holler_scan_runs, returns it as JSON, and emails it to ADMIN_EMAIL (falling back to SUPPORT_EMAIL).
 * The ingest monitor's conditions are also reported here (under `monitor`, read only), so the daily report stays ONE email and the
 * daily run never stores alert state. The deduped alert email is sent only by the hourly job.
 * ?monitor=1 runs ONLY the monitor, and sends (the hourly job, see supabase/cron.sql patch): no daily report, no daily email.
 * ?dry=1 builds and returns the report and the monitor conditions without sending or storing anything.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req, env.CRON_SECRET)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const dry = ['1', 'true'].includes(params.get('dry') ?? '');
  const monitorOnly = ['1', 'true'].includes(params.get('monitor') ?? '');
  const now = new Date();

  let admin: Admin;
  try {
    admin = createAdminClient();
  } catch {
    return Response.json({ error: 'not_configured' }, { status: 503 });
  }

  const to = env.ADMIN_EMAIL?.trim() || env.SUPPORT_EMAIL?.trim() || null;
  if (monitorOnly) {
    return Response.json({ monitor: await monitor(admin, now, dry, to) }, { headers: { 'Cache-Control': 'no-store' } });
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
  // A probation source with the samples table missing is "not set up" (it is skipped by the scan), never a failure (review defect 7).
  const adapters = (
    await withProbationSetup(admin, ALL_ADAPTERS.map((a) => ({ id: a.id, label: a.label, kind: a.kind, cadenceMinutes: a.cadenceMinutes, missingEnv: missingEnvFor(a), probation: !!a.probation })))
  ).map((a) => ({ id: a.id, label: a.label, kind: a.kind, cadenceMinutes: a.cadenceMinutes, missingEnv: a.missingEnv }));
  const counts = await loadCounts(admin, now);
  const report = planHealth({ adapters, runs, counts, now });

  // Per-source delivery health (holler_source_health), read once for both the email's state block and the JSON below. A read failure
  // leaves both null and never changes the rest of the report.
  let healthRows: SourceHealthRow[] | null = null;
  try {
    healthRows = await readSourceHealth(admin);
  } catch {
    healthRows = null;
  }
  // Source states (item 2.4): the health rows plus each source's own run history (14 days for the slow sources, see source-state-load.ts;
  // the report's 96 hours are too short to tell a long stall from a quiet source). Absent when either read fails.
  let sourceStates: SourceStateSummary | null = null;
  if (healthRows) {
    try {
      const stateAdapters = adapters.map((a) => ({ id: a.id, kind: a.kind, cadenceMinutes: a.cadenceMinutes, missingEnv: a.missingEnv }));
      const stateRuns = await readStateRuns(admin, now, stateAdapters);
      sourceStates = summarizeSourceStates(computeSourceStates({ adapters: stateAdapters, health: healthRows, runs: stateRuns, now }));
    } catch {
      sourceStates = null;
    }
  }
  report.sourceStates = sourceStates;
  // Firecrawl credits and per-source state. Never throws; absent when nothing is configured.
  try {
    const { loadFirecrawlHealth } = await import('@/lib/firecrawl/health');
    report.firecrawl = await loadFirecrawlHealth({ db: admin, now, env: { ...process.env, ...env } });
  } catch {
    report.firecrawl = null;
  }

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

  const sourceHealth: ReturnType<typeof summarizeSourceHealth> | null = healthRows ? summarizeSourceHealth(healthRows, now) : null;

  // Read only here: the hourly job (?monitor=1) is the one that sends and records alerts.
  const monitorResult = await monitor(admin, now, true, to);

  return Response.json({ ...report, email, sourceHealth, monitor: monitorResult }, { headers: { 'Cache-Control': 'no-store' } });
}
