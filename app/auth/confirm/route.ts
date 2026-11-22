import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { isConfirmType } from '@/lib/auth/otp';
import { safeNext } from '@/lib/auth/redirect';
import { originAllowed } from '@/lib/auth/origin';
import { env, siteUrl } from '@/lib/env';
import { RECOVERY_COOKIE, recoveryCookieOptions, signRecoveryProof } from '@/lib/auth/recovery';

/**
 * Two-step confirm so email link scanners (which GET every link) cannot burn single-use tokens.
 *  GET  /auth/confirm?token_hash&type&next  -> redirects to /auth/confirm/continue, a page with a button. Consumes nothing.
 *  POST /auth/confirm (token_hash, type, next in the form body) -> verifyOtp, then redirects to `next`.
 */
export function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = '/auth/confirm/continue';
  return NextResponse.redirect(url, 307);
}

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const field = (k: string) => {
    const v = form?.get(k);
    return typeof v === 'string' ? v : null;
  };
  const tokenHash = field('token_hash');
  const rawType = field('type');
  const type: EmailOtpType | null = isConfirmType(rawType) ? rawType : null;
  const next = safeNext(field('next'), '/app');

  const fail = () => {
    const url = request.nextUrl.clone();
    url.pathname = '/forgot';
    url.search = '';
    url.searchParams.set('error', 'link');
    return NextResponse.redirect(url, 303);
  };

  if (!originAllowed(request, siteUrl)) return fail();
  if (!tokenHash || !type) return fail();

  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return fail();
    userId = data?.user?.id ?? null;
  } catch {
    return fail();
  }

  const url = request.nextUrl.clone();
  url.pathname = next.split('?')[0];
  url.search = next.includes('?') ? `?${next.split('?').slice(1).join('?')}` : '';
  const res = NextResponse.redirect(url, 303);
  // SEC-4: proof for POST /api/auth/reset that this browser opened a recovery link (lib/auth/recovery.ts).
  if (type === 'recovery' && userId && env.CRON_SECRET) {
    res.cookies.set(RECOVERY_COOKIE, signRecoveryProof(userId, env.CRON_SECRET), recoveryCookieOptions());
  }
  return res;
}
