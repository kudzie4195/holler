import { describe, expect, it, vi } from 'vitest';
import { runMonitor, type MonitorSend } from '@/lib/monitor/run';
import { ago, D, H, health, healthyDb, MIN, MonitorDb, NOW, scanRuns } from './helpers';

const URL = 'https://localholler.com/api/admin/sources';
type Mail = Parameters<MonitorSend>[0];
const okSend = () => vi.fn(async (m: Mail) => (void m, { ok: true as const }));
const go = (db: MonitorDb, over: Partial<Parameters<typeof runMonitor>[0]> = {}, now = NOW) =>
  runMonitor({ db: db as never, now, dry: false, to: 'owner@example.com', sourcesUrl: URL, send: okSend(), ...over });
const alerts = (db: MonitorDb) => db.tables.holler_ops_alerts;

describe('quiet when healthy', () => {
  it('a healthy system sends nothing, writes nothing, and says ok', async () => {
    const db = healthyDb();
    const send = okSend();
    const r = await go(db, { send });
    expect(r.status).toBe('ok');
    expect(r.conditions).toEqual([]);
    expect(r.email.status).toBe('quiet');
    expect(send).not.toHaveBeenCalled();
    expect(alerts(db)).toEqual([]);
    expect(db.calls.filter((c) => c.endsWith('.upsert') || c.endsWith('.insert') || c.endsWith('.delete'))).toEqual([]);
  });
  it('NO STORM TODAY end to end: weather feeds saw rows, found nothing new for a day, and no email goes out', async () => {
    const db = healthyDb({
      holler_source_health: [
        health('nws', { last_new_at: ago(30 * H), last_record_at: ago(30 * H), rows_seen_last_run: 40, rows_new_last_run: 0 }),
        health('spc', { last_new_at: ago(30 * H), last_record_at: ago(30 * H), rows_seen_last_run: 0, rows_new_last_run: 0, last_rows_seen_at: ago(50 * H) }),
      ],
    });
    const send = okSend();
    const r = await go(db, { send });
    expect(r.conditions).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
});

/** Re-date the healthy tables to a later clock so only the scan is wrong. */
function freshAt(db: MonitorDb, at: Date) {
  db.tables.holler_signals = [{ id: 9, created_at: ago(H, at) }];
  db.tables.holler_source_health = [health('nws', { last_new_at: ago(H, at), last_run_at: ago(5 * MIN, at), last_success_at: ago(5 * MIN, at), last_record_at: ago(H, at), last_rows_seen_at: ago(5 * MIN, at) })];
}

describe('a scan error emails once, then stays quiet, then recovers', () => {
  const broken = () => healthyDb({ holler_scan_runs: [...scanRuns(6 * MIN, null, ['spc']), { source: 'nws', finished_at: ago(6 * MIN), error: 'matching failed: x' }] });
  it('first run sends one email naming the scan error and stores the key', async () => {
    const db = broken();
    const send = okSend();
    const r = await go(db, { send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ to: 'owner@example.com' });
    expect(send.mock.calls[0][0].subject).toBe('Holler ingest: scan error');
    expect(r.email).toMatchObject({ status: 'sent', to: 'owner@example.com' });
    expect(alerts(db)).toEqual([{ key: 'scan:error', first_seen_at: NOW.toISOString(), last_sent_at: NOW.toISOString(), last_state: 'alerting', count: 1 }]);
  });
  it('the next hour is quiet; 24h 1m later it sends again; then it clears with one recovery email', async () => {
    const db = broken();
    const send = okSend();
    await go(db, { send });
    const hourLater = new Date(NOW.getTime() + H);
    freshAt(db, hourLater);
    db.tables.holler_scan_runs = [...scanRuns(6 * MIN, null, ['spc'], hourLater), { source: 'nws', finished_at: ago(6 * MIN, hourLater), error: 'matching failed: x' }] as never;
    await go(db, { send }, hourLater);
    expect(send).toHaveBeenCalledTimes(1);
    const next = new Date(NOW.getTime() + D + MIN);
    freshAt(db, next);
    db.tables.holler_scan_runs = [...scanRuns(6 * MIN, null, ['spc'], next), { source: 'nws', finished_at: ago(6 * MIN, next), error: 'matching failed: x' }] as never;
    await go(db, { send }, next);
    expect(send).toHaveBeenCalledTimes(2);
    expect(alerts(db)[0]).toMatchObject({ count: 2, last_state: 'alerting' });
    const clear = new Date(next.getTime() + H);
    db.tables.holler_scan_runs = scanRuns(6 * MIN, null, ['nws', 'spc'], clear) as never;
    freshAt(db, clear);
    const r = await go(db, { send }, clear);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2][0].subject).toBe('Holler ingest: recovered');
    expect(send.mock.calls[2][0].text).toContain('Scan: the latest run has no error.');
    expect(r.recovered).toEqual(['Scan: the latest run has no error.']);
    expect(alerts(db)[0].last_state).toBe('recovered');
    const after = new Date(clear.getTime() + H);
    freshAt(db, after);
    db.tables.holler_scan_runs = scanRuns(6 * MIN, null, ['nws', 'spc'], after) as never;
    await go(db, { send }, after);
    expect(send).toHaveBeenCalledTimes(3);
  });
  it('stale scan: nothing finished in 2 hours', async () => {
    const db = healthyDb({ holler_scan_runs: scanRuns(2 * H) });
    const send = okSend();
    await go(db, { send });
    expect(send.mock.calls[0][0].subject).toBe('Holler ingest: scan has stopped');
  });
});

