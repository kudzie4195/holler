import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isConfigError, jsonError } from '@/lib/auth/api';
import { hit, LIMITS, RATE_LIMIT_MESSAGE } from '@/lib/auth/ratelimit';
import { sendConfirmOnlyEmail } from '@/lib/mobile/verify-email';
import { loadMemberLang } from '@/lib/auth/member-lang';
import { parseLang, t } from '@/lib/i18n';

/**
 * Signed-in users only. 3 per hour per user. Does nothing if the profile is already verified. The profile exists here, so the trial has
 * started (or a returning member's trial kept its first end): send the plain confirm message, not the signup welcome's trial promise.
 * Language (round 18 ES): the app's notice sends lang 'es' for a Spanish member, and the answers are Spanish then. The email is in the
 * member's saved language (profile column); before migration 0024, or on any read failure, it is English as before.
 */
export async function POST(request: Request) {
  // application/json requirement doubles as a CSRF guard (a cross-site form cannot send it).
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return jsonError('Unsupported request.', 415);
  }
  const raw = (await request.json().catch(() => null)) as { lang?: unknown } | null;
  const lang = parseLang(raw?.lang);
  const msg = (key: Parameters<typeof t>[1], en: string) => (lang === 'en' ? en : t(lang, key));
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user?.email) return jsonError(msg('api.verify.login', 'Log in to do that.'), 401);

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from('holler_profiles')
      .select('email_verified_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!profile) return jsonError(msg('api.verify.setup_first', 'Finish setting up your alerts first.'), 400);
    if (profile.email_verified_at) return NextResponse.json({ ok: true, alreadyVerified: true });

    const limited = await hit([LIMITS.verifyResendUser(user.id)], admin);
    if (limited === 'limited') return jsonError(msg('api.rate', RATE_LIMIT_MESSAGE), 429);
    if (limited === 'error') return jsonError(msg('api.server', 'Something went wrong on our side. Try again in a moment.'), 503);

    const mailLang = await loadMemberLang(admin, user.id);
    const sent = mailLang === 'es' ? await sendConfirmOnlyEmail(user.id, user.email, 'es') : await sendConfirmOnlyEmail(user.id, user.email);
    if (!sent) return jsonError(msg('api.verify.send_failed', 'We could not send that email right now. Try again in a moment.'), 502);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (isConfigError(e)) return jsonError(msg('api.verify.off', 'Email is not switched on yet.'), 503);
    return jsonError(msg('api.server', 'Something went wrong on our side. Try again in a moment.'), 500);
  }
}
