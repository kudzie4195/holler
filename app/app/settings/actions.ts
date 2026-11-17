'use server';

import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { getStripe, isHollerMetadata } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { getProfile, getUser } from '@/lib/auth/session';
import { leaveHollerPatch } from '@/lib/auth/membership';
import { saveProfile } from '@/lib/auth/profile';
import { backfillWithLimit } from '@/lib/signals/backfill-run';
import { applyTrialRules } from '@/lib/auth/trial';
import type { ProfileFormState } from '@/lib/auth/profile-types';

export async function saveSettings(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const user = await getUser();
  if (!user) redirect('/login?next=/app/settings');
  const before = await getProfile(user.id).catch(() => null);
  const result = await saveProfile(user.id, formData, { alertEmail: formData.get('alert_email') === 'on' });
  // A server action can be called without the page's guard, so this save may create the user's FIRST profile (no onboarding). The database
  // trigger (migration 0003, holler_profiles_trial_from_stamp) already stops a returning user from getting a second trial; this records
  // the trial start for a first-time user so it counts later. Never throws into the save.
  if (result.ok && !before) {
    try {
      await applyTrialRules(createAdminClient(), user.id);
    } catch (e) {
      console.error('settings trial rules failed:', e instanceof Error ? e.message : e);
    }
  }
  if (result.ok && targetingChanged(before, formData)) {
    // After the response: the save never waits for the 1000-row read, and a failure never reaches the user.
    // Limited to 6 an hour per user (backfillWithLimit), so repeated saves cannot hammer the database.
    const userId = user.id;
    after(async () => {
      const out = await backfillWithLimit(userId);
      if (!out.ran) console.warn(`settings backfill skipped: ${out.reason}`);
    });
  }
  return result;
}

/** True when categories, ZIP or radius differ from the saved profile (or there was no profile). */
function targetingChanged(
  before: { categories: string[] | null; zip: string | null; radius_mi: number } | null,
  formData: FormData,
): boolean {
  if (!before) return true;
  const cats = (list: string[]) => [...new Set(list)].sort().join(',');
  return (
    cats(formData.getAll('categories').map(String)) !== cats(before.categories ?? []) ||
    String(formData.get('zip') ?? '').trim() !== (before.zip ?? '') ||
    Number(formData.get('radius') ?? 25) !== before.radius_mi
  );
}

export interface DeleteState {
  error?: string;
}

const DELETE_ERROR = "We couldn't delete your account. Try again in a moment.";

/**
 * Deletes the user's Holler account on a project shared with other products.
 *  1. Cancels only Holler subscriptions (metadata.app === 'holler'); if that fails nothing else is deleted.
 *  2. Writes the trial stamp (app_metadata.holler_trial_started_at, from the profile's created_at) BEFORE any row is deleted, so a failure
 *     later cannot leave a deleted profile with no stamp (the profile is the only record of when the trial started; without the stamp
 *     coming back would grant a second trial). The write is idempotent and touches nothing else.
 *  3. Deletes Holler rows (matches, then profile).
 *  4. Strips 'holler' from app_metadata.products and sets holler_left_at. The shared auth user is NEVER deleted
 *     (other products depend on it), so a retry after any partial failure is safe.
 *  5. Signs out this session only (scope 'local').
 */
export async function deleteAccount(): Promise<DeleteState> {
  const user = await getUser();
  if (!user) redirect('/login');

  try {
    const admin = createAdminClient();
    const profile = await getProfile(user.id);

    const stripe = getStripe();
    if (stripe && profile && (profile.stripe_subscription_id || profile.stripe_customer_id)) {
      try {
        const ids = new Set<string>();
        if (profile.stripe_customer_id) {
          const subs = await stripe.subscriptions.list({ customer: profile.stripe_customer_id, status: 'all', limit: 100 });
          for (const sub of subs.data) {
            if (isHollerMetadata(sub.metadata) && sub.status !== 'canceled' && sub.status !== 'incomplete_expired') ids.add(sub.id);
          }
        }
        if (profile.stripe_subscription_id) {
          try {
            const sub = await stripe.subscriptions.retrieve(profile.stripe_subscription_id);
            if (isHollerMetadata(sub.metadata) && sub.status !== 'canceled' && sub.status !== 'incomplete_expired') ids.add(sub.id);
          } catch (e) {
            if ((e as { code?: string }).code !== 'resource_missing') throw e;
          }
        }
        for (const id of ids) {
          try {
            await stripe.subscriptions.cancel(id);
          } catch (e) {
            if ((e as { code?: string }).code !== 'resource_missing') throw e;
          }
        }
      } catch {
        return { error: "We couldn't cancel your subscription, so we haven't deleted anything. Open Manage billing, cancel there, then try again." };
      }
    }

    // Stamp first: the profile row is the only record of when the trial started, and the next step deletes it.
    const { data: before, error: bErr } = await admin.auth.admin.getUserById(user.id);
    if (bErr || !before?.user) return { error: DELETE_ERROR };
    const stamp = leaveHollerPatch(before.user.app_metadata, new Date(), profile?.created_at).holler_trial_started_at;
    if (stamp !== undefined) {
      const { error: sErr } = await admin.auth.admin.updateUserById(user.id, { app_metadata: { holler_trial_started_at: stamp } });
      if (sErr) return { error: DELETE_ERROR };
    }

    // Holler rows only. Matches first; profile last.
    const { error: mErr } = await admin.from('holler_matches').delete().eq('user_id', user.id);
    if (mErr) return { error: DELETE_ERROR };
    const { error: pErr } = await admin.from('holler_profiles').delete().eq('user_id', user.id);
    if (pErr) return { error: DELETE_ERROR };

    const { data: fresh, error: gErr } = await admin.auth.admin.getUserById(user.id);
    if (gErr || !fresh?.user) return { error: DELETE_ERROR };
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      app_metadata: leaveHollerPatch(fresh.user.app_metadata, new Date(), profile?.created_at),
    });
    if (error) return { error: DELETE_ERROR };
  } catch {
    return { error: DELETE_ERROR };
  }

  try {
    const supabase = await createClient();
    // 'local': never end the user's sessions in other products.
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // The stale cookie is harmless and fails verification.
  }
  redirect('/');
}
