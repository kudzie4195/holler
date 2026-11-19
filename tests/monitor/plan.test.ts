import { describe, expect, it } from 'vitest';
import { planAlerts, recoveredLine, RESEND_MS, type AlertRow } from '@/lib/monitor/rules';
import { ago, cond, D, H, MIN, NOW } from './helpers';

const row = (over: Partial<AlertRow> = {}): AlertRow => ({ key: 'scan:error', first_seen_at: ago(3 * H), last_sent_at: ago(3 * H), last_state: 'alerting', count: 1, ...over });

describe('quiet when healthy', () => {
  it('nothing active and nothing stored sends nothing and writes nothing', () => {
    expect(planAlerts([], [], NOW)).toEqual({ send: false, items: [], recovered: [], upserts: [] });
  });
  it('already-recovered rows stay quiet and are not rewritten', () => {
    expect(planAlerts([], [row({ last_state: 'recovered' })], NOW)).toEqual({ send: false, items: [], recovered: [], upserts: [] });
  });
});

describe('first appearance', () => {
  it('a new condition sends once and stamps the row', () => {
    const p = planAlerts([cond()], [], NOW);
    expect(p.send).toBe(true);
    expect(p.items.map((c) => c.key)).toEqual(['scan:error']);
    expect(p.upserts).toEqual([{ key: 'scan:error', first_seen_at: NOW.toISOString(), last_sent_at: NOW.toISOString(), last_state: 'alerting', count: 1 }]);
  });
});

describe('dedupe window (24 hours)', () => {
  const at = (ms: number) => planAlerts([cond()], [row({ last_sent_at: ago(ms), first_seen_at: ago(ms + H), count: 2 })], NOW);
  it('1 hour later: quiet, no writes', () => {
    expect(at(H)).toEqual({ send: false, items: [], recovered: [], upserts: [] });
  });
  it('23 hours 59 minutes later: quiet', () => {
    expect(at(RESEND_MS - MIN).send).toBe(false);
  });
  it('exactly 24 hours later: still quiet (more than, not at least)', () => {
    expect(at(RESEND_MS).send).toBe(false);
  });
  it('24 hours and a minute later: sends again, count goes up, first_seen_at is kept', () => {
    const p = at(RESEND_MS + MIN);
    expect(p.send).toBe(true);
    expect(p.upserts[0]).toMatchObject({ key: 'scan:error', count: 3, last_state: 'alerting', first_seen_at: ago(RESEND_MS + MIN + H) });
  });
  it('a never-emailed row (last_sent_at null) is due', () => {
    expect(planAlerts([cond()], [row({ last_sent_at: null, last_state: 'suppressed' })], NOW).send).toBe(true);
  });
});

// Changed in round 7 fix-g2 (verify-v3 P2, commander decision 10): a key emailed less than 24 hours ago is not listed again by a later
// email unless its state changed, and it is not restamped.
describe('one email lists what is new or due, not what was emailed in the last 24 hours', () => {
  const feed = (over = {}) => cond({ key: 'feed:silent', code: 'feed_silent', severity: 3, source: 'feed', headline: 'no new signals in 24 hours', ...over });
  it('a new condition makes one email; the older one emailed 2 hours ago is not listed and not restamped', () => {
    const p = planAlerts([feed(), cond()], [row({ key: 'feed:silent', last_sent_at: ago(2 * H) })], NOW);
    expect(p.send).toBe(true);
    expect(p.items.map((c) => c.key)).toEqual(['scan:error']);
    expect(p.upserts.map((u) => u.key)).toEqual(['scan:error']);
  });
  it('an older key that is due (emailed more than 24 hours ago) is listed with the new one, worst first, and both stamped', () => {
    const p = planAlerts([feed(), cond()], [row({ key: 'feed:silent', last_sent_at: ago(D + MIN) })], NOW);
    expect(p.items.map((c) => c.key)).toEqual(['scan:error', 'feed:silent']);
    expect(p.upserts.map((u) => u.key).sort()).toEqual(['feed:silent', 'scan:error']);
  });
  it('a key whose state changed since its last email (recovered, then back) is listed when an email goes anyway', () => {
    const p = planAlerts([feed(), cond()], [row({ key: 'feed:silent', last_state: 'suppressed', last_sent_at: ago(5 * H) })], NOW);
    expect(p.items.map((c) => c.key)).toEqual(['scan:error', 'feed:silent']);
  });
  it('verify-v3 P2 reviewer replay: hourly plans list each key only when it is new, changed or due', () => {
    const nws = cond({ key: 'source:nws:silent', code: 'source_silent', severity: 4, source: 'nws', headline: 'nws has gone quiet' });
    let stored: AlertRow[] = [];
    const log: string[] = [];
    const at = (h: number, active: ReturnType<typeof cond>[]) => {
      const now = new Date(NOW.getTime() + h * H);
      const p = planAlerts(active, stored, now);
      const byKey = new Map(stored.map((r) => [r.key, r]));
      for (const u of p.upserts) byKey.set(u.key, u);
      stored = [...byKey.values()];
      if (p.send) log.push(`h${h}:[${p.items.map((c) => c.key).join('+')}|${p.recovered.join('+')}]`);
    };
    at(0, [cond()]);
    at(3, [cond(), nws]);
    at(5, [nws]);
    at(6, []);
    at(28, [cond()]);
    expect(log).toEqual(['h0:[scan:error|]', 'h3:[source:nws:silent|]', 'h5:[|scan:error]', 'h6:[|source:nws:silent]', 'h28:[scan:error|]']);
  });
});

