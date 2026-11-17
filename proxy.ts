import { NextResponse, type NextRequest } from 'next/server';
import { decidePublicRoute } from '@/lib/seo/route-check';
import { updateSession } from '@/lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Public SEO paths: no cookies, no session, no Supabase. Unknown slugs get a real 404 on the first
  // request by rewriting to a path that does not exist, which renders app/not-found.tsx with status 404.
  if (pathname === '/local' || pathname.startsWith('/local/') || pathname === '/for' || pathname.startsWith('/for/')) {
    if (decidePublicRoute(pathname) === 'not-found') {
      const res = NextResponse.rewrite(new URL('/_holler-not-found', request.url), { status: 404 });
      res.headers.set('x-robots-tag', 'noindex');
      return res;
    }
    return NextResponse.next();
  }
  return updateSession(request);
}

// /app, /onboarding and the guest-only pages need the session. /local and /for only get the slug check;
// they never read or write cookies, so Set-Cookie headers can't interfere with their caching.
export const config = {
  matcher: ['/app/:path*', '/onboarding/:path*', '/login', '/signup', '/forgot', '/local/:path*', '/for/:path*'],
};
