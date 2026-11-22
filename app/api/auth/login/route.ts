import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { authMessage, friendlyAuthError, INVALID_LOGIN_MESSAGE, isConfigError, jsonError, readJsonLang } from '@/lib/auth/api';
import { t, type Lang } from '@/lib/i18n';
import { setLangCookie } from '@/lib/auth/lang-cookie';
import { loadMemberLang } from '@/lib/auth/member-lang';
import { signupLang } from '@/lib/auth/signup-lang';
import { hasHollerTag, hasLeftHoller, rejoinHollerPatch } from '@/lib/auth/membership';
import { clientIp, hit, LIMITS, RATE_LIMIT_MESSAGE } from '@/lib/auth/ratelimit';

const body = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')),
  password: z.string().min(1, 'Enter your password.').max(200),
});

/** The same rules with the messages in the form's language (the Spanish log-in page sends lang 'es'). English is `body` itself. */
function bodyFor(lang: Lang) {
  if (lang === 'en') return body;
  return z.object({
    email: z.string().trim().toLowerCase().pipe(z.email(t(lang, 'api.email_invalid'))),
    password: z.string().min(1, t(lang, 'api.password_missing')).max(200),
  });
}

/**
 * Logs in only people who have a Holler account (app_metadata.products includes 'holler', or a
 * holler_profiles row exists). Anyone else on the shared project gets the same error as a wrong password,
 * and any session that was just created is dropped with scope 'local' so their other products' sessions survive.
 */
export async function POST(request: Request) {
  const input = await readJsonLang(request, bodyFor);
  if (!input.ok) return input.response;
  const lang = input.lang;
  const msg = (key: Parameters<typeof t>[1], en: string) => authMessage(lang, key, en);
  const credentials = { email: input.data.email, password: input.data.password };

  try {
    const admin = createAdminClient();
    // Fail open: a broken limiter must not lock real customers out. Signup and forgot fail closed.
    const limited = await hit([LIMITS.loginIp(clientIp(request))], admin);
    if (limited === 'limited') return jsonError(msg('api.rate', RATE_LIMIT_MESSAGE), 429);

    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword(credentials);
    if (error || !data.user) {
      const { message, status } = friendlyAuthError(error ?? {}, lang);
      return jsonError(message, status);
    }

    let member = hasHollerTag(data.user.app_metadata);
    if (!member && hasLeftHoller(data.user.app_metadata)) {
      // Former member coming back: re-tag. They have no profile, so they land in onboarding.
      const { error: rErr } = await admin.auth.admin.updateUserById(data.user.id, {
        app_metadata: rejoinHollerPatch(data.user.app_metadata),
      });
      if (rErr) {
        await supabase.auth.signOut({ scope: 'local' });
        return jsonError(msg('api.server', 'Something went wrong on our side. Try again in a moment.'), 500);
      }
      member = true;
    }
    if (!member) {
      const { data: profile, error: pErr } = await admin
        .from('holler_profiles')
        .select('user_id')
        .eq('user_id', data.user.id)
        .maybeSingle();
      member = !pErr && Boolean(profile);
    }
    if (!member) {
      await supabase.auth.signOut({ scope: 'local' });
      return jsonError(msg('api.invalid_login', INVALID_LOGIN_MESSAGE), 401);
    }
    const res = NextResponse.json({ ok: true });
    // The language hint for the /app header (lib/auth/lang-cookie.ts): the saved profile language, else the one parked at sign-up.
    // A failed read is English; the hint never decides what a page shows.
    setLangCookie(res, (await loadMemberLang(admin, data.user.id)) ?? signupLang(data.user.app_metadata));
    return res;
  } catch (e) {
    if (isConfigError(e)) return jsonError(msg('api.login.off', 'Log in is not switched on yet. Please check back soon.'), 503);
    return jsonError(msg('api.server', 'Something went wrong on our side. Try again in a moment.'), 500);
  }
}
