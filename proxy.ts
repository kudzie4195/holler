import { NextResponse, type NextRequest } from 'next/server';
import { decidePublicRoute } from '@/lib/seo/route-check';
import { updateSession } from '@/lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Public SEO paths: no cookies, no session, no Supabase. Unknown slugs get a real 404 on the first
  // request by rewriting to a path that does not exist, which renders app/not-found.tsx with status 404. That includes weekly pages
  // (/local/<state>/<city>/week/<date>) whose date is malformed, not a Monday, in the future or older than the 12 week window.
  if (
    pathname === '/local' ||
    pathname.startsWith('/local/') ||
    pathname === '/for' ||
    pathname.startsWith('/for/') ||
    pathname.startsWith('/guides/') ||
    pathname === '/storms' ||
    pathname.startsWith('/storms/')
  ) {
    if (decidePublicRoute(pathname, Date.now()) === 'not-found') {
      const res = NextResponse.rewrite(new URL('/_holler-not-found', request.url), { status: 404 });
      res.headers.set('x-robots-tag', 'noindex');
      return res;
    }
    return NextResponse.next();
  }
  return updateSession(request);
}

// /app, /onboarding and the guest-only pages need the session. /local, /for, /storms and /guides/<slug> only get the slug check;
// they never read or write cookies, so Set-Cookie headers can't interfere with their caching. The /guides hub itself is not matched.
export const config = {
  matcher: ['/app/:path*', '/onboarding/:path*', '/login', '/signup', '/forgot', '/local/:path*', '/for/:path*', '/guides/:path+', '/storms', '/storms/:path*'],
};
