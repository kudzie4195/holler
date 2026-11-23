import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { sessionCookieOptions } from './cookie-options';
import { LANG_COOKIE } from '@/lib/auth/lang-cookie';

const PROTECTED = ['/app', '/onboarding', '/es/onboarding'];
const GUEST_ONLY = ['/login', '/signup', '/forgot', '/es/login', '/es/signup', '/es/forgot'];

/**
 * Where a signed-out visitor logs in: the Spanish log-in for a Spanish page, or for /app when the browser's language hint says Spanish
 * (an expired Spanish session, lib/auth/lang-cookie.ts). Everything else is /login, as before.
 */
function loginPathFor(request: NextRequest, pathname: string): string {
  if (pathname === '/es' || pathname.startsWith('/es/')) return '/es/login';
  return request.cookies.get(LANG_COOKIE)?.value === 'es' ? '/es/login' : '/login';
}

function matches(pathname: string, bases: string[]) {
  return bases.some((b) => pathname === b || pathname.startsWith(`${b}/`));
}

/**
 * Refreshes the Supabase session cookie and applies the route gate:
 * - /app, /onboarding and /es/onboarding need a user, otherwise redirect to /login?next=... (/es/login for a Spanish visitor)
 * - /login, /signup, /forgot and their /es twins send a signed-in user to /app
 * Profile-less users are sent to /onboarding by the data access layer (lib/auth/session.ts).
 */
export async function updateSession(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let response = NextResponse.next({ request });
  let signedIn = false;

  if (url && anon) {
    const supabase = createServerClient(url, anon, {
      cookieOptions: sessionCookieOptions(),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
        },
      },
    });
    try {
      // getClaims verifies the JWT signature, so a forged cookie does not pass.
      const { data } = await supabase.auth.getClaims();
      signedIn = Boolean(data?.claims?.sub);
    } catch {
      signedIn = false;
    }
  }

  const redirectTo = (target: URL) => {
    const redirect = NextResponse.redirect(target);
    // Carry refreshed session cookies onto the redirect.
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  };

  if (!signedIn && matches(pathname, PROTECTED)) {
    const target = request.nextUrl.clone();
    target.pathname = loginPathFor(request, pathname);
    target.search = '';
    target.searchParams.set('next', `${pathname}${search}`);
    return redirectTo(target);
  }

  if (signedIn && matches(pathname, GUEST_ONLY)) {
    const target = request.nextUrl.clone();
    target.pathname = '/app';
    target.search = '';
    return redirectTo(target);
  }

  return response;
}