describe('a silent source and the whole feed', () => {
  it('a silent failing nws emails with its id, last success time and cleaned error', async () => {
    const db = healthyDb({
      holler_source_health: [health('nws', { last_new_at: ago(26 * H), last_record_at: ago(26 * H), consecutive_failures: 4, last_error: 'HTTP 503', rows_seen_last_run: 0, last_success_at: ago(26 * H) })],
    });
    const send = okSend();
    await go(db, { send });
    const mail = send.mock.calls[0][0];
    expect(mail.subject).toBe('Holler ingest: nws has gone quiet');
    expect(mail.text).toContain('Source nws last had a good fetch at 2026-11-18 12:11 UTC, which was 26 h ago.');
    expect(mail.text).toContain('HTTP 503');
    expect(alerts(db).map((a) => a.key)).toEqual(['source:nws:silent']);
  });
  it('zero new signals in a day alerts for the feed', async () => {
    const db = healthyDb({ holler_signals: [{ id: 1, created_at: ago(25 * H) }] });
    const send = okSend();
    await go(db, { send });
    expect(send.mock.calls[0][0].subject).toBe('Holler ingest: no new signals in 24 hours');
  });
  it('two problems at once make ONE email, worst first', async () => {
    const db = healthyDb({
      holler_signals: [],
      holler_scan_runs: scanRuns(2 * H),
    });
    const send = okSend();
    await go(db, { send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].subject).toBe('Holler ingest: scan has stopped (and 1 more)');
    expect(alerts(db).map((a) => a.key).sort()).toEqual(['feed:silent', 'scan:stale']);
  });
});

describe('dry run', () => {
  it('returns the conditions, sends nothing, stores nothing', async () => {
    const db = healthyDb({ holler_scan_runs: scanRuns(2 * H) });
    const send = okSend();
    const r = await go(db, { send, dry: true });
    expect(r.conditions.map((c) => c.key)).toEqual(['scan:stale']);
    expect(r.email).toMatchObject({ status: 'would_send', subject: 'Holler ingest: scan has stopped' });
    expect(send).not.toHaveBeenCalled();
    expect(alerts(db)).toEqual([]);
  });
  it('healthy dry run is not_sent_dry', async () => {
    expect((await go(healthyDb(), { dry: true })).email.status).toBe('not_sent_dry');
  });
});

describe('before migration 0018 (table missing)', () => {
  const missing = (db: MonitorDb) => { db.failOn['holler_ops_alerts.select'] = `Could not find the table 'public.holler_ops_alerts' in the schema cache`; return db; };
  it('reports "monitor table missing", still lists the conditions, and sends nothing', async () => {
    const db = missing(healthyDb({ holler_scan_runs: scanRuns(2 * H) }));
    const send = okSend();
    const r = await go(db, { send });
    expect(r.status).toBe('table_missing');
    expect(r.note).toBe('monitor table missing');
    expect(r.conditions.map((c) => c.key)).toEqual(['scan:stale']);
    expect(send).not.toHaveBeenCalled();
  });
  it('also recognizes the Postgres wording', async () => {
    const db = healthyDb();
    db.failOn['holler_ops_alerts.select'] = 'relation "public.holler_ops_alerts" does not exist';
    expect((await go(db)).note).toBe('monitor table missing');
  });
  it('a different read error is "monitor state unreadable", also silent', async () => {
    const db = healthyDb({ holler_scan_runs: scanRuns(2 * H) });
    db.failOn['holler_ops_alerts.select'] = 'connection reset';
    const send = okSend();
    const r = await go(db, { send });
    expect(r).toMatchObject({ status: 'error', note: 'monitor state unreadable' });
    expect(send).not.toHaveBeenCalled();
  });
  it('without the new health columns the monitor still works from last_record_at and tracked defaults', async () => {
    const row = health('nws', { consecutive_failures: 2, last_error: 'HTTP 503', rows_seen_last_run: 0, last_record_at: ago(30 * H) });
    delete row.last_new_at; delete row.last_rows_seen_at; delete row.tracked_since;
    const r = await go(healthyDb({ holler_source_health: [row] }), { dry: true });
    expect(r.conditions.map((c) => c.key)).toEqual(['source:nws:silent']);
  });
});

