'use server';

import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth/session';
import { saveProfile } from '@/lib/auth/profile';
import { applyPendingVerification } from '@/lib/auth/verification';
import type { ProfileFormState } from '@/lib/auth/profile-types';

export async function completeOnboarding(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const user = await getUser();
  if (!user) redirect('/login?next=/onboarding');
  const result = await saveProfile(user.id, formData);
  if (!result.ok) return result;
  // They may have clicked the confirm-email link before this profile existed.
  await applyPendingVerification(user);
  redirect('/app');
}
