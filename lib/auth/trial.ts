import type { SupabaseClient } from '@supabase/supabase-js';
import { trialEndFromStart, trialStartedAt } from './membership';

type Admin = Pick<SupabaseClient, 'from' | 'auth'>;

export type TrialOutcome = 'first' | 'returning' | 'unchanged' | 'error';

/** Lifecycle emails that are timed from trial_ends_at. When a trial end moves later, these may be sent again for the new end. */
const TRIAL_END_EMAILS = ['trial_ending', 'trial_ended'];

/**
 * One free trial per person, not per profile row, and its end is always start + TRIAL_DAYS (lib/auth/membership.ts).
 * The auth user outlives "delete account" (shared project), so a returning user's new holler_profiles row would get the column default
 * of now() + the database's trial length (60 days with migration 0028; 14 days before it, migration 0019).
 *  - First profile: records holler_trial_started_at (the profile's created_at) in app_metadata.
 *  - Then, for everyone, the row's trial_ends_at is brought to start + TRIAL_DAYS:
 *      later than that: cut back (a returning user's new row; usually already past, so they land on the upgrade card);
 *      earlier than that: moved out to it, but ONLY for a row that never paid (status 'trialing', no Stripe subscription id), and only
 *      when start + TRIAL_DAYS is still ahead. This is what makes the site's 2-month headline (TRIAL_HEADLINE) true for a new member even while the
 *      database default is still 14 days (migration 0028 not applied yet): the code, not the column default, sets the length.
 *      When an end moves later, the member's trial_ending / trial_ended lifecycle ledger rows are removed so those two emails can be
 *      sent again for the new end (opt-outs are kept).
 * The database enforces the cap where rows are written (migration 0003, trigger holler_profiles_trial_from_stamp, a BEFORE INSERT trigger;
 * 60 days since migration 0028), so a profile saved from settings or inserted directly with the user's own JWT cannot dodge it.
 * Needs the admin client: authenticated users cannot update trial_ends_at or app_metadata (migration 0004 billing guard; the service role
 * passes it). Never throws; a failure is logged and the save carries on.
 */
export async function applyTrialRules(admin: Admin, userId: string, now: Date = new Date()): Promise<TrialOutcome> {
  try {
    const { data: u, error: uErr } = await admin.auth.admin.getUserById(userId);
    if (uErr || !u?.user) throw new Error(uErr?.message ?? 'user not found');
    let stamp = trialStartedAt(u.user.app_metadata);

    const { data: prof, error: pErr } = await admin
      .from('holler_profiles')
      .select('created_at, trial_ends_at, subscription_status, stripe_subscription_id')
      .eq('user_id', userId)
      .maybeSingle();
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

    const ends = trialEndFromStart(stamp);
    const endMs = Date.parse(ends);
    const current = Date.parse(String(prof.trial_ends_at));
    if (Number.isFinite(current) && current === endMs) return outcome;

    if (Number.isFinite(current) && current > endMs) {
      const { error } = await admin.from('holler_profiles').update({ trial_ends_at: ends }).eq('user_id', userId);
      if (error) throw new Error(error.message);
      return outcome === 'first' ? 'first' : 'returning';
    }

    // Earlier than start + TRIAL_DAYS: extend only a trial that never paid, and only to an end that is still ahead.
    if (prof.subscription_status !== 'trialing' || prof.stripe_subscription_id) return outcome;
    if (endMs <= now.getTime()) return outcome;
    const { error } = await admin
      .from('holler_profiles')
      .update({ trial_ends_at: ends })
      .eq('user_id', userId)
      .eq('subscription_status', 'trialing')
      .is('stripe_subscription_id', null)
      .lt('trial_ends_at', ends);
    if (error) throw new Error(error.message);
    await resetTrialEndEmails(admin, userId);
    return outcome === 'first' ? 'first' : 'returning';
  } catch (e) {
    console.error('applyTrialRules failed:', e instanceof Error ? e.message : String(e));
    return 'error';
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
