// verify-v1 finding 1 (P1), commander decision 2: matches that are history, not news, are never pushed.
//  - every insert that is history (backfill rows, re-map gains, rematches of records older than 3 days, anything inserted notified)
//    also sets pushed_at to the insert time, retried without the column when migration 0020 is not applied;
//  - the push itself counts only matches whose record occurred within the last 3 days and that were not inserted as history.
// And decision 8: FCM's malformed-token answer disables that token; a payload error still disables nothing.
import { beforeEach, describe, expect, it } from 'vitest';
import { classifyFcmError, malformedTokenAnswer, resetFcmCache } from '@/lib/push/fcm';
import { isNews, pushNewMatches } from '@/lib/push/notify';
import { rematchSignals } from '@/lib/signals/rematch';
import { backfillMatches } from '@/lib/signals/backfill';
import { upsertMatchRows, missingPushedAtColumn } from '@/lib/signals/quiet-matches';
import type { MatchProfile } from '@/lib/signals/match';
import { fakeTables } from '../match/fake-table';
import { profileRow, UA, UB } from './fakes';
import { memDb, type MemDb } from './memdb';

const NOW = new Date('2026-11-19T12:00:00Z');
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('decision 2, guard 2: the push counts only news (verifier probe)', () => {
  let m: MemDb;
  let sent: { token: string; title: string; body: string }[];
  const send = async (x: { token: string; title: string; body: string }) => (sent.push({ token: x.token, title: x.title, body: x.body }), { ok: true as const });
  beforeEach(() => {
    sent = [];
    m = memDb({
      holler_profiles: [profileRow(UA), profileRow(UB)],
      holler_push_tokens: [{ id: 'a1', user_id: UA, token: 'tA1', platform: 'ios', disabled_at: null }],
      holler_matches: [],
      holler_signals: [],
    });
  });
  const add = (id: number, occurredMsAgo: number, over: Record<string, unknown> = {}) => {
    m.tables.holler_signals.push({ id: 500 + id, title: `Roof permit in Atlanta ${id}`, city: 'Atlanta', source: 'arcgis-atlanta-permits', expires_at: null, occurred_at: ago(occurredMsAgo) });
    m.tables.holler_matches.push({ id, user_id: UA, signal_id: 500 + id, status: 'new', notified: true, pushed_at: null, created_at: ago(5 * 60_000), ...over });
  };

  it('two notified matches created 5 minutes ago for records 12 and 13 days old: nothing is sent', async () => {
    add(1, 12 * DAY);
    add(2, 13 * DAY);
    const r = await pushNewMatches(m.db as never, { now: NOW, configured: true, send });
    expect(sent).toEqual([]);
    expect(r.members_pushed).toBe(0);
    expect(r.matches_pushed).toBe(0);
  });
  it('a record of 2 days ago matched 5 minutes ago is still news and is pushed', async () => {
    add(3, 2 * DAY);
    const r = await pushNewMatches(m.db as never, { now: NOW, configured: true, send });
    expect(r.matches_pushed).toBe(1);
    expect(sent.map((s) => s.title)).toEqual(['New alert near Atlanta']);
  });
  it('isNews: future starts count, missing dates and records older than 3 days at insert do not', () => {
    const now = NOW.getTime();
    expect(isNews(ago(-DAY), ago(0), now)).toBe(true);
    expect(isNews(null, ago(0), now)).toBe(false);
    expect(isNews(ago(3 * DAY + 1000), ago(0), now)).toBe(false);
    expect(isNews(ago(2 * DAY), ago(0), now)).toBe(true);
  });
});

