// Regression tests from the r18 TRIAL re-review (probe 21); the R1 (ledger) and R2 (stored end) FINDING cases now assert the fix.
// REV2 probe 21 (r18 TRIAL, commit ef745e4): the signed-in repair (repairShortTrial -> mayExtendTrial -> applyTrialRules) under attack.
// A stateful in-memory admin client that evaluates the PostgREST filters AT WRITE TIME against the row as it then is (so a race is a
// real race), a one-trial "world" (database default, stamp trigger, delete account) and a random walk over member-reachable sequences.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { applyTrialRules, mayExtendTrial, neverPaid, repairShortTrial, trialStartOf, REVIVE_MIN_LEFT_MS, type TrialRow } from '../../lib/auth/trial';
import { TRIAL_DAYS, trialEndFromStart, trialStartedAt } from '../../lib/auth/membership';
import { selectLifecycle, staleTrialSends, type LifecycleProfile, type SendRow } from '../../lib/lifecycle/select';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.parse('2026-11-22T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

interface Row extends TrialRow { user_id: string; created_at: string; trial_ends_at: string; plan_source?: string | null }
interface World {
  meta: Record<string, unknown>;
  row: Row | null;
  ledger: Set<string>;
  calls: { getUser: number; stampWrite: number; select: number; update: number; updateHit: number; ledgerDelete: number; factory: number };
  /** Runs between the moment a guarded UPDATE is issued and the moment it is evaluated. */
  beforeWrite?: (w: World) => void;
  failLedgerDelete?: boolean;
  failStampWrite?: boolean;
}
const world = (row: Row | null, meta: Record<string, unknown> = {}): World => ({
  meta: { ...meta }, row: row ? { ...row } : null, ledger: new Set(['welcome', 'trial_ending', 'trial_ended']),
  calls: { getUser: 0, stampWrite: 0, select: 0, update: 0, updateHit: 0, ledgerDelete: 0, factory: 0 },
});

function adminOf(w: World): any {
  return {
    auth: { admin: {
      getUserById: async () => { w.calls.getUser++; return { data: { user: { id: 'u1', app_metadata: { ...w.meta } } }, error: null }; },
      updateUserById: async (_id: string, p: any) => {
        w.calls.stampWrite++;
        if (w.failStampWrite) return { error: { message: 'auth down' } };
        Object.assign(w.meta, p.app_metadata); return { error: null };
      },
    } },
    from: (table: string) => {
      if (table === 'holler_lifecycle_sends') {
        const d: any = { delete: () => d, eq: () => d, in: async (_k: string, kinds: string[]) => {
          w.calls.ledgerDelete++;
          if (w.failLedgerDelete) return { error: { code: '57014', message: 'timeout' } };
          for (const k of kinds) w.ledger.delete(k); return { error: null };
        } };
        return d;
      }
      const q: any = {
        select: () => q, eq: () => q,
        maybeSingle: async () => { w.calls.select++; return { data: w.row ? { ...w.row } : null, error: null }; },
        update: (patch: Record<string, unknown>) => {
          const tests: ((r: Row) => boolean)[] = [];
          const u: any = {
            eq: (k: string, v: unknown) => { if (k !== 'user_id') tests.push((r) => (r as any)[k] === v); return u; },
            is: (k: string, v: unknown) => { tests.push((r) => ((r as any)[k] ?? null) === v); return u; },
            lt: (k: string, v: string) => { tests.push((r) => Date.parse(String((r as any)[k])) < Date.parse(v)); return u; },
            or: (expr: string) => { if (expr !== 'plan_source.is.null,plan_source.eq.none') throw new Error('unexpected or(): ' + expr); tests.push((r) => r.plan_source == null || r.plan_source === 'none'); return u; },
            select: () => u,
            then: (res: (v: any) => void) => {
              w.calls.update++;
              w.beforeWrite?.(w);
              const hit = !!w.row && tests.every((t) => t(w.row!));
              if (hit) { Object.assign(w.row!, patch); w.calls.updateHit++; }
              res({ error: null, data: hit ? [{ user_id: 'u1', trial_ends_at: w.row!.trial_ends_at }] : [] }); // the columns the write selects
            },
          };
          return u;
        },
      };
      return q;
    },
  };
}
const load = (w: World, now: number) => repairShortTrial({ id: 'u1', app_metadata: { ...w.meta } }, w.row ? { ...w.row } : null, () => { w.calls.factory++; return adminOf(w); }, new Date(now));
const trialing = (createdMs: number, endsMs: number, extra: Partial<Row> = {}): Row => ({ user_id: 'u1', created_at: iso(createdMs), trial_ends_at: iso(endsMs), subscription_status: 'trialing', stripe_subscription_id: null, plan_source: 'none', ...extra });

describe('REV2 repair on page load: cost when nothing needs repair', () => {
  it('a row that is already right never builds the admin client and makes no call (every healthy state)', async () => {
    const healthy: [string, Row | null, Record<string, unknown>][] = [
      ['no profile', null, {}],
      ['new member after 0028 (60 days, microseconds)', { ...trialing(T0, T0 + 60 * DAY), created_at: '2026-11-22T12:00:00.123456+00:00', trial_ends_at: '2027-01-21T12:00:00.123456+00:00' }, { holler_trial_started_at: '2026-11-22T12:00:00.123456+00:00' }],
      ['app-set end (whole ms) on a microsecond start', { ...trialing(T0, T0 + 60 * DAY), created_at: '2026-11-22T12:00:00.123456+00:00', trial_ends_at: '2027-01-21T12:00:00.123Z' }, {}],
      ['day 30 of 60', trialing(T0 - 30 * DAY, T0 + 30 * DAY), { holler_trial_started_at: iso(T0 - 30 * DAY) }],
      ['60-day trial ended yesterday', trialing(T0 - 61 * DAY, T0 - DAY), { holler_trial_started_at: iso(T0 - 61 * DAY) }],
      ['14-day trial, start 58 days back (under 72 h would be left)', trialing(T0 - 58 * DAY, T0 - 44 * DAY), {}],
      ['paying', trialing(T0 - 5 * DAY, T0 + 9 * DAY, { subscription_status: 'active', stripe_subscription_id: 'sub_1', plan_source: 'stripe' }), {}],
      ['past_due', trialing(T0 - 5 * DAY, T0 + 9 * DAY, { subscription_status: 'past_due', stripe_subscription_id: 'sub_1', plan_source: 'stripe' }), {}],
      ['canceled', trialing(T0 - 5 * DAY, T0 + 9 * DAY, { subscription_status: 'canceled' }), {}],
      ['checkout started (trialing + sub id)', trialing(T0 - 5 * DAY, T0 + 9 * DAY, { stripe_subscription_id: 'sub_1' }), {}],
      ['store plan', trialing(T0 - 5 * DAY, T0 + 9 * DAY, { subscription_status: 'active', plan_source: 'apple' }), {}],
      ['returning member, row cut to stamp + 60', trialing(T0, T0 + 20 * DAY), { holler_trial_started_at: iso(T0 - 40 * DAY) }],
    ];
    for (const [name, row, meta] of healthy) {
      const w = world(row, meta);
      expect(await load(w, T0), name).toBeNull();
      expect(w.calls, name).toEqual({ getUser: 0, stampWrite: 0, select: 0, update: 0, updateHit: 0, ledgerDelete: 0, factory: 0 });
    }
  });

  it('a short row costs getUserById + select + one UPDATE + one ledger DELETE once, and the next load costs nothing', async () => {
    const w = world(trialing(T0 - 5 * DAY, T0 + 9 * DAY), { holler_trial_started_at: iso(T0 - 5 * DAY) });
    expect(await load(w, T0)).toBe(iso(T0 + 55 * DAY));
    expect(w.calls).toEqual({ getUser: 1, stampWrite: 0, select: 1, update: 1, updateHit: 1, ledgerDelete: 1, factory: 1 });
    expect(await load(w, T0 + HOUR)).toBeNull();
    expect(w.calls.factory).toBe(1);
  });
});

describe('REV2 mayExtendTrial: exhaustive grid (never past start + 60 days, never a paid row, never a short revival)', () => {
  it('holds for every combination of status, ids, source, start, stamp and current end', () => {
    const statuses = ['trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused', 'incomplete', ''];
    const subs = [null, 'sub_1', ''];
    const sources = [undefined, null, 'none', 'stripe', 'apple', 'google'];
    const startsH = [0, 1, 24, 13 * 24, 14 * 24, 15 * 24, 40 * 24, 56 * 24 + 23, 57 * 24 - 1, 57 * 24, 57 * 24 + 1, 59 * 24, 60 * 24 - 1, 60 * 24, 60 * 24 + 1, 61 * 24, 400 * 24];
    const stampDeltaH: (number | null)[] = [null, 0, -24 * 30, 24 * 3]; // stamp relative to created_at: none, same, 30 days EARLIER, 3 days LATER
    const endsH = [-60 * 24, -47 * 24, -46 * 24, -1, 0, 1, 71, 72, 73, 14 * 24, 59 * 24, 60 * 24, 61 * 24];
    let trues = 0; let n = 0;
    for (const status of statuses) for (const sub of subs) for (const source of sources) for (const sh of startsH) for (const sd of stampDeltaH) for (const eh of endsH) {
      n++;
      const created = T0 - sh * HOUR;
      const stamp = sd === null ? null : iso(created + sd * HOUR);
      const row: TrialRow = { created_at: iso(created), trial_ends_at: iso(T0 + eh * HOUR), subscription_status: status, stripe_subscription_id: sub };
      if (source !== undefined) row.plan_source = source;
      const start = trialStartOf(row.created_at, stamp)!;
      const startMs = Date.parse(start);
      expect(startMs).toBe(Math.min(created, stamp ? Date.parse(stamp) : created)); // the EARLIER of the two, always
      const target = startMs + TRIAL_DAYS * DAY;
      const yes = mayExtendTrial(row, start, T0);
      if (!yes) continue;
      trues++;
      expect(status).toBe('trialing');
      expect(!sub).toBe(true);
      expect(source == null || source === 'none').toBe(true);
      expect(target).toBeGreaterThan(T0);
      expect(T0 + eh * HOUR).toBeLessThan(target - 1000 + 1);
      if (eh <= 0) expect(target).toBeGreaterThan(T0 + REVIVE_MIN_LEFT_MS); // an ENDED trial: only with more than 72 hours left
      expect(Date.parse(trialEndFromStart(start))).toBe(target); // the write target is never later than earliest start + 60 days
    }
    expect(n).toBeGreaterThan(50_000);
    expect(trues).toBeGreaterThan(100);
  });

  it('boundaries to the millisecond: 72 h exactly is NOT revived, 72 h + 1 ms is; an end 1 ms in the future counts as running', () => {
    const mk = (startMs: number, endMs: number): [TrialRow, string] => [{ created_at: iso(startMs), trial_ends_at: iso(endMs), subscription_status: 'trialing', stripe_subscription_id: null }, iso(startMs)];
    const s72 = T0 + 72 * HOUR - 60 * DAY;
    expect(mayExtendTrial(...mk(s72, s72 + 14 * DAY), T0)).toBe(false);
    expect(mayExtendTrial(...mk(s72 + 1, s72 + 1 + 14 * DAY), T0)).toBe(true);
    // ended exactly now (end == now) counts as ended
    expect(mayExtendTrial(...mk(s72, T0), T0)).toBe(false);
    // still running by 1 ms, with only 1 hour of the 60 days left: extended (a running trial is always extended)
    const s1 = T0 + HOUR - 60 * DAY;
    expect(mayExtendTrial(...mk(s1, T0 + 1), T0)).toBe(true);
    // start exactly 60 days back: target == now: never
    expect(mayExtendTrial(...mk(T0 - 60 * DAY, T0 - 46 * DAY), T0)).toBe(false);
  });
});

describe('REV2 repair on page load: who is touched', () => {
  it('paying, past_due, canceled, checkout-started and store-billed rows: no call at all, even when the end is short', async () => {
    for (const extra of [
      { subscription_status: 'active', stripe_subscription_id: 'sub_1', plan_source: 'stripe' },
      { subscription_status: 'active' },
      { subscription_status: 'past_due', stripe_subscription_id: 'sub_1' },
      { subscription_status: 'canceled' },
      { subscription_status: 'canceled', stripe_subscription_id: 'sub_1' },
      { stripe_subscription_id: 'sub_1' },
      { subscription_status: 'active', plan_source: 'apple' },
      { subscription_status: 'canceled', plan_source: 'google' },
      { plan_source: 'apple' }, // trialing but a store source on the row
    ] as Partial<Row>[]) {
      const w = world(trialing(T0 - 5 * DAY, T0 + 9 * DAY, extra), { holler_trial_started_at: iso(T0 - 5 * DAY) });
      const before = w.row!.trial_ends_at;
      expect(await load(w, T0)).toBeNull();
      expect(w.calls.factory).toBe(0);
      expect(w.row!.trial_ends_at).toBe(before);
      expect([...w.ledger].sort()).toEqual(['trial_ended', 'trial_ending', 'welcome']);
    }
  });

  it('RACE: the member subscribes (or a store grant lands) between the page read and the write: nothing is written, the ledger stays, the page is told nothing moved', async () => {
    for (const mutate of [
      (w: World) => { w.row!.subscription_status = 'active'; w.row!.stripe_subscription_id = 'sub_9'; w.row!.plan_source = 'stripe'; },
      (w: World) => { w.row!.stripe_subscription_id = 'sub_9'; },
      (w: World) => { w.row!.subscription_status = 'active'; w.row!.plan_source = 'apple'; },
      (w: World) => { w.row!.plan_source = 'google'; },
      (w: World) => { w.row!.subscription_status = 'canceled'; },
    ]) {
      const w = world(trialing(T0 - 5 * DAY, T0 + 9 * DAY), { holler_trial_started_at: iso(T0 - 5 * DAY) });
      w.beforeWrite = mutate;
      const out = await load(w, T0);
      expect(w.row!.trial_ends_at).toBe(iso(T0 + 9 * DAY));
      expect(w.calls.updateHit).toBe(0);
      expect(w.calls.ledgerDelete).toBe(0);
      expect(out).toBeNull();
    }
  });

  it('RACE: two page loads at once end at the same start + 60, never further', async () => {
    const w = world(trialing(T0 - 5 * DAY, T0 + 9 * DAY), { holler_trial_started_at: iso(T0 - 5 * DAY) });
    const [a, b] = await Promise.all([load(w, T0), load(w, T0 + 3)]);
    expect(w.row!.trial_ends_at).toBe(iso(T0 + 55 * DAY));
    expect(w.calls.updateHit).toBe(1); // the second guarded UPDATE matches nothing
    // Review r3 D1b: the load that lost the race is told the end the row now holds too (it must not go on with the short end it read).
    expect([a, b]).toEqual([iso(T0 + 55 * DAY), iso(T0 + 55 * DAY)]);
    expect(w.calls.ledgerDelete).toBe(1);
  });

  it('a stamp LATER than created_at (hand-edited) never pushes the end past created_at + 60', async () => {
    const w = world(trialing(T0 - 20 * DAY, T0 - 6 * DAY), { holler_trial_started_at: iso(T0 - 2 * DAY) });
    await load(w, T0);
    expect(w.row!.trial_ends_at).toBe(iso(T0 + 40 * DAY));
  });

  it('revival bounds: start 57 d back minus 1 h is revived for 73 h; 57 d exactly, 58 d, 60 d and 61 d stay ended with no call', async () => {
    const a = world(trialing(T0 - 57 * DAY + HOUR, T0 - 43 * DAY + HOUR), {});
    expect(await load(a, T0)).toBe(iso(T0 + 73 * HOUR));
    for (const d of [57, 58, 60, 61]) {
      const w = world(trialing(T0 - d * DAY, T0 - (d - 14) * DAY), {});
      expect(await load(w, T0)).toBeNull();
      expect(w.calls.factory).toBe(0);
    }
  });
});

// ---- the one-trial world: database default, stamp trigger, delete account; random member-reachable sequences ----------------------
function mulberry32(a: number) { return () => { let t = (a += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

describe('REV2 random sequences: delete and re-create, pay, cancel, load, in any order, before and after 0028', () => {
  it('no state gives a never-paid row an end later than the FIRST start + 60 days; repair never raises a paid row; an ended trial is never revived for 72 h or less', async () => {
    const violations: string[] = [];
    let extensions = 0; let revivals = 0; let secondRows = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const rnd = mulberry32(seed);
      let now = T0;
      let db: 14 | 60 = rnd() < 0.5 ? 14 : 60;
      const w = world(null, {});
      let firstStart: number | null = null;
      const trace: string[] = [];
      const insertRow = (viaApp: boolean) => {
        const created = now;
        let end = now + db * DAY;                                   // column default
        const stamp = trialStartedAt(w.meta);
        if (stamp) end = Math.min(end, Date.parse(stamp) + db * DAY); // BEFORE INSERT trigger holler_profiles_trial_from_stamp
        w.row = trialing(created, end);
        w.ledger = new Set();
        if (firstStart === null) firstStart = created; else secondRows++;
        trace.push(`insert(${viaApp ? 'app' : 'jwt'},db${db})`);
      };
      for (let step = 0; step < 40; step++) {
        const r = rnd();
        const beforeEnd = w.row ? Date.parse(w.row.trial_ends_at) : NaN;
        const wasNeverPaid = w.row ? neverPaid(w.row) : false;
        if (r < 0.22) { now += Math.floor(rnd() * 20 * DAY); trace.push('wait'); continue; }
        if (r < 0.27) { now += Math.floor(rnd() * 6 * HOUR); trace.push('wait-h'); continue; }
        if (r < 0.30 && db === 14) { db = 60; trace.push('0028 default/trigger'); continue; }
        if (!w.row) {
          if (r < 0.75) { insertRow(true); await applyTrialRules(adminOf(w), 'u1', new Date(now)); }   // onboarding through the app
          else insertRow(false);                                                                       // own JWT straight to PostgREST: no server step
        } else if (r < 0.62) {
          const out = await load(w, now); trace.push(`load->${out ? 'moved' : 'null'}`);
          const afterEnd = Date.parse(w.row.trial_ends_at);
          if (afterEnd > beforeEnd) {
            extensions++;
            if (!wasNeverPaid) violations.push(`seed ${seed}: repair raised a paid row: ${trace.join(' ')}`);
            if (beforeEnd <= now) { revivals++; if (afterEnd <= now + 72 * HOUR) violations.push(`seed ${seed}: revived for ${(afterEnd - now) / HOUR} h`); }
          }
          if (afterEnd !== beforeEnd && !wasNeverPaid) violations.push(`seed ${seed}: repair wrote to a paid row`);
        } else if (r < 0.70) {
          await applyTrialRules(adminOf(w), 'u1', new Date(now)); trace.push('onboarding-replay');   // POST /api/m/onboarding again
          const afterEnd = Date.parse(w.row.trial_ends_at);
          if (afterEnd > beforeEnd && !wasNeverPaid) violations.push(`seed ${seed}: onboarding replay raised a paid row`);
        } else if (r < 0.80) {
          // Delete account (lib/mobile/account.ts): stamp first (from the row), then the row; the ledger goes with it (0016 trigger).
          if (!trialStartedAt(w.meta)) w.meta.holler_trial_started_at = w.row.created_at;
          w.row = null; w.ledger = new Set(); trace.push('delete-account');
        } else if (r < 0.86) { w.row.subscription_status = 'active'; w.row.stripe_subscription_id = 'sub_x'; w.row.plan_source = 'stripe'; trace.push('subscribe'); }
        else if (r < 0.90) { w.row.stripe_subscription_id = 'sub_x'; trace.push('checkout-open'); }
        else if (r < 0.94) { w.row.subscription_status = 'canceled'; trace.push('cancel'); }
        else if (r < 0.97) { w.row.subscription_status = 'active'; w.row.plan_source = 'apple'; trace.push('store-grant'); }
        else { w.row.subscription_status = 'canceled'; w.row.plan_source = 'apple'; trace.push('store-revoke'); }
        if (w.row && firstStart !== null && w.row.subscription_status === 'trialing') {
          const end = Date.parse(w.row.trial_ends_at);
          if (end > firstStart + TRIAL_DAYS * DAY + 1000) violations.push(`seed ${seed}: end ${(end - firstStart) / DAY} days after the first start: ${trace.join(' ')}`);
        }
      }
    }
    expect(violations.slice(0, 5)).toEqual([]);
    expect(extensions).toBeGreaterThan(20);  // the walk does reach extensions,
    expect(revivals).toBeGreaterThan(5);     // revivals of ended trials,
    expect(secondRows).toBeGreaterThan(50);  // and delete + re-create
    console.log(`random walk: 400 sequences, ${extensions} extensions on load, ${revivals} revivals, ${secondRows} re-created rows, 0 violations`);
  });
});

describe('REV2 findings in the repair path, fixed (review r2 R3, R4)', () => {
  it('R3 fixed: the ledger DELETE fails after the end moved: retried in the call, and the cron then treats the rows as stale for the new end, so the reminder and the ended email still go, each once', async () => {
    const w = world(trialing(T0 - 30 * DAY, T0 - 16 * DAY), { holler_trial_started_at: iso(T0 - 30 * DAY) });
    w.failLedgerDelete = true;
    const errors: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void errors.push(a.join(' '));
    try {
      expect(await load(w, T0)).toBe(iso(T0 + 30 * DAY)); // the trial IS revived
    } finally {
      console.error = orig;
    }
    expect(w.calls.ledgerDelete).toBe(3); // three attempts in the call
    expect(errors.join('\n')).toContain('the lifecycle cron clears stale rows');
    expect([...w.ledger].sort()).toEqual(['trial_ended', 'trial_ending', 'welcome']); // still in the table
    // The rows as the table holds them: written for the OLD end (reminder about 84 h before it, ended a day after it).
    const oldEnd = T0 - 16 * DAY;
    const ledger: SendRow[] = [
      { user_id: 'u1', kind: 'welcome', sent_at: iso(T0 - 29 * DAY) },
      { user_id: 'u1', kind: 'trial_ending', sent_at: iso(oldEnd - 83 * HOUR) },
      { user_id: 'u1', kind: 'trial_ended', sent_at: iso(oldEnd + 20 * HOUR) },
    ];
    const p: LifecycleProfile = { user_id: 'u1', created_at: w.row!.created_at, email_verified_at: w.row!.created_at, subscription_status: 'trialing', trial_ends_at: w.row!.trial_ends_at, stripe_subscription_id: null };
    expect(staleTrialSends([p], ledger).map((r) => r.kind).sort()).toEqual(['trial_ended', 'trial_ending']);
    // Hourly cron from now on: the stale rows do not count, so each email goes once, the reminder first, at the new end.
    const sent: string[] = [];
    const rows = [...ledger];
    const newEnd = Date.parse(p.trial_ends_at!);
    for (let t = T0; t <= newEnd + 3 * DAY; t += HOUR) {
      for (const c of selectLifecycle([p], rows, new Date(t))) {
        sent.push(`${c.kind}@${Math.round((t - newEnd) / HOUR)}h`);
        // the cron cleared the stale row and claimed a fresh one
        const i = rows.findIndex((r) => r.kind === c.kind);
        if (i >= 0) rows.splice(i, 1);
        rows.push({ user_id: 'u1', kind: c.kind, sent_at: iso(t) });
      }
    }
    expect(sent).toEqual(['trial_ending@-84h', 'trial_ended@18h']);
  });

  it('R4 fixed: no stamp yet + the guarded UPDATE matches nothing (member subscribed in between): the caller is handed nothing, never an end the row does not have', async () => {
    const w = world(trialing(T0 - 5 * DAY, T0 + 9 * DAY), {}); // no stamp in app_metadata
    w.beforeWrite = (x) => { x.row!.subscription_status = 'active'; x.row!.stripe_subscription_id = 'sub_9'; };
    const out = await load(w, T0);
    expect(w.calls.updateHit).toBe(0);
    expect(w.row!.trial_ends_at).toBe(iso(T0 + 9 * DAY)); // the row did not move
    expect(out).toBeNull(); // so /app, Settings, Checkout and /api/m/me keep the stored row
  });

  it('R4: when the row moves, the value handed back is the one the row holds afterwards', async () => {
    const w = world(trialing(T0 - 5 * DAY, T0 + 9 * DAY), { holler_trial_started_at: iso(T0 - 5 * DAY) });
    const out = await load(w, T0);
    expect(out).toBe(w.row!.trial_ends_at);
    expect(out).toBe(iso(T0 + 55 * DAY));
  });

  it('NOTE: the stamp write fails: no extension, and EVERY later load repeats getUserById + select + updateUserById (3 calls a load) until it works', async () => {
    const w = world(trialing(T0 - 5 * DAY, T0 + 9 * DAY), {});
    w.failStampWrite = true;
    for (let i = 0; i < 3; i++) expect(await load(w, T0 + i * HOUR)).toBeNull();
    expect(w.calls).toMatchObject({ getUser: 3, select: 3, stampWrite: 3, update: 0 });
    expect(w.row!.trial_ends_at).toBe(iso(T0 + 9 * DAY));
  });

  it('NOTE: an admin client that cannot be built (env missing) never throws into the page and makes no call', async () => {
    const w = world(trialing(T0 - 5 * DAY, T0 + 9 * DAY), {});
    const out = await repairShortTrial({ id: 'u1', app_metadata: {} }, w.row, () => { throw new Error('SUPABASE_SERVICE_ROLE_KEY missing'); }, new Date(T0));
    expect(out).toBeNull();
  });

  it('NOTE: hostile profile shapes never throw (null dates, garbage, numbers)', async () => {
    for (const p of [
      { created_at: null, trial_ends_at: null, subscription_status: 'trialing' },
      { created_at: 'garbage', trial_ends_at: 'garbage', subscription_status: 'trialing' },
      { created_at: 5 as any, trial_ends_at: {} as any, subscription_status: 'trialing' },
      { created_at: iso(T0), trial_ends_at: null, subscription_status: 'trialing' },
    ] as TrialRow[]) {
      const w = world(null, {});
      await expect(repairShortTrial({ id: 'u1', app_metadata: null }, p, () => adminOf(w), new Date(T0))).resolves.not.toThrow(); // trial_ends_at is NOT NULL in the schema; only "never throws" is asserted
    }
  });
});
