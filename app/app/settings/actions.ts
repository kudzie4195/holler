'use server';

import { redirect } from 'next/navigation';
import Stripe from 'stripe';
import { env } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { getProfile, getUser } from '@/lib/auth/session';
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

/**
 * Deletes the auth user (profiles and matches cascade via foreign keys).
 * An active Stripe subscription is cancelled first so a deleted account is never billed again.
 */
export async function deleteAccount(): Promise<DeleteState> {
  const user = await getUser();
  if (!user) redirect('/login');

  try {
    const profile = await getProfile(user.id);
    if (profile?.stripe_subscription_id && env.STRIPE_SECRET_KEY) {
      try {
        await new Stripe(env.STRIPE_SECRET_KEY).subscriptions.cancel(profile.stripe_subscription_id);
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code !== 'resource_missing') {
          return { error: "We couldn't cancel your subscription, so we haven't deleted anything. Open Manage billing, cancel there, then try again." };
        }
      }
    }
    const { error } = await createAdminClient().auth.admin.deleteUser(user.id);
    if (error) return { error: "We couldn't delete your account. Try again in a moment." };
  } catch {
    return { error: "We couldn't delete your account. Try again in a moment." };
  }

  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // The user is already gone; the stale cookie is harmless and fails verification.
  }
  redirect('/');
}
