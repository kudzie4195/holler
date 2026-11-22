import { TRIAL_DAYS } from './membership';

/**
 * Advertised trial length (TRIAL_DAYS, what every page and email says) against the length the database enforces, for the daily health
 * email (/api/cron/health, Bearer only). The database side comes from holler_trial_db_check() (migration 0028), which reads the
 * catalog: the trial_ends_at column default, the one-trial stamp trigger's cap and the billing guard's cap on a member's own insert.
 * Read-only. Never throws.
 */
export interface TrialDbCheck {
  /** 'ok': all three equal TRIAL_DAYS. 'mismatch': at least one differs. 'not_applied': migration 0028 is not there yet. 'error': read failed. */
  status: 'ok' | 'mismatch' | 'not_applied' | 'error';
  codeDays: number;
  defaultDays: number | null;
  stampCapDays: number | null;
  guardCapDays: number | null;
}

type Rpc = { rpc: (fn: string) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> };

/** PostgREST and Postgres codes for "this function does not exist". */
const MISSING_FUNCTION = new Set(['PGRST202', '42883']);

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function loadTrialDbCheck(db: Rpc, codeDays: number = TRIAL_DAYS): Promise<TrialDbCheck> {
  const empty = { codeDays, defaultDays: null, stampCapDays: null, guardCapDays: null };
  try {
    const { data, error } = await db.rpc('holler_trial_db_check');
    if (error) return { ...empty, status: MISSING_FUNCTION.has(error.code ?? '') ? 'not_applied' : 'error' };
    const d = (data ?? {}) as Record<string, unknown>;
    const out = { codeDays, defaultDays: num(d.default_days), stampCapDays: num(d.stamp_cap_days), guardCapDays: num(d.guard_cap_days) };
    const same = out.defaultDays === codeDays && out.stampCapDays === codeDays && out.guardCapDays === codeDays;
    return { ...out, status: same ? 'ok' : 'mismatch' };
  } catch {
    return { ...empty, status: 'error' };
  }
}

const d = (n: number | null): string => (n === null ? 'unreadable' : `${n} days`);

/** One line for the health email. */
export function trialCheckLine(c: TrialDbCheck): string {
  switch (c.status) {
    case 'ok':
      return `Free trial: the site says ${c.codeDays} days and the database enforces ${c.codeDays} days (column default, one-trial cap, member insert cap).`;
    case 'mismatch':
      return `MISMATCH: the site says ${c.codeDays} days, the database has column default ${d(c.defaultDays)}, one-trial cap ${d(c.stampCapDays)}, member insert cap ${d(c.guardCapDays)}. Apply the newest trial migration (LAUNCH.md, Round 18 order).`;
    case 'not_applied':
      return `MISMATCH: the site says ${c.codeDays} days but migration 0028 is not applied, so the database default is still 14 days. New members are moved to ${c.codeDays} days by the app at signup; existing trials are not. Apply supabase/migrations/0028_holler_trial_60.sql (LAUNCH.md, Round 18 order).`;
    default:
      return 'Free trial: could not read the database trial length (holler_trial_db_check failed).';
  }
}
