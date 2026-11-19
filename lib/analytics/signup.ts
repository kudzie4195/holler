import { createAdminClient } from '@/lib/supabase/admin';
import { trialStartedAt } from '@/lib/auth/membership';

/**
 * Whether completing onboarding is a new signup (and trial start) for the funnel. shouldRecordSignup is pure; priorTrial reads auth.
 *
 * prior: the person's one-trial stamp (auth app_metadata holler_trial_started_at) read BEFORE this save.
 *   'none'     no stamp: this is their first profile.
 *   'stamped'  a stamp exists: they had a profile before (deleted it and came back) or re-submitted the form. Not a new signup.
 *   'unknown'  the read failed.
 * trial: what applyTrialRules (lib/auth/trial.ts) did. 'first' means it found no stamp and wrote one, so it is the backup signal when
 * the earlier read failed. A returning member usually gets 'unchanged' (the database trigger already cut the trial), never 'first'.
 */
export type PriorTrial = 'none' | 'stamped' | 'unknown';

export function shouldRecordSignup(prior: PriorTrial, trial: string): boolean {
  if (prior === 'stamped') return false;
  if (prior === 'none') return true;
  return trial === 'first';
}

/**
 * The person's one-trial stamp as it is BEFORE this save (read it before applyTrialRules, which writes it for a first profile).
 * 'stamped' means they had a Holler profile before. Never throws: a failed read is 'unknown'.
 */
export async function priorTrial(userId: string): Promise<PriorTrial> {
  try {
    const { data, error } = await createAdminClient().auth.admin.getUserById(userId);
    if (error || !data?.user) return 'unknown';
    return trialStartedAt(data.user.app_metadata) ? 'stamped' : 'none';
  } catch {
    return 'unknown';
  }
}
