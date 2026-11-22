// Regression tests from the r18 TRIAL review (probe 06); F10 fixed (wording when the function is missing, subject on a read error).
// Reviewer probe 06 (r18 TRIAL): the health email's trial line in every state, and that it can never throw.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { loadTrialDbCheck, trialCheckLine, type TrialDbCheck } from '../../lib/auth/trial-check';
import { planHealth, renderHealthEmail, type HealthCounts } from '../../lib/email/health';

const rpc = (data: unknown, error: any = null) => ({ rpc: async () => ({ data, error }) });
const counts: HealthCounts = { newSignups24h: 0, activeSubscribers: 0, trialing: 0, usersEmailed24h: 0 };
const NOW = new Date('2026-11-22T12:00:00Z');

describe('REV health trial line', () => {
  it('0028 applied: ok line, subject untouched', async () => {
    const c = await loadTrialDbCheck(rpc({ default_days: 60, stamp_cap_days: 60, guard_cap_days: 60 }));
    expect(c.status).toBe('ok');
    const r = planHealth({ adapters: [], runs: [], counts, now: NOW });
    const base = renderHealthEmail(r).subject;
    r.trialCheck = c;
    expect(renderHealthEmail(r).subject).toBe(base);
    expect(renderHealthEmail(r).text).toContain('the site says 60 days and the database enforces 60 days');
  });

  it('0028 missing (PostgREST PGRST202, Postgres 42883): MISMATCH line and subject', async () => {
    for (const code of ['PGRST202', '42883']) {
      const c = await loadTrialDbCheck(rpc(null, { code, message: 'Could not find the function public.holler_trial_db_check without parameters in the schema cache' }));
      expect(c.status).toBe('not_applied');
      const r = planHealth({ adapters: [], runs: [], counts, now: NOW });
      r.trialCheck = c;
      const m = renderHealthEmail(r);
      expect(m.subject).toBe('Holler health: free trial length does not match the database');
      expect(m.text).toContain('MISMATCH: the site says 60 days but holler_trial_db_check() is missing: migration 0028 is not applied, or the API has not reloaded its schema');
    }
  });

  it('0028 applied then 0019 re-run (14 everywhere), or one place differs: MISMATCH with each number', async () => {
    const c = await loadTrialDbCheck(rpc({ default_days: 14, stamp_cap_days: 14, guard_cap_days: 14 }));
    expect(trialCheckLine(c)).toBe('MISMATCH: the site says 60 days, the database has column default 14 days, one-trial cap 14 days, member insert cap 14 days. Apply the newest trial migration (LAUNCH.md, Rounds 18 and 19 order).');
  });

  it('hostile shapes never throw and never read as ok', async () => {
    const shapes: unknown[] = [null, undefined, 'x', 42, [], [{ default_days: 60, stamp_cap_days: 60, guard_cap_days: 60 }], { default_days: '60', stamp_cap_days: '60', guard_cap_days: '60' }, { default_days: 60 }, { default_days: NaN, stamp_cap_days: 60, guard_cap_days: 60 }, { default_days: 60.0, stamp_cap_days: 60, guard_cap_days: Infinity }];
    for (const s of shapes) {
      const c = await loadTrialDbCheck(rpc(s));
      expect(c.status, JSON.stringify(s)).toBe('mismatch');
      expect(() => trialCheckLine(c)).not.toThrow();
      const r = planHealth({ adapters: [], runs: [], counts, now: NOW });
      r.trialCheck = c;
      expect(() => renderHealthEmail(r)).not.toThrow();
    }
    for (const db of [{}, { rpc: null }, { rpc: () => { throw new Error('sync throw'); } }, { rpc: () => Promise.reject(new Error('down')) }, { rpc: async () => null }, { rpc: async () => ({}) }, null, undefined]) {
      const c = await loadTrialDbCheck(db as any);
      expect(['error', 'mismatch']).toContain(c.status);
      expect(() => trialCheckLine(c)).not.toThrow();
    }
    // a status the renderer does not know, and a null check
    const r = planHealth({ adapters: [], runs: [], counts, now: NOW });
    r.trialCheck = { status: 'weird', codeDays: 60, defaultDays: null, stampCapDays: null, guardCapDays: null } as unknown as TrialDbCheck;
    expect(() => renderHealthEmail(r)).not.toThrow();
    r.trialCheck = null;
    expect(renderHealthEmail(r).text).not.toContain('Free trial length');
  });

  it('F10 fixed: a timeout or permission error changes the subject, so a real mismatch cannot hide behind an all-clear', async () => {
    const c = await loadTrialDbCheck(rpc(null, { code: '42501', message: 'permission denied for function holler_trial_db_check' }));
    expect(c.status).toBe('error');
    const r = planHealth({ adapters: [], runs: [], counts, now: NOW });
    const base = renderHealthEmail(r).subject;
    r.trialCheck = c;
    expect(renderHealthEmail(r).subject).not.toBe(base);
    expect(renderHealthEmail(r).subject).toBe('Holler health: could not check the free trial length');
    expect(renderHealthEmail(r).text).toContain('a mismatch cannot be ruled out');
  });

  it('F10 fixed: function missing (0028 not applied, or a stale schema cache) no longer claims to have read the default', async () => {
    const c = await loadTrialDbCheck(rpc(null, { code: 'PGRST202' }));
    expect(trialCheckLine(c)).not.toContain('so the database default is still 14 days');
    expect(trialCheckLine(c)).toContain('or the API has not reloaded its schema');
  });

  it('FINDING (P3): {} from an rpc that resolves without data or error reads as mismatch "unreadable" (not as error)', async () => {
    const c = await loadTrialDbCheck({ rpc: async () => ({}) } as any);
    expect(c.status).toBe('mismatch');
    expect(trialCheckLine(c)).toContain('column default unreadable');
  });
});
