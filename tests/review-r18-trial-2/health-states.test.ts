// Regression tests from the r18 TRIAL re-review (probe 23); FINDING H1 (R6) now asserts the fix.
// REV2 probe 23 (r18 TRIAL, commit ef745e4): the health email's "Free trial length" line and subject in every state, and that no
// payload or client failure can break the email.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { loadTrialDbCheck, trialCheckLine, type TrialDbCheck } from '../../lib/auth/trial-check';
import { planHealth, renderHealthEmail, type HealthCounts, type HealthReport } from '../../lib/email/health';

const NOW = new Date('2026-11-22T13:03:00.000Z');
const counts: HealthCounts = { newSignups24h: 1, activeSubscribers: 2, trialing: 3, usersEmailed24h: 4 };
const cleanReport = (): HealthReport => planHealth({ adapters: [], runs: [{ source: null, started_at: new Date(NOW.getTime() - 60_000).toISOString(), fetched: 1, inserted: 1, error: null }], counts, now: NOW });
const rpc = (data: unknown, error: any = null) => ({ rpc: async () => ({ data, error }) });

describe('REV2 health line: each state', () => {
  it('the trial migration applied: ok line, subject untouched', async () => {
    const c = await loadTrialDbCheck(rpc({ default_days: 30, stamp_cap_days: 30, guard_cap_days: 30 }));
    expect(c.status).toBe('ok');
    const r = cleanReport(); r.trialCheck = c;
    const m = renderHealthEmail(r);
    expect(m.subject).toBe(r.subject);
    expect(m.text).toContain('Free trial: the site says 30 days and the database enforces 30 days');
  });

  it('the check function missing (the real PostgREST and Postgres codes for a missing function): MISMATCH line and subject', async () => {
    for (const code of ['PGRST202', '42883']) {
      const c = await loadTrialDbCheck(rpc(null, { code, message: 'Could not find the function public.holler_trial_db_check without parameters in the schema cache' }));
      expect(c.status).toBe('not_applied');
      const r = cleanReport(); r.trialCheck = c;
      const m = renderHealthEmail(r);
      expect(m.subject).toBe('Holler health: free trial length does not match the database');
      expect(m.text).toContain('holler_trial_db_check() is missing: no trial migration is applied, or the API has not reloaded its schema');
      expect(m.text).not.toMatch(/the database default is still 14 days/); // the old over-claim (F10) is gone
    }
  });

  it('0019 re-run after 0028 (14/14/14), and each single place wrong: MISMATCH with the three numbers', async () => {
    for (const d of [{ default_days: 14, stamp_cap_days: 14, guard_cap_days: 14 }, { default_days: 30, stamp_cap_days: 14, guard_cap_days: 30 }, { default_days: 30, stamp_cap_days: 30, guard_cap_days: 14 }, { default_days: 14, stamp_cap_days: 30, guard_cap_days: 30 }, { default_days: 90, stamp_cap_days: 30, guard_cap_days: 30 }]) {
      const c = await loadTrialDbCheck(rpc(d));
      expect(c.status).toBe('mismatch');
      const line = trialCheckLine(c);
      expect(line).toContain(`column default ${d.default_days} days`);
      expect(line).toContain(`one-trial cap ${d.stamp_cap_days} days`);
      expect(line).toContain(`member insert cap ${d.guard_cap_days} days`);
    }
  });

  it('read error (timeout, permission denied, 500, thrown, rejected): "could not read" line and its own subject, never "OK"', async () => {
    const clients: any[] = [
      rpc(null, { code: '57014', message: 'canceling statement due to statement timeout' }),
      rpc(null, { code: '42501', message: 'permission denied for function holler_trial_db_check' }),
      rpc(null, { message: 'fetch failed' }),
      rpc(null, {}),
      { rpc: () => { throw new Error('boom'); } },
      { rpc: () => Promise.reject(new Error('boom')) },
      { rpc: async () => { throw 'string thrown'; } },
      {}, // no rpc at all
      null,
    ];
    for (const cl of clients) {
      const c = await loadTrialDbCheck(cl);
      expect(c.status).toBe('error');
      const r = cleanReport(); r.trialCheck = c;
      const m = renderHealthEmail(r);
      expect(m.subject).toBe('Holler health: could not check the free trial length');
      expect(m.text).toContain('could not read the database trial length');
    }
  });

  it('hostile payloads: never throws, never says ok unless all three are the number 30', async () => {
    const payloads: unknown[] = [null, undefined, 30, '30', [], [30, 30, 30], {}, { default_days: '30', stamp_cap_days: '30', guard_cap_days: '30' }, { default_days: 30 }, { default_days: NaN, stamp_cap_days: 30, guard_cap_days: 30 },
      { default_days: 30, stamp_cap_days: 30, guard_cap_days: Infinity }, { default_days: 30.0000001, stamp_cap_days: 30, guard_cap_days: 30 }, { default_days: null, stamp_cap_days: null, guard_cap_days: null },
      { default_days: { toString: () => '30' }, stamp_cap_days: 30, guard_cap_days: 30 }, { default_days: '<script>alert(1)</script>', stamp_cap_days: 30, guard_cap_days: 30 }];
    for (const p of payloads) {
      const c = await loadTrialDbCheck(rpc(p));
      expect(c.status).toBe('mismatch');
      const r = cleanReport(); r.trialCheck = c;
      const m = renderHealthEmail(r);
      expect(m.html).not.toContain('<script>');
      expect(m.subject).toBe('Holler health: free trial length does not match the database');
    }
  });

  it('with real source problems the subject keeps the sources and ADDS the trial part; the trial line is in the body', async () => {
    const r = planHealth({ adapters: [{ id: 'x', label: 'X', kind: 'permit', cadenceMinutes: 15 }], runs: [], counts, now: NOW });
    expect(r.problemCount).toBeGreaterThan(0);
    r.trialCheck = await loadTrialDbCheck(rpc(null, { code: 'PGRST202' }));
    const m = renderHealthEmail(r);
    expect(m.subject).toBe(`${r.subject}; free trial length does not match the database`);
    expect(m.text).toContain('MISMATCH: the site says 30 days');
  });

  it('trialCheck absent or null (older caller): email renders as before', () => {
    const r = cleanReport();
    const a = renderHealthEmail(r);
    r.trialCheck = null;
    const b = renderHealthEmail(r);
    expect(a.text).toBe(b.text);
    expect(a.text).not.toContain('Free trial');
  });

  it('R6 fixed: a trial mismatch is ADDED to "N sources are behind on data", never replaces it', async () => {
    const r = cleanReport();
    r.sourceStates = { total: 3, behind: 2, counts: { healthy: 1, delayed: 1, degraded: 1, unavailable: 0, not_set_up: 0 }, attention: [], quiet: [] } as any;
    const without = renderHealthEmail(r);
    expect(without.subject).toBe('Holler health: 2 sources are behind on data');
    r.trialCheck = await loadTrialDbCheck(rpc(null, { code: 'PGRST202' }));
    const withTrial = renderHealthEmail(r);
    expect(withTrial.subject).toBe('Holler health: 2 sources are behind on data; free trial length does not match the database');
    r.trialCheck = { status: 'error', codeDays: 30, defaultDays: null, stampCapDays: null, guardCapDays: null } as TrialDbCheck;
    expect(renderHealthEmail(r).subject).toBe('Holler health: 2 sources are behind on data; could not check the free trial length');
  });
});
