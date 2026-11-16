import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isConfigError, jsonError } from '@/lib/auth/api';
import { hit, LIMITS, RATE_LIMIT_MESSAGE } from '@/lib/auth/ratelimit';
import { sendVerifyEmail } from '@/lib/auth/verification';

/** Signed-in users only. 3 per hour per user. Does nothing if the profile is already verified. */
export async function POST(request: Request) {
  // application/json requirement doubles as a CSRF guard (a cross-site form cannot send it).
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return jsonError('Unsupported request.', 415);
  }
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user?.email) return jsonError('Log in to do that.', 401);

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from('holler_profiles')
      .select('email_verified_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!profile) return jsonError('Finish setting up your alerts first.', 400);
    if (profile.email_verified_at) return NextResponse.json({ ok: true, alreadyVerified: true });

    const limited = await hit([LIMITS.verifyResendUser(user.id)], admin);
    if (limited === 'limited') return jsonError(RATE_LIMIT_MESSAGE, 429);
    if (limited === 'error') return jsonError('Something went wrong on our side. Try again in a moment.', 503);

    const sent = await sendVerifyEmail(user.id, user.email);
    if (!sent) return jsonError('We could not send that email right now. Try again in a moment.', 502);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (isConfigError(e)) return jsonError('Email is not switched on yet.', 503);
    return jsonError('Something went wrong on our side. Try again in a moment.', 500);
  }
}
