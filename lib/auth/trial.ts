import type { SupabaseClient } from '@supabase/supabase-js';
import { trialCapFromStart, trialEndFromStart, trialStartedAt } from './membership';

type Admin = Pick<SupabaseClient, 'from' | 'auth'>;

export type TrialOutcome = 'first' | 'returning' | 'unchanged' | 'error';

/** Lifecycle emails that are timed from trial_ends_at. When a trial end moves later, these may be sent again for the new end. */
const TRIAL_END_EMAILS = ['trial_ending', 'trial_ended'];
const HOUR = 3_600_000;
/**
 * An ENDED trial is moved to start + TRIAL_DAYS only when the new end is more than this far away, so the "trial ends in 3 days" email
 * (36 to 84 hours before the end, normally sent at about 84 hours, lib/lifecycle/select.ts) always comes before a second "Your alerts are paused" (review F1). Same rule as
 * migration 0028.
 */
export const REVIVE_MIN_LEFT_MS = 72 * HOUR;
/** The app writes whole milliseconds and Postgres keeps microseconds: ends this close are the same end (review F4, as 0028). */
const SAME_END_MS = 1000;

export interface TrialRow {
  created_at: string | null;
  trial_ends_at: string | null;
  subscription_status: string;
  stripe_subscription_id?: string | null;
  /** Migration 0020. Absent when the column is not there. */
  plan_source?: string | null;
}

const parse = (s: unknown): number => (typeof s === 'string' ? Date.parse(s) : NaN);

/**
 * The person's one trial start: the earlier of the row's created_at and the app_metadata stamp (a stamp is normally the FIRST profile's
 * created_at; a stamp later than the row never pushes the start later, review F8, as 0028). Null when neither can be read.
 */
export function trialStartOf(createdAt: string | null | undefined, stamp: string | null): string | null {
  const c = parse(createdAt);
  const s = parse(stamp);
  if (Number.isFinite(c) && Number.isFinite(s)) return c < s ? String(createdAt) : String(stamp);
  if (Number.isFinite(s)) return String(stamp);
  if (Number.isFinite(c)) return String(createdAt);
  return null;
}

/** Never paid: still 'trialing', no Stripe subscription id, and no store plan (plan_source none, or the column absent). */
export function neverPaid(p: TrialRow): boolean {
  return p.subscription_status === 'trialing' && !p.stripe_subscription_id && (p.plan_source == null || p.plan_source === 'none');
}

/**
 * THE extension guard, shared by onboarding (applyTrialRules) and the signed-in repair (repairShortTrial): true when this never-paid row
 * ends earlier than start + TRIAL_DAYS and may be moved there. Never past start + TRIAL_DAYS (one trial per person, from the ORIGINAL
 * start), never a paid or store-billed row, never to an end already past, and an ended trial only when the reminder can still come first.
 */
export function mayExtendTrial(p: TrialRow, start: string, now: number): boolean {
  if (!neverPaid(p)) return false;
  const target = Date.parse(trialEndFromStart(start));
  const current = parse(p.trial_ends_at);
  if (!Number.isFinite(target) || target <= now) return false;
  if (Number.isFinite(current) && current >= target - SAME_END_MS) return false;
  if (Number.isFinite(current) && current <= now && target <= now + REVIVE_MIN_LEFT_MS) return false;
  return true;
}

/**
 * One free trial per person, not per profile row, and its end is always start + TRIAL_DAYS (lib/auth/membership.ts).
 * The auth user outlives "delete account" (shared project), so a returning user's new holler_profiles row would get the column default
 * of now() + the database's trial length (60 days with migration 0028; 14 days before it, migration 0019).
 *  - First profile: records holler_trial_started_at (the profile's created_at) in app_metadata.
 *  - Then, for everyone, the row's trial_ends_at is compared with start + TRIAL_DAYS (start = trialStartOf):
 *      later than start + TRIAL_MAX_DAYS: cut back to that cap. Round 23: the cap, not start + TRIAL_DAYS, so dropping TRIAL_DAYS from 60
 *      to 30 leaves every trial already granted exactly where it is (owner decision: existing trials keep their end date). A row between
 *      start + TRIAL_DAYS and the cap is not written at all.
 *      earlier than that: moved out to it when mayExtendTrial allows (never paid, never past start + TRIAL_DAYS, an ended trial only with
 *      more than 72 hours left). This is what makes the site's headline true for a new member even while the database default
 *      is still 14 days (migration 0028 not applied yet): the code, not the column default, sets the length.
 *      When an end really moves later (the guarded UPDATE returned the row), the member's trial_ending / trial_ended lifecycle ledger rows
 *      are removed so those two emails can be sent again for the new end (opt-outs are kept).
 * The database enforces the cap where rows are written (migration 0003, trigger holler_profiles_trial_from_stamp, a BEFORE INSERT trigger;
 * 60 days since migration 0028), so a profile saved from settings or inserted directly with the user's own JWT cannot dodge it.
 * Needs the admin client: authenticated users cannot update trial_ends_at or app_metadata (migration 0004 billing guard; the service role
 * passes it). Never throws; a failure is logged and the save carries on (repairShortTrial retries on the member's next signed-in load).
 */