describe('decision 2, guard 1: history rows are inserted with pushed_at set', () => {
  const profile: MatchProfile = { user_id: UA, categories: ['roofing'], lat: 33.75, lon: -84.39, state: 'GA', radius_mi: 10 };
  const sig = (id: number, occurredMsAgo: number) => ({
    id, source: 'arcgis-atlanta-permits', kind: 'permit', categories: ['roofing'], lat: 33.75, lon: -84.39, state: 'GA', severity: 1,
    occurred_at: ago(occurredMsAgo), expires_at: null, title: 'Roof permit in Atlanta', summary: null, data: { subtype: 'permit' },
  });

  it('rematch: a 12-day-old record is inserted notified and pushed_at = now; a fresh record is news (pushed_at null)', async () => {
    const db = fakeTables({ holler_signals: [sig(1, 12 * DAY), sig(2, 2 * 3_600_000)], holler_matches: [] });
    const r = await rematchSignals(db, [1, 2], { now: NOW, profiles: [profile] });
    expect(r).toEqual({ created: 2 });
    const byId = (s: number) => db.tables.holler_matches.find((x: { signal_id: number }) => x.signal_id === s);
    expect(byId(1)).toMatchObject({ notified: true, pushed_at: NOW.toISOString() });
    expect(byId(2)).toMatchObject({ notified: false, pushed_at: null });
  });
  it('rematch quiet (re-map gain): even a 2-hour-old record is history, pushed_at set', async () => {
    const db = fakeTables({ holler_signals: [sig(2, 2 * 3_600_000)], holler_matches: [] });
    await rematchSignals(db, [2], { now: NOW, profiles: [profile], quiet: true });
    expect(db.tables.holler_matches[0]).toMatchObject({ notified: true, pushed_at: NOW.toISOString() });
  });
  it('backfill rows carry pushed_at = now', async () => {
    const db = fakeTables({ holler_signals: [], holler_matches: [] });
    db.rpc = () => ({ select: () => Promise.resolve({ data: [{ ...sig(7, 2 * DAY), data: { subtype: 'permit' } }], error: null }) });
    // no state: the state-level read (overlaps, which this fake lacks) is skipped; the approx read fails soft
    const r = await backfillMatches(db, { ...profile, state: null } as never, NOW);
    expect(r.matched).toBe(1);
    expect(db.tables.holler_matches[0]).toMatchObject({ signal_id: 7, notified: true, pushed_at: NOW.toISOString() });
  });
  it('before migration 0020 (no pushed_at column) the insert is retried without the column', async () => {
    const db = fakeTables({ holler_signals: [sig(1, 12 * DAY)], holler_matches: [] });
    const orig = db.from.bind(db);
    let failed = 0;
    db.from = (t: string) => {
      const q = orig(t);
      if (t !== 'holler_matches') return q;
      const up = q.upsert.bind(q);
      q.upsert = (rows: Record<string, unknown>[], o: unknown) => {
        if (rows.some((r) => 'pushed_at' in r)) {
          failed++;
          return { select: () => Promise.resolve({ data: null, error: { message: "Could not find the 'pushed_at' column of 'holler_matches' in the schema cache" } }) };
        }
        return up(rows, o);
      };
      return q;
    };
    const r = await rematchSignals(db, [1], { now: NOW, profiles: [profile] });
    expect(failed).toBe(1);
    expect(r).toEqual({ created: 1 });
    expect(db.tables.holler_matches[0].pushed_at).toBeUndefined();
    expect(db.tables.holler_matches[0].notified).toBe(true);
  });
  it('another error is not retried', async () => {
    expect(missingPushedAtColumn('permission denied for table holler_matches')).toBe(false);
    expect(missingPushedAtColumn('column "pushed_at" of relation "holler_matches" does not exist')).toBe(true);
    const db = { from: () => ({ upsert: () => ({ select: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }) }) };
    await expect(upsertMatchRows(db as never, [{ user_id: UA, signal_id: 1, distance_mi: null, notified: true, pushed_at: 'x' }], { count: true })).rejects.toThrow('boom');
  });
});

describe('decision 8: FCM malformed registration token', () => {
  beforeEach(() => resetFcmCache());
  const fcmOnly = (message: string) => ({
    error: { code: 400, status: 'INVALID_ARGUMENT', message, details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'INVALID_ARGUMENT' }] },
  });
  it('INVALID_ARGUMENT with only the FcmError detail and a message naming the registration token disables the token', () => {
    const body = fcmOnly('The registration token is not a valid FCM registration token');
    expect(malformedTokenAnswer(body)).toBe(true);
    expect(classifyFcmError(400, body)).toBe('dead');
  });
  it('a payload error still disables nothing', () => {
    expect(classifyFcmError(400, fcmOnly("Invalid value at 'message.data[0].value' (TYPE_STRING)"))).toBe('payload');
    expect(classifyFcmError(400, fcmOnly('Request contains an invalid argument.'))).toBe('payload');
    // a registration-token message next to a field violation about another field is a payload error
    expect(
      classifyFcmError(400, {
        error: {
          status: 'INVALID_ARGUMENT',
          message: 'registration token',
          details: [{ '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field: 'message.apns.payload' }] }],
        },
      }),
    ).toBe('payload');
  });
});
