import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { friendlyAuthError, isConfigError, jsonError, readJson } from '@/lib/auth/api';
import { amrHasRecentRecovery, cookieFromHeader, RECOVERY_COOKIE, recoveryCookieOptions, recoveryProofValid } from '@/lib/auth/recovery';
import { env } from '@/lib/env';

const EXPIRED = 'This reset link has expired. Ask for a new one.';

const body = z.object({
  password: z.string().min(8, 'Use at least 8 characters.').max(72, 'Keep the password under 72 characters.'),
});

/**
 * Sets a new password for the session created by /auth/confirm (type=recovery). SEC-4: a signed-in session alone is not enough; the
 * request must carry the recovery proof cookie for this user, or the session must have been created by a recovery link in the last
 * 15 minutes (lib/auth/recovery.ts). Anything else is the same "expired" answer as no session.
 */
export async function POST(request: Request) {
  const input = await readJson(request, body);
  if (!input.ok) return input.response;

  try {
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return jsonError(EXPIRED, 401);

    const proof = cookieFromHeader(request.headers.get('cookie'), RECOVERY_COOKIE);
    let allowed = recoveryProofValid(proof, userData.user.id, env.CRON_SECRET);
    if (!allowed) {
      const { data: claims } = await supabase.auth.getClaims().catch(() => ({ data: null }));
      allowed = claims?.claims?.sub === userData.user.id && amrHasRecentRecovery((claims?.claims as { amr?: unknown } | undefined)?.amr);
    }
    if (!allowed) return jsonError(EXPIRED, 403);

    const { error } = await supabase.auth.updateUser({ password: input.data.password });
    if (error) {
      const { message, status } = friendlyAuthError(error);
      return jsonError(message, status);
    }
    const res = NextResponse.json({ ok: true });
    // One reset per link: the proof is spent.
    res.cookies.set(RECOVERY_COOKIE, '', { ...recoveryCookieOptions(), maxAge: 0 });
    return res;
  } catch (e) {
    if (isConfigError(e)) return jsonError('Password reset is not switched on yet.', 503);
    return jsonError('Something went wrong on our side. Try again in a moment.', 500);
  }
}
