/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { alertLogRowsFor, distanceBucket, logAlerts, markAlertsEmailed, toLogRecord } from '@/lib/moat/log';
import { makeDb } from './fakedb';

describe('distanceBucket', () => {
  it('uses 0-5, 5-15, 15-30, 30+ and null when unknown', () => {
    expect([0, 4.9, 5, 14.9, 15, 29.9, 30, 120].map(distanceBucket)).toEqual(['0-5', '0-5', '5-15', '5-15', '15-30', '15-30', '30+', '30+']);
    expect([null, undefined, NaN, -1].map((x) => distanceBucket(x as any))).toEqual([null, null, null, null]);
  });
});

describe('log rows', () => {
  it('keep machine tokens only: hostile text in any field becomes null', () => {
    const rec = toLogRecord({ user_id: 'u', signal_id: 1, source: 'nws', kind: 'alert', subtype: '123 Main St, call 555-1234', trade: 'Roof & Co. <b>', distance_mi: 3, severity: 2, plan: 'pro' })!;
    expect(rec.subtype).toBeNull();
    expect(rec.trade).toBeNull();
    expect(rec).toMatchObject({ source: 'nws', kind: 'alert', intent: 'demand', distance_bucket: '0-5', severity: 2, plan: 'pro' });
    expect(Object.keys(rec).sort()).toEqual(['distance_bucket', 'intent', 'kind', 'plan', 'severity', 'signal_id', 'source', 'subtype', 'trade', 'user_id']);
  });
  it('rejects rows without a user or a real signal id', () => {
    expect(toLogRecord({ user_id: '', signal_id: 1 })).toBeNull();
    expect(toLogRecord({ user_id: 'u', signal_id: 0 })).toBeNull();
    expect(toLogRecord(null as any)).toBeNull();
  });
  // u2: was "picks the first allowed trade" (first shared category). The trade is now the member's allowed trade with the best
  // opportunity label for the record, so the alert needs its event (title) to be labelled at all.
  it('alertLogRowsFor picks the allowed trade with the best label, the plan in force and the signal facts', () => {
    const rows = alertLogRowsFor(
      [{ user_id: 'u1', signal_id: 1, distance_mi: 12 }, { user_id: 'u2', signal_id: 1, distance_mi: null }, { user_id: 'u1', signal_id: 99, distance_mi: 1 }],
      [{ id: 1, source: 'nws', kind: 'alert', title: 'Excessive Heat Warning: Fulton, GA', subtype: null, categories: ['roofing', 'hvac'], severity: 3 }],
      [
        { user_id: 'u1', categories: ['hvac'], lat: 1, lon: 1, state: 'GA', plan: 'pro', subscription_status: 'active' },
        { user_id: 'u2', categories: ['plumbing'], lat: 1, lon: 1, state: 'GA', plan: 'pro', subscription_status: 'trialing' },
      ],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ user_id: 'u1', trade: 'hvac', plan: 'pro', distance_mi: 12, severity: 3 });
    expect(rows[1]).toMatchObject({ user_id: 'u2', trade: null, plan: 'starter' });
  });
  it('alertLogRowsFor logs a downstream trade that is not in the record categories (a re-roof permit for a gutter company)', () => {
    const rows = alertLogRowsFor(
      [{ user_id: 'g', signal_id: 5, distance_mi: 3 }],
      [{ id: 5, source: 'socrata-austin-permits', kind: 'permit', title: 'Roof permit in Austin', subtype: 'permit', categories: ['roofing'], severity: 1 }],
      [{ user_id: 'g', categories: ['siding-gutters', 'roofing'], lat: 1, lon: 1, state: 'TX', plan: 'pro', subscription_status: 'active' }],
    );
    // Coming soon for siding-gutters outranks Market insight for roofing.
    expect(rows[0]).toMatchObject({ user_id: 'g', trade: 'siding-gutters' });
  });
});

describe('logAlerts never throws', () => {
  const row = { user_id: 'u', signal_id: 1, source: 'nws', kind: 'alert' };
  it('works and ignores repeats', async () => {
    const db = makeDb({ holler_alert_log: [] });
    expect(await logAlerts(db, [row, row])).toBe(1);
    expect(await logAlerts(db, [row])).toBe(0);
  });
  it('survives a throwing client, an error result, a missing table and garbage input', async () => {
    const boom = { from: () => { throw new Error('x'); } } as any;
    const err = { from: () => ({ upsert: () => ({ select: async () => ({ data: null, error: { message: 'relation "holler_alert_log" does not exist' } }) }) }) } as any;
    const rejects = { from: () => ({ upsert: () => ({ select: () => Promise.reject(new Error('net')) }) }) } as any;
    for (const db of [boom, err, rejects, null, undefined, {}]) {
      await expect(logAlerts(db as any, [row])).resolves.toBe(0);
    }
    for (const rows of [null, undefined, 'x', [null], [{}], 5]) await expect(logAlerts(makeDb({}), rows as any)).resolves.toBeTypeOf('number');
  });
  it('markAlertsEmailed never throws and stamps only unstamped rows of that member', async () => {
    const db = makeDb({ holler_alert_log: [{ user_id: 'u', signal_id: 1, emailed_at: null }, { user_id: 'v', signal_id: 1, emailed_at: null }] });
    await markAlertsEmailed(db, 'u', [1], new Date('2026-01-01T00:00:00Z'));
    expect(db.tables.holler_alert_log[0].emailed_at).toBe('2026-01-01T00:00:00.000Z');
    expect(db.tables.holler_alert_log[1].emailed_at).toBeNull();
    await expect(markAlertsEmailed({ from: () => { throw new Error('x'); } } as any, 'u', [1])).resolves.toBeUndefined();
  });
});
