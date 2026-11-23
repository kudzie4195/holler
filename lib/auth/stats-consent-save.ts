import type { SupabaseClient } from '@supabase/supabase-js';
import { t, type Lang } from '@/lib/i18n';
import { statsConsentPatch } from './stats-consent';

export interface ConsentState {
  ok?: boolean;
  message?: string;
  error?: string;
}

type AdminAuth = Pick<SupabaseClient['auth']['admin'], 'getUserById' | 'updateUserById'>;

/**
 * Saves the member's answer to the data-use box (round 23). app_metadata is service-role only, so this takes the admin client's auth
 * admin, reads what is stored, and writes only when the answer really changes (lib/auth/stats-consent.ts statsConsentPatch keeps the
 * original tick time and adds revoked_at on an untick). Never throws: a failure comes back as a short message in the member's language.
 */
export async function saveStatsConsent(auth: AdminAuth, userId: string, consent: boolean, lang: Lang = 'en', now: Date = new Date()): Promise<ConsentState> {
  try {
    const { data, error } = await auth.getUserById(userId);
    if (error || !data?.user) return { error: t(lang, 'consent.error') };
    const patch = statsConsentPatch(data.user.app_metadata, consent, now);
    if (!patch) return { ok: true, message: t(lang, 'consent.saved') };
    const res = await auth.updateUserById(userId, { app_metadata: patch });
    if (res.error) return { error: t(lang, 'consent.error') };
    return { ok: true, message: t(lang, 'consent.saved') };
  } catch {
    return { error: t(lang, 'consent.error') };
  }
}
