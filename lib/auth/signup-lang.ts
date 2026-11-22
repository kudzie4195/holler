import { parseLang, type Lang } from '@/lib/i18n';

/**
 * The language of the page a person signed up on (round 18 ES), parked by POST /api/auth/signup in app_metadata.holler_language until
 * the profile exists (the same parking idea as holler_email_verified_at in lib/auth/verification.ts). app_metadata is written by the
 * service role only. Pure, so client-free server code and tests can import it without the session helpers.
 */
export const SIGNUP_LANG_KEY = 'holler_language';

/** The language parked at sign-up, from a user's app_metadata. Anything but exactly 'es' is English. */
export function signupLang(appMetadata: unknown): Lang {
  return parseLang((appMetadata as Record<string, unknown> | null | undefined)?.[SIGNUP_LANG_KEY]);
}
