'use server';

import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth/session';
import { saveProfile } from '@/lib/auth/profile';
import { createAdminClient } from '@/lib/supabase/admin';
import { backfillWithLimit } from '@/lib/signals/backfill-run';
import { applyTrialRules } from '@/lib/auth/trial';
import { recordSignup } from '@/lib/analytics/request';
import { priorTrial, shouldRecordSignup } from '@/lib/analytics/signup';
import { applyPendingVerification } from '@/lib/auth/verification';
import type { ProfileFormState } from '@/lib/auth/profile-types';
import { saveLanguage } from '@/lib/auth/language';
import { signupLang } from '@/lib/auth/signup-lang';
import { createClient } from '@/lib/supabase/server';
import { parseLang } from '@/lib/i18n';

export async function completeOnboarding(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const user = await getUser();
  // The form's language (round 18 ES): the Spanish onboarding page sends ui_lang 'es'. It only changes the words of the answers.
  const formLang = parseLang(formData.get('ui_lang'));
  if (!user) redirect(formLang === 'en' ? '/login?next=/onboarding' : `/es/login?next=${encodeURIComponent('/es/onboarding')}`);
  const result = formLang === 'en' ? await saveProfile(user.id, formData) : await saveProfile(user.id, formData, { lang: formLang });
  if (!result.ok) return result;
  // Signed up on a Spanish page: the new profile's language is Spanish (migration 0024). Its own update through the member's client,
  // after the profile exists; without the column it writes nothing and the account stays English (lib/auth/language.ts saveLanguage).
  let spanish = false;
  if (formLang === 'es' || signupLang(user.app_metadata) === 'es') {
    try {
      const saved = await saveLanguage(await createClient(), user.id, 'es');
      // Only a saved language makes the account Spanish; before migration 0024 it stays English, and so does the next page.
      spanish = saved.ok === true && !saved.skipped;
    } catch (e) {
      console.error('onboarding language save failed:', e instanceof Error ? e.message : e);
    }
  }
  // Read the one-trial stamp BEFORE applyTrialRules writes it: a stamp that is already there means this person had a profile before
  // (deleted it and came back) or re-submitted the form, so this is not a new signup. Never throws.
  const prior = await priorTrial(user.id);
  // One free trial per person: stamp the first profile, or cut a returning user's new profile back to the original trial end.
  // Runs before the backfill and the redirect so /app already shows the right trial state. Never throws.
  let trial: Awaited<ReturnType<typeof applyTrialRules>> = 'error';
  try {
    trial = await applyTrialRules(createAdminClient(), user.id);
  } catch (e) {
    console.error('onboarding trial rules failed:', e instanceof Error ? e.message : e);
  }
  // Funnel: signup and trial_start, with the first-touch campaign from the holler_src cookie. Only for a first profile: a returning member
  // (deleted their profile and came back) is not a new signup or trial start. The database trigger already cuts a returning member's trial
  // on insert, so applyTrialRules says 'unchanged' for them and cannot tell; the stamp read above can. Never throws.
  if (shouldRecordSignup(prior, trial)) await recordSignup(user.id);
  // Fill the feed with the last two weeks. Awaited on purpose (unlike settings): the first screen after onboarding is /app, and a feed
  // that is still filling when it loads defeats the point. Rate limited and never throws into the save.
  await backfillWithLimit(user.id);
  // They may have clicked the confirm-email link before this profile existed.
  await applyPendingVerification(user);
  // The saved settings are unchanged; the next screen shows what Holler watches there (a past-records preview), then links on to /app.
  redirect(spanish ? '/es/onboarding/preview' : '/onboarding/preview');
}
