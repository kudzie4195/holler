import type { SupabaseClient } from '@supabase/supabase-js';
import { trialEndFromStart, trialStartedAt } from './membership';

type Admin = Pick<SupabaseClient, 'from' | 'auth'>;

export type TrialOutcome = 'first' | 'returning' | 'unchanged' | 'error';

/** Lifecycle emails that are timed from trial_ends_at. When a trial end moves later, these may be sent again for the new end. */
const TRIAL_END_EMAILS = ['trial_ending', 'trial_ended'];
const HOUR = 3_600_000;
/**
 * An ENDED trial is moved to start + TRIAL_DAYS only when the new end is more than this far away, so the "trial ends in 3 days" email
 * (60 to 84 hours before the end, lib/lifecycle/select.ts) always comes before a second "Your alerts are paused" (review F1). Same rule as
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
 *  - Then, for everyone, the row's trial_ends_at is brought to start + TRIAL_DAYS (start = trialStartOf):
 *      later than that: cut back (a returning user's new row; usually already past, so they land on the upgrade card);
 *      earlier than that: moved out to it when mayExtendTrial allows (never paid, never past start + TRIAL_DAYS, an ended trial only with
 *      more than 72 hours left). This is what makes the site's 2-month headline true for a new member even while the database default
 *      is still 14 days (migration 0028 not applied yet): the code, not the column default, sets the length.
 *      When an end really moves later (the guarded UPDATE returned the row), the member's trial_ending / trial_ended lifecycle ledger rows
 *      are removed so those two emails can be sent again for the new end (opt-outs are kept).
 * The database enforces the cap where rows are written (migration 0003, trigger holler_profiles_trial_from_stamp, a BEFORE INSERT trigger;
 * 60 days since migration 0028), so a profile saved from settings or inserted directly with the user's own JWT cannot dodge it.
 * Needs the admin client: authenticated users cannot update trial_ends_at or app_metadata (migration 0004 billing guard; the service role
 * passes it). Never throws; a failure is logged and the save carries on (repairShortTrial retries on the member's next signed-in load).
 */
export async function applyTrialRules(admin: Admin, userId: string, now: Date = new Date()): Promise<TrialOutcome> {
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
    if (!prof) return outcome;
    const row = prof as TrialRow;

    const start: string = trialStartOf(row.created_at, stamp) ?? stamp ?? now.toISOString();
    const ends = trialEndFromStart(start);
    const endMs = Date.parse(ends);
    const current = parse(row.trial_ends_at);

    if (Number.isFinite(current) && current > endMs + SAME_END_MS) {
      const { error } = await admin.from('holler_profiles').update({ trial_ends_at: ends }).eq('user_id', userId);
      if (error) throw new Error(error.message);
      return outcome === 'first' ? 'first' : 'returning';
    }

    if (!mayExtendTrial(row, start, now.getTime())) return outcome;
    let q = admin
      .from('holler_profiles')
      .update({ trial_ends_at: ends })
      .eq('user_id', userId)
      .eq('subscription_status', 'trialing')
      .is('stripe_subscription_id', null)
      .lt('trial_ends_at', new Date(endMs - SAME_END_MS).toISOString());
    if ('plan_source' in row) q = q.or('plan_source.is.null,plan_source.eq.none');
    const { data: moved, error } = await q.select('user_id');
    if (error) throw new Error(error.message);
    // The guarded UPDATE matched nothing (the member subscribed between the read and the write): no extension, no ledger change (review F9).
    if (!Array.isArray(moved) || moved.length === 0) return outcome;
    await resetTrialEndEmails(admin, userId);
    return outcome === 'first' ? 'first' : 'returning';
  } catch (e) {
    console.error('applyTrialRules failed:', e instanceof Error ? e.message : String(e));
    return 'error';
  }
}

/**
 * Retry for a member whose onboarding server step failed while the database still gave 14 days (review F5): called on the member's
 * signed-in load (/app and GET /api/m/me). Pure check first, with the SAME guard as onboarding (mayExtendTrial, start from the stamp and
 * created_at), so a row that is already right costs no query; only a short never-paid row calls applyTrialRules with the admin client.
 * Returns the new trial end when the row was moved, else null. Never throws.
 */
export async function repairShortTrial(
  user: { id: string; app_metadata?: unknown },
  profile: TrialRow | null,
  admin: () => Admin,
  now: Date = new Date(),
): Promise<string | null> {
  try {
    if (!profile) return null;
    const start = trialStartOf(profile.created_at, trialStartedAt(user.app_metadata));
    if (!start || !mayExtendTrial(profile, start, now.getTime())) return null;
    const outcome = await applyTrialRules(admin(), user.id, now);
    return outcome === 'returning' || outcome === 'first' ? trialEndFromStart(start) : null;
  } catch (e) {
    console.error('repairShortTrial failed:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** Removes the member's trial_ending / trial_ended ledger rows (migration 0016). A missing table or a failure is logged, never thrown. */
async function resetTrialEndEmails(admin: Admin, userId: string): Promise<void> {
  try {
    const { error } = await admin.from('holler_lifecycle_sends').delete().eq('user_id', userId).in('kind', TRIAL_END_EMAILS);
    if (error) console.error('applyTrialRules lifecycle reset failed:', error.code ?? error.message);
  } catch (e) {
    console.error('applyTrialRules lifecycle reset failed:', e instanceof Error ? e.message : String(e));
  }
}
