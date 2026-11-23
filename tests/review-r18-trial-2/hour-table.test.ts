// Regression test from the r18 TRIAL re-review (probe 22).
// REV2 probe 22 (r18 TRIAL, commit ef745e4): the 72-hour rule, hour by hour, for original starts from 40 to 61 days back.
// Inputs: (a) what migration 0028 really did to one member per hour on Postgres 16 (probe 20, TSV), (b) the app's own decision
// (mayExtendTrial / repairShortTrial), (c) the real lifecycle selection (selectLifecycle) run at every hourly cron tick afterwards.
// Each member: never paid, verified email, the old 14-day trial (ended at start + 14 days), all three ledger rows already written.
// Writes the full table to REV2-TRIAL-hour-table.md and fails on any anomaly.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mayExtendTrial, repairShortTrial } from '../../lib/auth/trial';
import { selectLifecycle, WINDOWS, type LifecycleProfile, type SendRow } from '../../lib/lifecycle/select';
import { TRIAL_ENDED_SUBJECT, TRIAL_ENDING_SUBJECT } from '../../lib/lifecycle/templates';

const HOUR = 3_600_000;
const MIN = 60_000;
const DAY = 24 * HOUR;
const T0 = Date.parse('2026-11-22T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
// The grid is what migration 0028 did on Postgres 16 (reviewer probe 20), kept as a fixture; the table is no longer written to disk.
const TSV = path.join(__dirname, 'fixtures/hour-grid-0028-pg16.tsv');

interface Mail { kind: string; atH: number; relEndH: number }
/** Hourly cron, first tick `phaseMin` minutes after T0, for `days` days. Returns every lifecycle email that goes out. */
function emails(p: LifecycleProfile, ledger0: string[], phaseMin: number, days = 26, skipTicks: (k: number) => boolean = () => false): Mail[] {
  const ledger: SendRow[] = ledger0.map((kind) => ({ user_id: p.user_id, kind }));
  const out: Mail[] = [];
  const end = Date.parse(p.trial_ends_at!);
  for (let k = 0; k < days * 24; k++) {
    if (skipTicks(k)) continue;
    const t = T0 + phaseMin * MIN + k * HOUR;
    for (const c of selectLifecycle([p], ledger, new Date(t))) {
      out.push({ kind: c.kind, atH: (t - T0) / HOUR, relEndH: (t - end) / HOUR });
      ledger.push({ user_id: p.user_id, kind: c.kind });
    }
  }
  return out;
}
const dh = (h: number) => `${Math.floor(h / 24)}d ${String(h % 24).padStart(2, '0')}h`;
const f1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

describe('REV2 hour table: starts 40 to 61 days back', () => {
  it('0028 and the app agree on every hour, every revived member gets the reminder before the second "paused", nobody else gets anything', async () => {
    const grid = readFileSync(TSV, 'utf8').trim().split('\n').map((l) => l.split('\t')).filter((c) => Number(c[0]) < 900000)
      .map((c) => ({ h: Number(c[0]), beforeH: Number(c[1]), afterH: Number(c[2]), ledger: c[3].split(',') }));
    expect(grid.length).toBe(505); // 960..1464 hours back, inclusive
    const anomalies: string[] = [];
    const lines: string[] = [];
    const bands: { from: number; to: number; key: string; sample: string }[] = [];
    let minLeft = Infinity; let maxLeft = 0; let revived = 0; let untouched = 0;
    for (const g of grid) {
      const start = T0 - g.h * HOUR;
      const oldEnd = start + 14 * DAY;
      const row = { created_at: iso(start), trial_ends_at: iso(oldEnd), subscription_status: 'trialing', stripe_subscription_id: null, plan_source: 'none' };
      // (a) Postgres: what 0028 did
      const pgRevived = g.afterH > 0;
      // (b) the app: the pure guard, and the real repair call against a one-row fake
      const appMay = mayExtendTrial(row, iso(start), T0);
      const state = { end: row.trial_ends_at, ledger: ['welcome', 'trial_ending', 'trial_ended'] };
      const admin: any = {
        auth: { admin: { getUserById: async () => ({ data: { user: { id: 'u', app_metadata: { holler_trial_started_at: iso(start) } } }, error: null }), updateUserById: async () => ({ error: null }) } },
        from: (t: string) => t === 'holler_lifecycle_sends'
          ? (() => { const d: any = { delete: () => d, eq: () => d, in: async (_k: string, kinds: string[]) => { state.ledger = state.ledger.filter((k) => !kinds.includes(k)); return { error: null }; } }; return d; })()
          : (() => { const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { ...row, trial_ends_at: state.end }, error: null }),
              update: (patch: any) => { const u: any = { eq: () => u, is: () => u, lt: () => u, or: () => u, select: () => u, then: (res: any) => { state.end = patch.trial_ends_at; res({ data: [{ user_id: 'u' }], error: null }); } }; return u; } }; return q; })(),
      };
      const repaired = await repairShortTrial({ id: 'u', app_metadata: { holler_trial_started_at: iso(start) } }, row, () => admin, new Date(T0));
      const appRevived = repaired !== null;
      const appEndH = (Date.parse(state.end) - T0) / HOUR;
      if (appMay !== pgRevived || appRevived !== pgRevived) anomalies.push(`${g.h} h: 0028 ${pgRevived ? 'revives' : 'leaves'} but the app ${appRevived ? 'revives' : 'leaves'}`);
      if (pgRevived && Math.abs(appEndH - g.afterH) > 0.001) anomalies.push(`${g.h} h: 0028 end ${g.afterH} h, app end ${appEndH} h`);
      if (pgRevived && g.ledger.join(',') !== 'welcome') anomalies.push(`${g.h} h: 0028 ledger after = ${g.ledger.join(',')}`);
      if (pgRevived && state.ledger.join(',') !== 'welcome') anomalies.push(`${g.h} h: app ledger after = ${state.ledger.join(',')}`);
      if (!pgRevived && g.ledger.join(',') !== 'trial_ended,trial_ending,welcome') anomalies.push(`${g.h} h: untouched row lost ledger rows`);

      // (c) emails afterwards, for three cron phases (the cron is hourly at :17; T0 can be any minute)
      const p: LifecycleProfile = { user_id: 'u', created_at: iso(start), email_verified_at: iso(start + HOUR), subscription_status: 'trialing', trial_ends_at: pgRevived ? iso(T0 + g.afterH * HOUR) : iso(oldEnd), stripe_subscription_id: null };
      const perPhase = [1, 17, 59].map((ph) => emails(p, pgRevived ? ['welcome'] : ['welcome', 'trial_ending', 'trial_ended'], ph));
      const mails = perPhase[1];
      const flags: string[] = [];
      for (const ms of perPhase) {
        const ending = ms.filter((m) => m.kind === 'trial_ending');
        const ended = ms.filter((m) => m.kind === 'trial_ended');
        if (ms.some((m) => m.kind === 'welcome')) anomalies.push(`${g.h} h: a second welcome`);
        if (pgRevived) {
          if (ending.length !== 1) anomalies.push(`${g.h} h: ${ending.length} reminders (want 1)`);
          if (ended.length !== 1) anomalies.push(`${g.h} h: ${ended.length} ended emails after revival (want 1)`);
          if (ending[0] && ending[0].relEndH >= 0) anomalies.push(`${g.h} h: "${TRIAL_ENDING_SUBJECT}" sent AFTER the end`);
          if (ending[0] && (-ending[0].relEndH < WINDOWS.trial_ending.from || -ending[0].relEndH > WINDOWS.trial_ending.to)) anomalies.push(`${g.h} h: reminder ${-ending[0].relEndH} h before the end`);
          if (ending[0] && ended[0] && ending[0].atH >= ended[0].atH) anomalies.push(`${g.h} h: "paused" before the reminder`);
          if (ended[0] && ended[0].relEndH < WINDOWS.trial_ended.from) anomalies.push(`${g.h} h: ended email ${ended[0].relEndH} h after the end`);
        } else if (ms.length) anomalies.push(`${g.h} h: an untouched member got ${ms.map((m) => m.kind).join(',')}`);
      }
      const ending = mails.find((m) => m.kind === 'trial_ending');
      const ended = mails.find((m) => m.kind === 'trial_ended');
      if (pgRevived) { revived++; minLeft = Math.min(minLeft, g.afterH); maxLeft = Math.max(maxLeft, g.afterH); flags.push('second "paused" email (after a reminder)'); } else untouched++;
      const what0028 = pgRevived ? `revived, new end T0+${f1(g.afterH)} h (${f1(g.afterH / 24)} d left)` : g.h >= 1440 ? 'untouched (60 days already over)' : 'untouched (72 h or less would be left)';
      const whatApp = appRevived ? `revived to the same end` : 'no call, untouched';
      const rem = ending ? `T0+${f1(ending.atH)} h (${f1(-ending.relEndH)} h before the end)` : 'none';
      const end2 = ended ? `T0+${f1(ended.atH)} h (${f1(ended.relEndH)} h after the end)` : 'none';
      lines.push(`| ${g.h} | ${dh(g.h)} | ${f1(-g.beforeH / 24)} d ago | ${what0028} | ${whatApp} | ${rem} | ${end2} | ${flags.join('; ') || 'nothing sent, nothing due'} |`);
      const key = pgRevived ? (ending && ending.atH < 1.5 ? 'revived, reminder at the first cron tick' : 'revived, reminder later') : g.h >= 1440 ? 'over' : 'short';
      const last = bands[bands.length - 1];
      if (last && last.key === key) last.to = g.h; else bands.push({ from: g.h, to: g.h, key, sample: lines[lines.length - 1] });
    }

    // How many hourly cron ticks in a row can fail before the WORST revived member (just over 72 h left) loses the reminder?
    const worst = grid.filter((g) => g.afterH > 0).sort((a, b) => a.afterH - b.afterH)[0];
    const wp: LifecycleProfile = { user_id: 'u', created_at: iso(T0 - worst.h * HOUR), email_verified_at: iso(T0), subscription_status: 'trialing', trial_ends_at: iso(T0 + worst.afterH * HOUR), stripe_subscription_id: null };
    let tolerated = 0;
    for (let miss = 1; miss <= 30; miss++) {
      const ms = emails(wp, ['welcome'], 17, 10, (k) => k < miss);
      if (ms.some((m) => m.kind === 'trial_ending')) tolerated = miss; else break;
    }
    const lostThenPaused = emails(wp, ['welcome'], 17, 10, (k) => k < tolerated + 1);

    const header = [
      `# r18 TRIAL re-review: hour-by-hour table, starts 40 to 61 days back (commit ef745e4)`,
      ``,
      `T0 is the moment 0028 runs (or the member's page load, for the app repair). Member: never paid, verified email, old 14-day trial, ledger has welcome + trial_ending + trial_ended.`,
      `0028 column: Postgres 16.x, real migration file (probe 20). App column: real repairShortTrial. Emails: real selectLifecycle at every hourly tick (first tick 17 min after T0; phases 1 and 59 min checked too).`,
      `Revived: ${revived} of 505 hours (${dh(grid[0].h)} to ${dh(1367)} back), time left ${f1(minLeft)} h to ${f1(maxLeft)} h. Untouched: ${untouched} (${dh(1368)} to ${dh(1464)} back).`,
      `Worst revived member (${f1(worst.afterH)} h left): the reminder still goes out if the first ${tolerated} hourly ticks after T0 all fail; with ${tolerated + 1} missed ticks it is lost and the member gets: ${lostThenPaused.map((m) => m.kind).join(', ') || 'nothing'}.`,
      `Anomalies: ${anomalies.length}.`,
      ``,
      `| hours back | start back | 14-day trial ended | migration 0028 | app repair on a page load | "${TRIAL_ENDING_SUBJECT}" | "${TRIAL_ENDED_SUBJECT}" (second time) | flags |`,
      `|---|---|---|---|---|---|---|---|`,
    ];
    expect([...header, ...lines].length).toBeGreaterThan(500); // the table (reviewer's REV2-TRIAL-hour-table.md) is built, not written
    console.log(JSON.stringify({ revived, untouched, minLeft, maxLeft, tolerated, lostThenPaused, bands: bands.map((b) => ({ from: b.from, to: b.to, key: b.key })), anomalies: anomalies.slice(0, 10) }, null, 1));
    for (const b of bands) console.log(`${dh(b.from)} .. ${dh(b.to)}: ${b.key}\n   first row: ${b.sample}`);
    expect(anomalies).toEqual([]);
    expect(revived).toBe(408);
    expect(minLeft).toBeGreaterThan(72);
  });

  it('a later page load (the app repair without 0028) follows the same clock: the decision depends only on the time left at that load', () => {
    // start 56 d 12 h back at T0: 84 h left -> revived if the member loads now, not revived if they first load 12 h later (72 h left)
    const start = T0 - (56 * 24 + 12) * HOUR;
    const row = { created_at: iso(start), trial_ends_at: iso(start + 14 * DAY), subscription_status: 'trialing', stripe_subscription_id: null };
    expect(mayExtendTrial(row, iso(start), T0)).toBe(true);
    expect(mayExtendTrial(row, iso(start), T0 + 12 * HOUR - 1)).toBe(true);
    expect(mayExtendTrial(row, iso(start), T0 + 12 * HOUR)).toBe(false);
  });
});
