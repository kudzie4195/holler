import type { Db } from '../signals/store';
import { readAllPages } from '../signals/store';
import { readSourceHealth, sanitizeHealthError } from '../signals/health';
import { renderMonitorEmail } from './email';
import {
  evaluateFeed,
  evaluateScan,
  evaluateSources,
  planAlerts,
  recoveredLine,
  sortConditions,
  SCAN_LOOKBACK_MS,
  type AlertRow,
  type Condition,
  type ScanRunRow,
} from './rules';

/**
 * Reads what the rules need, decides, sends at most one email, and records what it sent. NEVER throws: every step is caught,
 * and the answer says what happened. Before migration 0018 the alerts table is missing: the answer says "monitor table missing",
 * the conditions are still reported, and nothing is emailed (without the table there is no way to avoid an email every hour).
 */

export type MonitorEmailStatus = 'quiet' | 'sent' | 'not_sent_dry' | 'would_send' | 'no_recipient' | 'skipped' | 'failed' | 'not_checked';

export interface MonitorResult {
  status: 'ok' | 'table_missing' | 'partial' | 'error';
  note?: string;
  checkedAt: string;
  conditions: Array<Pick<Condition, 'key' | 'code' | 'source' | 'headline' | 'reason' | 'lastSuccessAt' | 'lastError'>>;
  recovered: string[];
  email: { status: MonitorEmailStatus; to?: string; subject?: string; detail?: string };
  /** Inputs that could not be read this run. A condition that depends on one of them was not evaluated. */
  unread: string[];
}

export interface MonitorSend {
  (mail: { to: string; subject: string; html: string; text: string }): Promise<{ ok: true } | { ok: false; skipped?: boolean; error: string }>;
}

export interface MonitorOptions {
  db: Db;
  now: Date;
  dry: boolean;
  to: string | null;
  sourcesUrl: string;
  send: MonitorSend;
  /**
   * Source ids that are switched on right now (in the registry, with their env keys set). Health rows for any other id are not judged,
   * and an alert stored for one is left as it is (no "delivering again" line for a source that was switched off). The route always
   * passes it; omitted means every row is judged.
   */
  enabledSources?: ReadonlySet<string> | null;
}

const TABLE_MISSING = /holler_ops_alerts[\s\S]*(does not exist|schema cache)|42P01|PGRST205/i;

async function readAlerts(db: Db): Promise<{ rows: AlertRow[] } | { missing: true } | { failed: string }> {
  const { data, error } = await db.from('holler_ops_alerts').select('key, first_seen_at, last_sent_at, last_state, count').limit(1000);
  if (error) return TABLE_MISSING.test(error.message) ? { missing: true } : { failed: sanitizeHealthError(error.message) ?? 'error' };
  return { rows: (data ?? []) as AlertRow[] };
}

