import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { safeNext } from '@/lib/auth/redirect';

const TYPES: EmailOtpType[] = ['recovery', 'email', 'signup', 'magiclink', 'invite', 'email_change'];

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
  const type = field('type') as EmailOtpType | null;
  const next = safeNext(field('next'), '/app');

  const fail = () => {
    const url = request.nextUrl.clone();
    url.pathname = type === 'recovery' ? '/forgot' : '/login';
    url.search = '';
    url.searchParams.set('error', 'link');
    return NextResponse.redirect(url, 303);
  };

  if (!tokenHash || !type || !TYPES.includes(type)) return fail();

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return fail();
  } catch {
    return fail();
  }

  const url = request.nextUrl.clone();
  url.pathname = next.split('?')[0];
  url.search = next.includes('?') ? `?${next.split('?').slice(1).join('?')}` : '';
  return NextResponse.redirect(url, 303);
}
