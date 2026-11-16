'use server';

import { redirect } from 'next/navigation';
import { getStripe, isHollerMetadata } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { getProfile, getUser } from '@/lib/auth/session';
import { leaveHollerPatch } from '@/lib/auth/membership';
import { saveProfile } from '@/lib/auth/profile';
import type { ProfileFormState } from '@/lib/auth/profile-types';

export async function saveSettings(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const user = await getUser();
  if (!user) redirect('/login?next=/app/settings');
  return saveProfile(user.id, formData, { alertEmail: formData.get('alert_email') === 'on' });
}

export interface DeleteState {
  error?: string;
}

const DELETE_ERROR = "We couldn't delete your account. Try again in a moment.";

/**
 * Deletes the user's Holler account on a project shared with other products.
 *  1. Cancels only Holler subscriptions (metadata.app === 'holler'); if that fails nothing else is deleted.
 *  2. Deletes Holler rows (matches, then profile).
 *  3. Strips 'holler' from app_metadata.products and sets holler_left_at. The shared auth user is NEVER deleted
 *     (other products depend on it), so a retry after any partial failure is safe.
 *  4. Signs out this session only (scope 'local').
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

    // Holler rows only. Matches first; profile last.
    const { error: mErr } = await admin.from('holler_matches').delete().eq('user_id', user.id);
    if (mErr) return { error: DELETE_ERROR };
    const { error: pErr } = await admin.from('holler_profiles').delete().eq('user_id', user.id);
    if (pErr) return { error: DELETE_ERROR };

    const { data: fresh, error: gErr } = await admin.auth.admin.getUserById(user.id);
    if (gErr || !fresh?.user) return { error: DELETE_ERROR };
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      app_metadata: leaveHollerPatch(fresh.user.app_metadata, new Date()),
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
