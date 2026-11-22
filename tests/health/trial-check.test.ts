// Round 18: the daily health email (/api/cron/health, Bearer only) compares the advertised trial (TRIAL_DAYS) with what the database
// enforces (holler_trial_db_check, migration 0028). Fakes only; the PostgREST codes for a missing function are PGRST202 and 42883.
import { describe, expect, it } from 'vitest';
import { loadTrialDbCheck, trialCheckLine } from '@/lib/auth/trial-check';
import { TRIAL_DAYS } from '@/lib/auth/membership';
import { planHealth, renderHealthEmail, type HealthCounts } from '@/lib/email/health';

const rpc = (data: unknown, error: { code?: string; message?: string } | null = null) => ({ rpc: async () => ({ data, error }) });
const NOW = new Date('2026-11-22T12:00:00Z');
const counts: HealthCounts = { newSignups24h: 0, activeSubscribers: 0, trialing: 0, usersEmailed24h: 0 };

describe('loadTrialDbCheck', () => {
  it('ok when all three database places equal TRIAL_DAYS (60)', async () => {
    const c = await loadTrialDbCheck(rpc({ default_days: 60, stamp_cap_days: 60, guard_cap_days: 60 }));
    expect(TRIAL_DAYS).toBe(60);
    expect(c).toEqual({ status: 'ok', codeDays: 60, defaultDays: 60, stampCapDays: 60, guardCapDays: 60 });
    expect(trialCheckLine(c)).toBe('Free trial: the site says 60 days and the database enforces 60 days (column default, one-trial cap, member insert cap).');
  });

  it('mismatch when any place differs (0019 re-run, or a hand edit)', async () => {
    const c = await loadTrialDbCheck(rpc({ default_days: 14, stamp_cap_days: 60, guard_cap_days: 60 }));
    expect(c.status).toBe('mismatch');
    expect(trialCheckLine(c)).toMatch(/^MISMATCH: the site says 60 days, the database has column default 14 days/);
    expect((await loadTrialDbCheck(rpc({ default_days: null, stamp_cap_days: 60, guard_cap_days: 60 }))).status).toBe('mismatch');
  });

  it('not_applied when the function is missing (PGRST202 or 42883): 0028 missing or a stale schema cache', async () => {
    for (const code of ['PGRST202', '42883']) {
      const c = await loadTrialDbCheck(rpc(null, { code, message: 'function not found' }));
      expect(c.status).toBe('not_applied');
      expect(trialCheckLine(c)).toContain('holler_trial_db_check() is missing: migration 0028 is not applied, or the API has not reloaded its schema. Until 0028 is applied the database default is 14 days');
    }
  });

  it('error on any other failure, and never throws', async () => {
    expect((await loadTrialDbCheck(rpc(null, { code: '57014', message: 'timeout' }))).status).toBe('error');
    expect((await loadTrialDbCheck({ rpc: () => Promise.reject(new Error('down')) })).status).toBe('error');
    expect((await loadTrialDbCheck({} as never)).status).toBe('error');
  });
});

describe('health email block', () => {
  it('shows the block, and a mismatch or missing migration names itself in the subject when nothing else is wrong', async () => {
    const report = planHealth({ adapters: [], runs: [], counts, now: NOW });
    report.trialCheck = await loadTrialDbCheck(rpc({ default_days: 60, stamp_cap_days: 60, guard_cap_days: 60 }));
    const ok = renderHealthEmail(report);
    expect(ok.text).toContain('Free trial length\n- Free trial: the site says 60 days and the database enforces 60 days');
    expect(ok.subject).not.toContain('free trial');
    report.trialCheck = await loadTrialDbCheck(rpc(null, { code: 'PGRST202' }));
    const bad = renderHealthEmail(report);
    expect(bad.subject).toBe('Holler health: free trial length does not match the database');
    expect(bad.text).toContain('MISMATCH');
  });
});
