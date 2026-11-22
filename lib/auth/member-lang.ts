import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseLang, type Lang } from '@/lib/i18n';
import { getProfile, getUser } from './session';
import { SIGNUP_LANG_KEY, signupLang } from './signup-lang';

/**
 * The member's language, for pages and emails (round 18, unit ES).
 *
 *  - With a profile: the profile's language column (migration 0024). A database without the column reads as English.
 *  - Before the profile exists (between sign-up and onboarding): the language of the page the person signed up on, parked by
 *    POST /api/auth/signup in app_metadata.holler_language (the same parking idea as holler_email_verified_at in verification.ts).
 *    app_metadata is written by the service role only, so a member cannot set it for someone else.
 *  - Signed out, or any failure: English.
 */
export { SIGNUP_LANG_KEY, signupLang };

/** The signed-in member's language. Never throws, never redirects. Uses the per-request cached user and profile reads. */
export async function memberLang(): Promise<Lang> {
  try {
    const user = await getUser();
    if (!user) return 'en';
    const profile = await getProfile(user.id).catch(() => null);
    if (profile) return parseLang(profile.language);
    return signupLang(user.app_metadata);
  } catch {
    return 'en';
  }
}

/**
 * Saved languages of many members, read in chunks of 100 (lib/moat/run.ts does the same). A member with no row, no column (migration
 * 0024 not applied) or a failed chunk is simply not in the map: English. Never throws.
 */
export async function loadMemberLangs(db: Pick<SupabaseClient, 'from'>, userIds: string[]): Promise<Map<string, Lang>> {
  const out = new Map<string, Lang>();
  for (let i = 0; i < userIds.length; i += 100) {
    try {
      const { data, error } = await db.from('holler_profiles').select('user_id, language').in('user_id', userIds.slice(i, i + 100));
      if (error) continue;
      for (const row of (data ?? []) as Array<{ user_id?: unknown; language?: unknown }>) {
        if (typeof row.user_id === 'string' && (row.language === 'es' || row.language === 'en')) out.set(row.user_id, row.language);
      }
    } catch {
      // English
    }
  }
  return out;
}

/**
 * The language hint for the browser at sign-in (lib/auth/lang-cookie.ts): exactly what memberLang() says for this user. A profile row
 * decides (English when the row has no language column, migration 0024 not applied); the language parked at sign-up counts only while
 * there is no row; any error is English. `select('*')` on purpose: it never fails on a missing column. Never throws.
 */
export async function hintLang(db: Pick<SupabaseClient, 'from'>, user: { id: string; app_metadata?: unknown }): Promise<Lang> {
  try {
    const { data, error } = await db.from('holler_profiles').select('*').eq('user_id', user.id).maybeSingle();
    if (error) return 'en';
    if (data) return parseLang((data as { language?: unknown }).language);
    return signupLang(user.app_metadata as Parameters<typeof signupLang>[0]);
  } catch {
    return 'en';
  }
}

/**
 * One member's saved language, read with the service role for an email sent outside a page (verify resend, password reset, lifecycle).
 * null when there is no profile row, no language column (migration 0024 not applied: Postgres 42703, PostgREST PGRST204), or any error,
 * so the caller falls back to what it already knows (the sign-up language, then the page). Never throws.
 */
export async function loadMemberLang(db: Pick<SupabaseClient, 'from'>, userId: string): Promise<Lang | null> {
  try {
    const { data, error } = await db.from('holler_profiles').select('language').eq('user_id', userId).maybeSingle();
    if (error || !data) return null;
    const v = (data as { language?: unknown }).language;
    return v === 'es' || v === 'en' ? v : null;
  } catch {
    return null;
  }
}
