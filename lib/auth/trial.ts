import type { SupabaseClient } from '@supabase/supabase-js';
import { trialEndFromStart, trialStartedAt } from './membership';

type Admin = Pick<SupabaseClient, 'from' | 'auth'>;

export type TrialOutcome = 'first' | 'returning' | 'unchanged' | 'error';

/**
 * One free trial per person, not per profile row. The auth user outlives "delete account" (shared project), so a returning user's new
 * holler_profiles row would get the column default of now() + TRIAL_DAYS days (14; migration 0019).
 *  - First profile: records holler_trial_started_at (the profile's created_at) in app_metadata. The default trial_ends_at stands.
 *  - Already stamped (deleted and came back, or re-submitted onboarding): sets trial_ends_at to start + TRIAL_DAYS, which for a returning
 *    user is usually already past, so they land on the upgrade card instead of a new trial.
 * The database enforces the same rule where rows are written (migration 0003, trigger holler_profiles_trial_from_stamp: a BEFORE INSERT
 * trigger, 14 days since migration 0019, cuts trial_ends_at to stamp + 14 days), so a profile saved from settings or inserted directly with the user's own JWT cannot
 * dodge it. This function still does two jobs the trigger cannot: it writes the stamp for a first profile, and it repairs a row that
 * was inserted before the trigger existed.
 * Needs the admin client: authenticated users cannot update trial_ends_at or app_metadata. Never throws; a failure is logged and the
 * save carries on.
 */
export async function applyTrialRules(admin: Admin, userId: string, now: Date = new Date()): Promise<TrialOutcome> {
  try {
    const { data: u, error: uErr } = await admin.auth.admin.getUserById(userId);
    if (uErr || !u?.user) throw new Error(uErr?.message ?? 'user not found');
    const stamp = trialStartedAt(u.user.app_metadata);

    if (!stamp) {
      const { data: prof, error: pErr } = await admin.from('holler_profiles').select('created_at').eq('user_id', userId).maybeSingle();
      if (pErr) throw new Error(pErr.message);
      const started = typeof prof?.created_at === 'string' && Number.isFinite(Date.parse(prof.created_at)) ? prof.created_at : now.toISOString();
      const { error } = await admin.auth.admin.updateUserById(userId, { app_metadata: { holler_trial_started_at: started } });
      if (error) throw new Error(error.message);
      return 'first';
    }

    const ends = trialEndFromStart(stamp);
    const { data: prof, error: pErr } = await admin.from('holler_profiles').select('trial_ends_at').eq('user_id', userId).maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!prof) return 'unchanged';
    const current = Date.parse(String(prof.trial_ends_at));
    if (Number.isFinite(current) && current <= Date.parse(ends)) return 'unchanged';
    const { error } = await admin.from('holler_profiles').update({ trial_ends_at: ends }).eq('user_id', userId);
    if (error) throw new Error(error.message);
    return 'returning';
  } catch (e) {
    console.error('applyTrialRules failed:', e instanceof Error ? e.message : String(e));
    return 'error';
  }
}