describe('delivery failures', () => {
  const broken = () => healthyDb({ holler_scan_runs: scanRuns(2 * H) });
  it('no recipient: nothing sent, nothing stored, so it will be sent once an address exists', async () => {
    const db = broken();
    const r = await go(db, { to: null });
    expect(r.email.status).toBe('no_recipient');
    expect(alerts(db)).toEqual([]);
  });
  it('a failed send undoes the claim so the next run tries again', async () => {
    const db = broken();
    const send = vi.fn(async (m: Mail) => (void m, { ok: false as const, error: 'HTTP 500' }));
    const r = await go(db, { send });
    expect(r.email.status).toBe('failed');
    expect(alerts(db)).toEqual([]);
    const ok = okSend();
    await go(db, { send: ok });
    expect(ok).toHaveBeenCalledTimes(1);
  });
  it('a skipped send (no API key) is reported as skipped and also undone', async () => {
    const db = broken();
    const r = await go(db, { send: async () => ({ ok: false, skipped: true, error: 'no_api_key' }) });
    expect(r.email).toMatchObject({ status: 'skipped' });
    expect(alerts(db)).toEqual([]);
  });
  it('a failed send restores an older row instead of deleting it', async () => {
    const prior = { key: 'scan:stale', first_seen_at: ago(3 * D), last_sent_at: ago(2 * D), last_state: 'alerting', count: 2 };
    const db = broken();
    db.tables.holler_ops_alerts = [{ ...prior }];
    await go(db, { send: async () => ({ ok: false, error: 'x' }) });
    expect(alerts(db)).toEqual([prior]);
  });
  it('a send that throws is a failed send, not a throw', async () => {
    const r = await go(broken(), { send: async () => { throw new Error('boom'); } });
    expect(r.email.status).toBe('failed');
  });
  it('state that cannot be saved means nothing is emailed (no hourly repeats)', async () => {
    const db = broken();
    db.failOn['holler_ops_alerts.upsert'] = 'permission denied';
    const send = okSend();
    const r = await go(db, { send });
    expect(send).not.toHaveBeenCalled();
    expect(r.note).toBe('monitor state not saved');
  });
});

describe('never throws', () => {
  it('survives every read failing', async () => {
    const db = healthyDb();
    for (const t of ['holler_scan_runs.select', 'holler_source_health.select', 'holler_signals.select', 'holler_ops_alerts.select']) db.failOn[t] = 'boom';
    const r = await go(db);
    expect(r.status).toBeDefined();
    expect(r.conditions).toEqual([]);
  });
  it('an unreadable scan_runs table is not read as "no scan ran"', async () => {
    const db = healthyDb();
    db.failOn['holler_scan_runs.select'] = 'boom';
    const send = okSend();
    const r = await go(db, { send });
    expect(r.status).toBe('partial');
    expect(r.unread).toContain('scan_runs');
    expect(r.conditions).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
  it('an unreadable scan_runs table does not clear an alert that was emailed', async () => {
    const db = healthyDb();
    db.failOn['holler_scan_runs.select'] = 'boom';
    db.tables.holler_ops_alerts = [{ key: 'scan:error', first_seen_at: ago(H), last_sent_at: ago(H), last_state: 'alerting', count: 1 }];
    const send = okSend();
    await go(db, { send });
    expect(send).not.toHaveBeenCalled();
    expect(alerts(db)[0].last_state).toBe('alerting');
  });
  it('an unreadable signals count does not raise or clear the feed alert', async () => {
    const db = healthyDb({ holler_signals: [] });
    db.failOn['holler_signals.select'] = 'boom';
    const r = await go(db, { dry: true });
    expect(r.conditions.map((c) => c.key)).not.toContain('feed:silent');
  });
});

describe('only sources that are enabled right now (review r4)', () => {
  const off = () => health('bluesky', { last_run_at: ago(10 * D), last_success_at: ago(10 * D), last_new_at: ago(10 * D), last_record_at: ago(10 * D) });
  it('a switched-off source never alerts, replayed hourly for 5 days', async () => {
    const db = healthyDb({ holler_source_health: [health('nws'), off()] });
    const send = okSend();
    for (let h = 0; h < 5 * 24; h++) {
      const now = new Date(NOW.getTime() + h * H);
      // Keep the rest of the pipeline healthy as the clock moves, so only the source rule is under test.
      db.tables.holler_scan_runs = scanRuns(6 * MIN, null, ['nws', 'spc', 'usgs'], now) as never;
      db.tables.holler_signals = [{ id: 1, created_at: ago(H, now) }];
      db.tables.holler_source_health = [health('nws', { last_run_at: ago(5 * MIN, now), last_success_at: ago(5 * MIN, now), last_new_at: ago(2 * H, now), last_rows_seen_at: ago(5 * MIN, now) }), off()];
      await go(db, { send, enabledSources: new Set(['nws']) }, now);
    }
    expect(send).not.toHaveBeenCalled();
    expect(alerts(db)).toEqual([]);
  });
  it('an alert stored while the source was on gets no "delivering again" line once it is switched off', async () => {
    const db = healthyDb({
      holler_source_health: [off()],
      holler_ops_alerts: [{ key: 'source:bluesky:silent', first_seen_at: ago(2 * D), last_sent_at: ago(2 * D), last_state: 'alerting', count: 1 }],
    });
    const send = okSend();
    const r = await go(db, { send, enabledSources: new Set(['nws']) });
    expect(r.recovered).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
});
