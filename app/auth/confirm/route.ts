import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { safeNext } from '@/lib/auth/redirect';

const TYPES: EmailOtpType[] = ['recovery', 'email', 'signup', 'magiclink', 'invite', 'email_change'];

/** Exchanges the emailed token_hash for a session (verifyOtp), then redirects to `next`. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = safeNext(searchParams.get('next'), '/app');

  const fail = () => {
    const url = request.nextUrl.clone();
    url.pathname = type === 'recovery' ? '/forgot' : '/login';
    url.search = '';
    url.searchParams.set('error', 'link');
    return NextResponse.redirect(url);
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
  return NextResponse.redirect(url);
}
