'use server';

import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth/session';
import { saveProfile } from '@/lib/auth/profile';
import { createAdminClient } from '@/lib/supabase/admin';
import { backfillWithLimit } from '@/lib/signals/backfill-run';
import { applyTrialRules } from '@/lib/auth/trial';
import { applyPendingVerification } from '@/lib/auth/verification';
import type { ProfileFormState } from '@/lib/auth/profile-types';

export async function completeOnboarding(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const user = await getUser();
  if (!user) redirect('/login?next=/onboarding');
  const result = await saveProfile(user.id, formData);
  if (!result.ok) return result;
  // One free trial per person: stamp the first profile, or cut a returning user's new profile back to the original trial end.
  // Runs before the backfill and the redirect so /app already shows the right trial state. Never throws.
  try {
    await applyTrialRules(createAdminClient(), user.id);
  } catch (e) {
    console.error('onboarding trial rules failed:', e instanceof Error ? e.message : e);
  }
  // Fill the feed with the last two weeks. Awaited on purpose (unlike settings): the first screen after onboarding is /app, and a feed
  // that is still filling when it loads defeats the point. Rate limited and never throws into the save.
  await backfillWithLimit(user.id);
  // They may have clicked the confirm-email link before this profile existed.
  await applyPendingVerification(user);
  // The saved settings are unchanged; the next screen shows what Holler watches there (a past-records preview), then links on to /app.
  redirect('/onboarding/preview');
}
