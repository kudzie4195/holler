import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { friendlyAuthError, INVALID_LOGIN_MESSAGE, isConfigError, jsonError, readJson } from '@/lib/auth/api';
import { hasHollerTag } from '@/lib/auth/membership';
import { clientIp, hit, LIMITS, RATE_LIMIT_MESSAGE } from '@/lib/auth/ratelimit';

const body = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')),
  password: z.string().min(1, 'Enter your password.').max(200),
});

/**
 * Logs in only people who have a Holler account (app_metadata.products includes 'holler', or a
 * holler_profiles row exists). Anyone else on the shared project gets the same error as a wrong password,
 * and any session that was just created is dropped with scope 'local' so their other products' sessions survive.
 */
export async function POST(request: Request) {
  const input = await readJson(request, body);
  if (!input.ok) return input.response;

  try {
    const admin = createAdminClient();
    // Fail open: a broken limiter must not lock real customers out. Signup and forgot fail closed.
    const limited = await hit([LIMITS.loginIp(clientIp(request))], admin);
    if (limited === 'limited') return jsonError(RATE_LIMIT_MESSAGE, 429);

    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword(input.data);
    if (error || !data.user) {
      const { message, status } = friendlyAuthError(error ?? {});
      return jsonError(message, status);
    }

    let member = hasHollerTag(data.user.app_metadata);
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
      return jsonError(INVALID_LOGIN_MESSAGE, 401);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (isConfigError(e)) return jsonError('Log in is not switched on yet. Please check back soon.', 503);
    return jsonError('Something went wrong on our side. Try again in a moment.', 500);
  }
}