export async function applyTrialRules(admin: Admin, userId: string, now: Date = new Date()): Promise<TrialOutcome> {
  return (await applyTrialRulesDetailed(admin, userId, now)).outcome;
}

export interface TrialRulesResult {
  outcome: TrialOutcome;
  /** True only when the guarded extension UPDATE really changed the row (it returned the row). */
  extended: boolean;
  /**
   * The trial end AS STORED in the row after this call: the value the write returned, or the value that was read when nothing was
   * written. Never a computed end the row does not hold (review r2 R4). Null when there is no row or the call failed.
   */
  storedEnd: string | null;
}

/** applyTrialRules, with what the row holds afterwards. Never throws. */
export async function applyTrialRulesDetailed(admin: Admin, userId: string, now: Date = new Date()): Promise<TrialRulesResult> {
  try {
    const { data: u, error: uErr } = await admin.auth.admin.getUserById(userId);
    if (uErr || !u?.user) throw new Error(uErr?.message ?? 'user not found');
    let stamp = trialStartedAt(u.user.app_metadata);

    // select('*'): plan_source is read when the column exists (migration 0020) and simply absent when it does not.
    const { data: prof, error: pErr } = await admin.from('holler_profiles').select('*').eq('user_id', userId).maybeSingle();
    if (pErr) throw new Error(pErr.message);

    let outcome: TrialOutcome = 'unchanged';
    if (!stamp) {
      const started = typeof prof?.created_at === 'string' && Number.isFinite(Date.parse(prof.created_at)) ? prof.created_at : now.toISOString();
      const { error } = await admin.auth.admin.updateUserById(userId, { app_metadata: { holler_trial_started_at: started } });
      if (error) throw new Error(error.message);
      stamp = started;
      outcome = 'first';
    }
    if (!prof) return { outcome, extended: false, storedEnd: null };
    const row = prof as TrialRow;
    const readEnd = typeof row.trial_ends_at === 'string' ? row.trial_ends_at : null;

    const start: string = trialStartOf(row.created_at, stamp) ?? stamp ?? now.toISOString();
    const ends = trialEndFromStart(start);
    const endMs = Date.parse(ends);
    const current = parse(row.trial_ends_at);

    // Round 23: the cut-back is measured against start + TRIAL_MAX_DAYS, not start + TRIAL_DAYS, so lowering TRIAL_DAYS to 30 cannot
    // shorten a trial a member already holds (a running 60-day trial sits at the cap and is left alone). Only an end beyond the cap,
    // which no Holler code ever wrote, is cut, and then to the cap.
    const cap = trialCapFromStart(start);
    const capMs = Date.parse(cap);
    if (Number.isFinite(current) && current > capMs + SAME_END_MS) {
      const { data: cut, error } = await admin.from('holler_profiles').update({ trial_ends_at: cap }).eq('user_id', userId).select('trial_ends_at');
      if (error) throw new Error(error.message);
      const stored = Array.isArray(cut) && cut.length > 0 ? String((cut[0] as { trial_ends_at: unknown }).trial_ends_at) : readEnd;
      return { outcome: outcome === 'first' ? 'first' : 'returning', extended: false, storedEnd: stored };
    }

    if (!mayExtendTrial(row, start, now.getTime())) return { outcome, extended: false, storedEnd: readEnd };
    let q = admin
      .from('holler_profiles')
      .update({ trial_ends_at: ends })
      .eq('user_id', userId)
      .eq('subscription_status', 'trialing')
      .is('stripe_subscription_id', null)
      .lt('trial_ends_at', new Date(endMs - SAME_END_MS).toISOString());
    if ('plan_source' in row) q = q.or('plan_source.is.null,plan_source.eq.none');
    const { data: moved, error } = await q.select('user_id, trial_ends_at');
    if (error) throw new Error(error.message);
    // The guarded UPDATE matched nothing (the member subscribed between the read and the write): no extension, no ledger change (review F9),
    // and the caller is told the end that was read, not the one that was not written (review r2 R4).
    if (!Array.isArray(moved) || moved.length === 0) {
      // Review r3 D1b: the row changed between the read and the write (a concurrent repair won, or the member subscribed), so the end
      // read above may be stale. Read what the row holds now (one more read, on this rare path only).
      const { data: fresh } = await admin.from('holler_profiles').select('trial_ends_at').eq('user_id', userId).maybeSingle();
      return { outcome, extended: false, storedEnd: typeof fresh?.trial_ends_at === 'string' ? fresh.trial_ends_at : readEnd };
    }
    // The end as the row holds it: from the write's own returned row, else read back. Never the computed `ends` (review r2 R4).
    let storedEnd: string | null = typeof (moved[0] as { trial_ends_at?: unknown }).trial_ends_at === 'string' ? String((moved[0] as { trial_ends_at: string }).trial_ends_at) : null;
    if (storedEnd === null) {
      const { data: again } = await admin.from('holler_profiles').select('trial_ends_at').eq('user_id', userId).maybeSingle();
      storedEnd = typeof again?.trial_ends_at === 'string' ? again.trial_ends_at : null;
    }
    // If this delete fails, the lifecycle cron clears the rows it finds stale for the new end (lib/lifecycle/select.ts staleTrialSends).
    await resetTrialEndEmails(admin, userId);
    return { outcome: outcome === 'first' ? 'first' : 'returning', extended: storedEnd !== null, storedEnd };
  } catch (e) {
    console.error('applyTrialRules failed:', e instanceof Error ? e.message : String(e));
    return { outcome: 'error', extended: false, storedEnd: null };
  }
}

