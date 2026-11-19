import { describe, expect, it, vi } from 'vitest';
import { runMonitor, type MonitorSend } from '@/lib/monitor/run';
import { ago, H, health, MIN, MonitorDb, scanRuns } from './helpers';

/**
 * Walks the hourly job (minute 11 of every hour) through three days and counts emails.
 * The world is rebuilt each hour from a function of the clock, the way the real tables would look.
 */
const START = new Date('2026-11-16T00:11:00Z');

function world(db: MonitorDb, at: Date, s: { scanDown: boolean; nwsDown: boolean }, lastGood: Date) {
  // The scan runs at :00 of every hour in this model (four ticks an hour collapse to the newest, which is what the monitor reads).
  const lastTick = new Date(Math.floor(at.getTime() / (15 * MIN)) * 15 * MIN);
  db.tables.holler_scan_runs = s.scanDown ? [] : (scanRuns(at.getTime() - lastTick.getTime() + 45_000, null, ['nws', 'spc'], at) as never);
  db.tables.holler_signals = [{ id: 1, created_at: ago(H, lastGood) }];
  db.tables.holler_source_health = [
    health('nws', {
      last_run_at: ago(10 * MIN, at),
      last_new_at: s.nwsDown ? ago(30 * H, at) : ago(H, at),
      last_record_at: s.nwsDown ? ago(30 * H, at) : ago(H, at),
      last_success_at: s.nwsDown ? ago(30 * H, at) : ago(10 * MIN, at),
      consecutive_failures: s.nwsDown ? 9 : 0,
      last_error: s.nwsDown ? 'HTTP 503' : null,
      rows_seen_last_run: s.nwsDown ? 0 : 20,
    }),
  ];
}

async function simulate(hours: number, plan: (h: number) => { scanDown: boolean; nwsDown: boolean }) {
  const db = new MonitorDb({ holler_ops_alerts: [] });
  const subjects: Array<{ h: number; subject: string }> = [];
  const send: MonitorSend = async (m) => {
    subjects.push({ h: Math.round((cur.getTime() - START.getTime()) / H), subject: m.subject });
    return { ok: true };
  };
  let cur = START;
  let lastGood = START;
  for (let h = 0; h < hours; h++) {
    cur = new Date(START.getTime() + h * H);
    const p = plan(h);
    if (!p.scanDown) lastGood = cur;
    world(db, cur, p, lastGood);
    await runMonitor({ db: db as never, now: cur, dry: false, to: 'o@example.com', sourcesUrl: 'https://x.test/api/admin/sources', send });
  }
  return subjects;
}

describe('three days of hourly checks', () => {
  it('72 healthy hours send nothing', async () => {
    expect(await simulate(72, () => ({ scanDown: false, nwsDown: false }))).toEqual([]);
  });
  it('a scan that is down for 50 hours sends one email at the start, one a day while it lasts, and one when it recovers', async () => {
    const out = await simulate(72, (h) => ({ scanDown: h >= 10 && h < 60, nwsDown: false }));
    // Changed in round 7 fix-g2 (verify-v3 P2, commander decision 10): a key emailed less than 24 h ago is not listed or restamped by
    // another key's email, so each key keeps its own once-a-day cadence. Down from hour 10. Hour 33: the feed alert is a new key, emailed
    // alone (the scan alert, emailed at 10, is only counted as still open). Hour 35: the scan alert is due again. Hour 58: the feed
    // alert is due again. Hour 60: back, one recovery email. Each problem is emailed once a day; none in the healthy hours.
    expect(out.map((o) => o.h)).toEqual([10, 33, 35, 58, 60]);
    expect(out[0].subject).toBe('Holler ingest: scan has stopped');
    expect(out[1].subject).toBe('Holler ingest: no new signals in 24 hours');
    expect(out[2].subject).toBe('Holler ingest: scan has stopped');
    expect(out[3].subject).toBe('Holler ingest: no new signals in 24 hours');
    expect(out[4].subject).toBe('Holler ingest: recovered');
  });
  it('a source outage that clears inside a day sends one alert and one recovery, never a pile', async () => {
    const out = await simulate(72, (h) => ({ scanDown: false, nwsDown: h >= 5 && h < 20 }));
    expect(out.length).toBeLessThanOrEqual(2);
    expect(out.every((o) => /nws|recovered/.test(o.subject))).toBe(true);
  });
  it('an outage that flaps every hour for a day is not an email every hour', async () => {
    const out = await simulate(48, (h) => ({ scanDown: h >= 5 && h < 30 && h % 2 === 0, nwsDown: false }));
    expect(out.length).toBeLessThanOrEqual(4);
  });
});
void vi;
