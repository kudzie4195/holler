// Review r2 R2 and R3 (r18 TRIAL), through the real runLifecycle with an in-memory store:
//  R2: code live, 0028 not applied. A member on an old 14-day row inside the reminder window is one the app would extend. The cron must
//      extend first (repairTrial) and NOT send "Your trial ends in 3 days"; the new end gets its own emails later. If the repair does not
//      move the row (a returning member, a refused write), the email goes as before.
//  R3: the extension moved the end but the ledger delete was lost. The cron treats rows written for the earlier end as stale, clears them
//      (retrying on the next run if the clear fails), and the emails for the new end go once each.
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { runLifecycle } from '../../lib/lifecycle/run';
import type { FullProfile, LifecycleStore } from '../../lib/lifecycle/store';
import type { SendRow } from '../../lib/lifecycle/select';
import type { SendEmailInput, SendEmailResult } from '../../lib/email';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-11-22T12:17:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

interface W {
  profile: FullProfile;
  ledger: SendRow[];
  stamp: string | null;
  failRelease: number;
  sent: string[];
  /** The database clock for sent_at (the run's now). */
  at?: number;
}

function store(w: W): LifecycleStore {
  return {
    loadProfiles: async () => [w.profile],
    loadSends: async () => w.ledger.map((r) => ({ ...r })),
    claim: async (u, k) => {
      if (w.ledger.some((r) => r.user_id === u && r.kind === k)) return 'exists';
      w.ledger.push({ user_id: u, kind: k, sent_at: iso(w.at ?? NOW) });
      return 'claimed';
    },
    release: async (u, k) => {
      if (w.failRelease > 0) {
        w.failRelease--;
        throw new Error('release: timeout');
      }
      w.ledger = w.ledger.filter((r) => !(r.user_id === u && r.kind === k));
    },
    isOptedOut: async () => false,
    emailOf: async () => 'm@example.test',
    trialStartedAt: async () => w.stamp,
    matchesOf: async () => ({ items: [], total: 0, capped: false }),
    quietPreview: async () => null,
    missedSince: async () => ({ count: 0, capped: false }),
  };
}

const send = (w: W) => async (input: SendEmailInput): Promise<SendEmailResult> => (w.sent.push(input.subject), { ok: true, id: 'em' } as SendEmailResult);
const run = (w: W, now: number, repairTrial?: (u: string, n: Date) => Promise<string | null>) => {
  w.at = now;
  return runLifecycle({ store: store(w), send: send(w), siteUrl: 'https://holler.test', secret: 's', now: new Date(now), repairTrial, clock: () => 0 });
};

const member = (startBackD: number, endFromNowH: number): FullProfile => ({
  user_id: 'u1',
  business_name: 'Ace',
  created_at: iso(NOW - startBackD * DAY),
  email_verified_at: iso(NOW - startBackD * DAY),
  subscription_status: 'trialing',
  trial_ends_at: iso(NOW + endFromNowH * HOUR),
  stripe_subscription_id: null,
  categories: ['roofing'],
  lat: 33.9,
  lon: -84.5,
  state: 'GA',
  radius_mi: 25,
});