/**
 * Retry for a member whose onboarding server step failed while the database still gave 14 days (review F5). Runs BEFORE anything reads
 * the trial end to show billing or to charge: /app, /app/settings (the trial emails link there), POST /api/stripe/checkout, GET /api/m/me
 * and PATCH /api/m/profile (review r2 R1); the lifecycle cron uses the same repair before a trial email (repairTrialForCron). Pure check
 * first, with the SAME guard as onboarding (mayExtendTrial, start from the stamp and created_at), so a row that is already right costs no
 * query; only a short never-paid row calls the admin client.
 * Returns the trial end AS STORED after the write when the row was really moved, else null (review r2 R4). Never throws.
 */
export async function repairShortTrial(
  user: { id: string; app_metadata?: unknown },
  profile: TrialRow | null,
  admin: () => Admin,
  now: Date = new Date(),
): Promise<string | null> {
  return (await repairShortTrialChecked(user, profile, admin, now)).end;
}

/**
 * repairShortTrial with two more answers (review r3 D1):
 *  - `end` is the trial end the row holds NOW whenever that is not the end the caller read: moved by this call, or by a concurrent repair
 *    (another tab, the app, the cron) that won the race. Null when the row still holds what the caller read.
 *  - `failed` is true when a repair was due and could not be carried out (an Auth admin or database error). A caller that charges
 *    (Checkout) must not go on with the short end then.
 */
export async function repairShortTrialChecked(
  user: { id: string; app_metadata?: unknown },
  profile: TrialRow | null,
  admin: () => Admin,
  now: Date = new Date(),
): Promise<{ end: string | null; failed: boolean }> {
  try {
    if (!profile) return { end: null, failed: false };
    const start = trialStartOf(profile.created_at, trialStartedAt(user.app_metadata));
    if (!start || !mayExtendTrial(profile, start, now.getTime())) return { end: null, failed: false };
    const was = parse(profile.trial_ends_at); // read before the call: the caller's object may be the one a write updates
    const r = await applyTrialRulesDetailed(admin(), user.id, now);
    if (r.outcome === 'error') return { end: null, failed: true };
    const same = r.storedEnd === null || Math.abs(Date.parse(r.storedEnd) - was) <= SAME_END_MS;
    return { end: same ? null : r.storedEnd, failed: false };
  } catch (e) {
    console.error('repairShortTrial failed:', e instanceof Error ? e.message : String(e));
    return { end: null, failed: true };
  }
}

/**
 * Removes the member's trial_ending / trial_ended ledger rows (migration 0016), up to three attempts. A missing table or a final failure is
 * logged, never thrown. It is not the only safeguard (review r2 R3): the lifecycle cron treats a trial_ending / trial_ended row that was
 * sent for an EARLIER end as stale and clears it before it selects (lib/lifecycle/select.ts staleTrialSends), so a lost delete delays
 * nothing.
 */
async function resetTrialEndEmails(admin: Admin, userId: string): Promise<boolean> {
  let last = '';
  for (let i = 0; i < 3; i++) {
    try {
      const { error } = await admin.from('holler_lifecycle_sends').delete().eq('user_id', userId).in('kind', TRIAL_END_EMAILS);
      if (!error) return true;
      last = error.code ?? error.message ?? 'error';
      if (error.code === 'PGRST205' || error.code === '42P01') break; // table missing: nothing to reset
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
  }
  console.error('applyTrialRules lifecycle reset failed (the lifecycle cron clears stale rows):', last);
  return false;
}

/**
 * The lifecycle cron's repair (review r2 R2): before a trial_ending or trial_ended email, a member the app would extend is extended first
 * and the email is skipped (the new end gets its own emails). Same guard as everywhere (mayExtendTrial via applyTrialRulesDetailed).
 * Returns the stored new end when the row moved, else null (then the email goes as usual). Never throws.
 */
export async function repairTrialForCron(admin: Admin, userId: string, now: Date = new Date()): Promise<string | null> {
  const r = await applyTrialRulesDetailed(admin, userId, now);
  // Review r3 D2: a failed repair THROWS (the cron then sends nothing in this run and tries again next hour), and the end returned is the
  // end the row holds now, moved by this call or not (the cron compares it with the end it loaded).
  if (r.outcome === 'error') throw new Error('trial repair failed');
  return r.storedEnd;
}
