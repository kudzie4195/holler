import { TRIAL_DAYS } from './membership';
import { mayExtendTrial, type TrialRow } from './trial';

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
  /**
   * Round 18 integration (review 3 D4): when the database is not at TRIAL_DAYS, the real number of never-paid members whose row still ends
   * earlier than the app would move it (countShortTrials). Null when it could not be counted; absent when not read.
   */
  shortTrials?: number | null;
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

type From = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Review 3 D4: how many never-paid members still hold a trial the app would move to signup + TRIAL_DAYS (mayExtendTrial, with the signup
 * date as the start: a returning member's earlier stamp is in Auth and is not read here, so such a member may be counted). The health line
 * states this count instead of saying the hourly email job moves everyone (it moves only members due a trial email). Read only; null on
 * any error.
 */
export async function countShortTrials(db: From, now: Date): Promise<number | null> {
  try {
    const since = new Date(now.getTime() - TRIAL_DAYS * 86_400_000).toISOString();
    const { data, error } = await db.from('holler_profiles').select('*').eq('subscription_status', 'trialing').gt('created_at', since).limit(5000);
    if (error || !Array.isArray(data)) return null;
    return (data as TrialRow[]).filter((r) => typeof r.created_at === 'string' && mayExtendTrial(r, r.created_at, now.getTime())).length;
  } catch {
    return null;
  }
}

const d = (n: number | null): string => (n === null ? 'unreadable' : `${n} days`);
const shortLine = (c: TrialDbCheck): string =>
  c.shortTrials === undefined
    ? ''
    : c.shortTrials === null
      ? ' Members still on a shorter trial could not be counted.'
      : ` Today ${c.shortTrials} never-paid ${c.shortTrials === 1 ? 'member still holds' : 'members still hold'} a shorter trial that the app would move (counted from the signup date).`;

/** One line for the health email. */
export function trialCheckLine(c: TrialDbCheck): string {
  switch (c.status) {
    case 'ok':
      return `Free trial: the site says ${c.codeDays} days and the database enforces ${c.codeDays} days (column default, one-trial cap, member insert cap).`;
    case 'mismatch':
      return `MISMATCH: the site says ${c.codeDays} days, the database has column default ${d(c.defaultDays)}, one-trial cap ${d(c.stampCapDays)}, member insert cap ${d(c.guardCapDays)}.${shortLine(c)} Apply the newest trial migration (LAUNCH.md, Round 18 order).`;
    case 'not_applied':
      return `MISMATCH: the site says ${c.codeDays} days but holler_trial_db_check() is missing: migration 0028 is not applied, or the API has not reloaded its schema. Until 0028 is applied the database default is 14 days.${shortLine(c)} The app moves a never-paid member to ${c.codeDays} days at signup and when they open the app, Settings or Checkout; the hourly email job moves only members due a trial email (verified, not unsubscribed). Everyone else keeps the 14-day end until they sign in or 0028 is applied. Apply supabase/migrations/0028_holler_trial_60.sql (LAUNCH.md, Round 18 order).`;
    default:
      return 'Free trial: could not read the database trial length (holler_trial_db_check failed), so a mismatch cannot be ruled out. Check it today.';
  }
}
