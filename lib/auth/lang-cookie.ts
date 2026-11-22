// Type only: the proxy imports this file, and it must not pull the dictionaries into the proxy bundle.
import type { Lang } from '@/lib/i18n';

/**
 * The language hint cookie (round 18 ES, review P2-4): `holler_lang=en|es`. It only tells the browser which words to show in the static
 * /app header before the member's own header streams in (components/app-header.tsx APP_LANG_SCRIPT), and lets the proxy send an expired
 * Spanish session to /es/login. It holds nothing but the language code.
 *
 * Not HttpOnly on purpose: the inline script reads it. Secure, SameSite=Lax, Path=/, one year. The server never renders a page from it
 * (pages read the profile), so a wrong or forged value can only change the words of a placeholder for that one browser.
 *
 * Set at sign-in and sign-up (the routes), at onboarding and when the language is saved in Settings (server actions); cleared at sign-out.
 */
export const LANG_COOKIE = 'holler_lang';

export const LANG_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

export function langCookieOptions(): { path: string; sameSite: 'lax'; secure: boolean; httpOnly: false; maxAge: number } {
  return { path: '/', sameSite: 'lax', secure: true, httpOnly: false, maxAge: LANG_COOKIE_MAX_AGE };
}

/** The value of the hint from a cookie header or a cookie value. Anything but exactly 'es' is English. */
export function langFromCookieValue(v: string | null | undefined): Lang {
  return v === 'es' ? 'es' : 'en';
}

/** Minimal response shape (NextResponse.cookies) so the routes and the tests share one setter. */
interface CookieSink {
  cookies: { set: (name: string, value: string, options: Record<string, unknown>) => unknown };
}

export function setLangCookie(res: CookieSink, lang: Lang): void {
  res.cookies.set(LANG_COOKIE, lang, langCookieOptions());
}

export function clearLangCookie(res: CookieSink): void {
  res.cookies.set(LANG_COOKIE, '', { ...langCookieOptions(), maxAge: 0 });
}

/**
 * From a server action: sets the hint through next/headers. Never throws (outside a request, as in a unit test, it does nothing).
 */
export async function setLangCookieFromAction(lang: Lang): Promise<void> {
  try {
    const { cookies } = await import('next/headers');
    (await cookies()).set(LANG_COOKIE, lang, langCookieOptions());
  } catch {
    // not in a request: nothing to set
  }
}
