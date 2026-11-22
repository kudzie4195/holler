import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { authMessage, friendlyAuthError, isConfigError, isEmailTaken, jsonError, readJsonLang } from '@/lib/auth/api';
import { clientIp, hit, LIMITS, RATE_LIMIT_MESSAGE } from '@/lib/auth/ratelimit';
import { sendVerifyEmail } from '@/lib/auth/verification';
import { SIGNUP_LANG_KEY } from '@/lib/auth/signup-lang';
import { t, type Lang } from '@/lib/i18n';

const body = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')),
  password: z.string().min(8, 'Use at least 8 characters.').max(72, 'Keep the password under 72 characters.'),
});

/** The same rules with the messages in the form's language. English is `body` itself. */
function bodyFor(lang: Lang) {
  if (lang === 'en') return body;
  return z.object({
    email: z.string().trim().toLowerCase().pipe(z.email(t(lang, 'api.email_invalid'))),
    password: z.string().min(8, t(lang, 'api.password_short')).max(72, t(lang, 'api.password_long')),
  });
}

/**
 * Creates the account with the admin client (email_confirm: true, so the shared project's
 * confirmation emails are never sent), tags it app_metadata.products=['holler'], then signs in with the
 * cookie-aware server client and sends Holler's own welcome + verify email.
 *
 * Shared project: if the email already exists the existing user is NOT touched, and the answer is the
 * generic "log in" shape, never a 409.
 *
 * Spanish (round 18 ES): the Spanish sign-up page sends lang 'es'. Messages come back in Spanish, the new user's app_metadata gets
 * holler_language 'es' (copied to the profile language column at onboarding, lib/auth/member-lang.ts), and the welcome + verify email
 * is in Spanish. An English body is handled exactly as before.
 */
export async function POST(request: Request) {
  const input = await readJsonLang(request, bodyFor);
  if (!input.ok) return input.response;
  const { email, password } = input.data;
  const lang = input.lang;
  const msg = (key: Parameters<typeof t>[1], en: string) => authMessage(lang, key, en);

  try {
    const admin = createAdminClient();
    const limited = await hit([LIMITS.signupIp(clientIp(request)), LIMITS.signupEmail(email)], admin);
    if (limited === 'limited') return jsonError(msg('api.rate', RATE_LIMIT_MESSAGE), 429);
    if (limited === 'error') return jsonError(msg('api.server', 'Something went wrong on our side. Try again in a moment.'), 503);

    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: lang === 'en' ? { products: ['holler'] } : { products: ['holler'], [SIGNUP_LANG_KEY]: lang },
    });
    if (created.error) {
      if (isEmailTaken(created.error)) {
        // Do not reveal that the address is registered, and do not modify that user (it may belong to another product).
        return NextResponse.json({
          ok: true,
          signedIn: false,
          next: lang === 'en' ? '/login' : '/es/login',
          message: msg('api.signup.exists', 'If you already have an account, log in.'),
        });
      }
      const { message, status } = friendlyAuthError(created.error, lang);
      return jsonError(message, status);
    }
    const userId = created.data.user.id;

    after(async () => {
      // The language of the page they signed up on: there is no profile yet.
      if (lang === 'en') await sendVerifyEmail(userId, email);
      else await sendVerifyEmail(userId, email, lang);
    });

    const supabase = await createClient();
    const signedIn = await supabase.auth.signInWithPassword({ email, password });
    if (signedIn.error) {
      return NextResponse.json({ ok: true, signedIn: false, next: lang === 'en' ? '/login' : '/es/login', message: msg('api.signup.exists', 'If you already have an account, log in.') });
    }
    return NextResponse.json({ ok: true, signedIn: true, next: lang === 'en' ? '/onboarding' : '/es/onboarding' });
  } catch (e) {
    if (isConfigError(e)) return jsonError(msg('api.signup.off', 'Sign-up is not switched on yet. Please check back soon.'), 503);
    return jsonError(msg('api.server', 'Something went wrong on our side. Try again in a moment.'), 500);
  }
}