describe('recovery', () => {
  it('an alerted key that cleared gets one recovered line and is marked recovered', () => {
    const p = planAlerts([], [row()], NOW);
    expect(p.send).toBe(true);
    expect(p.items).toEqual([]);
    expect(p.recovered).toEqual(['scan:error']);
    expect(p.upserts).toEqual([{ ...row(), last_state: 'recovered' }]);
  });
  it('after that it is quiet again (the line is only sent once)', () => {
    const p1 = planAlerts([], [row()], NOW);
    const p2 = planAlerts([], p1.upserts, new Date(NOW.getTime() + H));
    expect(p2.send).toBe(false);
  });
  it('a recovery rides in an email that goes out anyway', () => {
    const feed = cond({ key: 'feed:silent', code: 'feed_silent', severity: 3, source: 'feed', headline: 'no new signals in 24 hours' });
    const p = planAlerts([feed], [row()], NOW);
    expect(p.send).toBe(true);
    expect(p.items.map((c) => c.key)).toEqual(['feed:silent']);
    expect(p.recovered).toEqual(['scan:error']);
  });
  it('a key that was only suppressed clears silently', () => {
    const p = planAlerts([], [row({ last_state: 'suppressed' })], NOW);
    expect(p.send).toBe(false);
    expect(p.recovered).toEqual([]);
    expect(p.upserts[0].last_state).toBe('recovered');
  });
  it('flapping: back within 24 hours of the last email is tracked as suppressed, not emailed', () => {
    const p = planAlerts([cond()], [row({ last_state: 'recovered', last_sent_at: ago(2 * H) })], NOW);
    expect(p.send).toBe(false);
    expect(p.upserts).toEqual([{ key: 'scan:error', first_seen_at: NOW.toISOString(), last_sent_at: ago(2 * H), last_state: 'suppressed', count: 1 }]);
  });
  it('flapping: back after more than 24 hours is a new episode and emails', () => {
    const p = planAlerts([cond()], [row({ last_state: 'recovered', last_sent_at: ago(D + MIN) })], NOW);
    expect(p.send).toBe(true);
    expect(p.upserts[0]).toMatchObject({ last_state: 'alerting', first_seen_at: NOW.toISOString(), count: 2 });
  });
  it('suppressed keys that stay broken email when the window ends', () => {
    expect(planAlerts([cond()], [row({ last_state: 'suppressed', last_sent_at: ago(D + MIN) })], NOW).send).toBe(true);
  });
});

describe('recovered lines read plainly, with no raw data', () => {
  it.each([
    ['scan:stale', 'Scan: running again.'],
    ['scan:error', 'Scan: the latest run has no error.'],
    ['feed:silent', 'Feed: new signals are arriving again.'],
    ['source:nws:silent', 'nws: delivering again.'],
    ['source:socrata-nyc-311:status', 'socrata-nyc-311: back to healthy or delayed.'],
  ])('%s', (key, line) => expect(recoveredLine(key)).toBe(line));
});