describe('R2: the cron extends before a trial email (code live, 0028 not applied)', () => {
  it('day 11 of an old 14-day row (72 h left): no "ends in 3 days"; the repair runs and the email is skipped', async () => {
    const w: W = { profile: member(11, 72), ledger: [{ user_id: 'u1', kind: 'welcome', sent_at: iso(NOW - 10 * DAY) }], stamp: iso(NOW - 11 * DAY), failRelease: 0, sent: [] };
    const repaired: string[] = [];
    const s = await run(w, NOW, async (u) => (repaired.push(u), iso(NOW - 11 * DAY + 60 * DAY)));
    expect(repaired).toEqual(['u1']);
    expect(w.sent).toEqual([]);
    expect(s).toMatchObject({ skipped_trial_extended: 1, sent: { trial_ending: 0 } });
    expect(w.ledger.map((r) => r.kind)).toEqual(['welcome']); // no claim was taken
  });

  it('a 14-day trial that ended a day ago (start 15 days back): no second "paused"; extended instead', async () => {
    const w: W = { profile: member(15, -24), ledger: [{ user_id: 'u1', kind: 'welcome' }, { user_id: 'u1', kind: 'trial_ending' }], stamp: iso(NOW - 15 * DAY), failRelease: 0, sent: [] };
    const s = await run(w, NOW, async () => iso(NOW - 15 * DAY + 60 * DAY));
    expect(w.sent).toEqual([]);
    expect(s).toMatchObject({ skipped_trial_extended: 1 });
  });

  it('the repair did not move the row (returning member, refused write): the email goes as before', async () => {
    const w: W = { profile: member(11, 72), ledger: [{ user_id: 'u1', kind: 'welcome' }], stamp: iso(NOW - 11 * DAY), failRelease: 0, sent: [] };
    const s = await run(w, NOW, async () => null);
    expect(w.sent).toEqual(['Your trial ends in 3 days']);
    expect(s).toMatchObject({ skipped_trial_extended: 0, sent: { trial_ending: 1 } });
  });

  it('a member already at start + 60 (0028 applied) is never sent to the repair; the reminder goes', async () => {
    const w: W = { profile: member(57, 72), ledger: [{ user_id: 'u1', kind: 'welcome' }], stamp: iso(NOW - 57 * DAY), failRelease: 0, sent: [] };
    const calls: string[] = [];
    await run(w, NOW, async (u) => (calls.push(u), null));
    expect(calls).toEqual([]);
    expect(w.sent).toEqual(['Your trial ends in 3 days']);
  });

  it('a late send (missed runs, 40 h left) states 2 days, not 3', async () => {
    const w: W = { profile: member(57.5, 40), ledger: [{ user_id: 'u1', kind: 'welcome' }], stamp: iso(NOW - 57.5 * DAY), failRelease: 0, sent: [] };
    await run(w, NOW);
    expect(w.sent).toEqual(['Your trial ends in 2 days']);
  });

  it('dry run: counts the member as extended and writes nothing', async () => {
    const w: W = { profile: member(11, 72), ledger: [{ user_id: 'u1', kind: 'welcome' }], stamp: iso(NOW - 11 * DAY), failRelease: 0, sent: [] };
    let called = 0;
    const s = await runLifecycle({ store: store(w), send: send(w), siteUrl: 'https://holler.test', secret: 's', now: new Date(NOW), dry: true, repairTrial: async () => (called++, 'x') });
    expect(called).toBe(0);
    expect(s).toMatchObject({ skipped_trial_extended: 1 });
    expect(w.sent).toEqual([]);
  });
});

describe('R3: the ledger delete was lost after an extension; the cron recovers', () => {
  // Start 30 days back: the old 14-day trial ended 16 days ago (reminder and "paused" were sent then); the row now ends at start + 60.
  const oldEnd = NOW - 16 * DAY;
  const staleLedger = (): SendRow[] => [
    { user_id: 'u1', kind: 'welcome', sent_at: iso(NOW - 29 * DAY) },
    { user_id: 'u1', kind: 'trial_ending', sent_at: iso(oldEnd - 83 * HOUR) },
    { user_id: 'u1', kind: 'trial_ended', sent_at: iso(oldEnd + 20 * HOUR) },
  ];

  it('failure then recovery: the clear fails on the first run (nothing is sent twice), succeeds on the next, and each email for the new end goes once', async () => {
    // Fast-forward to 80 h before the new end (start + 60 = NOW + 30 days).
    const newEnd = NOW + 30 * DAY;
    const w: W = { profile: { ...member(30, 0), trial_ends_at: iso(newEnd) }, ledger: staleLedger(), stamp: iso(NOW - 30 * DAY), failRelease: 2, sent: [] };
    const t1 = newEnd - 80 * HOUR;
    const r1 = await run(w, t1);
    expect(w.sent).toEqual([]); // the stale rows could not be cleared, so the claim found them: no send, never twice
    expect(r1).toMatchObject({ stale_cleared: 0, already_sent: 1 });
    const r2 = await run(w, t1 + HOUR);
    expect(r2).toMatchObject({ stale_cleared: 2 });
    expect(w.sent).toEqual(['Your trial ends in 3 days']);
    for (let h = 2; h <= 100; h++) await run(w, t1 + h * HOUR); // through the end and a day after
    expect(w.sent).toEqual(['Your trial ends in 3 days', 'Your alerts are paused']);
    expect(w.ledger.map((r) => r.kind).sort()).toEqual(['trial_ended', 'trial_ending', 'welcome']);
  });

  it('a row with no sent_at, or one written for the CURRENT end, is never treated as stale', async () => {
    const newEnd = NOW + 3 * DAY + HOUR;
    const w: W = {
      profile: { ...member(30, 0), trial_ends_at: iso(newEnd) },
      ledger: [{ user_id: 'u1', kind: 'welcome' }, { user_id: 'u1', kind: 'trial_ending', sent_at: iso(newEnd - 84 * HOUR) }, { user_id: 'u1', kind: 'trial_ended' }],
      stamp: iso(NOW - 30 * DAY),
      failRelease: 0,
      sent: [],
    };
    const r = await run(w, newEnd - 70 * HOUR);
    expect(r).toMatchObject({ stale_cleared: 0 });
    expect(w.sent).toEqual([]);
  });
});
