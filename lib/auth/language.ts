import type { SupabaseClient } from '@supabase/supabase-js';
import { isLang, t, parseLang, type Lang } from '@/lib/i18n';

export interface LanguageState {
  ok?: boolean;
  /** True when nothing was written because the database has no `language` column yet (migration 0024 not applied). Never an error. */
  skipped?: boolean;
  message?: string;
  error?: string;
}

/** The profile row has a language setting only when migration 0024 is applied (select('*') then returns the key). */
export function hasLanguageSetting(profile: object | null | undefined): boolean {
  return !!profile && Object.prototype.hasOwnProperty.call(profile, 'language');
}

/** Postgres 42703 (undefined column) or PostgREST PGRST204 (column not in the schema cache): migration 0024 is not applied. */
function columnMissing(e: { code?: string | null; message?: string | null } | null): boolean {
  if (!e) return false;
  if (e.code === '42703' || e.code === 'PGRST204') return true;
  return /column/i.test(e.message ?? '') && /language/i.test(e.message ?? '');
}

/**
 * Saves the member's language on their own profile row, in its own update (never inside the main profile save, so a missing column can
 * never break "Save changes"). Only 'en' and 'es' are accepted. With migration 0024 not applied it writes nothing and returns
 * { ok: true, skipped: true } with no error. Any other failure returns a short error in the language the member chose.
 */
export async function saveLanguage(
  supabase: Pick<SupabaseClient, 'from'>,
  userId: string,
  raw: unknown,
): Promise<LanguageState> {
  if (!isLang(raw)) return { error: t('en', 'settings.language.error') };
  const lang: Lang = parseLang(raw);
  try {
    const { error } = await supabase.from('holler_profiles').update({ language: lang }).eq('user_id', userId);
    if (columnMissing(error)) return { ok: true, skipped: true };
    if (error) return { error: t(lang, 'settings.language.error') };
    return { ok: true, message: t(lang, 'settings.language.saved') };
  } catch {
    return { error: t(lang, 'settings.language.error') };
  }
}
