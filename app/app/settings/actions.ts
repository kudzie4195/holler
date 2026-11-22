'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { getProfile, getUser } from '@/lib/auth/session';
import { deleteHollerAccount } from '@/lib/mobile/account';
import { saveProfile } from '@/lib/auth/profile';
import { saveLanguage, type LanguageState } from '@/lib/auth/language';
import { backfillWithLimit } from '@/lib/signals/backfill-run';
import { applyTrialRules } from '@/lib/auth/trial';
import type { ProfileFormState } from '@/lib/auth/profile-types';
import { cleanKeyword, parseExtraAreas, parseKeywords } from '@/lib/plan';
import { langOfProfile, parseLang, t, type Lang } from '@/lib/i18n';
import { setLangCookieFromAction } from '@/lib/auth/lang-cookie';

export async function saveSettings(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const user = await getUser();
  if (!user) redirect('/login?next=/app/settings');
  const before = await getProfile(user.id).catch(() => null);
  // The words of the answers follow the member's saved choice (round 18 ES); English calls the save exactly as before.
  const lang: Lang = langOfProfile(before);
  const result =
    lang === 'en'
      ? await saveProfile(user.id, formData, { alertEmail: formData.get('alert_email') === 'on' })
      : await saveProfile(user.id, formData, { alertEmail: formData.get('alert_email') === 'on', lang });
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

/**
 * True when anything matching reads changed: categories, ZIP, radius, the extra ZIPs or the keyword watches (or there was no profile).
 * A new extra area or keyword therefore triggers the same backfill as a new main ZIP, and the backfill covers every area the plan allows.
 */
function targetingChanged(
  before: { categories: string[] | null; zip: string | null; radius_mi: number; extra_areas?: unknown; keywords?: unknown } | null,
  formData: FormData,
): boolean {
  if (!before) return true;
  const set = (list: string[]) => [...new Set(list)].sort().join(',');
  const has = (k: string) => formData.has(k);
  return (
    set(formData.getAll('categories').map(String)) !== set(before.categories ?? []) ||
    String(formData.get('zip') ?? '').trim() !== (before.zip ?? '') ||
    Number(formData.get('radius') ?? 25) !== before.radius_mi ||
    // Extra ZIPs and keywords are only on the form for Pro members; when absent they did not change.
    (has('extra_zip') &&
      set(formData.getAll('extra_zip').map((v) => String(v).trim()).filter(Boolean)) !== set(parseExtraAreas(before.extra_areas).map((a) => a.zip))) ||
    (has('keyword') &&
      set(formData.getAll('keyword').map((v) => cleanKeyword(String(v)).toLowerCase()).filter(Boolean)) !==
        set(parseKeywords(before.keywords).map((k) => k.toLowerCase())))
  );
}

export interface DeleteState {
  error?: string;
}

const DELETE_ERROR = "We couldn't delete your account. Try again in a moment.";

/**
 * Deletes the user's Holler account on a project shared with other products. The steps live in one place,
 * lib/mobile/account.ts deleteHollerAccount, shared with the app's POST /api/m/account/delete: cancel Holler Stripe subscriptions
 * (nothing is deleted if that fails), stamp the trial start, delete matches, push tokens and the profile, untag the shared sign-in
 * (never deleted). Then this session only is signed out (scope 'local').
 */
export async function deleteAccount(_prev?: DeleteState, formData?: FormData): Promise<DeleteState> {
  // The Spanish Settings page sends ui_lang 'es' (round 18 ES): the answers and the page after deleting are Spanish then.
  const lang: Lang = parseLang(formData?.get('ui_lang'));
  const err = (key: Parameters<typeof t>[1], en: string) => (lang === 'en' ? en : t(lang, key));
  const user = await getUser();
  if (!user) redirect(lang === 'en' ? '/login' : '/es/login');

  let admin: ReturnType<typeof createAdminClient>;
  let profile: Awaited<ReturnType<typeof getProfile>>;
  try {
    admin = createAdminClient();
    profile = await getProfile(user.id);
  } catch {
    return { error: err('del.err', DELETE_ERROR) };
  }
  const res = await deleteHollerAccount({ admin, userId: user.id, stripe: getStripe(), profile });
  if (!res.ok) {
    return res.error === 'billing_cancel_failed'
      ? { error: err('del.err_billing', "We couldn't cancel your subscription, so we haven't deleted anything. Open Manage billing, cancel there, then try again.") }
      : { error: err('del.err', DELETE_ERROR) };
  }

  try {
    const supabase = await createClient();
    // 'local': never end the user's sessions in other products.
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // The stale cookie is harmless and fails verification.
  }
  redirect(lang === 'en' ? '/' : '/es');
}

/**
 * Saves the member's language (English or Español). Separate from saveSettings on purpose: a database without migration 0024 has no
 * `language` column, and that must never make "Save changes" fail. Without the column this writes nothing and shows no error.
 */
export async function saveLanguageSetting(_prev: LanguageState, formData: FormData): Promise<LanguageState> {
  const user = await getUser();
  if (!user) redirect('/login?next=/app/settings');
  const supabase = await createClient();
  const result = await saveLanguage(supabase, user.id, formData.get('language'));
  // The cards, the header and the settings page read the language from the profile on every request. The hint cookie follows the
  // saved choice, so the static header shows the right words on the next full load (lib/auth/lang-cookie.ts).
  if (result.ok && !result.skipped) {
    await setLangCookieFromAction(parseLang(formData.get('language')));
    revalidatePath('/app', 'layout');
  }
  return result;
}