async function readScanRuns(db: Db, now: Date): Promise<ScanRunRow[]> {
  const since = new Date(now.getTime() - SCAN_LOOKBACK_MS).toISOString();
  return readAllPages<ScanRunRow>(
    (from, to) =>
      db
        .from('holler_scan_runs')
        .select('source, finished_at, error')
        .gte('finished_at', since)
        .order('finished_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to),
    10,
  );
}

async function countNewSignals(db: Db, now: Date): Promise<number | null> {
  const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const { count, error } = await db.from('holler_signals').select('id', { count: 'exact', head: true }).gte('created_at', since);
  return error ? null : (count ?? 0);
}

function shape(c: Condition): MonitorResult['conditions'][number] {
  return { key: c.key, code: c.code, source: c.source, headline: c.headline, reason: c.reason, lastSuccessAt: c.lastSuccessAt, lastError: c.lastError };
}

export async function runMonitor(o: MonitorOptions): Promise<MonitorResult> {
  const checkedAt = o.now.toISOString();
  const unread: string[] = [];
  const base: MonitorResult = { status: 'ok', checkedAt, conditions: [], recovered: [], email: { status: 'not_checked' }, unread };
  try {
    const [runs, healthRows, newSignals24h, alerts] = await Promise.all([
      readScanRuns(o.db, o.now).catch(() => (unread.push('scan_runs'), null)),
      readSourceHealth(o.db).catch(() => (unread.push('source_health'), null)),
      countNewSignals(o.db, o.now).catch(() => null),
      readAlerts(o.db).catch((): { failed: string } => ({ failed: 'error' })),
    ]);
    if (newSignals24h === null) unread.push('signals_count');

    const active: Condition[] = [];
    // Scan rules need the runs. With no read there is nothing to judge; do not call it stale.
    if (runs) active.push(...evaluateScan(runs, o.now));
    const lastNewAt = healthRows?.reduce<string | null>((m, r) => (r.last_new_at && (!m || r.last_new_at > m) ? r.last_new_at : m), null) ?? null;
    active.push(...evaluateFeed({ newSignals24h, lastNewAt }));
    if (healthRows) active.push(...evaluateSources(healthRows, o.now, o.enabledSources));
    const conditions = sortConditions(active);
    base.conditions = conditions.map(shape);
    if (unread.length) base.status = 'partial';

    if ('missing' in alerts) {
      return { ...base, status: 'table_missing', note: 'monitor table missing', email: { status: 'quiet', detail: 'Apply migration 0018. Nothing is emailed until then.' } };
    }
    if ('failed' in alerts) {
      return { ...base, status: 'error', note: 'monitor state unreadable', email: { status: 'quiet', detail: 'Alert state could not be read, so nothing was emailed.' } };
    }

    // A partial read can only miss conditions, never invent them. But it must not clear alerts either: skip recovery for keys whose
    // inputs were unreadable, by treating them as still active.
    const stored = alerts.rows;
    const switchedOff = (key: string) => {
      const m = /^source:(.+):(silent|status)$/.exec(key);
      return !!m && !!o.enabledSources && !o.enabledSources.has(m[1]);
    };
    const stillUnknown = (key: string) =>
      switchedOff(key) ||
      (unread.includes('scan_runs') && key.startsWith('scan:')) ||
      (unread.includes('source_health') && key.startsWith('source:')) ||
      (unread.includes('signals_count') && key === 'feed:silent');
    const plan = planAlerts(active, stored.filter((r) => !stillUnknown(r.key)), o.now);
    base.recovered = plan.recovered.map(recoveredLine);

    if (!plan.send) return { ...base, email: { status: o.dry ? 'not_sent_dry' : 'quiet' } };
    // Active problems already emailed in the last 24 hours are not listed again (planAlerts); the email counts them as still open.
    const stillOpen = active.length - plan.items.length;
    if (o.dry) return { ...base, email: { status: 'would_send', subject: renderMonitorEmail({ items: plan.items, recovered: plan.recovered, now: o.now, sourcesUrl: o.sourcesUrl, stillOpen }).subject } };

    if (!o.to) {
      return { ...base, email: { status: 'no_recipient', detail: 'Set ADMIN_EMAIL or SUPPORT_EMAIL to receive ingest alerts.' } };
    }
    const mail = renderMonitorEmail({ items: plan.items, recovered: plan.recovered, now: o.now, sourcesUrl: o.sourcesUrl, stillOpen });

    // Claim first, send second: if the state write fails nothing is sent (so no hourly repeats); if the send fails the claim is undone.
    const keys = plan.upserts.map((u) => u.key);
    const prior = new Map(stored.map((r) => [r.key, r]));
    const claim = await o.db.from('holler_ops_alerts').upsert(plan.upserts, { onConflict: 'key' });
    if (claim.error) return { ...base, status: 'error', note: 'monitor state not saved', email: { status: 'failed', subject: mail.subject, detail: 'Alert state could not be saved, so nothing was emailed.' } };

    let res: Awaited<ReturnType<MonitorSend>>;
    try {
      res = await o.send({ to: o.to, subject: mail.subject, html: mail.html, text: mail.text });
    } catch {
      res = { ok: false, error: 'send threw' };
    }
    if (res.ok) return { ...base, email: { status: 'sent', to: o.to, subject: mail.subject } };

    // Undo the claim so the next run tries again.
    const restore = keys.map((k) => prior.get(k)).filter((r): r is AlertRow => !!r);
    const created = keys.filter((k) => !prior.has(k));
    await Promise.resolve(restore.length ? o.db.from('holler_ops_alerts').upsert(restore, { onConflict: 'key' }) : null).catch(() => undefined);
    if (created.length) await Promise.resolve(o.db.from('holler_ops_alerts').delete().in('key', created)).catch(() => undefined);
    const skipped = 'skipped' in res && res.skipped;
    return { ...base, email: { status: skipped ? 'skipped' : 'failed', to: o.to, subject: mail.subject, detail: sanitizeHealthError(res.error) ?? 'send failed' } };
  } catch (e) {
    return { ...base, status: 'error', note: 'monitor failed', email: { status: 'not_checked', detail: sanitizeHealthError(e) ?? 'error' } };
  }
}
